import type {
  AniCliMatch,
  AniCliSearchResult,
  AniCliStatus,
  AppSettings,
  Bookmark,
  BulkDownloadResult,
  Job,
  LibraryEntry,
  Media,
  MediaDetail,
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
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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

  anicliStatus() {
    return get<AniCliStatus>('/api/anicli/status', false)
  },

  anicliSearch(q: string) {
    return get<{ q: string; results: AniCliSearchResult[] }>(`/api/anicli/search?q=${encodeURIComponent(q)}`)
  },

  anicliMatch(mediaId: number) {
    return get<{ match: AniCliMatch | null }>(`/api/anicli/matches/${mediaId}`, false)
  },

  bulkDownload(payload: {
    media: { id: number; title: string; romaji: string | null }
    episodes: number[]
    template?: string
    source?: 'anicli' | 'template'
    anicli?: {
      query: string
      resultIndex: number
      quality?: string
      dub?: boolean
      title?: string | null
    }
  }) {
    return send<BulkDownloadResult>('/api/downloads/bulk', 'POST', payload)
  },

  bookmarks() {
    return get<{ items: Bookmark[] }>('/api/bookmarks', false)
  },

  setBookmark(media: Media, add: boolean) {
    return add
      ? send<{ item: Bookmark }>('/api/bookmarks', 'POST', { media })
      : send<{ removed: boolean }>(`/api/bookmarks/${media.id}`, 'DELETE')
  },

  downloads() {
    return get<Job[]>('/api/downloads', false)
  },

  startDownload(payload: {
    mediaId: number | null
    title: string
    episode: number | null
    url: string
    filename?: string
  }) {
    return send<Job>('/api/downloads', 'POST', payload)
  },

  cancelDownload(id: string) {
    return send<Job>(`/api/downloads/${id}/cancel`, 'POST')
  },

  removeDownload(id: string) {
    return send<{ removed: boolean }>(`/api/downloads/${id}`, 'DELETE')
  },

  library() {
    return get<{ items: LibraryEntry[]; dir: string }>('/api/library', false)
  },

  removeExtra(relPath: string) {
    return send<{ removed: boolean }>(`/api/library?path=${encodeURIComponent(relPath)}`, 'DELETE')
  },

  fileUrl(id: string) {
    return `/api/downloads/${id}/file`
  },

  extraFileUrl(relPath: string) {
    return `/api/library/file?path=${encodeURIComponent(relPath)}`
  },

  streamUrl(id: string) {
    return `/api/stream/${id}`
  },

  extraStreamUrl(relPath: string) {
    return `/api/stream?path=${encodeURIComponent(relPath)}`
  },

  transcodeUrl(id: string) {
    return `/api/transcode/${id}`
  },

  extraTranscodeUrl(relPath: string) {
    return `/api/transcode?path=${encodeURIComponent(relPath)}`
  },

  subtitleUrl(id: string) {
    return `/api/subtitle/${id}`
  },

  extraSubtitleUrl(relPath: string) {
    return `/api/subtitle?path=${encodeURIComponent(relPath)}`
  },

  liveJobUrl(id: string) {
    return `/api/live/job/${id}`
  },

  liveJobSubtitleUrl(id: string) {
    return `/api/live/job/${id}/subtitle`
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
    if (params.dub) qs.set('dub', '1')
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
    if (params.dub) qs.set('dub', '1')
    return `/api/live/subtitle?${qs.toString()}`
  },
}
