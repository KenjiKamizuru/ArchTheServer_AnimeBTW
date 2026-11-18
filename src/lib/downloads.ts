// Live download-queue and shared-library store backed by Server-Sent Events
// (with automatic polling fallback if SSE disconnects).

import { useSyncExternalStore } from 'react'
import type {
  ArtworkSnapshot,
  BulkDownloadAction,
  BulkEnqueuePayload,
  DownloadsSnapshot,
  EnqueueDownloadPayload,
  LibraryItem,
  LibraryResponse,
  Media,
} from '../types'
import { api } from './api'
import { applyArtworkSnapshot } from './artwork'
import { inferSeasonFromTitle } from './format'

interface LibraryStoreState extends LibraryResponse {
  loading: boolean
  loaded: boolean
}

let queueState: DownloadsSnapshot = {
  jobs: [],
  maxConcurrent: 2,
  counts: { active: 0, queued: 0, paused: 0, completed: 0, failed: 0, total: 0 },
}

let libraryState: LibraryStoreState = {
  items: [],
  stats: { totalFiles: 0, episodeCount: 0, movieCount: 0, unknownCount: 0, totalBytes: 0 },
  loading: true,
  loaded: false,
}

const queueListeners = new Set<() => void>()
const libraryListeners = new Set<() => void>()

let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let libraryFetchPending = false
let libraryFetchSeq = 0
let queueLoaded = false

function emitQueue() {
  for (const fn of queueListeners) fn()
}

function emitLibrary() {
  for (const fn of libraryListeners) fn()
}

function hasAnySubscriber() {
  return queueListeners.size > 0 || libraryListeners.size > 0
}

export async function refreshDownloads() {
  try {
    queueState = await api.downloads()
    queueLoaded = true
    emitQueue()
  } catch {
    /* keep existing state (e.g. during brief restart) */
  }
}

export async function refreshLibrary(fresh = false) {
  if (libraryFetchPending && !fresh) return libraryState
  const seq = ++libraryFetchSeq
  libraryFetchPending = true
  if (!libraryState.loaded) {
    libraryState = { ...libraryState, loading: true }
    emitLibrary()
  }
  try {
    const data = await api.library(fresh)
    if (seq === libraryFetchSeq) {
      libraryState = { ...data, loading: false, loaded: true }
      emitLibrary()
    }
  } catch {
    if (seq === libraryFetchSeq) {
      libraryState = { ...libraryState, loading: false }
      emitLibrary()
    }
  } finally {
    if (seq === libraryFetchSeq) {
      libraryFetchPending = false
    }
  }
  return libraryState
}

function stopFallbackPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startFallbackPolling() {
  if (pollTimer || !hasAnySubscriber()) return
  pollTimer = setInterval(() => {
    if (!hasAnySubscriber()) {
      stopFallbackPolling()
      return
    }
    void refreshDownloads()
  }, 3_000)
}

function connectStream() {
  if (typeof window === 'undefined' || eventSource || !hasAnySubscriber()) return
  if (typeof EventSource !== 'function') {
    startFallbackPolling()
    return
  }

  try {
    const es = new EventSource('/api/downloads/events')
    eventSource = es

    es.addEventListener('jobs', (event) => {
      stopFallbackPolling()
      try {
        const next = JSON.parse((event as MessageEvent).data) as DownloadsSnapshot
        if (next && Array.isArray(next.jobs)) {
          queueState = next
          queueLoaded = true
          emitQueue()
        }
      } catch {
        /* ignore malformed event */
      }
    })

    es.addEventListener('library', () => {
      void refreshLibrary(true)
    })

    es.addEventListener('artwork', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent).data) as ArtworkSnapshot
        applyArtworkSnapshot(next)
      } catch {
        /* ignore malformed event */
      }
    })

    es.onerror = () => {
      es.close()
      if (eventSource === es) eventSource = null
      startFallbackPolling()
      if (!reconnectTimer && hasAnySubscriber()) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connectStream()
        }, 4_000)
      }
    }
  } catch {
    startFallbackPolling()
  }
}

