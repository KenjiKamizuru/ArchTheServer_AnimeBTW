// Persistent, 413-proof, resumable chunked video upload store.
//
// Lives at module scope so switching pages never interrupts an upload.
// Starts at a proxy-safe 900 KB chunk (passes default Nginx `client_max_body_size 1m`,
// Cloudflare Tunnel, Caddy, Traefik, and Apache with zero config), automatically
// scales up to 4 MB / 8 MB when the reverse proxy allows larger bodies, and
// steps down to 450 KB / 200 KB / 96 KB / 48 KB if any proxy responds with HTTP 413
// — without ever resetting upload progress.

import { useSyncExternalStore } from 'react'
import { api } from './api'
import { claimArtworkSlots } from './artwork'
import { refreshLibraryNow } from './downloads'
import type { ArtworkSlot, LibraryItem, UploadCategory } from '../types'

export type UploadTaskStatus =
  | 'queued'
  | 'uploading'
  | 'retrying'
  | 'finalizing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface UploadTask {
  id: string
  uploadId: string | null
  fileName: string
  targetFileName: string
  targetFolder: string
  category: UploadCategory
  title: string
  season: number
  episode: number
  quality: string
  dub: boolean
  keepBoth: boolean
  subtitleName: string | null
  totalSize: number
  uploadedBytes: number
  progress: number
  speedBps: number | null
  chunkSize: number
  resumed: boolean
  retryAttempt: number
  status: UploadTaskStatus
  error: string | null
  item: LibraryItem | null
  createdAt: number
}

export interface PendingImdbArtwork {
  imdbId: string
  imdbTitle: string
  slots: Partial<Record<ArtworkSlot, string>>
}

export interface EnqueueUploadInput {
  file: File
  category: UploadCategory
  title?: string
  season?: number
  episode?: number
  quality?: string
  dub?: boolean
  keepBoth?: boolean
  subtitleFile?: File | null
  imdbArtwork?: PendingImdbArtwork | null
}

interface InternalTask extends UploadTask {
  file: File
  subtitleFile: File | null
  imdbArtwork: PendingImdbArtwork | null
  xhr: XMLHttpRequest | null
  pauseRequested: boolean
  cancelRequested: boolean
  retryTimer: number | null
  probedCeiling: boolean
}

// Ordered ascending; index 4 (900 KB) fits under Nginx default `1m` (1,048,576 B)
// and decimal 1,000,000 B proxy caps with ample headroom for HTTP headers.
const CHUNK_LADDER = [
  48 * 1024, // 48 KB
  96 * 1024, // 96 KB
  200 * 1024, // 200 KB
  450 * 1024, // 450 KB
  900 * 1024, // 900 KB (default start — works on Nginx 1m out of the box)
  4 * 1024 * 1024, // 4 MB
  8 * 1024 * 1024, // 8 MB (full LAN / Cloudflare Tunnel speed)
]
const SAFE_START_CHUNK = 900 * 1024
const MAX_CHUNK_RETRIES = 10
const PROXY_CAP_KEY = 'animevault.uploadMaxChunkBytes'

// Remember discovered reverse-proxy body ceiling for this session so later chunks
// and subsequent movies never waste requests re-triggering 413.
let maxAllowedChunkBytes = (() => {
  try {
    const saved = Number(sessionStorage.getItem(PROXY_CAP_KEY))
    if (Number.isFinite(saved) && saved >= CHUNK_LADDER[0]) {
      return Math.min(saved, CHUNK_LADDER[CHUNK_LADDER.length - 1])
    }
  } catch {
    /* ignore */
  }
  return CHUNK_LADDER[CHUNK_LADDER.length - 1]
})()

let verifiedFastChunkBytes = 0

function recordProxyCeiling(rejectedSize: number) {
  const smaller = [...CHUNK_LADDER].reverse().find((s) => s < rejectedSize) ?? CHUNK_LADDER[0]
  if (smaller < maxAllowedChunkBytes) {
    maxAllowedChunkBytes = smaller
    if (verifiedFastChunkBytes > maxAllowedChunkBytes) {
      verifiedFastChunkBytes = maxAllowedChunkBytes
    }
    try {
      sessionStorage.setItem(PROXY_CAP_KEY, String(maxAllowedChunkBytes))
    } catch {
      /* ignore */
    }
  }
  return maxAllowedChunkBytes
}

