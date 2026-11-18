// Persistent anime download manager.
//
// - Persists all jobs atomically to `data/downloads.json` and survives restarts.
// - Reuses `server/resolver.mjs` and `server/playback.mjs` (FFmpeg + subtitle VTT).
// - Supports individual episodes, multi-select, custom ranges, full seasons,
//   full series, and authorized external MP4 / HLS (M3U8) URLs with safe headers.
// - Stages active writes in `<libraryDir>/.incomplete/` and commits completed,
//   container-verified files atomically without overwriting existing media.
// - Supports pause/resume, cancel, retry, single & bulk delete, configurable
//   concurrency limits, and live Server-Sent Events progress updates.

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as settings from './settings.mjs'
import * as resolver from './resolver.mjs'
import * as playback from './playback.mjs'
import * as library from './library.mjs'
import {
  inspectHlsPlaylist,
  inspectMp4File,
  inspectMp4PrefixBytes,
  safeFetch,
  sanitizeExternalHeaders,
  validateRemoteUrl,
} from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const JOBS_FILE = path.join(DATA_DIR, 'downloads.json')

const MAX_BULK_EPISODES = 500
const MAX_SUSPENDED_FFMPEG = 3
const PROGRESS_PERSIST_MS = 1_500
const SSE_THROTTLE_MS = 300

const ACTIVE_STATUSES = new Set(['queued', 'resolving', 'downloading', 'paused'])
const RUNNING_STATUSES = new Set(['resolving', 'downloading'])

/** Ordered list of jobs (newest first in public responses, FIFO when dequeuing). */
let jobs = []
/** jobId -> runtime execution handle */
const runtime = new Map()
/** Connected SSE response listeners */
const listeners = new Set()

let persistTimer = null
let persistChain = Promise.resolve()
let emitTimer = null
let shuttingDown = false
let pumpScheduled = false
let unsubLibrary = null

// Overridable only in automated tests; always undefined (strict defaults) in prod.
let networkOverrides = {
  dnsLookup: undefined,
  fetchImpl: undefined,
}

export function _setTestOverrides(overrides = {}) {
  networkOverrides = {
    dnsLookup: overrides.dnsLookup,
    fetchImpl: overrides.fetchImpl,
  }
}

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function newJobId() {
  return `dl_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`
}

function serializeJobs() {
  return JSON.stringify(jobs, null, 2)
}

function persistNow() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const payload = serializeJobs()
  persistChain = persistChain
    .catch(() => {})
    .then(async () => {
      await fsp.mkdir(DATA_DIR, { recursive: true })
      const tmp = `${JOBS_FILE}.${process.pid}.tmp`
      await fsp.writeFile(tmp, payload)
      await fsp.rename(tmp, JOBS_FILE)
    })
    .catch((err) => {
      console.error('[downloads] failed to persist jobs:', err?.message || err)
    })
  return persistChain
}

function persistThrottled() {
  if (persistTimer || shuttingDown) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistNow()
  }, PROGRESS_PERSIST_MS)
  persistTimer.unref?.()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitNow(eventType = 'jobs') {
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
  if (listeners.size === 0) return
  const payload = eventType === 'jobs' ? snapshot() : null
  for (const fn of listeners) {
    try {
      fn(eventType, payload)
    } catch {
      /* ignore broken subscriber */
    }
  }
}

function emitThrottled() {
  if (emitTimer || listeners.size === 0) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    emitNow('jobs')
  }, SSE_THROTTLE_MS)
  emitTimer.unref?.()
}

function canPauseJob(job) {
  if (job.status === 'queued') return true
  if (job.status === 'downloading') {
    const rt = runtime.get(job.id)
    if (!rt) return false
    if (rt.kind === 'direct') return true
    if (rt.kind === 'ffmpeg') return Boolean(rt.control?.canPause) || true
  }
  if (job.status === 'resolving') return true
  return false
}

/** Strips internal state and filesystem details before returning a job over the API. */
export function toPublicJob(job) {
  return {
    id: job.id,
    sourceType: job.sourceType,
    mediaId: job.mediaId,
    animeTitle: job.animeTitle,
    seriesTitle: job.seriesTitle,
    season: job.season,
    episode: job.episode,
    code: library.formatSeasonEpisodeCode(job.season, job.episode),
    fileName: path.posix.basename(job.targetRelPath),
    folder: path.posix.dirname(job.targetRelPath),
    quality: job.quality,
    resolvedHeight: job.resolvedHeight,
    dub: job.dub,
    format: job.format,
    cover: job.cover,
    status: job.status,
    progress: job.progress,
    downloadedBytes: job.downloadedBytes,
    totalBytes: job.totalBytes,
    durationSec: job.durationSec,
    downloadedSec: job.downloadedSec,
    speedBps: job.status === 'downloading' ? job.speedBps : null,
    canPause: canPauseJob(job),
    canResume: job.status === 'paused',
    fileId: job.fileId,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  }
}

export function snapshot() {
  const ordered = [...jobs].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  const config = settings.get()
  let activeCount = 0
  let queuedCount = 0
  let pausedCount = 0
  let completedCount = 0
  let failedCount = 0
  for (const job of ordered) {
    if (job.status === 'downloading' || job.status === 'resolving') activeCount += 1
    else if (job.status === 'queued') queuedCount += 1
    else if (job.status === 'paused') pausedCount += 1
    else if (job.status === 'completed') completedCount += 1
    else if (job.status === 'failed') failedCount += 1
  }
  return {
    jobs: ordered.map(toPublicJob),
    maxConcurrent: config.maxConcurrentDownloads,
    counts: {
      active: activeCount,
      queued: queuedCount,
      paused: pausedCount,
      completed: completedCount,
      failed: failedCount,
      total: ordered.length,
    },
  }
}

