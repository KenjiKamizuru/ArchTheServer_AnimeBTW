// Playback and FFmpeg media helpers shared by live streaming, local library
// playback, and the persistent download manager.
//
// - Local MP4/WebM/MOV files are served with HTTP byte-range support (both for
//   seeking in the in-app player and for sending files to client devices).
// - Remote streams (and non-browser local containers like MKV/TS) are remuxed
//   to fragmented MP4 with ffmpeg and piped to the response.
// - Downloads reuse the same ffmpeg input/codec pipeline, writing fast-start
//   MP4 files to a temporary path with live progress reporting.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readResponseTextLimited, safeFetch, sanitizeErrorMessage } from './security.mjs'

const MAX_SUBTITLE_FETCH_BYTES = 16 * 1024 * 1024
const ASS_CONVERT_TIMEOUT_MS = 15_000
const rawMaxStreams = Number(process.env.MAX_CONCURRENT_STREAMS)
const MAX_CONCURRENT_REMUX =
  Number.isInteger(rawMaxStreams) && rawMaxStreams >= 1 && rawMaxStreams <= 32 ? rawMaxStreams : 6
let activeRemuxCount = 0

function toFfmpegLocalPath(p) {
  return `file:${path.resolve(String(p))}`
}

function assertSafeRemoteMediaTarget(target) {
  const str = String(target ?? '').trim()
  if (!/^https?:\/\//i.test(str) || /[\u0000-\u001f\u007f]/.test(str)) {
    throw Object.assign(new Error('Refusing unsafe remote media URL'), { status: 400 })
  }
  return str
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export const VIDEO_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
}

export const VIDEO_EXTENSIONS = new Set(Object.keys(VIDEO_MIME))
const DIRECT_PLAY = new Set(['.mp4', '.m4v', '.webm', '.mov'])
export const SUBTITLE_EXTENSIONS = ['.vtt', '.srt', '.ass', '.ssa']

const capabilityCache = new Map()

/** Finds ffmpeg on PATH (or an absolute path via FFMPEG_BIN) without spawning it. */
export function resolveFfmpeg() {
  const cmd = String(process.env.FFMPEG_BIN ?? '').trim() || 'ffmpeg'
  if (cmd.includes(path.sep) || cmd.includes('/')) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK)
      return cmd
    } catch {
      return null
    }
  }
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
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