function nextLargerChunk(current: number): number | null {
  for (const candidate of CHUNK_LADDER) {
    if (candidate > current && candidate <= maxAllowedChunkBytes) return candidate
  }
  return null
}

function nextSmallerChunk(current: number): number | null {
  for (let i = CHUNK_LADDER.length - 1; i >= 0; i--) {
    if (CHUNK_LADDER[i] < current) return CHUNK_LADDER[i]
  }
  return null
}

function initialChunkSize(): number {
  if (verifiedFastChunkBytes > 0) {
    return Math.min(verifiedFastChunkBytes, maxAllowedChunkBytes)
  }
  return Math.min(SAFE_START_CHUNK, maxAllowedChunkBytes)
}

export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.webm',
  '.m4v',
  '.mov',
  '.avi',
  '.ts',
  '.m2ts',
  '.ogv',
]
export const SUPPORTED_SUBTITLE_EXTENSIONS = ['.vtt', '.srt', '.ass', '.ssa']

export function cleanTitleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  return (
    stem
      .replace(/\[[^\]]*]/g, ' ')
      .replace(
        /\((?:19|20)\d{2}\)|\((?:360|480|720|1080|1440|2160)p\)|\((?:BD|BluRay|WEB[- ]?DL|WEBRip|HEVC|x264|x265|10bit|AAC|FLAC|Dual[- ]?Audio)[^)]*\)/gi,
        ' ',
      )
      .replace(
        /\b(?:360p|480p|720p|1080p|1440p|2160p|4k|x264|x265|h\.?264|h\.?265|hevc|av1|10bit|bluray|bdrip|webrip|web[-.]?dl|aac|flac|opus|ac3|eac3|dts|remux|dual[-.]?audio|multi[-.]?subs?)\b/gi,
        ' ',
      )
      .replace(/[._]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || stem.trim() || 'Movie'
  )
}

export function inferEpisodeFromFileName(fileName: string): {
  title: string
  season: number
  episode: number
} | null {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const sxxexx = stem.match(/^(.*?)[\s._-]*[Ss](\d{1,2})[\s._-]*[Ee](\d{1,4})(?:\b|[\s._-])/i)
  if (sxxexx) {
    return {
      title: cleanTitleFromFileName(sxxexx[1] || stem),
      season: Math.max(1, Number(sxxexx[2]) || 1),
      episode: Math.max(1, Number(sxxexx[3]) || 1),
    }
  }
  return null
}

const tasks: InternalTask[] = []
let pumping = false
let idCounter = 0
const listeners = new Set<() => void>()

export interface UploadsSnapshot {
  tasks: UploadTask[]
  activeCount: number
}

let cachedSnapshot: UploadsSnapshot = { tasks: [], activeCount: 0 }

function isActiveStatus(status: UploadTaskStatus) {
  return status === 'queued' || status === 'uploading' || status === 'retrying' || status === 'finalizing'
}

function toPublic(task: InternalTask): UploadTask {
  return {
    id: task.id,
    uploadId: task.uploadId,
    fileName: task.fileName,
    targetFileName: task.targetFileName,
    targetFolder: task.targetFolder,
    category: task.category,
    title: task.title,
    season: task.season,
    episode: task.episode,
    quality: task.quality,
    dub: task.dub,
    keepBoth: task.keepBoth,
    subtitleName: task.subtitleName,
    totalSize: task.totalSize,
    uploadedBytes: task.uploadedBytes,
    progress: task.progress,
    speedBps: task.speedBps,
    chunkSize: task.chunkSize,
    resumed: task.resumed,
    retryAttempt: task.retryAttempt,
    status: task.status,
    error: task.error,
    item: task.item,
    createdAt: task.createdAt,
  }
}

let lastEmitAt = 0
let trailingTimer: number | null = null

function rebuildSnapshot() {
  const pub = tasks.map(toPublic)
  cachedSnapshot = {
    tasks: pub,
    activeCount: pub.filter((t) => isActiveStatus(t.status)).length,
  }
  for (const fn of listeners) fn()
}

