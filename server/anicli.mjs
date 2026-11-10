// ani-cli integration.
//
// ani-cli (https://github.com/pystardust/ani-cli) resolves an episode from
// hianime and hands the stream URL to yt-dlp or ffmpeg. The app shells out to it
// in download mode (`ani-cli -d`) into a scratch folder and then adopts the
// finished file into ./library.
//
// Search results are scraped with the same curl + sed pipeline ani-cli uses so
// the result indices shown in the UI line up with `ani-cli -S`.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const MATCH_FILE = path.join(DATA_DIR, 'anicli-matches.json')

export const DEFAULT_BIN = 'ani-cli'
const BASE_URL = 'https://hianime.at'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SEARCH_TTL = 10 * 60 * 1000
const MAX_RESULTS = 15

let matches = {}
const cache = new Map()
const streamCache = new Map()
const streamPending = new Map()
const STREAM_TTL = 90 * 1000

export async function init() {
  try {
    const raw = await fsp.readFile(MATCH_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') matches = parsed
  } catch {
    // First run.
  }
}

export function binName(preferred) {
  return String(preferred ?? '').trim() || String(process.env.ANI_CLI_BIN ?? '').trim() || DEFAULT_BIN
}

/** Finds an executable on PATH (or an absolute path) without spawning it. */
export function resolveBin(preferred) {
  const cmd = binName(preferred)
  if (cmd.includes('/')) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK)
      return cmd
    } catch {
      return null
    }
  }
  const dirs = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.join(dir, cmd)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  return null
}

function capture(command, args, { timeout = 20_000, env } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(env ? { env } : {}),
      })
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: err?.message ?? String(err), error: err })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      finish({ code: null, stdout, stderr: stderr || 'Timed out', error: new Error('Timed out') })
    }, timeout)

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 2_000_000) stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 100_000) stderr += chunk
    })
    child.on('error', (err) => {
      finish({ code: null, stdout, stderr: stderr || err.message, error: err })
    })
    child.on('close', (code) => {
      finish({ code, stdout, stderr, error: null })
    })
  })
}

/** Reports whether the installed ani-cli (and the tools it needs) is usable. */
export async function status(preferred) {
  const bin = binName(preferred)
  const resolved = resolveBin(bin)
  const curl = Boolean(resolveBin('curl'))
  const menu = Boolean(resolveBin('fzf')) || Boolean(resolveBin('rofi')) || Boolean(resolveBin('dmenu'))
  const downloader = resolveBin('yt-dlp') ? 'yt-dlp' : resolveBin('ffmpeg') ? 'ffmpeg' : null

  if (!resolved) {
    return {
      available: false,
      installed: false,
      bin,
      path: null,
      version: null,
      curl,
      menu,
      downloader,
      error: `Could not find "${bin}". Install ani-cli and put it on PATH, or set the full path in Settings.`,
    }
  }

  const result = await capture(resolved, ['-V'], { timeout: 8_000 })
  const version = (result.stdout || result.stderr || '').trim().split('\n').pop()?.trim() || null

  let error = null
  if (!downloader) error = 'ani-cli needs yt-dlp or ffmpeg installed to download episodes.'
  else if (!curl) error = 'ani-cli needs curl to resolve streams.'
  else if (!menu) error = 'ani-cli needs fzf (or rofi/dmenu) installed to run its menus.'

  return {
    available: !error,
    installed: true,
    bin,
    path: resolved,
    version,
    curl,
    menu,
    downloader,
    error,
  }
}