/** Loads persisted jobs, recovers interrupted downloads, and resumes the queue. */
export async function init() {
  shuttingDown = false
  try {
    const raw = await fsp.readFile(JOBS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      jobs = parsed.filter((j) => j && typeof j === 'object' && j.id && j.targetRelPath)
    }
  } catch {
    jobs = []
  }

  // Forward library changes to SSE subscribers so open tabs refresh immediately.
  unsubLibrary?.()
  unsubLibrary = library.onChange(() => {
    emitNow('library')
  })

  const keepPartFiles = new Set()
  let dirty = false

  for (const job of jobs) {
    job.speedBps = null

    // Jobs that were running when the server stopped are re-queued automatically.
    if (job.status === 'resolving' || job.status === 'downloading') {
      // Check if the final file actually made it into the library right before exit.
      const existing = await library.getExistingByRelPath(job.targetRelPath)
      if (existing) {
        job.status = 'completed'
        job.progress = 100
        job.downloadedBytes = existing.size
        job.totalBytes = existing.size
        job.fileId = existing.id
        job.completedAt = job.completedAt || Date.now()
        job._partFileName = null
        job._directResume = false
      } else {
        job.status = 'queued'
        job.error = null
        job.updatedAt = Date.now()
        if (job._directResume && job._partFileName) {
          // Verify partial direct-MP4 file and retain it for HTTP Range resume.
          const partPath = await library.allocateTempPath(job._partFileName)
          try {
            const st = await fsp.stat(partPath)
            if (st.isFile() && st.size > 0) {
              job.downloadedBytes = st.size
              if (job.totalBytes && job.totalBytes > 0) {
                job.progress = Math.min(99.9, Math.round((st.size / job.totalBytes) * 1000) / 10)
              }
              keepPartFiles.add(job._partFileName)
            } else {
              job.downloadedBytes = 0
              job.progress = 0
            }
          } catch {
            job.downloadedBytes = 0
            job.progress = 0
          }
        } else {
          // Non-resumable stream (HLS/FFmpeg): start cleanly from 0%.
          job.downloadedBytes = 0
          job.downloadedSec = 0
          job.progress = 0
          job._partFileName = null
        }
      }
      dirty = true
      continue
    }

    if (job.status === 'paused' && job._directResume && job._partFileName) {
      keepPartFiles.add(job._partFileName)
      continue
    }

    if (job.status === 'paused' && !job._directResume) {
      // A process-paused FFmpeg job cannot stay suspended across OS restarts;
      // keep it paused and restart cleanly when the user clicks Resume.
      if (job.downloadedBytes > 0 || job._partFileName) {
        job.downloadedBytes = 0
        job.downloadedSec = 0
        job.progress = 0
        job._partFileName = null
        dirty = true
      }
      continue
    }

    if (job.status === 'queued' && job._directResume && job._partFileName) {
      keepPartFiles.add(job._partFileName)
      continue
    }

    if (job.status === 'completed') {
      const existing = await library.getExistingByRelPath(job.targetRelPath)
      const nextId = existing ? existing.id : null
      if (job.fileId !== nextId) {
        job.fileId = nextId
        dirty = true
      }
    }
  }

  await library.cleanupIncompleteFiles(keepPartFiles)
  if (dirty) await persistNow()
  schedulePump()
}

/** Cleanly stops active downloads and flushes queue state before process exit. */
export async function shutdown() {
  shuttingDown = true
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }

  for (const [jobId, rt] of runtime.entries()) {
    rt.reason = 'shutdown'
    try {
      rt.controller.abort()
    } catch {
      /* ignore */
    }
    const job = jobs.find((j) => j.id === jobId)
    if (job && (job.status === 'downloading' || job.status === 'resolving')) {
      job.speedBps = null
      job.updatedAt = Date.now()
    }
  }
  runtime.clear()

  try {
    await fsp.mkdir(DATA_DIR, { recursive: true })
    const tmp = `${JOBS_FILE}.${process.pid}.shutdown.tmp`
    fs.writeFileSync(tmp, serializeJobs())
    fs.renameSync(tmp, JOBS_FILE)
  } catch {
    /* best effort on shutdown */
  }
}

/** Triggers the scheduler (e.g. after changing simultaneous download limit). */
export function schedulePump() {
  if (pumpScheduled || shuttingDown) return
  pumpScheduled = true
  queueMicrotask(() => {
    pumpScheduled = false
    pump()
  })
}

function runningSlotCount() {
  let count = 0
  for (const job of jobs) {
    if (RUNNING_STATUSES.has(job.status)) count += 1
  }
  return count
}

function suspendedFfmpegCount() {
  let count = 0
  for (const rt of runtime.values()) {
    if (rt.kind === 'ffmpeg' && rt.suspended) count += 1
  }
  return count
}

function pump() {
  if (shuttingDown) return
  const limit = settings.get().maxConcurrentDownloads
  let running = runningSlotCount()
  if (running >= limit) return

  // Wake suspended in-memory FFmpeg jobs first, then dequeue fresh jobs FIFO.
  const queued = jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => {
      const aSusp = runtime.get(a.id)?.suspended ? 0 : 1
      const bSusp = runtime.get(b.id)?.suspended ? 0 : 1
      if (aSusp !== bSusp) return aSusp - bSusp
      return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    })

  for (const job of queued) {
    if (running >= limit) break
    const existingRt = runtime.get(job.id)
    if (existingRt) {
      if (existingRt.kind === 'ffmpeg' && existingRt.suspended && existingRt.control?.resume()) {
        existingRt.suspended = false
        job.status = 'downloading'
        job.updatedAt = Date.now()
        running += 1
        void persistNow()
        emitNow('jobs')
      }
      continue
    }
    running += 1
    void executeJob(job)
  }
}

function normalizeQuality(raw, fallback) {
  const q = String(raw ?? fallback ?? 'best').trim().toLowerCase()
  return settings.QUALITIES.includes(q) ? q : fallback || 'best'
}

