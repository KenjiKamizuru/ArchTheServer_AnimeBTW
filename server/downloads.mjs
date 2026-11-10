// Local download manager.
//
// Two engines can queue episodes:
//   - ani-cli  → shells out to `ani-cli -d`, which resolves the stream and lets
//                yt-dlp/ffmpeg write into a scratch folder in ./library; the
//                finished file is then adopted into the library.
//   - http     → streams a direct URL straight to disk.
//
// Both expose byte progress, speed and cancellation, and run at most two jobs
// at a time so the UI stays responsive on slow links.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { resolveSource } from './settings.mjs'
import * as anicli from './anicli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const LIBRARY_DIR = path.join(ROOT, 'library')
const DATA_DIR = path.join(ROOT, 'data')
const STATE_FILE = path.join(DATA_DIR, 'downloads.json')
const ANICLI_DIR = path.join(LIBRARY_DIR, '.anicli')
const MAX_ACTIVE = 2
const VIDEO_EXT = /\.(mp4|mkv|webm|m4v|mov|ts)$/i
const SUB_EXT = /\.(vtt|srt|ass|ssa)$/i
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export const bus = new EventEmitter()
bus.setMaxListeners(200)

const jobs = new Map()
const controllers = new Map()
const removed = new Set()
let saveTimer = null
let repairScheduled = false

const snapshot = (job) => ({ ...job })

function persist() {
  if (saveTimer) return
  saveTimer = setTimeout(async () => {
    saveTimer = null
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true })
      await fsp.writeFile(STATE_FILE, JSON.stringify([...jobs.values()], null, 2))
    } catch (err) {
      console.error('[downloads] save failed:', err.message)
    }
  }, 400)
}

function emit(job) {
  // A job deleted mid-download may still report in from its runner; the client
  // already dropped it, so don't resurrect it.
  if (removed.has(job.id)) return
  bus.emit('job', snapshot(job))
}

export async function init() {
  await fsp.mkdir(LIBRARY_DIR, { recursive: true })
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8')
    let pruned = false
    for (const job of JSON.parse(raw)) {
      if (!job?.id) continue
      job.provider ??= 'http'
      job.progress ??= null
      if (job.status === 'downloading' || job.status === 'queued') {
        job.status = 'canceled'
        job.error = 'Interrupted when the app restarted'
        job.speed = 0
      }
      // A finished job whose file was deleted outside the app is dead weight.
      if (job.status === 'completed' && !fs.existsSync(job.path)) {
        pruned = true
        continue
      }
      jobs.set(job.id, job)
    }
    if (pruned) persist()
  } catch {
    // First run.
  }

  // Older downloads may have been saved before audio renditions were muxed in.
  // Repair them in the background so existing library files gain sound too.
  if (!repairScheduled) {
    repairScheduled = true
    const timer = setTimeout(() => {
      void repairMissingAudio()
    }, 1_500)
    timer.unref?.()
  }
}

/** Adds audio to completed ani-cli downloads that are missing it. */
export async function repairMissingAudio() {
  for (const job of jobs.values()) {
    if (job.provider !== 'anicli' || job.status !== 'completed' || !job.path) continue
    if (!fs.existsSync(job.path)) continue
    if ((await probeHasAudio(job.path)) !== false) continue
    try {
      const repaired = await addMissingAudio(job, new AbortController().signal)
      if (!repaired) continue
      job.updatedAt = Date.now()
      emit(job)
      persist()
      console.log(`[downloads] added missing audio to ${job.filename}`)
    } catch (err) {
      console.error(`[downloads] could not repair audio for ${job.filename}:`, err.message)
    }
  }
}

export function list() {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(snapshot)
}

export function activeCount() {
  return [...jobs.values()].filter((j) => j.status === 'downloading').length
}

function sanitize(name) {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 140)
}

function extFromUrl(url) {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)
    if (match) return `.${match[1].toLowerCase()}`
  } catch {
    /* fall through */
  }
  return '.mp4'
}

function uniqueName(name) {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length) || 'file'
  const taken = new Set([...jobs.values()].map((j) => j.filename))
  let candidate = name
  let i = 1
  while (taken.has(candidate) || fs.existsSync(path.join(LIBRARY_DIR, candidate))) {
    i += 1
    candidate = `${stem} (${i})${ext}`
  }
  return candidate
}

