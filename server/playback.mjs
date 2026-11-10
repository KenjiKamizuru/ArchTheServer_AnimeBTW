// Playback helpers.
//
// Local files are served with HTTP range support so the browser can seek.
// Containers the browser cannot play (mkv, ts, …) and live ani-cli streams are
// remuxed to fragmented MP4 with ffmpeg and piped straight to the response.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import * as anicli from './anicli.mjs'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const VIDEO_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
}

const DIRECT_PLAY = new Set(['.mp4', '.m4v', '.webm', '.mov'])
const SUBTITLE_EXT = ['.vtt', '.srt', '.ass', '.ssa']

export function getMime(filePath) {
  return VIDEO_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

/** True when the browser can usually play this container without remuxing. */
export function directPlayable(filePath) {
  return DIRECT_PLAY.has(path.extname(filePath).toLowerCase())
}

/** Serves a file with byte-range support (needed for seeking and mobile Safari). */
export function sendFileWithRange(req, res, filePath, downloadName) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    res.status(404).json({ error: 'File not found' })
    return
  }
  if (!stat.isFile()) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  const fileSize = stat.size
  const range = req.headers.range
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', getMime(filePath))
  if (downloadName) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(downloadName)}"`)
  }

  if (range) {
    const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-')
    let start
    let end
    if (!startRaw) {
      // Suffix range: the last N bytes.
      const suffix = Number.parseInt(endRaw, 10)
      start = Number.isNaN(suffix) ? NaN : Math.max(0, fileSize - suffix)
      end = fileSize - 1
    } else {
      start = Number.parseInt(startRaw, 10)
      end = endRaw ? Number.parseInt(endRaw, 10) : fileSize - 1
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end()
      return
    }
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
    res.setHeader('Content-Length', end - start + 1)
    const stream = fs.createReadStream(filePath, { start, end })
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end()
    })
    stream.pipe(res)
    return
  }

  res.status(200)
  res.setHeader('Content-Length', fileSize)
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end()
  })
  stream.pipe(res)
}

/** Finds a sidecar subtitle next to a media file. */
export function findSubtitle(filePath) {
  const parsed = path.parse(filePath)
  for (const ext of SUBTITLE_EXT) {
    const candidate = path.join(parsed.dir, `${parsed.name}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function srtToVtt(value) {
  return `WEBVTT\n\n${value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

function assToVtt(filePath) {
  return new Promise((resolve) => {
    const ffmpeg = anicli.resolveBin('ffmpeg')
    if (!ffmpeg) {
      resolve(null)
      return
    }
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-f', 'webvtt', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout?.on('data', (chunk) => {
      if (out.length < 8_000_000) out += chunk
    })
    child.once('error', () => resolve(null))
    child.once('close', (code) => resolve(code === 0 && out.trim() ? out : null))
  })
}

/** Serves a local subtitle as WebVTT, converting SRT/ASS when needed. */
export async function sendSubtitleFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  let text
  try {
    if (ext === '.ass' || ext === '.ssa') {
      text = await assToVtt(filePath)
      if (!text) text = await fsp.readFile(filePath, 'utf8')
    } else {
      text = await fsp.readFile(filePath, 'utf8')
      if (ext === '.srt') text = srtToVtt(text)
    }
  } catch {
    res.status(404).json({ error: 'Subtitle not found' })
    return
  }

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.send(text)
}

/** Fetches a remote subtitle (hianime serves VTT) and relays it same-origin. */
export async function proxySubtitle(res, url, referer) {
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(referer ? { Referer: referer } : {}),
      },
    })
    if (!upstream.ok) {
      res.status(upstream.status === 404 ? 404 : 502).json({ error: 'Subtitle not found' })
      return
    }
    let text = await upstream.text()
    if (!/^\s*WEBVTT/i.test(text)) text = srtToVtt(text)
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.send(text)
  } catch (err) {
    res.status(502).json({ error: err?.message || 'Could not fetch the subtitle' })
  }
}

function lastError(stderr) {
  const lines = String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.at(-1)?.slice(0, 300) || null
}

function kill(child) {
  if (!child || child.killed || child.exitCode != null) return
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }, 2_000)
  timer.unref?.()
}

/**
 * Pipes ffmpeg output to the browser as fragmented MP4.
 *
 * Pass either a local `filePath` or a remote `url` (with an optional referer).
 * When the source keeps audio in a separate HLS rendition, pass `audioUrl` so
 * ffmpeg reads the video variant and the audio playlist as two inputs.
 * HLS sources need `hls: true` so ffmpeg accepts hianime's `.ts.jpg` segments.
 * Set `realtime: true` for live viewing so ffmpeg reads at playback speed instead
 * of pulling the whole episode down as fast as the network allows.
 */
export function remux(req, res, { filePath, url, audioUrl, referer, hls = false, realtime = false } = {}) {
  const ffmpeg = anicli.resolveBin('ffmpeg')
  if (!ffmpeg) {
    res.status(503).json({ error: 'ffmpeg is required for this playback mode' })
    return
  }

  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']
  const addRemoteInput = (target) => {
    if (realtime) args.push('-re')
    if (referer) args.push('-referer', referer)
    args.push('-user_agent', USER_AGENT)
    if (hls) args.push('-extension_picky', '0', '-f', 'hls', '-allowed_segment_extensions', 'ALL')
    args.push('-i', target)
  }
  if (url) addRemoteInput(url)
  else args.push('-i', filePath)
  if (audioUrl) addRemoteInput(audioUrl)

  if (audioUrl) {
    args.push('-map', '0:v:0?', '-map', '1:a:0?')
  } else {
    args.push('-map', '0:v:0?', '-map', '0:a:0?')
  }
  args.push(
    '-c',
    'copy',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  )
  // hianime audio arrives as ADTS AAC inside MPEG-TS; MP4 needs the ASC headers.
  if (audioUrl || hls) args.splice(args.length - 6, 0, '-bsf:a', 'aac_adtstoasc')

  let child
  try {
    child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Could not start ffmpeg' })
    return
  }

  let started = false
  let stderr = ''
  let settled = false

  const finish = (status, body) => {
    if (settled) return
    settled = true
    if (res.writableEnded || res.destroyed) return
    if (!started) {
      res.status(status).json(body)
    } else {
      res.end()
    }
  }

  const cleanup = () => kill(child)
  res.on('close', cleanup)
  req.on('close', cleanup)

  child.stdout?.on('data', (chunk) => {
    if (res.writableEnded || res.destroyed) return
    if (!started) {
      started = true
      res.status(200)
      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Accept-Ranges', 'none')
    }
    res.write(chunk)
  })

  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8_000)
  })

  child.once('error', (err) => {
    finish(500, { error: err?.message || 'Could not start ffmpeg' })
  })

  child.once('close', (code) => {
    res.off('close', cleanup)
    req.off('close', cleanup)
    if (code === 0) {
      finish(200, {})
      return
    }
    finish(502, { error: lastError(stderr) || `ffmpeg exited with code ${code}` })
  })
}