async function prepareJobRecord(spec, config) {
  const sourceType = spec.sourceType === 'external' ? 'external' : 'resolver'
  const rawTitle = String(spec.animeTitle ?? spec.title ?? spec.query ?? '').trim()
  if (!rawTitle) {
    throw httpError('An anime title is required', 400)
  }

  const quality = normalizeQuality(spec.quality, config.quality)
  const dub = spec.dub === undefined ? Boolean(config.dub) : Boolean(spec.dub)
  const mediaId = Number.isInteger(Number(spec.mediaId)) && Number(spec.mediaId) > 0 ? Number(spec.mediaId) : null
  const episode = Number(spec.episode ?? 1)
  if (!Number.isFinite(episode) || episode < 1 || episode > 9999) {
    throw httpError('Episode number must be between 1 and 9999', 400)
  }
  if (spec.season !== undefined && spec.season !== null && spec.season !== '') {
    const s = Number(spec.season)
    if (!Number.isFinite(s) || s < 1 || s > 99) {
      throw httpError('Season number must be between 1 and 99', 400)
    }
  }

  let query = null
  let resultIndex = config.resultIndex || 1
  let externalUrl = null
  let externalSubtitleUrl = null
  let headers = null

  if (sourceType === 'external') {
    const validatedUrl = await validateRemoteUrl(spec.url, {
      requireApprovedHost: true,
      extraApprovedHosts: config.allowedExternalHosts,
      dnsLookup: networkOverrides.dnsLookup,
    })
    externalUrl = validatedUrl.href
    headers = sanitizeExternalHeaders(spec.headers, spec.referer)
    if (spec.subtitleUrl && String(spec.subtitleUrl).trim()) {
      const validatedSub = await validateRemoteUrl(spec.subtitleUrl, {
        requireApprovedHost: true,
        extraApprovedHosts: config.allowedExternalHosts,
        dnsLookup: networkOverrides.dnsLookup,
      })
      externalSubtitleUrl = validatedSub.href
    }
  } else {
    query = String(spec.query ?? rawTitle).trim().slice(0, 200)
    if (!query) throw httpError('A search title is required', 400)
    const parsedIdx = Math.floor(Number(spec.resultIndex ?? config.resultIndex ?? 1))
    resultIndex = Number.isFinite(parsedIdx) && parsedIdx >= 1 ? Math.min(100, parsedIdx) : 1
  }

  const location = library.buildEpisodeLocation(rawTitle, {
    seriesTitle: spec.seriesTitle,
    season: spec.season,
    episode,
    ext: '.mp4',
  })

  // Check for existing downloaded file (prevents duplicates & never overwrites).
  const existingFile = await library.findDownloadedEpisode({
    mediaId,
    title: rawTitle,
    seriesTitle: location.seriesTitle,
    season: location.season,
    episode: location.episode,
    targetRelPath: location.relPosix,
  })
  if (existingFile) {
    return { kind: 'already_downloaded', file: existingFile }
  }

  // Check for already active/queued job targeting the same episode file.
  const existingActive = jobs.find(
    (j) => j.targetRelPath === location.relPosix && ACTIVE_STATUSES.has(j.status),
  )
  if (existingActive) {
    return { kind: 'already_queued', job: existingActive }
  }

  const now = Date.now()
  const durationHint =
    Number.isFinite(Number(spec.durationMinutes)) && Number(spec.durationMinutes) > 0
      ? Math.round(Number(spec.durationMinutes) * 60)
      : null

  const job = {
    id: newJobId(),
    sourceType,
    mediaId,
    animeTitle: rawTitle.slice(0, 200),
    seriesTitle: location.seriesTitle.slice(0, 200),
    season: location.season,
    episode: location.episode,
    quality,
    resolvedHeight: null,
    dub,
    format: spec.format ? String(spec.format).slice(0, 32) : null,
    cover: spec.cover ? String(spec.cover).slice(0, 500) : null,
    query,
    resultIndex,
    externalUrl,
    externalSubtitleUrl,
    headers,
    targetRelPath: location.relPosix,
    fileId: null,
    status: 'queued',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    durationSec: durationHint,
    downloadedSec: 0,
    speedBps: null,
    error: null,
    _partFileName: null,
    _directResume: false,
    _etag: null,
    _lastModified: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  }

  return { kind: 'ready', job }
}

function insertJobReplacingFinished(job) {
  jobs = jobs.filter(
    (existing) =>
      !(
        existing.targetRelPath === job.targetRelPath &&
        (existing.status === 'failed' || existing.status === 'cancelled' || (existing.status === 'completed' && !existing.fileId))
      ),
  )
  jobs.push(job)
}

/** Enqueues a single episode or authorized external source for download. */
export async function enqueue(spec = {}) {
  const config = settings.get()
  const prepared = await prepareJobRecord(spec, config)

  if (spec.mediaId && spec.query && prepared.kind !== 'error') {
    await resolver
      .saveMatch(spec.mediaId, {
        query: String(spec.query).trim(),
        index: spec.resultIndex ?? config.resultIndex,
        title: spec.providerTitle,
      })
      .catch(() => {})
  }

  if (prepared.kind === 'already_downloaded') {
    return {
      status: 'already_downloaded',
      file: prepared.file,
      job: null,
    }
  }
  if (prepared.kind === 'already_queued') {
    return {
      status: 'already_queued',
      job: toPublicJob(prepared.job),
      file: null,
    }
  }

  insertJobReplacingFinished(prepared.job)
  await persistNow()
  emitNow('jobs')
  schedulePump()
  return {
    status: 'queued',
    job: toPublicJob(prepared.job),
    file: null,
  }
}

async function resolveEpisodeNumbersForEntry(entry, config) {
  if (Array.isArray(entry.episodes) && entry.episodes.length > 0) {
    const nums = [
      ...new Set(
        entry.episodes
          .map((v) => Math.floor(Number(v)))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 9999),
      ),
    ].sort((a, b) => a - b)
    if (nums.length === 0) throw httpError('Select at least one valid episode number', 400)
    return nums
  }

  if (entry.startEpisode !== undefined || entry.endEpisode !== undefined) {
    const start = Math.floor(Number(entry.startEpisode ?? 1))
    const end = Math.floor(Number(entry.endEpisode ?? start))
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      throw httpError('Invalid episode range (start must be >= 1 and <= end)', 400)
    }
    if (end - start + 1 > MAX_BULK_EPISODES) {
      throw httpError(`Episode range cannot exceed ${MAX_BULK_EPISODES} episodes at once`, 400)
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }

  const knownCount = Math.floor(Number(entry.episodeCount ?? 0))
  const query = String(entry.query ?? entry.animeTitle ?? entry.title ?? '').trim()

  // Prefer live provider episode discovery when asked or when AniList lacks a count.
  if ((entry.discoverFromProvider || knownCount <= 0) && query) {
    try {
      const discovered = await resolver.episodesForQuery(query, {
        resultIndex: entry.resultIndex ?? config.resultIndex,
      })
      if (discovered.episodes.length > 0) {
        return discovered.episodes.slice(0, MAX_BULK_EPISODES)
      }
    } catch (err) {
      if (knownCount <= 0) throw err
    }
  }

  if (knownCount > 0) {
    const capped = Math.min(knownCount, MAX_BULK_EPISODES)
    return Array.from({ length: capped }, (_, i) => i + 1)
  }

  throw httpError('Could not determine available episodes for this title', 400)
}

/**
 * Bulk-enqueues episodes into the persistent queue:
 * - `mode: 'episodes'` — arbitrary selected episodes `[1, 4, 7]`
 * - `mode: 'range'` — custom range `startEpisode..endEpisode`
 * - `mode: 'season'` — every available episode in a season
 * - `mode: 'series'` — multiple seasons (or all provider episodes) under one series folder
 */