function episodeLabel(episode) {
  return String(episode ?? 1).padStart(2, '0')
}

/** Queues a direct HTTP(S) download. */
export function start({ mediaId, title, episode, url, filename }) {
  const invalid = (message) => Object.assign(new Error(message), { status: 400 })
  if (!url || typeof url !== 'string') throw invalid('A source URL is required')
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw invalid('That source URL is not valid')
  }
  if (!/^https?:$/.test(parsed.protocol)) throw invalid('Only http(s) sources are supported')

  const ep = Number.isFinite(Number(episode)) && Number(episode) > 0 ? Math.floor(Number(episode)) : null
  const safeTitle = sanitize(String(title ?? '') || 'Episode')
  const suggested = filename?.trim()
    ? sanitize(filename.trim())
    : sanitize(`${safeTitle} - E${episodeLabel(ep)}${extFromUrl(url)}`)

  const name = uniqueName(suggested || `episode${extFromUrl(url)}`)

  const job = {
    id: crypto.randomUUID(),
    provider: 'http',
    mediaId: mediaId ?? null,
    title: title || safeTitle,
    episode: ep,
    url,
    query: null,
    resultIndex: null,
    quality: null,
    dub: false,
    filename: name,
    path: path.join(LIBRARY_DIR, name),
    received: 0,
    total: 0,
    speed: 0,
    progress: null,
    status: 'queued',
    error: null,
    contentType: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
  }

  jobs.set(job.id, job)
  persist()
  emit(job)
  pump()
  return snapshot(job)
}

/** Queues one episode for ani-cli. */
export function startAniCli({
  mediaId,
  title,
  episode,
  query,
  resultIndex = 1,
  quality = 'best',
  dub = false,
  bin = anicli.binName(),
}) {
  const invalid = (message) => Object.assign(new Error(message), { status: 400 })
  const ep = Number(episode)
  if (!Number.isFinite(ep) || ep < 1) throw invalid('An episode number is required')
  const search = String(query ?? '').trim().slice(0, 200)
  if (!search) throw invalid('A title to search for on ani-cli is required')
  if (!anicli.resolveBin(bin)) {
    throw Object.assign(
      new Error(`ani-cli was not found ("${bin}"). Install it or set its path in Settings.`),
      { status: 503 },
    )
  }

  const index = Math.min(Math.max(1, Math.floor(Number(resultIndex) || 1)), 100)
  const safeTitle = sanitize(String(title ?? '') || 'Episode')
  const name = uniqueName(sanitize(`${safeTitle} - E${episodeLabel(ep)}.mp4`))

  const job = {
    id: crypto.randomUUID(),
    provider: 'anicli',
    mediaId: mediaId ?? null,
    title: title || safeTitle,
    episode: Math.floor(ep),
    url: '',
    query: search,
    resultIndex: index,
    quality: String(quality || 'best'),
    dub: Boolean(dub),
    bin: String(bin),
    filename: name,
    path: path.join(LIBRARY_DIR, name),
    received: 0,
    total: 0,
    speed: 0,
    progress: null,
    status: 'queued',
    error: null,
    contentType: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
  }

  jobs.set(job.id, job)
  persist()
  emit(job)
  pump()
  return snapshot(job)
}