/** Probes optional HLS demuxer, HTTP, and pacing flags once per ffmpeg binary. */
export function getFfmpegCapabilities(ffmpeg) {
  const cached = capabilityCache.get(ffmpeg)
  if (cached) return cached

  let hlsHelp = ''
  let longHelp = ''
  try {
    const res = spawnSync(ffmpeg, ['-hide_banner', '-h', 'demuxer=hls'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    hlsHelp = res.stdout || ''
  } catch {
    /* fall back to conservative flags */
  }
  // `-h long` omits protocol/demuxer AVOptions such as `-protocol_whitelist`
  // (verified on FFmpeg 4.1: absent from `long`, present in `full`). Probe `full`
  // first so security-critical flags are actually detected and applied, falling
  // back to `long` on builds where `full` is unavailable.
  for (const mode of ['full', 'long']) {
    try {
      const res = spawnSync(ffmpeg, ['-hide_banner', '-h', mode], {
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      longHelp = res.stdout || ''
      if (longHelp) break
    } catch {
      /* try the next help mode */
    }
  }

  // help text is unreliable across builds/forks (`-h long` and even `-h full`
  // can omit AVOptions on some static builds), so confirm behaviourally: feed a
  // playlist pointing at a `file:` URI and require ffmpeg to refuse it. This is
  // the security-critical guarantee, so it must never be inferred optimistically.
  const protocolWhitelist = probeProtocolWhitelist(ffmpeg)

  const caps = {
    extensionPicky: hlsHelp.includes('-extension_picky'),
    allowedExtensions: hlsHelp.includes('-allowed_extensions'),
    allowedSegmentExtensions: hlsHelp.includes('-allowed_segment_extensions'),
    readrateBurst: longHelp.includes('-readrate_initial_burst'),
    protocolWhitelist,
    httpReconnect: longHelp.includes('-reconnect_delay_max'),
    statsPeriod: longHelp.includes('-stats_period'),
  }
  capabilityCache.set(ffmpeg, caps)
  return caps
}

/**
 * Returns true only when ffmpeg rejects a `file:` HLS segment URI while
 * `-protocol_whitelist` excludes `file`. A build that silently ignores the
 * option (or accepts local paths) reports false so callers can fail closed.
 */
function probeProtocolWhitelist(ffmpeg) {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffprobe-wl-'))
  const probeFile = path.join(probeDir, 'probe.m3u8')
  const outFile = path.join(probeDir, 'out.mp4')
  try {
    fs.writeFileSync(
      probeFile,
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:1.0,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n',
    )
    const res = spawnSync(
      ffmpeg,
      [
        '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-protocol_whitelist', 'http,https,tcp,tls,crypto',
        '-f', 'hls', '-allowed_extensions', 'ALL',
        '-i', probeFile,
        '-c', 'copy', '-f', 'mp4', outFile,
      ],
      { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    if (res.error) return false
    if (res.status === 0) return false // accepted a local-file segment: unsafe
    return /not on whitelist|Protocol 'file' not/i.test(String(res.stderr ?? ''))
  } catch {
    return false
  } finally {
    try {
      fs.rmSync(probeDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

export function getMime(filePath) {
  return VIDEO_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

/** True when modern browsers play this container directly via byte-range HTTP. */
export function directPlayable(filePath) {
  return DIRECT_PLAY.has(path.extname(filePath).toLowerCase())
}

function contentDispositionHeader(type, rawName) {
  const clean = String(rawName || 'video.mp4').replace(/[\u0000-\u001f\u007f]/g, '')
  const ascii = clean
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'video.mp4'
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Serves a validated local library file with full HTTP byte-range support for
 * instant seeking in the browser or downloading to a client device.
 */
export function sendFileWithRange(req, res, filePath, { downloadName, attachment = false } = {}) {
  let stat
  try {
    stat = fs.lstatSync(filePath)
  } catch {
    res.status(404).json({ error: 'File not found' })
    return
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const fileSize = stat.size
  const name = downloadName || path.basename(filePath)
  const isHead = req.method === 'HEAD'

  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', getMime(filePath))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
  res.setHeader('Last-Modified', stat.mtime.toUTCString())
  res.setHeader('Content-Disposition', contentDispositionHeader(attachment ? 'attachment' : 'inline', name))

  const pipeRange = (opts) => {
    if (isHead) {
      res.end()
      return
    }
    const stream = fs.createReadStream(filePath, opts)
    const closeStream = () => stream.destroy()
    res.once('close', closeStream)
    stream.once('end', () => res.off('close', closeStream))
    stream.once('error', () => {
      res.off('close', closeStream)
      if (!res.headersSent) res.status(500).end()
      else res.destroy()
    })
    stream.pipe(res)
  }

  const range = req.headers.range
  if (range && typeof range === 'string' && range.startsWith('bytes=') && fileSize > 0) {
    // Strictly validate single RFC 9110 byte range (`start-end`, `start-`, `-suffix`).
    const spec = range.slice(6).trim()
    if (!spec.includes(',')) {
      const m = spec.match(/^(\d{0,16})-(\d{0,16})$/)
      if (!m || (!m[1] && !m[2])) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end()
        return
      }
      const [, startRaw, endRaw] = m
      let start
      let end
      if (!startRaw) {
        const suffix = Number(endRaw)
        start = !Number.isSafeInteger(suffix) || suffix <= 0 ? NaN : Math.max(0, fileSize - suffix)
        end = fileSize - 1
      } else {
        start = Number(startRaw)
        const parsedEnd = endRaw ? Number(endRaw) : fileSize - 1
        end = Number.isSafeInteger(parsedEnd) ? Math.min(parsedEnd, fileSize - 1) : NaN
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start < 0 ||
        start >= fileSize
      ) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end()
        return
      }
      res.status(206)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      res.setHeader('Content-Length', String(end - start + 1))
      pipeRange({ start, end })
      return
    }
  }

  res.status(200)
  res.setHeader('Content-Length', String(fileSize))
  pipeRange(undefined)
}

/** Finds a regular non-symlink sidecar subtitle next to a local media file. */
export function findSubtitle(filePath) {
  const parsed = path.parse(filePath)
  for (const ext of SUBTITLE_EXTENSIONS) {
    const candidate = path.join(parsed.dir, `${parsed.name}${ext}`)
    try {
      const st = fs.lstatSync(candidate)
      if (st.isFile() && !st.isSymbolicLink()) return candidate
    } catch {
      /* try next */
    }
  }
  return null
}

export function normalizeSubtitleToVtt(value) {
  const text = String(value ?? '')
  if (/^\s*WEBVTT/i.test(text)) return text
  return `WEBVTT\n\n${text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

function assToVtt(filePath) {
  return new Promise((resolve) => {
    const ffmpeg = resolveFfmpeg()
    if (!ffmpeg) {
      resolve(null)
      return
    }
    const caps = getFfmpegCapabilities(ffmpeg)
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']
    if (caps.protocolWhitelist) args.push('-protocol_whitelist', 'file,pipe')
    args.push('-i', toFfmpegLocalPath(filePath), '-f', 'webvtt', 'pipe:1')

    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    let overflowed = false
    const timer = setTimeout(() => {
      overflowed = true
      kill(child)
    }, ASS_CONVERT_TIMEOUT_MS)
    timer.unref?.()

    child.stdout?.on('data', (chunk) => {
      if (overflowed) return
      if (out.length + chunk.length > 8_000_000) {
        overflowed = true
        kill(child)
        return
      }
      out += chunk.toString('utf8')
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(!overflowed && code === 0 && out.trim() ? out : null)
    })
  })
}

/** Serves a local sidecar subtitle as WebVTT, converting SRT/ASS when needed. */
export async function sendSubtitleFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  let text
  try {
    if (ext === '.ass' || ext === '.ssa') {
      text = await assToVtt(filePath)
      if (!text) {
        res.status(415).json({ error: 'ffmpeg is required to convert ASS subtitles' })
        return
      }
    } else {
      const st = await fsp.lstat(filePath)
      if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_SUBTITLE_FETCH_BYTES) {
        res.status(404).json({ error: 'Subtitle not found' })
        return
      }
      const raw = await fsp.readFile(filePath, 'utf8')
      text = ext === '.srt' ? normalizeSubtitleToVtt(raw) : raw
    }
  } catch {
    res.status(404).json({ error: 'Subtitle not found' })
    return
  }

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cache-Control', 'no-store')
  res.send(text)
}

/** Fetches a remote subtitle URL (with SSRF checks & byte cap) and converts it to WebVTT. */
export async function fetchSubtitleVtt(url, { referer, headers = {}, signal, fetchFn } = {}) {
  const mergedHeaders = {
    'User-Agent': headers['User-Agent'] || USER_AGENT,
    ...(referer ? { Referer: referer } : {}),
    ...headers,
  }
  const effectiveSignal = signal ?? AbortSignal.timeout(15_000)
  const upstream = fetchFn
    ? await fetchFn(url, { headers: mergedHeaders, signal: effectiveSignal })
    : (await safeFetch(url, { headers: mergedHeaders, signal: effectiveSignal })).response
  if (!upstream.ok) {
    await upstream.body?.cancel?.().catch(() => {})
    const err = new Error('Subtitle not found')
    err.status = upstream.status === 404 ? 404 : 502
    throw err
  }
  const raw = await readResponseTextLimited(upstream, MAX_SUBTITLE_FETCH_BYTES, 'Subtitle file')
  if (/^\s*<!doctype\s+html|^\s*<html/i.test(raw)) {
    throw Object.assign(new Error('Invalid subtitle document'), { status: 502 })
  }
  return normalizeSubtitleToVtt(raw)
}

/** Fetches a remote subtitle (hianime serves VTT) and relays it same-origin. */
export async function proxySubtitle(res, url, referer) {
  try {
    const text = await fetchSubtitleVtt(url, { referer })
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'no-store')
    res.send(text)
  } catch (err) {
    const status = err?.status === 403 ? 403 : err?.status === 404 ? 404 : 502
    res.status(status).json({ error: sanitizeErrorMessage(err?.message, 'Could not fetch the subtitle') })
  }
}

function lastError(stderr) {
  const lines = String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const raw = lines.at(-1)
  if (!raw) return null
  // Scrub signed upstream URLs and local filesystem paths from FFmpeg diagnostics.
  const withoutUrls = raw.replace(/https?:\/\/\S+/gi, '[remote-stream]').replace(/file:\S+/gi, '[local-file]')
  return sanitizeErrorMessage(withoutUrls, 'Media processing failed').slice(0, 300)
}

function kill(child, wasStopped = false) {
  if (!child || child.exitCode != null) return
  if (wasStopped && process.platform !== 'win32') {
    try {
      child.kill('SIGCONT')
    } catch {
      /* already gone */
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
  const timer = setTimeout(() => {
    if (child.exitCode != null) return
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }, 2_000)
  timer.unref?.()
}

export function shouldTranscodeAudioFallback(stderr) {
  return /aac_adtstoasc|bitstream filter|malformed aac|could not find tag for codec|not (?:currently )?supported in container/i.test(
    String(stderr ?? ''),
  )
}

function detectDrmStderr(stderr) {
  const text = String(stderr ?? '')
  if (/sample-aes|widevine|playready|fairplay|cenc|decryption key|encrypted stream|drm/i.test(text)) {
    return 'DRM-protected or encrypted stream cannot be downloaded'
  }
  return null
}

function appendRemoteInputArgs(
  args,
  target,
  { referer, headers, isHls, realtime, restrictProtocols, caps },
) {
  const safeTarget = assertSafeRemoteMediaTarget(target)
  if (realtime) {
    // Deliver an initial burst at full speed so `delay_moov` emits the first
    // fragment immediately and the browser builds a healthy audio buffer, then
    // pace gently so an idle stream does not pull the whole episode at once.
    if (caps.readrateBurst) {
      args.push('-readrate', '1.5', '-readrate_initial_burst', '15')
    } else {
      args.push('-re')
    }
  }
  // Explicitly omit `file` so remote playlists/redirects can never read local
  // disk. If this ffmpeg build cannot enforce the whitelist, refuse the remote
  // stream entirely rather than falling back to unrestricted protocol access.
  if (restrictProtocols) {
    if (!caps.protocolWhitelist) {
      throw Object.assign(
        new Error('This ffmpeg build cannot restrict remote protocols; remote playback is disabled'),
        { status: 503 },
      )
    }
    args.push('-protocol_whitelist', 'http,https,tcp,tls,crypto')
  }
  if (!realtime && caps.httpReconnect && !isHls) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5')
  }

  const effectiveReferer = referer || headers?.Referer || null
  const effectiveUa = headers?.['User-Agent'] || USER_AGENT
  if (effectiveReferer) args.push('-referer', effectiveReferer)
  args.push('-user_agent', effectiveUa)

  if (headers && typeof headers === 'object') {
    const extraLines = []
    for (const [k, v] of Object.entries(headers)) {
      if (!v || k === 'Referer' || k === 'User-Agent') continue
      const safeKey = String(k).replace(/[\r\n:\0]/g, '').trim()
      const safeVal = String(v).replace(/[\r\n\0]/g, '').trim()
      if (safeKey && safeVal) extraLines.push(`${safeKey}: ${safeVal}`)
    }
    if (extraLines.length > 0) {
      args.push('-headers', `${extraLines.join('\r\n')}\r\n`)
    }
  }

  if (isHls) {
    if (caps.extensionPicky) args.push('-extension_picky', '0')
    args.push('-f', 'hls')
    if (caps.allowedExtensions) args.push('-allowed_extensions', 'ALL')
    if (caps.allowedSegmentExtensions) args.push('-allowed_segment_extensions', 'ALL')
  }
  args.push('-i', safeTarget)
}

function appendMappingAndCodecArgs(
  args,
  { hasSecondAudioInput, needsAacBsf, transcodeAudio, transcodeVideo = false },
) {
  if (hasSecondAudioInput) {
    args.push('-map', '0:v:0?', '-map', '1:a:0?')
  } else {
    args.push('-map', '0:v:0?', '-map', '0:a:0?')
  }
  args.push('-disposition:v:0', 'default', '-disposition:a:0', 'default')

  if (transcodeVideo) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p')
  } else {
    args.push('-c:v', 'copy')
  }

  if (transcodeAudio || transcodeVideo) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000')
  } else {
    args.push('-c:a', 'copy')
    // hianime audio arrives as ADTS AAC inside MPEG-TS; MP4 needs ASC framing.
    if (needsAacBsf) args.push('-bsf:a', 'aac_adtstoasc')
  }
}

function buildRemuxArgs({
  filePath,
  url,
  audioUrl,
  referer,
  headers,
  hls,
  realtime,
  transcodeAudio,
  transcodeVideo = false,
  caps,
}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']

  if (url) {
    appendRemoteInputArgs(args, url, {
      referer,
      headers,
      isHls: hls,
      realtime,
      restrictProtocols: true,
      caps,
    })
  } else {
    if (caps.protocolWhitelist) {
      args.push('-protocol_whitelist', 'file,pipe,crypto')
    }
    args.push('-i', toFfmpegLocalPath(filePath))
  }

  if (audioUrl) {
    appendRemoteInputArgs(args, audioUrl, {
      referer,
      headers,
      isHls: hls || /\.m3u8(?:$|\?)/i.test(audioUrl),
      realtime,
      restrictProtocols: true,
      caps,
    })
  }

  const localExt = filePath ? path.extname(filePath).toLowerCase() : ''
  const localTs = localExt === '.ts' || localExt === '.m2ts'
  // Local movies remuxed from MKV/AVI/fallback often carry DTS, AC-3, FLAC, or
  // Vorbis audio; transcoding just audio to AAC-LC runs far faster than realtime
  // and plays reliably in every browser.
  const forceLocalAac = Boolean(filePath && !localTs)
  appendMappingAndCodecArgs(args, {
    hasSecondAudioInput: Boolean(audioUrl),
    needsAacBsf: Boolean(audioUrl || hls || localTs),
    transcodeAudio: Boolean(transcodeAudio || forceLocalAac),
    transcodeVideo,
  })

  // `delay_moov` waits for the first fragment so `aac_adtstoasc` has populated
  // the AAC AudioSpecificConfig (`esds` DecoderSpecificInfo) before writing
  // `moov`; `empty_moov` omits it and makes browsers drop or reject the audio.
  args.push(
    '-movflags',
    'frag_keyframe+delay_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  )
  return args
}

/**
 * Pipes ffmpeg output to the browser as fragmented MP4.
 *
 * Pass either a remote `url` (with optional `audioUrl` and `referer`) or a
 * validated local `filePath` (for containers such as MKV/TS). HLS sources need
 * `hls: true` so ffmpeg accepts hianime's `.ts.jpg` segments. `realtime: true`
 * paces input reading instead of pulling the whole episode at once.
 */
export function remux(
  req,
  res,
  { filePath, url, audioUrl, referer, headers, hls = false, realtime = false } = {},
) {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) {
    res.status(503).json({ error: 'ffmpeg is required for this playback mode' })
    return
  }

  if (activeRemuxCount >= MAX_CONCURRENT_REMUX) {
    res.status(429).json({ error: 'Too many simultaneous active streams; close another stream and retry' })
    return
  }

  const caps = getFfmpegCapabilities(ffmpeg)
  activeRemuxCount += 1
  let slotReleased = false
  const releaseSlot = () => {
    if (slotReleased) return
    slotReleased = true
    activeRemuxCount = Math.max(0, activeRemuxCount - 1)
  }
  let child = null
  let started = false
  let settled = false
  let clientClosed = false

  const detachListeners = () => {
    res.off('close', onClientClose)
    res.off('drain', onDrain)
    req.off('aborted', onClientClose)
  }

  const onDrain = () => {
    if (!clientClosed) child?.stdout?.resume()
  }

  const onClientClose = () => {
    clientClosed = true
    releaseSlot()
    detachListeners()
    kill(child)
  }

  const finish = (status, body) => {
    if (settled) return
    settled = true
    releaseSlot()
    detachListeners()
    if (res.writableEnded || res.destroyed) return
    if (!started) {
      res.status(status).json(body)
    } else {
      res.end()
    }
  }

  res.on('close', onClientClose)
  res.on('drain', onDrain)
  req.on('aborted', onClientClose)

  const run = ({ transcodeAudio = false, transcodeVideo = false, dropAudioUrl = false } = {}) => {
    const activeAudioUrl = dropAudioUrl ? null : audioUrl
    let args
    try {
      args = buildRemuxArgs({
        filePath,
        url,
        audioUrl: activeAudioUrl,
        referer,
        headers,
        hls,
        realtime,
        transcodeAudio,
        transcodeVideo,
        caps,
      })
    } catch (err) {
      finish(err?.status || 400, { error: sanitizeErrorMessage(err?.message, 'Invalid stream source') })
      return
    }
    let proc
    try {
      proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      finish(500, { error: sanitizeErrorMessage(err?.message, 'Could not start ffmpeg') })
      return
    }
    child = proc
    let stderr = ''

    proc.stdout?.on('data', (chunk) => {
      if (clientClosed || res.writableEnded || res.destroyed) return
      if (!started) {
        started = true
        res.status(200)
        res.setHeader('Content-Type', 'video/mp4')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Accept-Ranges', 'none')
      }
      if (!res.write(chunk)) {
        proc.stdout?.pause()
      }
    })

    proc.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8_000)
    })

    proc.once('error', (err) => {
      finish(500, { error: sanitizeErrorMessage(err?.message, 'Could not start ffmpeg') })
    })

    proc.once('close', (code) => {
      if (clientClosed || settled) return
      if (code === 0) {
        if (started) finish(200, {})
        else finish(502, { error: 'Stream produced no media data' })
        return
      }
      // Non-AAC source audio (MP3, AC-3/E-AC-3, Opus, etc.) cannot be copied
      // with `aac_adtstoasc`; transcode just the audio track to AAC-LC.
      if (!started && !transcodeAudio && shouldTranscodeAudioFallback(stderr)) {
        run({ transcodeAudio: true, transcodeVideo, dropAudioUrl })
        return
      }
      // Local movies with non-MP4 video codecs (e.g. VP8/VP9/MPEG-4 in MKV/AVI)
      // fall back to H.264 + AAC transcoding so they still play in-browser.
      if (!started && filePath && !transcodeVideo && shouldTranscodeAudioFallback(stderr)) {
        run({ transcodeAudio: true, transcodeVideo: true, dropAudioUrl })
        return
      }
      // If a separate audio rendition URL is broken, fall back to the main
      // variant rather than failing the whole stream.
      if (!started && activeAudioUrl && !dropAudioUrl && stderr.includes(activeAudioUrl)) {
        run({ transcodeAudio: false, dropAudioUrl: true })
        return
      }
      finish(502, { error: lastError(stderr) || `ffmpeg exited with code ${code}` })
    })
  }

  run()
}

function buildFileDownloadArgs({
  url,
  audioUrl,
  referer,
  headers,
  hls,
  outputPath,
  transcodeAudio,
  caps,
}) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:1']
  if (caps.statsPeriod) args.push('-stats_period', '0.5')

  appendRemoteInputArgs(args, url, {
    referer,
    headers,
    isHls: hls,
    realtime: false,
    restrictProtocols: true,
    caps,
  })
  if (audioUrl) {
    appendRemoteInputArgs(args, audioUrl, {
      referer,
      headers,
      isHls: hls || /\.m3u8(?:$|\?)/i.test(audioUrl),
      realtime: false,
      restrictProtocols: true,
      caps,
    })
  }

  appendMappingAndCodecArgs(args, {
    hasSecondAudioInput: Boolean(audioUrl),
    needsAacBsf: Boolean(audioUrl || hls),
    transcodeAudio,
  })

  // Standard fast-start MP4 places `moov` at the beginning of the file so local
  // HTTP range playback starts and seeks instantaneously in every browser.
  // Note: `-protocol_whitelist` is a per-input AVOption (does not restrict the
  // muxer output file, which still uses `file:` to block protocol confusion).
  args.push('-movflags', '+faststart', '-f', 'mp4', toFfmpegLocalPath(outputPath))
  return args
}

/**
 * Downloads and muxes a remote HLS/media stream into a temporary MP4 file at
 * `outputPath`, emitting real-time progress and supporting pause/resume/cancel.
 */
export function downloadStreamToFile({
  url,
  audioUrl = null,
  referer = null,
  headers = null,
  hls = true,
  outputPath,
  durationSec = null,
  signal,
  onProgress,
  onControl,
}) {
  return new Promise((resolve, reject) => {
    const ffmpeg = resolveFfmpeg()
    if (!ffmpeg) {
      reject(Object.assign(new Error('ffmpeg is required to download HLS/streaming episodes'), { status: 503 }))
      return
    }
    if (signal?.aborted) {
      reject(Object.assign(new Error('Download cancelled'), { name: 'AbortError' }))
      return
    }

    const caps = getFfmpegCapabilities(ffmpeg)
    const canPause = process.platform !== 'win32'
    let child = null
    let stopped = false
    let settled = false
    let lastBytes = 0
    let lastTickAt = Date.now()
    let smoothedSpeed = null

    const control = {
      canPause,
      pause() {
        if (!canPause || !child || child.exitCode != null || stopped) return false
        try {
          child.kill('SIGSTOP')
          stopped = true
          return true
        } catch {
          return false
        }
      },
      resume() {
        if (!canPause || !child || child.exitCode != null || !stopped) return false
        try {
          child.kill('SIGCONT')
          stopped = false
          lastTickAt = Date.now()
          return true
        } catch {
          return false
        }
      },
    }
    onControl?.(control)

    const onAbort = () => {
      if (settled) return
      settled = true
      kill(child, stopped)
      stopped = false
      reject(Object.assign(new Error('Download cancelled'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    const run = ({ transcodeAudio = false, dropAudioUrl = false } = {}) => {
      if (settled || signal?.aborted) return
      const activeAudioUrl = dropAudioUrl ? null : audioUrl
      let args
      try {
        args = buildFileDownloadArgs({
          url,
          audioUrl: activeAudioUrl,
          referer,
          headers,
          hls,
          outputPath,
          transcodeAudio,
          caps,
        })
      } catch (err) {
        settled = true
        cleanup()
        reject(err)
        return
      }

      let proc
      try {
        proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (err) {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error(err?.message || 'Could not start ffmpeg'))
        }
        return
      }
      child = proc
      stopped = false
      lastBytes = 0
      lastTickAt = Date.now()
      smoothedSpeed = null

      let stderr = ''
      let stdoutRemainder = ''
      let currentBlock = {}

      const flushProgressBlock = () => {
        const sizeVal = Number(currentBlock.total_size)
        const timeUs = Number(currentBlock.out_time_us ?? currentBlock.out_time_ms)
        const outTimeSec = Number.isFinite(timeUs) && timeUs > 0 ? timeUs / 1_000_000 : 0
        const downloadedBytes = Number.isFinite(sizeVal) && sizeVal >= 0 ? sizeVal : lastBytes

        const now = Date.now()
        const elapsedSec = (now - lastTickAt) / 1000
        if (elapsedSec >= 0.25 && downloadedBytes >= lastBytes) {
          const instant = (downloadedBytes - lastBytes) / elapsedSec
          if (Number.isFinite(instant) && instant >= 0) {
            smoothedSpeed = smoothedSpeed == null ? instant : smoothedSpeed * 0.6 + instant * 0.4
          }
          lastBytes = downloadedBytes
          lastTickAt = now
        }

        let progress = null
        if (durationSec && durationSec > 0 && outTimeSec > 0) {
          const pct = (outTimeSec / durationSec) * 100
          progress = Math.min(99.5, Math.max(0, Math.round(pct * 10) / 10))
        }
        if (currentBlock.progress === 'end') {
          progress = 100
        }

        onProgress?.({
          downloadedBytes,
          downloadedSec: Math.round(outTimeSec * 10) / 10,
          progress,
          speedBps: smoothedSpeed != null ? Math.round(smoothedSpeed) : null,
        })
        currentBlock = {}
      }

      proc.stdout?.on('data', (chunk) => {
        if (settled) return
        stdoutRemainder += chunk.toString('utf8')
        const lines = stdoutRemainder.split(/\r?\n/)
        stdoutRemainder = lines.pop() ?? ''
        for (const line of lines) {
          const eq = line.indexOf('=')
          if (eq <= 0) continue
          const k = line.slice(0, eq).trim()
          const v = line.slice(eq + 1).trim()
          currentBlock[k] = v
          if (k === 'progress') flushProgressBlock()
        }
      })

      proc.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-8_000)
      })

      proc.once('error', (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(err?.message || 'Could not start ffmpeg'))
      })

      proc.once('close', async (code) => {
        if (settled || signal?.aborted) return
        if (code === 0) {
          settled = true
          cleanup()
          resolve({ transcodedAudio: transcodeAudio })
          return
        }

        const drmMessage = detectDrmStderr(stderr)
        if (drmMessage) {
          settled = true
          cleanup()
          await fsp.rm(outputPath, { force: true }).catch(() => {})
          reject(new Error(drmMessage))
          return
        }

        // Retry with AAC-LC transcode when source carries non-AAC audio (MP3, Opus, E-AC-3).
        if (!transcodeAudio && shouldTranscodeAudioFallback(stderr)) {
          await fsp.rm(outputPath, { force: true }).catch(() => {})
          run({ transcodeAudio: true, dropAudioUrl })
          return
        }

        // Fall back to the main variant when an external audio rendition is unreachable.
        if (activeAudioUrl && !dropAudioUrl && stderr.includes(activeAudioUrl)) {
          await fsp.rm(outputPath, { force: true }).catch(() => {})
          run({ transcodeAudio: false, dropAudioUrl: true })
          return
        }

        settled = true
        cleanup()
        await fsp.rm(outputPath, { force: true }).catch(() => {})
        reject(new Error(lastError(stderr) || `ffmpeg exited with code ${code}`))
      })
    }

    run()
  })
}

/**
 * Losslessly moves an MP4 file's `moov` box to the start (`+faststart`) when
 * ffmpeg is available, leaving the original untouched if ffmpeg is missing.
 */
export function remuxFastStart(inputPath, outputPath, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const ffmpeg = resolveFfmpeg()
    if (!ffmpeg) {
      resolve(false)
      return
    }
    const caps = getFfmpegCapabilities(ffmpeg)
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin']
    if (caps.protocolWhitelist) args.push('-protocol_whitelist', 'file,pipe,crypto')
    args.push(
      '-i',
      toFfmpegLocalPath(inputPath),
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      toFfmpegLocalPath(outputPath),
    )
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const onAbort = () => kill(child)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr?.on('data', (c) => {
      stderr = (stderr + c.toString('utf8')).slice(-4_000)
    })
    child.once('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        reject(Object.assign(new Error('Download cancelled'), { name: 'AbortError' }))
        return
      }
      if (code === 0) resolve(true)
      else reject(new Error(lastError(stderr) || `ffmpeg faststart failed (${code})`))
    })
  })
}