export async function enqueueBulk(payload = {}) {
  const config = settings.get()
  const mode = String(payload.mode ?? 'episodes').toLowerCase()
  const quality = normalizeQuality(payload.quality, config.quality)
  const dub = payload.dub === undefined ? Boolean(config.dub) : Boolean(payload.dub)

  let seasonEntries = []
  if (mode === 'series' && Array.isArray(payload.seasons) && payload.seasons.length > 0) {
    const sharedSeries =
      String(payload.seriesTitle ?? '').trim() ||
      library.inferSeriesAndSeason(payload.seasons[0]?.animeTitle || payload.animeTitle || payload.title).seriesTitle
    seasonEntries = payload.seasons.slice(0, 30).map((item, idx) => ({
      mediaId: item.mediaId ?? null,
      animeTitle: item.animeTitle ?? item.title ?? sharedSeries,
      seriesTitle: sharedSeries,
      query: item.query ?? item.animeTitle ?? item.title ?? sharedSeries,
      resultIndex: item.resultIndex ?? config.resultIndex,
      providerTitle: item.providerTitle,
      season: Number(item.season) >= 1 ? Math.floor(Number(item.season)) : idx + 1,
      episodes: item.episodes,
      episodeCount: item.episodeCount,
      discoverFromProvider: Boolean(item.discoverFromProvider),
      format: item.format ?? null,
      cover: item.cover ?? null,
      durationMinutes: item.durationMinutes ?? null,
    }))
  } else {
    seasonEntries = [
      {
        mediaId: payload.mediaId ?? null,
        animeTitle: payload.animeTitle ?? payload.title ?? payload.query,
        seriesTitle: payload.seriesTitle,
        query: payload.query ?? payload.animeTitle ?? payload.title,
        resultIndex: payload.resultIndex ?? config.resultIndex,
        providerTitle: payload.providerTitle,
        season: payload.season,
        episodes: mode === 'episodes' ? payload.episodes : undefined,
        startEpisode: mode === 'range' ? payload.startEpisode : undefined,
        endEpisode: mode === 'range' ? payload.endEpisode : undefined,
        episodeCount: mode === 'season' || mode === 'series' ? payload.episodeCount : undefined,
        discoverFromProvider:
          payload.discoverFromProvider !== undefined
            ? Boolean(payload.discoverFromProvider)
            : mode === 'series',
        format: payload.format ?? null,
        cover: payload.cover ?? null,
        durationMinutes: payload.durationMinutes ?? null,
      },
    ]
  }

  const queuedJobs = []
  let skippedDownloaded = 0
  let skippedQueued = 0
  let totalRequested = 0
  let baseTimestamp = Date.now()

  for (const entry of seasonEntries) {
    const epNumbers = await resolveEpisodeNumbersForEntry(entry, config)
    if (entry.mediaId && entry.query) {
      // Preserve existing user-picked match for related seasons if one was saved earlier.
      const saved = entry.mediaId !== payload.mediaId ? resolver.getMatch(entry.mediaId) : null
      const effectiveQuery = saved?.query || String(entry.query).trim()
      const effectiveIndex = saved?.index || entry.resultIndex || config.resultIndex
      entry.query = effectiveQuery
      entry.resultIndex = effectiveIndex
      if (entry.mediaId === payload.mediaId) {
        await resolver
          .saveMatch(entry.mediaId, {
            query: effectiveQuery,
            index: effectiveIndex,
            title: entry.providerTitle,
          })
          .catch(() => {})
      }
    }

    for (const ep of epNumbers) {
      if (totalRequested >= MAX_BULK_EPISODES) break
      totalRequested += 1

      const prepared = await prepareJobRecord(
        {
          sourceType: 'resolver',
          mediaId: entry.mediaId,
          animeTitle: entry.animeTitle,
          seriesTitle: entry.seriesTitle,
          query: entry.query,
          resultIndex: entry.resultIndex,
          season: entry.season,
          episode: ep,
          quality,
          dub,
          format: entry.format,
          cover: entry.cover,
          durationMinutes: entry.durationMinutes,
        },
        config,
      )

      if (prepared.kind === 'already_downloaded') {
        skippedDownloaded += 1
        continue
      }
      if (prepared.kind === 'already_queued') {
        skippedQueued += 1
        continue
      }
      // Strictly monotonic timestamps preserve episode 1, 2, 3 queue ordering.
      prepared.job.createdAt = baseTimestamp++
      prepared.job.updatedAt = prepared.job.createdAt
      insertJobReplacingFinished(prepared.job)
      queuedJobs.push(prepared.job)
    }
    if (totalRequested >= MAX_BULK_EPISODES) break
  }

  if (queuedJobs.length > 0) {
    await persistNow()
    emitNow('jobs')
    schedulePump()
  }

  return {
    queued: queuedJobs.map(toPublicJob),
    queuedCount: queuedJobs.length,
    skippedDownloaded,
    skippedQueued,
    totalRequested,
  }
}

async function fetchTextSafe(url, { headers, signal, requireApprovedHost, extraApprovedHosts }) {
  const { response, finalUrl } = await safeFetch(url, {
    headers: {
      'User-Agent': headers?.['User-Agent'] || playback.USER_AGENT,
      Accept: '*/*',
      ...headers,
    },
    signal,
    requireApprovedHost,
    extraApprovedHosts,
    dnsLookup: networkOverrides.dnsLookup,
    fetchImpl: networkOverrides.fetchImpl,
  })
  if (!response.ok) {
    throw httpError(`Remote source responded with HTTP ${response.status}`, 502)
  }
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > 10 * 1024 * 1024) {
    await response.body?.cancel().catch(() => {})
    throw httpError('Playlist response is unexpectedly large', 422)
  }
  const text = await response.text()
  return { text, finalUrl, contentType: String(response.headers.get('content-type') || '') }
}