function emit(throttled = false) {
  if (!throttled) {
    if (trailingTimer !== null) {
      window.clearTimeout(trailingTimer)
      trailingTimer = null
    }
    lastEmitAt = Date.now()
    rebuildSnapshot()
    return
  }
  const now = Date.now()
  const elapsed = now - lastEmitAt
  if (elapsed >= 120) {
    lastEmitAt = now
    rebuildSnapshot()
    return
  }
  if (trailingTimer === null) {
    trailingTimer = window.setTimeout(() => {
      trailingTimer = null
      lastEmitAt = Date.now()
      rebuildSnapshot()
    }, 120 - elapsed)
  }
}

// Guard against accidental page close/refresh while a movie upload is running.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (tasks.some((t) => isActiveStatus(t.status))) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
}

class ChunkError extends Error {
  status: number
  code?: string
  uploadedBytes?: number
  aborted: boolean

  constructor(
    message: string,
    opts: { status: number; code?: string; uploadedBytes?: number; aborted?: boolean },
  ) {
    super(message)
    this.status = opts.status
    this.code = opts.code
    this.uploadedBytes = opts.uploadedBytes
    this.aborted = Boolean(opts.aborted)
  }
}

function sendChunk(
  task: InternalTask,
  uploadId: string,
  offset: number,
  blob: Blob,
  onLoaded: (loaded: number) => void,
): Promise<{ uploadedBytes: number; totalSize: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    task.xhr = xhr
    // Use POST + query offset + header offset so every reverse proxy / WAF forwards it cleanly.
    const url = `/api/library/uploads/${encodeURIComponent(uploadId)}/chunk?offset=${offset}`
    xhr.open('POST', url)
    xhr.timeout = 180_000 // 3 min per chunk (plenty even on slow mobile uplinks)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Upload-Offset', String(offset))

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onLoaded(ev.loaded)
    }

    xhr.onload = () => {
      task.xhr = null
      let body: {
        uploadedBytes?: number
        totalSize?: number
        error?: string
        code?: string
      } | null = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && typeof body?.uploadedBytes === 'number') {
        resolve({ uploadedBytes: body.uploadedBytes, totalSize: body.totalSize ?? task.totalSize })
        return
      }
      const fallbackMsg =
        xhr.status === 413
          ? 'Chunk exceeded proxy body limit (413)'
          : body?.error || `Upload chunk failed (${xhr.status})`
      reject(
        new ChunkError(fallbackMsg, {
          status: xhr.status,
          code: body?.code,
          uploadedBytes: body?.uploadedBytes,
        }),
      )
    }

    xhr.onerror = () => {
      task.xhr = null
      reject(new ChunkError('Network interruption during chunk transfer', { status: 0 }))
    }

    xhr.ontimeout = () => {
      task.xhr = null
      reject(new ChunkError('Chunk upload timed out', { status: 408 }))
    }

    xhr.onabort = () => {
      task.xhr = null
      reject(new ChunkError('Upload paused or cancelled', { status: 0, aborted: true }))
    }

    xhr.send(blob)
  })
}

function waitWithCancel(task: InternalTask, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      task.retryTimer = null
      resolve()
    }, ms)
    task.retryTimer = timer
  })
}

async function ensureSession(task: InternalTask): Promise<string> {
  if (task.uploadId) {
    try {
      const state = await api.getUploadSession(task.uploadId)
      task.uploadedBytes = state.uploadedBytes
      task.targetFileName = state.fileName
      task.targetFolder = state.folder
      task.progress = Math.min(99, Math.floor((state.uploadedBytes / task.totalSize) * 100))
      return state.uploadId
    } catch {
      task.uploadId = null
    }
  }

  const created = await api.createUploadSession({
    fileName: task.file.name,
    totalSize: task.file.size,
    lastModified: task.file.lastModified,
    category: task.category,
    title: task.title || undefined,
    season: task.season,
    episode: task.episode,
    quality: task.quality || undefined,
    dub: task.dub,
    keepBoth: task.keepBoth,
    imdbId: task.imdbArtwork?.imdbId || undefined,
  })
  task.uploadId = created.uploadId
  task.uploadedBytes = created.uploadedBytes
  task.targetFileName = created.fileName
  task.targetFolder = created.folder
  task.resumed = Boolean(created.resumed)
  task.progress =
    created.totalSize > 0 ? Math.min(99, Math.floor((created.uploadedBytes / created.totalSize) * 100)) : 0
  return created.uploadId
}

