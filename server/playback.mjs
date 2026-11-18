// Playback helpers for the in-app player.
//
// Remote streams are remuxed to fragmented MP4 with ffmpeg and piped straight
// to the response; remote subtitles are relayed same-origin as VTT.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

/** Probes optional HLS demuxer and pacing flags once per ffmpeg binary. */
function getFfmpegCapabilities(ffmpeg) {
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
  try {
    const res = spawnSync(ffmpeg, ['-hide_banner', '-h', 'long'], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    longHelp = res.stdout || ''
  } catch {
    /* fall back to -re */
  }

  const caps = {
    extensionPicky: hlsHelp.includes('-extension_picky'),
    allowedExtensions: hlsHelp.includes('-allowed_extensions'),
    allowedSegmentExtensions: hlsHelp.includes('-allowed_segment_extensions'),
    readrateBurst: longHelp.includes('-readrate_initial_burst'),
  }
  capabilityCache.set(ffmpeg, caps)
  return caps
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

function shouldTranscodeAudioFallback(stderr) {
  return /aac_adtstoasc|bitstream filter|malformed aac|could not find tag for codec|not (?:currently )?supported in container/i.test(
    String(stderr ?? ''),
  )
}

function buildRemuxArgs({ url, audioUrl, referer, hls, realtime, transcodeAudio, caps }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']
  const addRemoteInput = (target, isHls) => {
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
    if (referer) args.push('-referer', referer)
    args.push('-user_agent', USER_AGENT)
    if (isHls) {
      if (caps.extensionPicky) args.push('-extension_picky', '0')
      args.push('-f', 'hls')
      if (caps.allowedExtensions) args.push('-allowed_extensions', 'ALL')
      if (caps.allowedSegmentExtensions) args.push('-allowed_segment_extensions', 'ALL')
    }
    args.push('-i', target)
  }

  addRemoteInput(url, hls)
  if (audioUrl) addRemoteInput(audioUrl, hls || /\.m3u8(?:$|\?)/i.test(audioUrl))

  if (audioUrl) {
    args.push('-map', '0:v:0?', '-map', '1:a:0?')
  } else {
    args.push('-map', '0:v:0?', '-map', '0:a:0?')
  }
  args.push('-disposition:v:0', 'default', '-disposition:a:0', 'default')

  if (transcodeAudio) {
    args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000')
  } else {
    args.push('-c:v', 'copy', '-c:a', 'copy')
    // hianime audio arrives as ADTS AAC inside MPEG-TS; MP4 needs ASC framing.
    if (audioUrl || hls) args.push('-bsf:a', 'aac_adtstoasc')
  }

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
 * The source is a remote `url` with an optional referer. When the source keeps
 * audio in a separate HLS rendition, pass `audioUrl` so ffmpeg reads the video
 * variant and the audio playlist as two inputs. HLS sources need `hls: true`
 * so ffmpeg accepts hianime's `.ts.jpg` segments. `realtime: true` paces input
 * reading instead of pulling the whole episode down as fast as the network
 * allows.
 */
export function remux(req, res, { url, audioUrl, referer, hls = false, realtime = false } = {}) {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) {
    res.status(503).json({ error: 'ffmpeg is required for this playback mode' })
    return
  }

  const caps = getFfmpegCapabilities(ffmpeg)
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
    detachListeners()
    kill(child)
  }

  const finish = (status, body) => {
    if (settled) return
    settled = true
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

  const run = ({ transcodeAudio = false, dropAudioUrl = false } = {}) => {
    const activeAudioUrl = dropAudioUrl ? null : audioUrl
    const args = buildRemuxArgs({
      url,
      audioUrl: activeAudioUrl,
      referer,
      hls,
      realtime,
      transcodeAudio,
      caps,
    })
    let proc
    try {
      proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      finish(500, { error: err?.message || 'Could not start ffmpeg' })
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
      finish(500, { error: err?.message || 'Could not start ffmpeg' })
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
        run({ transcodeAudio: true, dropAudioUrl })
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