function decodeEntities(value) {
  return value
    .replace(/&#0*39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const SEARCH_SCRIPT = `
curl -sL -A "$3" --max-time 15 "$1/search?keyword=$2" |
  sed '/id="main-sidebar"/,$d' |
  tr '\\n' ' ' |
  sed 's|<div class="film-detail">|\\n<div class="film-detail">|g' |
  sed -nE 's|.*<h3 class="film-name">[[:space:]]*<a href="[^"]*/([^"/]*)"[[:space:]]*title="([^"]*)".*|\\1\\t\\2|p'
`

/** Searches hianime the same way ani-cli does. Indices are 1-based. */
export async function search(query, { limit = MAX_RESULTS } = {}) {
  const q = String(query ?? '').trim().slice(0, 120)
  if (!q) return []

  const key = q.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.results

  if (!resolveBin('curl')) {
    throw Object.assign(new Error('curl is required for ani-cli search'), { status: 503 })
  }

  const encoded = encodeURIComponent(q).replace(/%20/g, '+')
  const result = await capture('sh', ['-c', SEARCH_SCRIPT, 'sh', BASE_URL, encoded, USER_AGENT], {
    timeout: 25_000,
  })

  if (result.error && !result.stdout) {
    throw Object.assign(new Error('Could not reach the streaming site to search'), { status: 502 })
  }

  const results = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [slug, ...rest] = line.split('\t')
      return { index: index + 1, slug: slug.trim(), title: decodeEntities(rest.join('\t').trim()) }
    })
    .filter((entry) => entry.slug && entry.title)
    .slice(0, Math.max(1, limit))

  cache.set(key, { at: Date.now(), results })
  return results
}

/** Command-line arguments for a single download. */
export function buildArgs(job) {
  const args = ['-d']
  if (job.quality) args.push('-q', String(job.quality))
  args.push('-S', String(job.resultIndex ?? 1))
  args.push('-e', String(job.episode ?? 1))
  if (job.dub) args.push('--dub')
  args.push(String(job.query ?? ''))
  return args
}

function parseDebugLinks(output) {
  const selected = output.match(/Selected link:\s*\r?\n\s*(\S+)/i)
  const subtitle = output.match(/Subtitles:\s*\r?\n\s*(\S*)/i)
  return {
    url: selected?.[1]?.trim() || null,
    subtitleUrl: subtitle?.[1]?.trim() || null,
  }
}

/**
 * hianime's embed JSON points at a master playlist, but ani-cli hands back one
 * of its video variants. The audio lives in a separate `EXT-X-MEDIA` rendition,
 * so derive the sibling master.m3u8 and read the rendition list from it.
 */
export function masterUrlFor(videoUrl) {
  try {
    const url = new URL(videoUrl)
    const match = url.pathname.match(/^(.*)\/[^/]+\/index\.m3u8$/i)
    if (!match) return null
    url.pathname = `${match[1]}/master.m3u8`
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function parseAttributes(line) {
  const attrs = {}
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/gi
  let match
  while ((match = re.exec(line))) {
    attrs[match[1].toUpperCase()] = (match[3] ?? match[2] ?? '').trim()
  }
  return attrs
}

function chooseAudioRendition(playlist, masterUrl, { dub = false } = {}) {
  const renditions = []
  for (const line of String(playlist).split(/\r?\n/)) {
    if (!/^#EXT-X-MEDIA:/i.test(line)) continue
    const attrs = parseAttributes(line)
    if (String(attrs.TYPE).toUpperCase() !== 'AUDIO' || !attrs.URI) continue
    renditions.push({
      name: attrs.NAME || '',
      language: attrs.LANGUAGE || '',
      isDefault: /^YES$/i.test(attrs.DEFAULT || ''),
      uri: new URL(attrs.URI, masterUrl).toString(),
    })
  }
  if (!renditions.length) return null

  // Dub servers tend to expose English as a non-default rendition; prefer it so
  // the dub button does not silently fall back to the Japanese track.
  if (dub) {
    const english = renditions.find((entry) => /^en/i.test(entry.language))
    if (english) return english
  }
  return (
    renditions.find((entry) => entry.isDefault) ||
    renditions.find((entry) => /^ja/i.test(entry.language)) ||
    renditions[0]
  )
}

/**
 * Resolves the default audio rendition that belongs to a video variant URL.
 * Returns null when the source is already muxed or the master is unavailable,
 * so callers can safely keep playing the video-only stream.
 */
export async function resolveAudioUrl(videoUrl, referer, { dub = false } = {}) {
  const masterUrl = masterUrlFor(videoUrl)
  if (!masterUrl) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(masterUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(referer ? { Referer: referer } : {}),
      },
    })
    if (!res.ok) return null
    const text = await res.text()
    return chooseAudioRendition(text, masterUrl, { dub })?.uri ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolves a playable stream without downloading it.
 *
 * ani-cli's debug player prints the selected m3u8 (and subtitle) URL, so live
 * viewing stays in sync with the same search/quality/dub settings used by the
 * downloader. Results are cached briefly because a single player session asks
 * for both the video and its subtitle.
 */
export async function resolveStream({
  query,
  resultIndex = 1,
  episode = 1,
  quality = 'best',
  dub = false,
  bin = binName(),
} = {}) {
  const search = String(query ?? '').trim().slice(0, 200)
  if (!search) {
    throw Object.assign(new Error('A title to search for on ani-cli is required'), { status: 400 })
  }
  const ep = Math.max(1, Math.floor(Number(episode) || 1))
  const index = Math.min(Math.max(1, Math.floor(Number(resultIndex) || 1)), 100)
  const resolvedBin = resolveBin(bin)
  if (!resolvedBin) {
    throw Object.assign(
      new Error(`ani-cli was not found ("${bin}"). Install it or set its path in Settings.`),
      { status: 503 },
    )
  }

  const key = JSON.stringify([search.toLowerCase(), index, ep, String(quality || 'best'), Boolean(dub), bin])
  const hit = streamCache.get(key)
  if (hit && Date.now() - hit.at < STREAM_TTL) return { ...hit.data }

  // The player asks for the video and its subtitle at the same time; share one
  // ani-cli resolution instead of spawning two debug runs.
  const inflight = streamPending.get(key)
  if (inflight) return inflight

  const task = (async () => {
    const args = ['-S', String(index), '-e', String(ep)]
    if (dub) args.push('--dub')
    args.push(search)

    const result = await capture(resolvedBin, args, {
      timeout: 90_000,
      env: {
        ...process.env,
        ANI_CLI_PLAYER: 'debug',
        ANI_CLI_QUALITY: String(quality || 'best'),
        ANI_CLI_LOG: '0',
        ANI_CLI_HIST_DIR: path.join(DATA_DIR, 'anicli-history'),
      },
    })

    const links = parseDebugLinks(result.stdout)
    if (!links.url) {
      const detail = (result.stderr || result.stdout || '')
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1)
      throw Object.assign(new Error(detail || 'ani-cli could not resolve a stream for that episode'), {
        status: 502,
      })
    }

    let referer = ''
    try {
      referer = `${new URL(links.url).origin}/`
    } catch {
      /* ffmpeg will try without one */
    }

    // ani-cli's selected variant is video-only when the source splits audio
    // into HLS renditions; resolve the matching audio playlist as well.
    const audioUrl = await resolveAudioUrl(links.url, referer, { dub })

    return {
      url: links.url,
      audioUrl,
      subtitleUrl: links.subtitleUrl,
      referer,
      quality: String(quality || 'best'),
      episode: ep,
    }
  })()

  streamPending.set(key, task)
  try {
    const data = await task
    streamCache.set(key, { at: Date.now(), data })
    return { ...data }
  } finally {
    streamPending.delete(key)
  }
}

export function getMatch(mediaId) {
  const entry = matches[String(mediaId)]
  return entry ? { ...entry } : null
}

export function listMatches() {
  return { ...matches }
}

async function persistMatches() {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(MATCH_FILE, JSON.stringify(matches, null, 2))
}

export async function saveMatch(mediaId, { query, index, title } = {}) {
  const id = Number(mediaId)
  if (!Number.isInteger(id) || id <= 0) return null
  const value = String(query ?? '').trim().slice(0, 200)
  if (!value) return null
  const parsedIndex = Math.floor(Number(index))
  const entry = {
    mediaId: id,
    query: value,
    index: Number.isFinite(parsedIndex) && parsedIndex >= 1 ? Math.min(parsedIndex, 100) : 1,
    title: String(title ?? '').trim().slice(0, 200),
    updatedAt: Date.now(),
  }
  matches[String(id)] = entry
  await persistMatches()
  return { ...entry }
}
