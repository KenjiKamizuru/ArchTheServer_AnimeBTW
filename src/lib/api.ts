import type {
  AppSettings,
  Bookmark,
  BulkDownloadAction,
  BulkEnqueuePayload,
  BulkEnqueueResult,
  DownloadJob,
  DownloadsSnapshot,
  EnqueueDownloadPayload,
  EnqueueDownloadResult,
  LibraryItem,
  LibraryResponse,
  Media,
  MediaDetail,
  ProviderEpisodesResult,
  ProviderMatch,
  ProviderSearchResult,
  ResolverStatus,
  WatchResult,
} from '../types'

export interface SeasonResponse {
  season: string
  year: number
  sort: string
  page: number
  hasNextPage: boolean
  total: number
  media: Media[]
}

interface CacheEntry {
  at: number
  data: unknown
}

const cache = new Map<string, CacheEntry>()
const TTL = 5 * 60 * 1000

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

async function get<T>(url: string, useCache = true): Promise<T> {
  const hit = cache.get(url)
  if (useCache && hit && Date.now() - hit.at < TTL) return hit.data as T
  const data = await request<T>(url)
  cache.set(url, { at: Date.now(), data })
  return data
}

function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export const api = {
  season(params: { season?: string; year?: number; sort?: string; page?: number } = {}) {
    const qs = new URLSearchParams()
    if (params.season) qs.set('season', params.season)
    if (params.year) qs.set('year', String(params.year))
    if (params.sort) qs.set('sort', params.sort)
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    const query = qs.toString()
    return get<SeasonResponse>(`/api/season${query ? `?${query}` : ''}`)
  },

  airing() {
    return get<{ media: Media[]; hasNextPage: boolean }>('/api/airing')
  },

  search(q: string, page = 1) {
    return get<{ media: Media[]; hasNextPage: boolean }>(`/api/search?q=${encodeURIComponent(q)}&page=${page}`)
  },

  detail(id: number) {
    return get<MediaDetail>(`/api/anime/${id}`)
  },

  mediaMany(ids: number[]) {
    if (!ids.length) return Promise.resolve({ media: [] as Media[] })
    return get<{ media: Media[] }>(`/api/media?ids=${ids.join(',')}`)
  },

  settings() {
    return get<AppSettings>('/api/settings', false)
  },

  saveSettings(patch: Partial<AppSettings>) {
    return send<AppSettings>('/api/settings', 'PUT', patch)
  },

  resolverStatus() {
    return get<ResolverStatus>('/api/resolver/status', false)
  },

  resolverSearch(q: string) {
    return get<{ q: string; results: ProviderSearchResult[] }>(`/api/resolver/search?q=${encodeURIComponent(q)}`)
  },

  resolverEpisodes(q: string, resultIndex?: number) {
    const qs = new URLSearchParams({ q })
    if (resultIndex) qs.set('resultIndex', String(resultIndex))
    return get<ProviderEpisodesResult>(`/api/resolver/episodes?${qs.toString()}`)
  },

  resolverMatch(mediaId: number) {
    return get<{ match: ProviderMatch | null }>(`/api/resolver/matches/${mediaId}`, false)
  },

  saveMatch(mediaId: number, match: { query: string; index: number; title?: string }) {
    return send<{ match: ProviderMatch }>(`/api/resolver/matches/${mediaId}`, 'PUT', match)
  },

  /** Resolves the episode server-side (search, embed, quality pick). */
  watch(payload: {
    query: string
    resultIndex?: number
    episode?: number
    quality?: string
    dub?: boolean
    mediaId?: number
    title?: string
  }) {
    return send<WatchResult>('/api/watch', 'POST', payload)
  },

  bookmarks() {
    return get<{ items: Bookmark[] }>('/api/bookmarks', false)
  },

  setBookmark(media: Media, add: boolean) {
    return add
      ? send<{ item: Bookmark }>('/api/bookmarks', 'POST', { media })
      : send<{ removed: boolean }>(`/api/bookmarks/${media.id}`, 'DELETE')
  },

  // ── Persistent Download Manager ────────────────────────────────────────────

  downloads() {
    return get<DownloadsSnapshot>('/api/downloads', false)
  },

  enqueueDownload(payload: EnqueueDownloadPayload) {
    return send<EnqueueDownloadResult>('/api/downloads', 'POST', payload)
  },

  enqueueBulkDownload(payload: BulkEnqueuePayload) {
    return send<BulkEnqueueResult>('/api/downloads/bulk', 'POST', payload)
  },

  pauseDownload(id: string) {
    return send<{ job: DownloadJob }>(`/api/downloads/${encodeURIComponent(id)}/pause`, 'POST')
  },

  resumeDownload(id: string) {
    return send<{ job: DownloadJob }>(`/api/downloads/${encodeURIComponent(id)}/resume`, 'POST')
  },

  cancelDownload(id: string) {
    return send<{ job: DownloadJob }>(`/api/downloads/${encodeURIComponent(id)}/cancel`, 'POST')
  },

  retryDownload(id: string) {
    return send<{ job: DownloadJob }>(`/api/downloads/${encodeURIComponent(id)}/retry`, 'POST')
  },

  deleteDownload(id: string, deleteFile = false) {
    const qs = deleteFile ? '?deleteFile=1' : ''
    return send<{ removed: boolean; fileDeleted: boolean }>(
      `/api/downloads/${encodeURIComponent(id)}${qs}`,
      'DELETE',
    )
  },

  bulkDownloadAction(action: BulkDownloadAction, ids: string[] = [], deleteFiles = false) {
    return send<{ affected: number; snapshot: DownloadsSnapshot }>('/api/downloads/actions', 'POST', {
      action,
      ids,
      deleteFiles,
    })
  },

  // ── Shared Local Media Library ─────────────────────────────────────────────

  library(fresh = false) {
    return get<LibraryResponse>(`/api/library${fresh ? '?fresh=1' : ''}`, false)
  },

  libraryForAnime(mediaId: number, hints?: { title?: string; romaji?: string | null; english?: string | null }) {
    const qs = new URLSearchParams()
    if (hints?.title) qs.set('title', hints.title)
    if (hints?.romaji) qs.set('romaji', hints.romaji)
    if (hints?.english) qs.set('english', hints.english)
    const query = qs.toString()
    return get<{ items: LibraryItem[] }>(
      `/api/library/anime/${mediaId}${query ? `?${query}` : ''}`,
      false,
    )
  },

  deleteLibraryFile(id: string) {
    return send<{ removed: boolean; id: string }>(`/api/library/${encodeURIComponent(id)}`, 'DELETE')
  },

  bulkDeleteLibraryFiles(ids: string[]) {
    return send<{ deleted: string[]; notFound: string[] }>('/api/library/bulk-delete', 'POST', { ids })
  },

  importLibraryVideo(file: File, onProgress?: (percent: number) => void): Promise<{ item: LibraryItem }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/library/import?filename=${encodeURIComponent(file.name)}`)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
        }
      }
      xhr.onload = () => {
        let parsed: { item?: LibraryItem; error?: string } | null = null
        try {
          parsed = JSON.parse(xhr.responseText) as { item?: LibraryItem; error?: string }
        } catch {
          parsed = null
        }
        if (xhr.status >= 200 && xhr.status < 300 && parsed?.item) {
          resolve({ item: parsed.item })
        } else {
          reject(new Error(parsed?.error || `Upload failed (${xhr.status})`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error while uploading file'))
      xhr.onabort = () => reject(new Error('Upload cancelled'))
      xhr.send(file)
    })
  },

  localStreamUrl(id: string, opts?: { remux?: boolean }) {
    const qs = opts?.remux ? '?remux=1' : ''
    return `/api/library/${encodeURIComponent(id)}/stream${qs}`
  },

  localDownloadUrl(id: string) {
    return `/api/library/${encodeURIComponent(id)}/download`
  },

  localSubtitleUrl(id: string) {
    return `/api/library/${encodeURIComponent(id)}/subtitle`
  },

  liveStreamUrl(params: {
    query: string
    resultIndex?: number
    episode?: number
    quality?: string
    dub?: boolean
  }) {
    const qs = new URLSearchParams()
    qs.set('query', params.query)
    if (params.resultIndex) qs.set('resultIndex', String(params.resultIndex))
    if (params.episode) qs.set('episode', String(params.episode))
    if (params.quality) qs.set('quality', params.quality)
    if (params.dub !== undefined) qs.set('dub', params.dub ? '1' : '0')
    return `/api/live/stream?${qs.toString()}`
  },

  liveSubtitleUrl(params: {
    query: string
    resultIndex?: number
    episode?: number
    quality?: string
    dub?: boolean
  }) {
    const qs = new URLSearchParams()
    qs.set('query', params.query)
    if (params.resultIndex) qs.set('resultIndex', String(params.resultIndex))
    if (params.episode) qs.set('episode', String(params.episode))
    if (params.quality) qs.set('quality', params.quality)
    if (params.dub !== undefined) qs.set('dub', params.dub ? '1' : '0')
    return `/api/live/subtitle?${qs.toString()}`
  },
}