/** Queues every selected episode using either ani-cli or the source template. */
export function startMany({ media, episodes, template, source = 'template', anicli: options = {} }) {
  const chosen = [...new Set((episodes ?? []).map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5000)
    .sort((a, b) => a - b)

  if (!chosen.length) {
    throw Object.assign(new Error('Select at least one episode'), { status: 400 })
  }

  const useAniCli = source === 'anicli'
  if (useAniCli) {
    if (!anicli.resolveBin(options.bin ?? anicli.binName())) {
      throw Object.assign(new Error('ani-cli was not found. Install it or set its path in Settings.'), {
        status: 503,
      })
    }
  } else if (!template) {
    throw Object.assign(new Error('No default source configured'), { status: 400 })
  }

  const created = []
  const errors = []

  for (const episode of chosen) {
    try {
      if (useAniCli) {
        created.push(
          startAniCli({
            mediaId: media.id,
            title: media.title,
            episode,
            query: options.query || media.title || media.romaji,
            resultIndex: options.resultIndex,
            quality: options.quality,
            dub: options.dub,
            bin: options.bin,
          }),
        )
      } else {
        const url = resolveSource(template, {
          id: media.id,
          title: media.title,
          romaji: media.romaji,
          episode,
        })
        created.push(start({ mediaId: media.id, title: media.title, episode, url }))
      }
    } catch (err) {
      errors.push({ episode, error: err.message || 'Could not queue this episode' })
    }
  }

  return { created, errors }
}

function pump() {
  let active = activeCount()
  for (const job of jobs.values()) {
    if (active >= MAX_ACTIVE) break
    if (job.status === 'queued') {
      active += 1
      void run(job)
    }
  }
}

async function run(job) {
  const controller = new AbortController()
  controllers.set(job.id, controller)

  job.status = 'downloading'
  job.error = null
  job.received = 0
  job.speed = 0
  job.progress = null
  job.updatedAt = Date.now()
  emit(job)
  persist()

  try {
    if (job.provider === 'anicli') await downloadWithAniCli(job, controller.signal)
    else await downloadOverHttp(job, controller.signal)

    job.status = 'completed'
    job.speed = 0
    job.progress = 100
    job.finishedAt = Date.now()
    if (!job.total) job.total = job.received
  } catch (err) {
    job.speed = 0
    job.progress = null
    if (controller.signal.aborted) {
      job.status = 'canceled'
      job.error = 'Canceled'
    } else {
      job.status = 'error'
      job.error = err?.message || 'Download failed'
    }
  } finally {
    controllers.delete(job.id)
    job.updatedAt = Date.now()
    if (removed.has(job.id)) removed.delete(job.id)
    else emit(job)
    persist()
    pump()
  }
}

async function downloadOverHttp(job, signal) {
  const partial = `${job.path}.part`
  let out = null

  try {
    const res = await fetch(job.url, {
      signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'AnimeVault/1.0 (local library downloader)',
        Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.8',
      },
    })
    if (!res.ok) throw new Error(`Source responded ${res.status} ${res.statusText}`.trim())
    if (!res.body) throw new Error('Source returned an empty response')

    job.total = Number(res.headers.get('content-length') ?? 0)
    job.contentType = res.headers.get('content-type') ?? ''
    if (job.total) emit(job)

    out = fs.createWriteStream(partial)
    // A cancel or a dropped source destroys this stream; without a listener the
    // async 'error' event would be unhandled and take down the whole server.
    let streamError = null
    out.on('error', (err) => {
      streamError = err
    })

    let lastTick = Date.now()
    let lastBytes = 0

    for await (const chunk of res.body) {
      if (streamError) throw streamError
      if (!out.writable) throw new Error('Destination file was closed')
      job.received += chunk.length
      if (!out.write(chunk)) await once(out, 'drain')

      const now = Date.now()
      if (now - lastTick >= 250) {
        job.speed = Math.max(0, Math.round(((job.received - lastBytes) * 1000) / (now - lastTick)))
        job.progress = job.total ? Math.min(100, (job.received / job.total) * 100) : null
        job.updatedAt = now
        lastTick = now
        lastBytes = job.received
        emit(job)
      }
    }

    await new Promise((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()))
    })
    out = null

    await fsp.rename(partial, job.path)
    if (!job.total) job.total = job.received
  } catch (err) {
    if (out) {
      try {
        out.destroy()
      } catch {
        /* ignore */
      }
    }
    await safeUnlink(partial)
    throw err
  }
}

function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}

const UNIT_FACTOR = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }

function unitFactor(unit) {
  return UNIT_FACTOR[String(unit ?? '').toUpperCase()] ?? 1
}

async function walkFiles(dir, out = []) {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walkFiles(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function killTree(child) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }, 4_000)
  timer.unref?.()
}

function contentKind(ext) {
  const value = ext.toLowerCase()
  if (value === '.webm') return 'video/webm'
  if (value === '.mkv') return 'video/x-matroska'
  return 'video/mp4'
}

function lastLine(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
}

/** Runs ffmpeg to completion, rejecting with its last error line. */
function runFfmpeg(args, signal) {
  return new Promise((resolve, reject) => {
    const ffmpeg = anicli.resolveBin('ffmpeg')
    if (!ffmpeg) {
      reject(new Error('ffmpeg is required to add audio to this download'))
      return
    }

    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const onAbort = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8_000)
    })
    child.once('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) reject(new Error('Canceled'))
      else if (code === 0) resolve()
      else reject(new Error(lastLine(stderr) || `ffmpeg exited with code ${code}`))
    })
  })
}