async function runHlsDownload(job, rt, { videoUrl, audioUrl, referer, headers, requireApprovedHost, allowedHosts }) {
  const reqHeaders = {
    ...(headers ?? {}),
    ...(referer ? { Referer: referer } : {}),
  }

  // Inspect playlist(s) upfront for DRM protection, unsafe segment URIs, and total duration.
  let finalVideoUrl = videoUrl
  let finalAudioUrl = audioUrl || null
  let durationSec = job.durationSec

  const first = await fetchTextSafe(videoUrl, {
    headers: reqHeaders,
    signal: rt.controller.signal,
    requireApprovedHost,
    extraApprovedHosts: allowedHosts,
  })
  const firstCheck = await inspectHlsPlaylist(first.text, first.finalUrl, {
    dnsLookup: networkOverrides.dnsLookup,
    extraApprovedHosts: allowedHosts,
    requireApprovedHost: false,
  })

  if (firstCheck.isMaster) {
    const selected = resolver.parseMasterPlaylist(first.text, first.finalUrl, {
      quality: job.quality,
      dub: job.dub,
    })
    if (!selected) {
      throw httpError('No playable video variant found in HLS master playlist', 422)
    }
    finalVideoUrl = selected.videoUrl
    finalAudioUrl = selected.audioUrl || finalAudioUrl
    if (selected.height > 0) job.resolvedHeight = selected.height

    const mediaPlaylist = await fetchTextSafe(finalVideoUrl, {
      headers: reqHeaders,
      signal: rt.controller.signal,
      requireApprovedHost: false,
      extraApprovedHosts: allowedHosts,
    })
    const mediaCheck = await inspectHlsPlaylist(mediaPlaylist.text, mediaPlaylist.finalUrl, {
      dnsLookup: networkOverrides.dnsLookup,
      extraApprovedHosts: allowedHosts,
      requireApprovedHost: false,
    })
    finalVideoUrl = mediaPlaylist.finalUrl
    if (mediaCheck.durationSec) durationSec = mediaCheck.durationSec
  } else {
    finalVideoUrl = first.finalUrl
    if (firstCheck.durationSec) durationSec = firstCheck.durationSec
  }

  // Also inspect external split audio playlist for DRM / SSRF when present.
  if (finalAudioUrl) {
    try {
      const audPlaylist = await fetchTextSafe(finalAudioUrl, {
        headers: reqHeaders,
        signal: rt.controller.signal,
        requireApprovedHost: false,
        extraApprovedHosts: allowedHosts,
      })
      await inspectHlsPlaylist(audPlaylist.text, audPlaylist.finalUrl, {
        dnsLookup: networkOverrides.dnsLookup,
        extraApprovedHosts: allowedHosts,
        requireApprovedHost: false,
      })
      finalAudioUrl = audPlaylist.finalUrl
    } catch (err) {
      // Surface DRM and SSRF violations immediately; let FFmpeg handle broken audio fallback.
      if (err?.status === 422 || err?.status === 403) throw err
    }
  }

  if (durationSec) job.durationSec = durationSec

  const partFileName = `${job.id}.part.mp4`
  const tempPath = await library.allocateTempPath(partFileName)
  await fsp.rm(tempPath, { force: true }).catch(() => {})

  job._partFileName = partFileName
  job._directResume = false
  job.status = 'downloading'
  job.downloadedBytes = 0
  job.downloadedSec = 0
  job.progress = 0
  job.updatedAt = Date.now()
  rt.kind = 'ffmpeg'
  rt.tempPath = tempPath
  await persistNow()
  emitNow('jobs')

  try {
    await playback.downloadStreamToFile({
      url: finalVideoUrl,
      audioUrl: finalAudioUrl,
      referer: referer || reqHeaders.Referer || null,
      headers: reqHeaders,
      hls: true,
      outputPath: tempPath,
      durationSec: job.durationSec,
      signal: rt.controller.signal,
      onControl(ctrl) {
        rt.control = ctrl
      },
      onProgress(update) {
        if (job.status !== 'downloading') return
        job.downloadedBytes = update.downloadedBytes
        job.downloadedSec = update.downloadedSec
        if (update.progress != null) job.progress = update.progress
        job.speedBps = update.speedBps
        job.updatedAt = Date.now()
        persistThrottled()
        emitThrottled()
      },
    })
  } catch (err) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    throw err
  }

  // Validate MP4 integrity and check for CENC/DRM boxes before atomic commit.
  const verification = await inspectMp4File(tempPath)
  if (!verification.valid) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    throw httpError(verification.error || 'Downloaded MP4 failed integrity validation', 422)
  }

  return tempPath
}

async function runDirectMp4Download(job, rt, { url, referer, headers, requireApprovedHost, allowedHosts }) {
  const partFileName = job._partFileName || `${job.id}.part.mp4`
  const tempPath = await library.allocateTempPath(partFileName)
  rt.kind = 'direct'
  rt.tempPath = tempPath

  let resumeOffset = 0
  if (job._directResume) {
    try {
      const st = await fsp.stat(tempPath)
      if (st.isFile() && st.size > 0) resumeOffset = st.size
    } catch {
      resumeOffset = 0
    }
  } else {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }

  const reqHeaders = {
    'User-Agent': headers?.['User-Agent'] || playback.USER_AGENT,
    Accept: headers?.Accept || 'video/mp4,video/*;q=0.9,*/*;q=0.5',
    ...(headers ?? {}),
    ...(referer ? { Referer: referer } : {}),
  }
  if (resumeOffset > 0) {
    reqHeaders.Range = `bytes=${resumeOffset}-`
    const validator = job._etag || job._lastModified
    if (validator) reqHeaders['If-Range'] = validator
  }

  const { response, finalUrl } = await safeFetch(url, {
    headers: reqHeaders,
    signal: rt.controller.signal,
    requireApprovedHost,
    extraApprovedHosts: allowedHosts,
    dnsLookup: networkOverrides.dnsLookup,
    fetchImpl: networkOverrides.fetchImpl,
  })

  // Handle already-complete range (416 when local size == remote size).
  if (response.status === 416 && resumeOffset > 0 && job.totalBytes && resumeOffset === job.totalBytes) {
    await response.body?.cancel().catch(() => {})
  } else {
    if (!response.ok && response.status !== 206) {
      await response.body?.cancel().catch(() => {})
      throw httpError(`Remote source responded with HTTP ${response.status}`, 502)
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (
      /application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:mpegurl|x-mpegurl)/i.test(contentType)
    ) {
      await response.body?.cancel().catch(() => {})
      await fsp.rm(tempPath, { force: true }).catch(() => {})
      return runHlsDownload(job, rt, {
        videoUrl: finalUrl,
        audioUrl: null,
        referer,
        headers,
        requireApprovedHost,
        allowedHosts,
      })
    }
    if (/application\/dash\+xml/i.test(contentType)) {
      await response.body?.cancel().catch(() => {})
      throw httpError(
        'Unsupported MPEG-DASH stream (often DRM-protected); only direct MP4 and HLS (.m3u8) sources are supported',
        422,
      )
    }
    if (/^text\/html\b|^application\/json\b|^image\//i.test(contentType)) {
      await response.body?.cancel().catch(() => {})
      throw httpError(
        `Unsupported source content type "${contentType.split(';')[0]}" (expected a direct MP4 or HLS stream)`,
        422,
      )
    }

    const isPartial = response.status === 206 && resumeOffset > 0
    if (!isPartial) {
      resumeOffset = 0
      await fsp.rm(tempPath, { force: true }).catch(() => {})
    }

    const contentLengthHeader = response.headers.get('content-length')
    const contentRangeHeader = response.headers.get('content-range')
    let expectedTotal = null
    if (isPartial && contentRangeHeader) {
      const m = contentRangeHeader.match(/bytes\s+\d+-\d+\/(\d+)/i)
      if (m) expectedTotal = Number(m[1])
    }
    if (expectedTotal == null && contentLengthHeader != null) {
      const cl = Number(contentLengthHeader)
      if (Number.isFinite(cl) && cl >= 0) expectedTotal = resumeOffset + cl
    }

    job._partFileName = partFileName
    job._directResume = true
    job._etag = response.headers.get('etag') || job._etag || null
    job._lastModified = response.headers.get('last-modified') || job._lastModified || null
    job.totalBytes = expectedTotal
    job.downloadedBytes = resumeOffset
    job.progress =
      expectedTotal && expectedTotal > 0
        ? Math.min(99.9, Math.round((resumeOffset / expectedTotal) * 1000) / 10)
        : null
    job.status = 'downloading'
    job.updatedAt = Date.now()
    await persistNow()
    emitNow('jobs')

    if (!response.body) {
      throw httpError('Remote source returned an empty response body', 502)
    }

    const reader = response.body.getReader()
    const out = fs.createWriteStream(tempPath, { flags: isPartial ? 'a' : 'w' })
    let prefixCollector = isPartial ? null : Buffer.alloc(0)
    let prefixChecked = isPartial
    let hlsRedirectDetected = false
    let lastSpeedBytes = resumeOffset
    let lastSpeedAt = Date.now()
    let smoothedSpeed = null

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.byteLength === 0) continue
        const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength)

        if (!prefixChecked && prefixCollector) {
          prefixCollector = Buffer.concat([prefixCollector, chunk])
          if (prefixCollector.length >= 32) {
            const check = inspectMp4PrefixBytes(prefixCollector)
            if (!check.valid) {
              if (check.isHls) {
                hlsRedirectDetected = true
                await reader.cancel().catch(() => {})
                break
              }
              await reader.cancel().catch(() => {})
              throw httpError(check.error, 422)
            }
            prefixChecked = true
            prefixCollector = null
          }
        }

        if (!out.write(chunk)) {
          await new Promise((resolve, reject) => {
            const onDrain = () => {
              out.off('error', onErr)
              resolve()
            }
            const onErr = (err) => {
              out.off('drain', onDrain)
              reject(err)
            }
            out.once('drain', onDrain)
            out.once('error', onErr)
          })
        }

        job.downloadedBytes += chunk.length
        if (job.totalBytes && job.totalBytes > 0) {
          job.progress = Math.min(99.9, Math.round((job.downloadedBytes / job.totalBytes) * 1000) / 10)
        }
        const now = Date.now()
        const dt = (now - lastSpeedAt) / 1000
        if (dt >= 0.25) {
          const inst = (job.downloadedBytes - lastSpeedBytes) / dt
          smoothedSpeed = smoothedSpeed == null ? inst : smoothedSpeed * 0.6 + inst * 0.4
          job.speedBps = Math.round(smoothedSpeed)
          lastSpeedBytes = job.downloadedBytes
          lastSpeedAt = now
        }
        job.updatedAt = now
        persistThrottled()
        emitThrottled()
      }

      await new Promise((resolve, reject) => {
        out.once('error', reject)
        out.end(resolve)
      })
    } catch (err) {
      await new Promise((resolve) => {
        if (rt.reason === 'pause' || rt.reason === 'shutdown') {
          out.once('error', resolve)
          out.end(resolve)
        } else {
          out.once('close', resolve)
          out.destroy()
        }
      })
      // Keep partial file on pause or server shutdown so Range resume works!
      if (rt.reason !== 'pause' && rt.reason !== 'shutdown') {
        await fsp.rm(tempPath, { force: true }).catch(() => {})
      }
      throw err
    }

    if (hlsRedirectDetected) {
      await fsp.rm(tempPath, { force: true }).catch(() => {})
      job._directResume = false
      return runHlsDownload(job, rt, {
        videoUrl: finalUrl,
        audioUrl: null,
        referer,
        headers,
        requireApprovedHost,
        allowedHosts,
      })
    }

    if (job.totalBytes != null && job.downloadedBytes !== job.totalBytes) {
      throw httpError(
        `Download ended prematurely (${job.downloadedBytes} of ${job.totalBytes} bytes received)`,
        502,
      )
    }
  }

  // Validate full MP4 structure and reject DRM-encrypted (encv/enca/pssh/sinf) files.
  const check = await inspectMp4File(tempPath)
  if (!check.valid) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    job._directResume = false
    throw httpError(check.error || 'Downloaded file is not a valid MP4', 422)
  }

  // Move `moov` to the start for instant seeking when needed and ffmpeg is installed.
  if (!check.fastStart && playback.resolveFfmpeg()) {
    const fastPath = await library.allocateTempPath(`${job.id}.fast.part.mp4`)
    try {
      const converted = await playback.remuxFastStart(tempPath, fastPath, {
        signal: rt.controller.signal,
      })
      if (converted) {
        const recheck = await inspectMp4File(fastPath)
        if (recheck.valid) {
          await fsp.rm(tempPath, { force: true }).catch(() => {})
          return fastPath
        }
      }
      await fsp.rm(fastPath, { force: true }).catch(() => {})
    } catch (err) {
      await fsp.rm(fastPath, { force: true }).catch(() => {})
      if (err?.name === 'AbortError' || rt.controller.signal.aborted) throw err
      // Keep original validated MP4 if optional faststart optimization fails.
    }
  }

  return tempPath
}