async function runUploadTask(task: InternalTask) {
  task.pauseRequested = false
  task.cancelRequested = false
  task.error = null
  task.status = 'uploading'
  task.chunkSize = initialChunkSize()
  emit()

  let uploadId: string
  try {
    uploadId = await ensureSession(task)
  } catch (err) {
    task.status = 'failed'
    task.speedBps = null
    task.error = err instanceof Error ? err.message : 'Could not start upload'
    emit()
    return
  }

  let speedWindowBytes = 0
  let speedWindowStart = performance.now()
  let consecutiveFailures = 0
  let succeededAtCurrentSize = 0
  let activeProbeFrom: number | null = null

  while (task.uploadedBytes < task.totalSize) {
    if (task.cancelRequested) {
      task.status = 'cancelled'
      task.speedBps = null
      emit()
      if (task.uploadId) void api.cancelUploadSession(task.uploadId).catch(() => {})
      task.uploadId = null
      return
    }
    if (task.pauseRequested) {
      task.status = 'paused'
      task.speedBps = null
      emit()
      return
    }

    const offset = task.uploadedBytes
    const remaining = task.totalSize - offset
    const sliceSize = Math.min(task.chunkSize, remaining)
    const slice = task.file.slice(offset, offset + sliceSize)
    const chunkStartedAt = performance.now()

    try {
      const result = await sendChunk(task, uploadId, offset, slice, (loaded) => {
        const liveBytes = Math.min(task.totalSize, offset + loaded)
        task.progress = Math.min(99, Math.floor((liveBytes / task.totalSize) * 100))
        const elapsedSec = (performance.now() - speedWindowStart) / 1000
        if (elapsedSec >= 0.4) {
          task.speedBps = Math.round((speedWindowBytes + loaded) / elapsedSec)
        }
        emit(true)
      })

      const delta = Math.max(0, result.uploadedBytes - offset)
      task.uploadedBytes = result.uploadedBytes
      task.progress = Math.min(99, Math.floor((task.uploadedBytes / task.totalSize) * 100))
      task.status = 'uploading'
      task.retryAttempt = 0
      task.error = null
      consecutiveFailures = 0
      succeededAtCurrentSize += 1
      activeProbeFrom = null

      if (sliceSize === task.chunkSize && task.chunkSize > verifiedFastChunkBytes) {
        verifiedFastChunkBytes = task.chunkSize
      }

      speedWindowBytes += delta
      const elapsedSec = (performance.now() - speedWindowStart) / 1000
      if (elapsedSec >= 0.5) {
        task.speedBps = Math.round(speedWindowBytes / elapsedSec)
        speedWindowBytes = 0
        speedWindowStart = performance.now()
      }

      // After a clean chunk, gently step up toward 4 MB -> 8 MB if the proxy permits it.
      if (succeededAtCurrentSize >= 1 && task.totalSize - task.uploadedBytes > task.chunkSize) {
        const bigger = nextLargerChunk(task.chunkSize)
        if (bigger && task.totalSize - task.uploadedBytes >= bigger) {
          activeProbeFrom = task.chunkSize
          task.chunkSize = bigger
          succeededAtCurrentSize = 0
        }
      }

      emit(true)
    } catch (err) {
      const ce =
        err instanceof ChunkError
          ? err
          : new ChunkError(err instanceof Error ? err.message : 'Upload error', { status: 0 })

      if (ce.aborted || task.cancelRequested || task.pauseRequested) {
        if (task.cancelRequested) {
          task.status = 'cancelled'
          task.speedBps = null
          emit()
          if (task.uploadId) void api.cancelUploadSession(task.uploadId).catch(() => {})
          task.uploadId = null
          return
        }
        task.status = 'paused'
        task.speedBps = null
        emit()
        return
      }

      // Offset mismatch — instantly resync to the server's exact byte count and continue.
      if (ce.status === 409 && typeof ce.uploadedBytes === 'number') {
        task.uploadedBytes = ce.uploadedBytes
        task.progress = Math.min(99, Math.floor((task.uploadedBytes / task.totalSize) * 100))
        speedWindowBytes = 0
        speedWindowStart = performance.now()
        emit()
        continue
      }

      // HTTP 413 (or immediate TCP reset while probing a larger chunk — Nginx frequently
      // closes the socket before reading the request body on `client_max_body_size` 413,
      // which browsers surface as status 0 within a few hundred ms):
      // permanently cap chunk size below `sliceSize` and retry immediately without resetting!
      const fastReset =
        ce.status === 0 &&
        (activeProbeFrom !== null || consecutiveFailures >= 1) &&
        performance.now() - chunkStartedAt < 8_000
      if (ce.status === 413 || fastReset) {
        // Resync offset first — if the server actually received partial bytes, it was a
        // normal network hiccup rather than a reverse-proxy 413 rejection.
        let serverAdvanced = false
        try {
          const state = await api.getUploadSession(uploadId)
          if (state.uploadedBytes > offset) serverAdvanced = true
          task.uploadedBytes = state.uploadedBytes
        } catch {
          /* keep current offset */
        }
        if (ce.status === 413 || !serverAdvanced) {
          const newCap = recordProxyCeiling(sliceSize)
          const fallback =
            activeProbeFrom !== null ? Math.min(activeProbeFrom, newCap) : nextSmallerChunk(sliceSize)
          activeProbeFrom = null
          succeededAtCurrentSize = 0
          if (fallback && fallback < sliceSize) {
            task.chunkSize = fallback
            speedWindowBytes = 0
            speedWindowStart = performance.now()
            emit()
            continue
          }
        }
      }

      // Also step down one notch on repeated timeouts over very slow connections.
      if (ce.status === 408) {
        const smaller = nextSmallerChunk(task.chunkSize)
        if (smaller && smaller >= SAFE_START_CHUNK) {
          task.chunkSize = smaller
        }
      }

      // Non-retryable client validation errors (400 / 422).
      if (ce.status === 400 || ce.status === 422) {
        task.status = 'failed'
        task.speedBps = null
        task.error = ce.message
        emit()
        return
      }

      consecutiveFailures += 1
      if (consecutiveFailures > MAX_CHUNK_RETRIES) {
        task.status = 'failed'
        task.speedBps = null
        task.error = `${ce.message}. Progress saved at ${task.progress}% — click Resume to continue.`
        emit()
        return
      }

      task.status = 'retrying'
      task.retryAttempt = consecutiveFailures
      task.speedBps = null
      emit()

      const backoffMs = Math.min(8_000, 700 * Math.pow(1.6, consecutiveFailures - 1))
      await waitWithCancel(task, backoffMs)
      if (task.cancelRequested || task.pauseRequested) continue

      // Resync exact server offset (recreating session if expired) before resuming.
      try {
        uploadId = await ensureSession(task)
      } catch {
        /* next loop iteration will retry */
      }
      speedWindowBytes = 0
      speedWindowStart = performance.now()
    }
  }

  // All bytes delivered — validate & atomically commit into the library.
  task.status = 'finalizing'
  task.progress = 99
  task.speedBps = null
  emit()

  try {
    const { item } = await api.completeUploadSession(uploadId)
    task.item = item
    task.targetFileName = item.fileName
    task.targetFolder = item.folder

    if (task.subtitleFile) {
      try {
        await api.uploadLibrarySubtitle(item.id, task.subtitleFile)
        task.item = { ...item, hasSubtitle: true }
      } catch (subErr) {
        task.error =
          subErr instanceof Error
            ? `Video saved, but subtitle failed: ${subErr.message}`
            : 'Video saved, but subtitle upload failed'
      }
    }

    if (task.imdbArtwork && Object.values(task.imdbArtwork.slots).some(Boolean)) {
      try {
        const groupTitle = item.seriesTitle || item.animeTitle || task.title
        await claimArtworkSlots({
          targetType: task.category === 'unknown' ? 'file' : 'series',
          targetKey: task.category === 'unknown' ? item.id : groupTitle,
          slots: task.imdbArtwork.slots,
          imdbId: task.imdbArtwork.imdbId,
          imdbTitle: task.imdbArtwork.imdbTitle,
        })
      } catch (artErr) {
        if (!task.error) {
          task.error =
            artErr instanceof Error
              ? `Video saved, but IMDb artwork failed: ${artErr.message}`
              : 'Video saved, but IMDb artwork claim failed'
        }
      }
    }

    task.status = 'completed'
    task.progress = 100
    task.uploadedBytes = task.totalSize
    task.uploadId = null
    emit()
    await refreshLibraryNow().catch(() => {})
  } catch (err) {
    task.status = 'failed'
    task.error = err instanceof Error ? err.message : 'Could not finalize uploaded video'
    emit()
  }
}