/** True/false when ffprobe is available, null when it cannot be checked. */
function probeHasAudio(filePath) {
  return new Promise((resolve) => {
    const ffprobe = anicli.resolveBin('ffprobe')
    if (!ffprobe) {
      resolve(null)
      return
    }
    const child = spawn(
      ffprobe,
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let out = ''
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString()
    })
    child.once('error', () => resolve(null))
    child.once('close', () => resolve(out.trim().length > 0))
  })
}

/**
 * ani-cli downloads only the video variant when the source keeps audio in a
 * separate HLS rendition. Fetch that rendition and mux it into the finished
 * file so downloads are not silent.
 */
async function addMissingAudio(job, signal) {
  if (job.provider !== 'anicli') return false
  if ((await probeHasAudio(job.path)) !== false) return false

  const stream = await anicli.resolveStream({
    query: job.query || job.title,
    resultIndex: job.resultIndex ?? 1,
    episode: job.episode ?? 1,
    quality: job.quality || 'best',
    dub: job.dub ?? false,
    bin: job.bin || anicli.binName(),
  })
  if (!stream.audioUrl) return false

  await fsp.mkdir(ANICLI_DIR, { recursive: true })
  const audioPath = path.join(ANICLI_DIR, `${job.id}.audio.m4a`)
  const muxedPath = path.join(ANICLI_DIR, `${job.id}.mux.mp4`)

  try {
    await runFfmpeg(
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-referer',
        stream.referer,
        '-user_agent',
        USER_AGENT,
        '-extension_picky',
        '0',
        '-f',
        'hls',
        '-allowed_segment_extensions',
        'ALL',
        '-i',
        stream.audioUrl,
        '-map',
        '0:a:0',
        '-c',
        'copy',
        '-f',
        'mp4',
        audioPath,
      ],
      signal,
    )

    await runFfmpeg(
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        job.path,
        '-i',
        audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        muxedPath,
      ],
      signal,
    )

    await fsp.rename(muxedPath, job.path)
    job.received = (await fsp.stat(job.path)).size
    job.total = job.received
    job.contentType = 'video/mp4'
    return true
  } finally {
    await safeUnlink(audioPath)
    await safeUnlink(muxedPath)
  }
}