async function saveOptionalSubtitle(job, subtitleUrl, { referer, headers, requireApprovedHost, allowedHosts }) {
  if (!subtitleUrl) return
  try {
    const text = await playback.fetchSubtitleVtt(subtitleUrl, {
      referer,
      headers: headers ?? {},
      signal: AbortSignal.timeout(20_000),
      fetchFn: async (targetUrl, init) => {
        const { response } = await safeFetch(targetUrl, {
          headers: init?.headers,
          signal: init?.signal,
          requireApprovedHost,
          extraApprovedHosts: allowedHosts,
          dnsLookup: networkOverrides.dnsLookup,
          fetchImpl: networkOverrides.fetchImpl,
        })
        return response
      },
    })
    await library.commitSidecarSubtitle(job.targetRelPath, text)
  } catch {
    // Subtitles are optional; never fail a completed video download if unavailable.
  }
}

async function executeJob(job) {
  if (shuttingDown) return

  // Re-check library right before downloading so duplicate work never occurs.
  const existing = await library.getExistingByRelPath(job.targetRelPath)
  if (existing) {
    job.status = 'completed'
    job.progress = 100
    job.downloadedBytes = existing.size
    job.totalBytes = existing.size
    job.fileId = existing.id
    job.error = null
    job.completedAt = Date.now()
    job.updatedAt = job.completedAt
    await persistNow()
    emitNow('jobs')
    schedulePump()
    return
  }

  const rt = {
    controller: new AbortController(),
    kind: 'resolving',
    control: null,
    suspended: false,
    tempPath: null,
    reason: null, // 'pause' | 'cancel' | 'delete' | 'shutdown'
  }
  runtime.set(job.id, rt)

  job.status = 'resolving'
  job.error = null
  job.speedBps = null
  job.startedAt = job.startedAt || Date.now()
  job.updatedAt = Date.now()
  await persistNow()
  emitNow('jobs')

  let tempPath = null
  try {
    const config = settings.get()
    let subtitleUrl = null
    let subtitleReferer = null
    let subtitleHeaders = null
    let requireApprovedForSub = false

    if (job.sourceType === 'external') {
      const cleanHeaders = sanitizeExternalHeaders(job.headers)
      const parsed = await validateRemoteUrl(job.externalUrl, {
        requireApprovedHost: true,
        extraApprovedHosts: config.allowedExternalHosts,
        dnsLookup: networkOverrides.dnsLookup,
      })

      if (/\.mpd(?:$|\?)/i.test(parsed.pathname)) {
        throw httpError(
          'Unsupported MPEG-DASH (.mpd) manifest; only direct MP4 and HLS (.m3u8) streams are supported',
          422,
        )
      }

      const looksLikeHls = /\.m3u8(?:$|\?)/i.test(parsed.pathname + parsed.search)
      if (looksLikeHls) {
        tempPath = await runHlsDownload(job, rt, {
          videoUrl: parsed.href,
          audioUrl: null,
          referer: cleanHeaders.Referer || null,
          headers: cleanHeaders,
          requireApprovedHost: true,
          allowedHosts: config.allowedExternalHosts,
        })
      } else {
        tempPath = await runDirectMp4Download(job, rt, {
          url: parsed.href,
          referer: cleanHeaders.Referer || null,
          headers: cleanHeaders,
          requireApprovedHost: true,
          allowedHosts: config.allowedExternalHosts,
        })
      }

      subtitleUrl = job.externalSubtitleUrl
      subtitleReferer = cleanHeaders.Referer || null
      subtitleHeaders = cleanHeaders
      requireApprovedForSub = true
    } else {
      const stream = await resolver.resolve(job.query, {
        resultIndex: job.resultIndex,
        episode: job.episode,
        quality: job.quality,
        dub: job.dub,
      })
      if (rt.controller.signal.aborted) {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
      }
      if (stream.height > 0) job.resolvedHeight = stream.height

      // Enforce SSRF protection on resolved stream URLs as well.
      await validateRemoteUrl(stream.videoUrl, {
        requireApprovedHost: false,
        dnsLookup: networkOverrides.dnsLookup,
      })
      if (stream.audioUrl) {
        await validateRemoteUrl(stream.audioUrl, {
          requireApprovedHost: false,
          dnsLookup: networkOverrides.dnsLookup,
        })
      }

      const isHls = Boolean(
        stream.hls ||
          /\.m3u8(?:$|\?)/i.test(stream.videoUrl) ||
          (stream.audioUrl && /\.m3u8(?:$|\?)/i.test(stream.audioUrl)),
      )
      if (isHls) {
        tempPath = await runHlsDownload(job, rt, {
          videoUrl: stream.videoUrl,
          audioUrl: stream.audioUrl || null,
          referer: stream.referer || null,
          headers: stream.referer ? { Referer: stream.referer } : {},
          requireApprovedHost: false,
          allowedHosts: config.allowedExternalHosts,
        })
      } else {
        tempPath = await runDirectMp4Download(job, rt, {
          url: stream.videoUrl,
          referer: stream.referer || null,
          headers: stream.referer ? { Referer: stream.referer } : {},
          requireApprovedHost: false,
          allowedHosts: config.allowedExternalHosts,
        })
      }

      subtitleUrl = stream.subtitleUrl
      subtitleReferer = stream.referer || null
      subtitleHeaders = {}
      requireApprovedForSub = false
    }

    if (rt.controller.signal.aborted) {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    }

    // Atomic move from `<libraryDir>/.incomplete/` into `<Anime>/Season XX/<Anime> - SXXEXX.mp4`.
    let committed
    try {
      committed = await library.commitTempFile(tempPath, job.targetRelPath, {
        mediaId: job.mediaId,
        animeTitle: job.animeTitle,
        seriesTitle: job.seriesTitle,
        season: job.season,
        episode: job.episode,
        quality: job.resolvedHeight ? `${job.resolvedHeight}p` : job.quality,
        resolvedHeight: job.resolvedHeight,
        dub: job.dub,
        format: job.format,
        cover: job.cover,
        sourceType: job.sourceType,
      })
    } catch (err) {
      if (err?.code === 'EEXIST' && err?.fileId) {
        const existingAfter = await library.getExistingByRelPath(job.targetRelPath)
        committed = {
          id: err.fileId,
          relPosix: job.targetRelPath,
          size: existingAfter?.size ?? job.downloadedBytes,
        }
      } else {
        throw err
      }
    }
    tempPath = null // Ownership transferred to the library.

    await saveOptionalSubtitle(job, subtitleUrl, {
      referer: subtitleReferer,
      headers: subtitleHeaders,
      requireApprovedHost: requireApprovedForSub,
      allowedHosts: config.allowedExternalHosts,
    })

    const now = Date.now()
    job.status = 'completed'
    job.progress = 100
    job.downloadedBytes = committed.size
    job.totalBytes = committed.size
    job.speedBps = null
    job.fileId = committed.id
    job.error = null
    job._partFileName = null
    job._directResume = false
    job._etag = null
    job._lastModified = null
    job.completedAt = now
    job.updatedAt = now
  } catch (err) {
    if (rt.reason === 'pause') {
      job.status = 'paused'
      job.speedBps = null
      job.error = null
      job.updatedAt = Date.now()
      if (!job._directResume && tempPath) {
        await fsp.rm(tempPath, { force: true }).catch(() => {})
      }
    } else if (rt.reason === 'requeue') {
      job.status = 'queued'
      job.speedBps = null
      job.error = null
      job.updatedAt = Date.now()
      if (!job._directResume && tempPath) {
        await fsp.rm(tempPath, { force: true }).catch(() => {})
      }
    } else if (rt.reason === 'cancel') {
      if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {})
      if (job._partFileName) {
        const p = await library.allocateTempPath(job._partFileName).catch(() => null)
        if (p) await fsp.rm(p, { force: true }).catch(() => {})
      }
      job.status = 'cancelled'
      job.speedBps = null
      job.error = null
      job._partFileName = null
      job._directResume = false
      job.updatedAt = Date.now()
    } else if (rt.reason === 'delete' || rt.reason === 'shutdown') {
      if (rt.reason === 'delete' && tempPath) {
        await fsp.rm(tempPath, { force: true }).catch(() => {})
      }
    } else {
      if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {})
      job.status = 'failed'
      job.speedBps = null
      job.error = String(err?.message || 'Download failed').slice(0, 400)
      job.updatedAt = Date.now()
    }
  } finally {
    runtime.delete(job.id)
    if (!shuttingDown) {
      await persistNow()
      emitNow('jobs')
      schedulePump()
    }
  }
}