async function pumpQueue() {
  if (pumping) return
  pumping = true
  try {
    while (true) {
      const next = tasks.find((t) => t.status === 'queued')
      if (!next) break
      await runUploadTask(next)
    }
  } finally {
    pumping = false
  }
}

export function enqueueUploads(inputs: EnqueueUploadInput[]): UploadTask[] {
  const added: InternalTask[] = []
  for (const input of inputs) {
    idCounter += 1
    const cleanTitle = (input.title ?? '').trim() || cleanTitleFromFileName(input.file.name)
    const folderPreview =
      input.category === 'movie'
        ? 'Movies'
        : input.category === 'episode'
          ? `${cleanTitle}/Season ${String(Math.max(1, input.season ?? 1)).padStart(2, '0')}`
          : 'Unsorted'
    const task: InternalTask = {
      id: `local_up_${Date.now()}_${idCounter}`,
      uploadId: null,
      file: input.file,
      subtitleFile: input.subtitleFile ?? null,
      imdbArtwork: input.imdbArtwork ?? null,
      subtitleName: input.subtitleFile?.name ?? null,
      fileName: input.file.name,
      targetFileName: input.file.name,
      targetFolder: folderPreview,
      category: input.category,
      title: cleanTitle,
      season: Math.max(1, Math.floor(input.season ?? 1)),
      episode: Math.max(1, Math.floor(input.episode ?? 1)),
      quality: input.quality ?? 'local',
      dub: Boolean(input.dub),
      keepBoth: Boolean(input.keepBoth),
      totalSize: input.file.size,
      uploadedBytes: 0,
      progress: 0,
      speedBps: null,
      chunkSize: initialChunkSize(),
      resumed: false,
      retryAttempt: 0,
      status: 'queued',
      error: null,
      item: null,
      createdAt: Date.now(),
      xhr: null,
      pauseRequested: false,
      cancelRequested: false,
      retryTimer: null,
      probedCeiling: false,
    }
    tasks.unshift(task)
    added.push(task)
  }
  emit()
  void pumpQueue()
  return added.map(toPublic)
}