async function downloadWithAniCli(job, signal) {
  const tempDir = path.join(ANICLI_DIR, job.id)
  await fsp.rm(tempDir, { recursive: true, force: true })
  await fsp.mkdir(tempDir, { recursive: true })

  const bin = anicli.resolveBin(job.bin) ?? anicli.binName(job.bin)
  const child = spawn(bin, anicli.buildArgs(job), {
    cwd: tempDir,
    detached: true,
    env: {
      ...process.env,
      ANI_CLI_DOWNLOAD_DIR: tempDir,
      ANI_CLI_LOG: '0',
      ANI_CLI_QUALITY: job.quality || 'best',
      TERM: process.env.TERM || 'xterm-256color',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const onAbort = () => killTree(child)
  signal.addEventListener('abort', onAbort, { once: true })

  const tail = []
  let buffer = ''
  let lastEmit = 0

  const noteLine = (raw) => {
    const line = stripAnsi(raw).trim()
    if (!line) return
    tail.push(line)
    if (tail.length > 80) tail.shift()

    const progress = line.match(
      /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)\s*([KMGT]?)i?B(?:\s+at\s+([\d.]+)\s*([KMGT]?)i?B\/s)?/i,
    )
    if (progress) {
      const total = Math.round(Number(progress[2]) * unitFactor(progress[3]))
      const pct = Math.min(100, Math.max(0, Number(progress[1])))
      if (total > 0) job.total = total
      job.progress = Math.max(job.progress ?? 0, pct)
      if (total > 0) job.received = Math.round((total * job.progress) / 100)
      if (progress[4]) job.speed = Math.round(Number(progress[4]) * unitFactor(progress[5]))
      const now = Date.now()
      if (now - lastEmit >= 500) {
        lastEmit = now
        job.updatedAt = now
        emit(job)
      }
    }

    const ffmpegSize = line.match(/(?:^|\s)size=\s*([\d.]+)\s*(k|m|g)?i?B/i)
    if (ffmpegSize) {
      job.received = Math.round(Number(ffmpegSize[1]) * unitFactor(ffmpegSize[2]))
      job.updatedAt = Date.now()
    }
  }

  const consume = (chunk) => {
    buffer += chunk.toString()
    const parts = buffer.split(/[\r\n]+/)
    buffer = parts.pop() ?? ''
    for (const part of parts) noteLine(part)
  }

  child.stdout?.on('data', consume)
  child.stderr?.on('data', consume)

  // yt-dlp only publishes a file once every fragment is merged; while the
  // fragment list is still being written, use the growing folder as a fallback.
  let lastSize = 0
  let lastTick = Date.now()
  let polling = false
  const poll = setInterval(() => {
    if (polling || job.progress != null) return
    polling = true
    walkFiles(tempDir)
      .then(async (files) => {
        let size = 0
        for (const file of files) {
          if (SUB_EXT.test(file) || file.endsWith('.ytdl')) continue
          const stat = await fsp.stat(file).catch(() => null)
          if (stat?.isFile()) size += stat.size
        }
        if (size <= lastSize) return
        const now = Date.now()
        const elapsed = Math.max(1, now - lastTick)
        job.received = size
        job.speed = Math.round(((size - lastSize) * 1000) / elapsed)
        job.updatedAt = now
        lastSize = size
        lastTick = now
        emit(job)
      })
      .finally(() => {
        polling = false
      })
  }, 1_000)

  let code = null
  let spawnError = null
  try {
    const closed = await new Promise((resolve) => {
      child.once('error', (err) => resolve({ code: null, error: err }))
      child.once('close', (exitCode) => resolve({ code: exitCode, error: null }))
    })
    code = closed.code
    spawnError = closed.error
  } finally {
    clearInterval(poll)
    signal.removeEventListener('abort', onAbort)
  }

  try {
    if (signal.aborted) throw new Error('Canceled')
    if (spawnError) throw new Error(spawnError.message || 'Could not start ani-cli')
    if (code !== 0) {
      throw new Error(failureMessage(tail, code))
    }

    const files = await walkFiles(tempDir)
    let video = null
    let subtitle = null
    for (const file of files) {
      if (SUB_EXT.test(file)) {
        if (!subtitle) subtitle = file
        continue
      }
      if (!VIDEO_EXT.test(file)) continue
      const stat = await fsp.stat(file).catch(() => null)
      if (stat?.isFile() && stat.size > 0 && (!video || stat.size > video.size)) {
        video = { path: file, size: stat.size }
      }
    }

    if (!video) {
      throw new Error(failureMessage(tail, code) || 'ani-cli finished without a video file')
    }

    // Keep the reserved name, but honour the container ani-cli actually produced.
    const actualExt = path.extname(video.path).toLowerCase() || '.mp4'
    const stem = job.filename.replace(/\.[^.]+$/, '')
    job.filename = `${stem}${actualExt}`
    job.path = path.join(LIBRARY_DIR, job.filename)
    await fsp.rename(video.path, job.path)
    job.contentType = contentKind(actualExt)
    job.received = (await fsp.stat(job.path)).size
    job.total = job.received

    if (subtitle) {
      const subExt = path.extname(subtitle).toLowerCase()
      const target = path.join(LIBRARY_DIR, `${stem}${subExt}`)
      try {
        await fsp.rename(subtitle, target)
      } catch {
        /* subtitles are optional */
      }
    }

    // ani-cli may have saved a video-only variant; mux in the source audio.
    try {
      await addMissingAudio(job, signal)
    } catch (err) {
      if (signal.aborted) throw err
      console.error(`[downloads] could not add audio to ${job.filename}:`, err.message)
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}

function failureMessage(tail, code) {
  const clean = tail.filter(
    (line) => !/^\[download\]\s+[\d.]+%/.test(line) && !/^(frame|size)=/.test(line) && !/^\[hlsnative\]/.test(line),
  )
  const strong = [...clean]
    .reverse()
    .find((line) => /error|failed|not found|no sources|invalid|blocked|unsupported|forbidden/i.test(line))
  if (strong) return stripAnsi(strong).slice(0, 300)
  const last = [...clean].reverse().find((line) => line && !/^\[download\]/.test(line))
  if (last) return stripAnsi(last).slice(0, 300)
  return code == null ? null : `ani-cli exited with code ${code}`
}

/** Aborts every running transfer so the app can exit without orphaned workers. */
export function shutdown() {
  for (const [id, controller] of controllers) {
    removed.add(id)
    try {
      controller.abort()
    } catch {
      /* already settled */
    }
  }
}

export function cancel(id) {
  const job = jobs.get(id)
  if (!job) return null
  controllers.get(id)?.abort()
  if (job.status === 'queued') {
    job.status = 'canceled'
    job.error = 'Canceled'
    job.updatedAt = Date.now()
    emit(job)
    persist()
  }
  return snapshot(job)
}

function sidecars(jobPath) {
  const parsed = path.parse(jobPath)
  return ['.vtt', '.srt', '.ass', '.ssa'].map((ext) => path.join(parsed.dir, `${parsed.name}${ext}`))
}

export async function remove(id) {
  const job = jobs.get(id)
  if (!job) return false
  if (job.status === 'queued') {
    // Stop pump() from launching it during the shutdown grace period.
    job.status = 'canceled'
    job.error = 'Canceled'
    emit(job)
  }
  if (controllers.has(id)) removed.add(id)
  controllers.get(id)?.abort()
  await new Promise((r) => setTimeout(r, 150))
  await safeUnlink(job.path)
  await safeUnlink(`${job.path}.part`)
  if (job.provider === 'anicli') {
    for (const sidecar of sidecars(job.path)) await safeUnlink(sidecar)
    await fsp.rm(path.join(ANICLI_DIR, job.id), { recursive: true, force: true }).catch(() => {})
  }
  jobs.delete(id)
  persist()
  bus.emit('removed', { id })
  return true
}

async function safeUnlink(target) {
  try {
    await fsp.unlink(target)
  } catch {
    /* already gone */
  }
}

function insideLibrary(relPath) {
  const resolved = path.resolve(LIBRARY_DIR, relPath)
  return resolved.startsWith(LIBRARY_DIR + path.sep) ? resolved : null
}

/** Absolute path for a file inside ./library, or null when the path escapes it. */
export function resolveLibraryPath(relPath) {
  return insideLibrary(relPath)
}

/** Removes a file that exists on disk but was not queued through the app. */
export async function removeExtraFile(relPath) {
  const target = insideLibrary(relPath)
  if (!target) throw new Error('Path is outside the library folder')
  await fsp.unlink(target)
  bus.emit('removed', { id: `file:${relPath}` })
  return true
}

/** Completed jobs plus anything else sitting in ./library (dropped in by hand). */
export async function library() {
  const tracked = [...jobs.values()]
    .filter((j) => j.status === 'completed' && fs.existsSync(j.path))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .map((j) => ({
      id: j.id,
      mediaId: j.mediaId,
      title: j.title,
      episode: j.episode,
      filename: j.filename,
      path: j.path,
      size: j.received,
      finishedAt: j.finishedAt,
      contentType: j.contentType,
      tracked: true,
      provider: j.provider,
    }))

  const known = new Set(tracked.map((t) => t.filename))
  const extras = []

  try {
    const entries = await fsp.readdir(LIBRARY_DIR, { recursive: true })
    for (const rel of entries) {
      const relPath = String(rel)
      if (relPath.endsWith('.part')) continue
      // Scratch folders (ani-cli) and their files are never library entries.
      if (relPath.split(path.sep).some((part) => part.startsWith('.'))) continue
      const name = path.basename(relPath)
      if (SUB_EXT.test(name)) continue
      if (known.has(name)) continue
      const stat = await fsp.stat(path.join(LIBRARY_DIR, relPath)).catch(() => null)
      if (!stat?.isFile()) continue
      extras.push({
        id: `file:${relPath}`,
        mediaId: null,
        title: name,
        episode: null,
        filename: name,
        relPath,
        path: path.join(LIBRARY_DIR, relPath),
        size: stat.size,
        finishedAt: stat.mtimeMs,
        contentType: '',
        tracked: false,
        provider: 'file',
      })
    }
  } catch {
    /* empty library */
  }

  return [...tracked, ...extras]
}

export function libraryDir() {
  return LIBRARY_DIR
}
