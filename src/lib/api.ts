import type {
  AppSettings,
  Bookmark,
  Media,
  MediaDetail,
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

  resolverStatus() {
    return get<ResolverStatus>('/api/resolver/status', false)
  },

  resolverSearch(q: string) {
    return get<{ q: string; results: ProviderSearchResult[] }>(`/api/resolver/search?q=${encodeURIComponent(q)}`)
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