function maybeDisconnectStream() {
  if (hasAnySubscriber()) return
  stopFallbackPolling()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

function subscribeQueue(listener: () => void) {
  queueListeners.add(listener)
  if (!queueLoaded) void refreshDownloads()
  connectStream()
  return () => {
    queueListeners.delete(listener)
    maybeDisconnectStream()
  }
}

function subscribeLibrary(listener: () => void) {
  libraryListeners.add(listener)
  if (!libraryState.loaded) void refreshLibrary(false)
  connectStream()
  return () => {
    libraryListeners.delete(listener)
    maybeDisconnectStream()
  }
}

export function useDownloads(): DownloadsSnapshot {
  return useSyncExternalStore(subscribeQueue, () => queueState, () => queueState)
}

export function useLibrary(): LibraryStoreState {
  return useSyncExternalStore(subscribeLibrary, () => libraryState, () => libraryState)
}

export async function enqueueDownload(payload: EnqueueDownloadPayload) {
  const res = await api.enqueueDownload(payload)
  void refreshDownloads()
  if (res.status === 'already_downloaded') void refreshLibrary(false)
  return res
}

export async function enqueueBulkDownload(payload: BulkEnqueuePayload) {
  const res = await api.enqueueBulkDownload(payload)
  void refreshDownloads()
  return res
}

export async function pauseDownload(id: string) {
  const res = await api.pauseDownload(id)
  void refreshDownloads()
  return res.job
}

export async function resumeDownload(id: string) {
  const res = await api.resumeDownload(id)
  void refreshDownloads()
  return res.job
}

export async function cancelDownload(id: string) {
  const res = await api.cancelDownload(id)
  void refreshDownloads()
  return res.job
}

export async function retryDownload(id: string) {
  const res = await api.retryDownload(id)
  void refreshDownloads()
  return res.job
}

export async function deleteDownload(id: string, deleteFile = false) {
  const res = await api.deleteDownload(id, deleteFile)
  await refreshDownloads()
  if (deleteFile) await refreshLibrary(true)
  return res
}

export async function bulkDownloadAction(action: BulkDownloadAction, ids: string[] = [], deleteFiles = false) {
  const res = await api.bulkDownloadAction(action, ids, deleteFiles)
  queueState = res.snapshot
  emitQueue()
  if (deleteFiles) await refreshLibrary(true)
  return res
}

export async function deleteLibraryFile(id: string) {
  const res = await api.deleteLibraryFile(id)
  await Promise.all([refreshLibrary(true), refreshDownloads()])
  return res
}

export async function bulkDeleteLibraryFiles(ids: string[]) {
  const res = await api.bulkDeleteLibraryFiles(ids)
  await Promise.all([refreshLibrary(true), refreshDownloads()])
  return res
}

export async function refreshLibraryNow() {
  return refreshLibrary(true)
}

function normKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, '')
}

/** Matches local library files belonging to a Media entry (works completely offline). */
export function localFilesForMedia(items: LibraryItem[], media: Media | null): LibraryItem[] {
  if (!media || items.length === 0) return []
  const inferred = inferSeasonFromTitle(media.title)
  const keys = new Set(
    [media.title, media.romaji, media.english, inferred.seriesTitle].map(normKey).filter(Boolean),
  )

  return items
    .filter((item) => {
      if (!item.known) return false
      if (item.mediaId === media.id) return true
      if (item.mediaId != null && item.mediaId !== media.id) return false
      const sKey = normKey(item.seriesTitle)
      const aKey = normKey(item.animeTitle)
      if ((sKey && keys.has(sKey)) || (aKey && keys.has(aKey))) {
        if (inferred.season > 1 && item.season != null && item.season !== inferred.season) return false
        return true
      }
      return false
    })
    .sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 1) - (b.episode ?? 1))
}
