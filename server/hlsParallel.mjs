// Parallel HLS segment fetcher.
//
// FFmpeg's hls demuxer downloads segments strictly one after another, which
// makes a single episode download latency-bound: on a 400 ms-RTT CDN, 1 400
// two-second segments spend ~9 minutes just waiting. This module fetches
// segments over a bounded connection pool (default 8, configurable), rewrites
// the playlist to point at local files, and hands it to FFmpeg for the remux.
// The remux stays local, so all of the existing `-protocol_whitelist` safety
// and MP4 verification still applies.
//
// Every URL goes through the same SSRF/allowlist validation as the sequential
// path; the pool never follows redirects to unapproved hosts.

import fsp from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_CONCURRENCY = 8
const MAX_CONCURRENCY = 16
const SEGMENT_TIMEOUT_MS = 45_000
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024

/** Reads the configured parallelism, clamped to a sane range. */
export function segmentConcurrency(envValue = process.env.HLS_SEGMENT_CONCURRENCY) {
  const n = Number(envValue)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY
  return Math.min(MAX_CONCURRENCY, Math.floor(n))
}

/**
 * Splits an HLS media playlist into its header lines, ordered segment entries
 * and trailing directives, so a rewritten playlist can preserve `#EXT-X-KEY`,
 * `#EXT-X-MAP`, `#EXT-X-DISCONTINUITY` and byte-range metadata.
 */
export function parseMediaPlaylist(text, playlistUrl) {
  const lines = String(text ?? '').split(/\r?\n/)
  const header = []
  const entries = []
  const footer = []
  let pending = []

  // Tags that describe the segment that follows them.
  const PER_SEGMENT_TAG_RE =
    /^#EXT(?:INF|BYTERANGE|-X-BYTERANGE|-X-KEY|-X-MAP|-X-PROGRAM-DATE-TIME|-X-DISCONTINUITY)/i
  // Playlist-level directives that always belong in the header.
  const HEADER_TAG_RE =
    /^#EXTM3U|^#EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE|PLAYLIST-TYPE|INDEPENDENT-SEGMENTS|START|ALLOW-CACHE|I-FRAMES-ONLY)/i

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      if (/^#EXT-X-ENDLIST/i.test(line)) {
        footer.push(line)
        continue
      }
      if (PER_SEGMENT_TAG_RE.test(line)) {
        pending.push(line)
        continue
      }
      if (entries.length === 0 && HEADER_TAG_RE.test(line)) {
        header.push(line)
        continue
      }
      // Unknown/uncommon directive: keep it in document order relative to the
      // next segment so behaviour is preserved.
      pending.push(line)
      continue
    }

    // A URI line: it is the segment for the accumulated `pending` tags.
    let url
    try {
      url = new URL(line, playlistUrl).toString()
    } catch {
      throw Object.assign(new Error('Playlist contains an invalid segment URI'), { status: 422 })
    }
    entries.push({ tags: pending, url, line })
    pending = []
  }

  if (pending.length > 0) footer.push(...pending)
  return { header, entries, footer }
}

/** Rewrites a playlist so every segment points at a local file. */
export function rewritePlaylist({ header, entries, footer }, localPaths) {
  const out = [...header]
  entries.forEach((entry, index) => {
    out.push(...entry.tags)
    out.push(localPaths[index])
  })
  out.push(...footer)
  if (!out.some((line) => /^#EXT-X-ENDLIST/i.test(line))) out.push('#EXT-X-ENDLIST')
  return `${out.join('\n')}\n`
}

class Semaphore {
  constructor(limit) {
    this.limit = limit
    this.active = 0
    this.queue = []
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise((resolve) => this.queue.push(resolve))
    this.active += 1
  }

  release() {
    this.active -= 1
    const next = this.queue.shift()
    if (next) next()
  }
}

/**
 * Downloads every segment of a media playlist in parallel.
 *
 * @param {object} opts
 * @param {string} opts.playlistText media playlist body (already inspected)
 * @param {string} opts.playlistUrl final URL of that playlist (for relative URIs)
 * @param {string} opts.workDir directory to write segment files into
 * @param {(url: string, init: object) => Promise<{response: Response}>} opts.safeFetchFn
 * @param {(url: string) => Promise<unknown>} [opts.validateUrl] SSRF/allowlist check per segment
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.concurrency]
 * @param {(done: number, total: number) => void} [opts.onProgress]
 * @returns {Promise<{playlistPath: string, segmentCount: number, bytes: number}>}
 */
export async function downloadSegmentsParallel({
  playlistText,
  playlistUrl,
  workDir,
  safeFetchFn,
  validateUrl,
  signal,
  concurrency = DEFAULT_CONCURRENCY,
  onProgress,
  headers = {},
}) {
  const parsed = parseMediaPlaylist(playlistText, playlistUrl)
  if (parsed.entries.length === 0) {
    throw Object.assign(new Error('HLS media playlist contains no segments'), { status: 422 })
  }

  await fsp.mkdir(workDir, { recursive: true })
  const sem = new Semaphore(Math.max(1, Math.min(MAX_CONCURRENCY, concurrency)))
  const localPaths = new Array(parsed.entries.length)
  let bytes = 0
  let done = 0
  let failed = null

  const fetchOne = async (entry, index) => {
    if (failed) return
    if (validateUrl) await validateUrl(entry.url)
    const { response } = await safeFetchFn(entry.url, {
      headers,
      signal: signal ?? AbortSignal.timeout(SEGMENT_TIMEOUT_MS),
    })
    if (!response.ok && response.status !== 206) {
      await response.body?.cancel?.().catch(() => {})
      throw Object.assign(new Error(`Segment responded with HTTP ${response.status}`), { status: 502 })
    }
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.length > MAX_SEGMENT_BYTES) {
      throw Object.assign(new Error('HLS segment exceeds maximum size'), { status: 422 })
    }
    if (bytes + buf.length > MAX_TOTAL_BYTES) {
      throw Object.assign(new Error('HLS download exceeds maximum size'), { status: 413 })
    }
    bytes += buf.length
    const localPath = path.join(workDir, `seg-${String(index).padStart(6, '0')}.ts`)
    await fsp.writeFile(localPath, buf)
    localPaths[index] = localPath
    done += 1
    onProgress?.(done, parsed.entries.length)
  }

  const workers = parsed.entries.map((entry, index) => async () => {
    await sem.acquire()
    try {
      await fetchOne(entry, index)
    } catch (err) {
      if (!failed) failed = err
    } finally {
      sem.release()
    }
  })

  await Promise.allSettled(workers.map((run) => run()))
  if (failed) {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {})
    throw failed
  }

  // Absolute `file://` URLs keep FFmpeg from resolving anything against the
  // network, and are unambiguous on every platform.
  const playlistPath = path.join(workDir, 'local.m3u8')
  const toFileUrl = (p) => `file://${p.split(path.sep).map(encodeURIComponent).join('/')}`
  await fsp.writeFile(playlistPath, rewritePlaylist(parsed, localPaths.map(toFileUrl)))
  return { playlistPath, segmentCount: parsed.entries.length, bytes }
}