function findJobOrThrow(id) {
  const job = jobs.find((j) => j.id === String(id ?? ''))
  if (!job) throw httpError('Download job not found', 404)
  return job
}

export async function pause(id) {
  const job = findJobOrThrow(id)
  if (job.status === 'paused') return toPublicJob(job)

  if (job.status === 'queued') {
    job.status = 'paused'
    job.updatedAt = Date.now()
    await persistNow()
    emitNow('jobs')
    return toPublicJob(job)
  }

  if (job.status === 'downloading' || job.status === 'resolving') {
    const rt = runtime.get(job.id)
    if (!rt) {
      job.status = 'paused'
      job.updatedAt = Date.now()
      await persistNow()
      emitNow('jobs')
      return toPublicJob(job)
    }

    // Live POSIX SIGSTOP preserves in-flight FFmpeg progress without losing bytes.
    if (
      rt.kind === 'ffmpeg' &&
      rt.control?.canPause &&
      suspendedFfmpegCount() < MAX_SUSPENDED_FFMPEG &&
      rt.control.pause()
    ) {
      rt.suspended = true
      job.status = 'paused'
      job.speedBps = null
      job.updatedAt = Date.now()
      await persistNow()
      emitNow('jobs')
      schedulePump()
      return toPublicJob(job)
    }

    // Direct MP4 keeps its `.part.mp4` for HTTP Range resume; resolving/excess
    // FFmpeg aborts cleanly and resumes from start when unpaused.
    rt.reason = 'pause'
    job.status = 'paused'
    job.speedBps = null
    job.updatedAt = Date.now()
    rt.controller.abort()
    await persistNow()
    emitNow('jobs')
    schedulePump()
    return toPublicJob(job)
  }

  throw httpError(`Cannot pause a ${job.status} download`, 400)
}

