// Playback helpers for the in-app player.
//
// Remote streams are remuxed to fragmented MP4 with ffmpeg and piped straight
// to the response; remote subtitles are relayed same-origin as VTT.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** Finds ffmpeg on PATH (or an absolute path) without spawning it. */
export function resolveFfmpeg() {
  const cmd = 'ffmpeg'
  if (cmd.includes('/')) {
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

function srtToVtt(value) {
  return `WEBVTT\n\n${value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
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
 * The source is a remote `url` with an optional referer. When the source keeps
 * audio in a separate HLS rendition, pass `audioUrl` so ffmpeg reads the video
 * variant and the audio playlist as two inputs. HLS sources need `hls: true`
 * so ffmpeg accepts hianime's `.ts.jpg` segments. `realtime: true` makes ffmpeg
 * read at playback speed instead of pulling the whole episode down as fast as
 * the network allows.
 */
export function remux(req, res, { url, audioUrl, referer, hls = false, realtime = false } = {}) {
  const ffmpeg = resolveFfmpeg()
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
  addRemoteInput(url)
  if (audioUrl) addRemoteInput(audioUrl)

  if (audioUrl) {
    args.push('-map', '0:v:0?', '-map', '1:a:0?')
  } else {
    args.push('-map', '0:v:0?', '-map', '0:a:0?')
  }
  // hianime audio arrives as ADTS AAC inside MPEG-TS; MP4 needs the ASC headers.
  if (audioUrl || hls) args.push('-bsf:a', 'aac_adtstoasc')
  args.push(
    '-c',
    'copy',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  )

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