export function pauseUpload(id: string) {
  const task = tasks.find((t) => t.id === id)
  if (!task) return
  if (task.status === 'queued') {
    task.status = 'paused'
    emit()
    return
  }
  if (task.status === 'uploading' || task.status === 'retrying') {
    task.pauseRequested = true
    if (task.retryTimer !== null) {
      window.clearTimeout(task.retryTimer)
      task.retryTimer = null
    }
    if (task.xhr) {
      task.xhr.abort()
    } else {
      task.status = 'paused'
      task.speedBps = null
      emit()
    }
  }
}

export function resumeUpload(id: string) {
  const task = tasks.find((t) => t.id === id)
  if (!task) return
  if (task.status === 'paused' || task.status === 'failed') {
    task.pauseRequested = false
    task.cancelRequested = false
    task.error = null
    task.retryAttempt = 0
    task.status = 'queued'
    emit()
    void pumpQueue()
  }
}

export function cancelUpload(id: string) {
  const task = tasks.find((t) => t.id === id)
  if (!task) return
  task.cancelRequested = true
  if (task.retryTimer !== null) {
    window.clearTimeout(task.retryTimer)
    task.retryTimer = null
  }
  if (task.xhr) {
    task.xhr.abort()
    return
  }
  const existingSession = task.uploadId
  task.uploadId = null
  task.status = 'cancelled'
  task.speedBps = null
  emit()
  if (existingSession) {
    void api.cancelUploadSession(existingSession).catch(() => {})
  }
}

export function dismissUpload(id: string) {
  const idx = tasks.findIndex((t) => t.id === id)
  if (idx === -1) return
  const task = tasks[idx]
  if (isActiveStatus(task.status)) return
  if (task.uploadId && task.status !== 'completed') {
    void api.cancelUploadSession(task.uploadId).catch(() => {})
  }
  tasks.splice(idx, 1)
  emit()
}

export function clearFinishedUploads() {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const s = tasks[i].status
    if (s === 'completed' || s === 'cancelled') {
      tasks.splice(i, 1)
    }
  }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return cachedSnapshot
}

export function useUploads(): UploadsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