export async function resume(id) {
  const job = findJobOrThrow(id)
  if (job.status !== 'paused') {
    if (job.status === 'queued' || job.status === 'downloading') return toPublicJob(job)
    throw httpError(`Cannot resume a ${job.status} download`, 400)
  }

  const rt = runtime.get(job.id)
  if (rt) {
    if (
      rt.kind === 'ffmpeg' &&
      rt.suspended &&
      runningSlotCount() < settings.get().maxConcurrentDownloads &&
      rt.control?.resume()
    ) {
      rt.suspended = false
      job.status = 'downloading'
      job.updatedAt = Date.now()
      await persistNow()
      emitNow('jobs')
      return toPublicJob(job)
    }
    if (rt.reason === 'pause') {
      rt.reason = 'requeue'
    }
  }

  job.status = 'queued'
  job.error = null
  job.updatedAt = Date.now()
  await persistNow()
  emitNow('jobs')
  schedulePump()
  return toPublicJob(job)
}

export async function cancel(id) {
  const job = findJobOrThrow(id)
  if (job.status === 'cancelled') return toPublicJob(job)
  if (job.status === 'completed') {
    throw httpError('Download already completed; use delete to remove it', 400)
  }

  const rt = runtime.get(job.id)
  if (rt) {
    rt.reason = 'cancel'
    rt.suspended = false
    rt.controller.abort()
  }
  if (job._partFileName) {
    const partPath = await library.allocateTempPath(job._partFileName).catch(() => null)
    if (partPath) await fsp.rm(partPath, { force: true }).catch(() => {})
  }

  job.status = 'cancelled'
  job.speedBps = null
  job.error = null
  job._partFileName = null
  job._directResume = false
  job._etag = null
  job._lastModified = null
  job.updatedAt = Date.now()
  await persistNow()
  emitNow('jobs')
  schedulePump()
  return toPublicJob(job)
}

export async function retry(id) {
  const job = findJobOrThrow(id)
  if (job.status !== 'failed' && job.status !== 'cancelled') {
    throw httpError(`Only failed or cancelled downloads can be retried`, 400)
  }

  const existing = await library.getExistingByRelPath(job.targetRelPath)
  if (existing) {
    job.status = 'completed'
    job.progress = 100
    job.downloadedBytes = existing.size
    job.totalBytes = existing.size
    job.fileId = existing.id
    job.error = null
    job.completedAt = Date.now()
    job.updatedAt = job.completedAt
    await persistNow()
    emitNow('jobs')
    return toPublicJob(job)
  }

  // Keep partial bytes if a direct MP4 failed mid-stream; otherwise reset cleanly.
  if (!job._directResume || !job._partFileName) {
    job.downloadedBytes = 0
    job.totalBytes = null
    job.progress = 0
  }
  job.downloadedSec = 0
  job.speedBps = null
  job.error = null
  job.status = 'queued'
  job.completedAt = null
  job.updatedAt = Date.now()
  await persistNow()
  emitNow('jobs')
  schedulePump()
  return toPublicJob(job)
}

/** Deletes a job record and optionally removes its completed local library file. */
export async function remove(id, { deleteFile = false } = {}) {
  const idx = jobs.findIndex((j) => j.id === String(id ?? ''))
  if (idx < 0) return { removed: false }

  const job = jobs[idx]
  jobs.splice(idx, 1)

  const rt = runtime.get(job.id)
  if (rt) {
    rt.reason = 'delete'
    rt.suspended = false
    rt.controller.abort()
    if (rt.tempPath) await fsp.rm(rt.tempPath, { force: true }).catch(() => {})
  }
  if (job._partFileName) {
    const partPath = await library.allocateTempPath(job._partFileName).catch(() => null)
    if (partPath) await fsp.rm(partPath, { force: true }).catch(() => {})
  }

  let fileDeleted = false
  if (deleteFile) {
    const targetId = job.fileId || (await library.getExistingByRelPath(job.targetRelPath))?.id
    if (targetId) {
      const del = await library.removeById(targetId)
      fileDeleted = del.removed
    }
  }

  await persistNow()
  emitNow('jobs')
  schedulePump()
  return { removed: true, fileDeleted }
}

/** Synchronizes completed job records when a library file is deleted directly. */
export async function unlinkDeletedFileIds(fileIds = []) {
  const idSet = new Set(fileIds)
  if (idSet.size === 0) return
  let changed = false
  for (const job of jobs) {
    if (job.fileId && idSet.has(job.fileId)) {
      job.fileId = null
      job.updatedAt = Date.now()
      changed = true
    }
  }
  if (changed) {
    await persistNow()
    emitNow('jobs')
  }
}

/** Applies a bulk action (`delete` | `cancel` | `retry` | `pause` | `resume` | `clear-finished`). */
export async function bulkAction({ action, ids = [], deleteFiles = false } = {}) {
  const act = String(action ?? '').toLowerCase()
  if (act === 'clear-finished') {
    const before = jobs.length
    jobs = jobs.filter(
      (j) => j.status !== 'completed' && j.status !== 'cancelled' && j.status !== 'failed',
    )
    const affected = before - jobs.length
    if (affected > 0) {
      await persistNow()
      emitNow('jobs')
    }
    return { affected }
  }

  if (!['delete', 'cancel', 'retry', 'pause', 'resume'].includes(act)) {
    throw httpError(`Unsupported bulk action "${action}"`, 400)
  }

  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map((v) => String(v ?? '').trim()))]
    .filter(Boolean)
    .slice(0, 500)

  let affected = 0
  for (const id of uniqueIds) {
    try {
      if (act === 'delete') {
        const r = await remove(id, { deleteFile: Boolean(deleteFiles) })
        if (r.removed) affected += 1
      } else if (act === 'cancel') {
        await cancel(id)
        affected += 1
      } else if (act === 'retry') {
        await retry(id)
        affected += 1
      } else if (act === 'pause') {
        await pause(id)
        affected += 1
      } else if (act === 'resume') {
        await resume(id)
        affected += 1
      }
    } catch {
      /* skip jobs where the transition doesn't apply */
    }
  }

  return { affected }
}
