import type {
  AppSettings,
  ArtworkFocus,
  ArtworkSlot,
  ArtworkSnapshot,
  ArtworkTargetType,
  Bookmark,
  BulkDownloadAction,
  BulkEnqueuePayload,
  BulkEnqueueResult,
  ClaimedArtworkRecord,
  DownloadJob,
  DownloadsSnapshot,
  EnqueueDownloadPayload,
  EnqueueDownloadResult,
  ImdbSearchItem,
  ImdbTitleResult,
  LibraryItem,
  LibraryResponse,
  Media,
  MediaDetail,
  ProviderEpisodesResult,
  ProviderMatch,
  ProviderSearchResult,
  ResolverStatus,
  UploadSessionInfo,
  UploadSessionSpec,
  WatchResult,
  AnimeNote,
} from '../types'

export interface BrowseFilters {
  season?: string | null
  year?: number | null
  includeOlderSeasons?: boolean
  formats?: string[]
  statuses?: string[]
  sources?: string[]
  countries?: string[]
  genres?: string[]
  genresExclude?: string[]
  tags?: string[]
  tagMode?: 'and' | 'or'
  years?: { min?: number; max?: number }
  episodes?: { min?: number; max?: number }
  duration?: { min?: number; max?: number }
  minScore?: number | null
  maxPopularity?: number | null
  sort?: string
  page?: number
  perPage?: number
  query?: string | null
}

export interface BrowseResponse {
  media: Media[]
  rejectedCount: number
  total: number
  hasNextPage: boolean
  page: number
  perPage: number
  filters: string
  params: string
  activeFilters: number
}

export interface DiscoverPick {
  kind: string
  media: Media | null
  items?: Media[]
  total?: number
}

export interface StudioSummary {
  id: number | null
  name: string
  isAnimationStudio: boolean
  favourites: number | null
  siteUrl: string | null
  bucket: string
}

export interface StudioListResponse {
  studios: StudioSummary[]
  page: number
  hasNextPage: boolean
  total: number
  type: 'all' | 'animation' | 'producer'
}

export interface StudioFilmographyResponse {
  studio: Omit<StudioSummary, 'bucket'>
  media: Media[]
  page: number
  hasNextPage: boolean
  total: number
  byYear: { year: number | 'Unknown'; count: number; items: Media[] }[]
  decades: number[]
}

export interface IndexBucket {
  bucket: string
  count: number
  items: Media[]
}

export interface CatalogIndexResponse {
  buckets: IndexBucket[]
  bucketsAvailable: string[]
  page: number
  hasNextPage: boolean
  total: number
}

export interface FranchiseGroup {
  key: string
  count: number
  title: string
  media: Media[]
}

export interface FranchiseResponse {
  season: string
  year: number
  groups: FranchiseGroup[]
  considered: number
}

export interface HighlightSegment {
  text: string
  match: boolean
}

export interface SearchSuggestion {
  id: number
  title: string
  sub: string
  cover: string | null
  reason: string
  score: number
  hintText: HighlightSegment[]
}

export interface SuggestResponse {
  query: string
  suggestions: SearchSuggestion[]
  correction: { suggestion: string; original: string; reason: string; score: number } | null
}

export interface SearchFilterState {
  studio: string[]
  genre: string[]
  tag: string[]
  year: { min: number; max: number } | null
  status: string[]
  format: string[]
  score: { min?: number; max?: number } | null
  episodes: { min?: number; max?: number } | null
}

export interface AdvancedSearchResponse {
  query: string
  text: string
  filters: SearchFilterState
  media: Media[]
  hasNextPage: boolean
  removed: number
  correction: { suggestion: string; original: string; reason: string; score: number } | null
  page: number
  perPage: number
  cappedAt: number
  groups: { format: string; items: Media[] }[]
  alternatives: { label: string; query: string; kind: string }[]
}

export interface SearchLibraryItem {
  id: string
  fileName: string
  folder: string | null
  animeTitle: string | null
  seriesTitle: string | null
  season: number | null
  episode: number | null
  quality: string | null
  size: number
  modifiedAt: number
  highlight: HighlightSegment[]
}

export interface SearchLibraryResponse {
  query: string
  count: number
  items: SearchLibraryItem[]
  totalLibrary: number
}

export interface SeasonResponse {
  season: string
  year: number
  sort: string
  page: number
  hasNextPage: boolean
  total: number
  media: Media[]
}

export interface SeasonComparison {
  season: string
  year: number
  label: string
  count: number
  returned: number
  averageScore: number | null
  topFormats: [string, number][]
  topGenres: [string, number][]
  topTitles: { id: number; title: string; score: number | null; format: string | null }[]
  media: Media[]
}

export interface SeasonComparisonResponse {
  seasons: SeasonComparison[]
  compared: number
  sharedTitleIds: number[]
  sharedCount: number
}

export interface SeasonCalendarDay {
  date: string
  year: number
  month: number
  day: number
  media: Media[]
}

export interface SeasonCalendarResponse {
  season: string
  year: number
  total: number
  returned: number
  hasNextPage: boolean
  media: Media[]
  byDate: Record<string, Media[]>
  dates: string[]
  calendar: SeasonCalendarDay[]
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

async function get<T>(url: string, useCache = true, signal?: AbortSignal): Promise<T> {
  const hit = cache.get(url)
  if (useCache && hit && Date.now() - hit.at < TTL) return hit.data as T
  const data = await request<T>(url, signal ? { signal } : undefined)
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

  compareSeasons(seasons: Array<{ season?: string; year?: number }>) {
    const qs = new URLSearchParams()
    for (const { season, year } of seasons) {
      if (season) qs.append('season', season)
      if (year) qs.append('year', String(year))
    }
    const query = qs.toString()
    return get<SeasonComparisonResponse>(`/api/seasons/compare${query ? `?${query}` : ''}`)
  },

  seasonCalendar(params: { season?: string; year?: number; sort?: string; page?: number } = {}) {
    const qs = new URLSearchParams()
    if (params.season) qs.set('season', params.season)
    if (params.year) qs.set('year', String(params.year))
    if (params.sort) qs.set('sort', params.sort)
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    const query = qs.toString()
    return get<SeasonCalendarResponse>(`/api/season/calendar${query ? `?${query}` : ''}`)
  },

  browse(filters: Record<string, string | number | boolean | undefined | null>) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '' || value === false) continue
      qs.set(key, value === true ? '1' : String(value))
    }
    const query = qs.toString()
    return get<BrowseResponse>(`/api/browse${query ? `?${query}` : ''}`)
  },

  discover(kind: 'spotlight' | 'random' | 'hidden-gems', filters: Record<string, string | number | boolean | undefined | null> = {}) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '' || value === false) continue
      qs.set(key, value === true ? '1' : String(value))
    }
    const query = qs.toString()
    return get<DiscoverPick>(`/api/discover/${kind}${query ? `?${query}` : ''}`, false)
  },

  studios(params: {
    page?: number
    q?: string
    sort?: 'favourites' | 'name'
    type?: 'all' | 'animation' | 'producer'
  } = {}) {
    const qs = new URLSearchParams()
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    if (params.q) qs.set('q', params.q)
    if (params.sort) qs.set('sort', params.sort)
    if (params.type && params.type !== 'all') qs.set('type', params.type)
    const query = qs.toString()
    return get<StudioListResponse>(`/api/studios${query ? `?${query}` : ''}`)
  },

  studio(id: number, params: { page?: number; sort?: string } = {}) {
    const qs = new URLSearchParams()
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    if (params.sort) qs.set('sort', params.sort)
    const query = qs.toString()
    return get<StudioFilmographyResponse>(`/api/studios/${id}${query ? `?${query}` : ''}`)
  },

  catalogIndex(params: { page?: number; sort?: 'title' | 'popular' | 'rated'; kana?: boolean } = {}) {
    const qs = new URLSearchParams()
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    if (params.sort) qs.set('sort', params.sort)
    if (params.kana === false) qs.set('kana', '0')
    const query = qs.toString()
    return get<CatalogIndexResponse>(`/api/index${query ? `?${query}` : ''}`)
  },

  franchises(params: { season?: string; year?: number } = {}) {
    const qs = new URLSearchParams()
    if (params.season) qs.set('season', params.season)
    if (params.year) qs.set('year', String(params.year))
    const query = qs.toString()
    return get<FranchiseResponse>(`/api/franchises${query ? `?${query}` : ''}`)
  },

  recentlyAdded(limit = 24) {
    return get<{ media: Media[]; count: number }>(`/api/recent?limit=${limit}`, false)
  },

  recentlyUpdated(limit = 24) {
    return get<{ media: Media[]; count: number }>(`/api/updated?limit=${limit}`, false)
  },

  airing() {
    return get<{ media: Media[]; hasNextPage: boolean }>('/api/airing')
  },

  search(q: string, page = 1) {
    return get<{ media: Media[]; hasNextPage: boolean }>(`/api/search?q=${encodeURIComponent(q)}&page=${page}`)
  },

  suggest(q: string, signal?: AbortSignal) {
    return get<SuggestResponse>(`/api/search/suggest?q=${encodeURIComponent(q)}`, false, signal)
  },

  searchAdvanced(q: string, params: { page?: number; perPage?: number } = {}, signal?: AbortSignal) {
    const qs = new URLSearchParams({ q })
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    if (params.perPage) qs.set('perPage', String(params.perPage))
    return get<AdvancedSearchResponse>(`/api/search/advanced?${qs.toString()}`, false, signal)
  },

  searchLibrary(q: string, signal?: AbortSignal) {
    return get<SearchLibraryResponse>(`/api/search/library?q=${encodeURIComponent(q)}`, false, signal)
  },

  searchOptions() {
    return get<{ fields: string[]; resultCap: { max: number; defaultPerPage: number; min: number }; statuses: string[]; formats: string[] }>(
      '/api/search/options',
    )
  },

  detail(id: number, opts: { spoilers?: boolean; order?: 'release' | 'chronological' } = {}) {
    const qs = new URLSearchParams()
    if (opts.spoilers) qs.set('spoilers', '1')
    if (opts.order) qs.set('order', opts.order)
    const query = qs.toString()
    return get<MediaDetail>(`/api/anime/${id}${query ? `?${query}` : ''}`, !query)
  },

  animeNotes(id: number) {
    return get<AnimeNote>(`/api/anime/${id}/notes`, false)
  },

  saveAnimeNotes(id: number, note: string) {
    return send<AnimeNote>(`/api/anime/${id}/notes`, 'PUT', { note })
  },

  reportAnimeIssue(
    id: number,
    payload: { field?: string; message: string; kind?: 'metadata' | 'episode-order' },
  ) {
    return send<{ report: { id: string; field: string; status: string }; pending: number }>(
      `/api/anime/${id}/report`,
      'POST',
      payload,
    )
  },

  reports() {
    return get<{ reports: { id: string; mediaId: number; field: string; message: string; createdAt: number; status: string }[] }>(
      '/api/reports',
      false,
    )
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

  createUploadSession(spec: UploadSessionSpec) {
    return send<UploadSessionInfo>('/api/library/uploads', 'POST', spec)
  },

  getUploadSession(uploadId: string) {
    return get<UploadSessionInfo>(`/api/library/uploads/${encodeURIComponent(uploadId)}`, false)
  },

  completeUploadSession(uploadId: string) {
    return send<{ item: LibraryItem }>(
      `/api/library/uploads/${encodeURIComponent(uploadId)}/complete`,
      'POST',
    )
  },

  cancelUploadSession(uploadId: string) {
    return send<{ cancelled: boolean }>(`/api/library/uploads/${encodeURIComponent(uploadId)}`, 'DELETE')
  },

  /**
   * Attaches a companion subtitle (.vtt, .srt, .ass, .ssa) to any library item.
   * Automatically splits files in 450 KB chunks so even large font-embedded .ass
   * subtitles succeed behind default 1 MB Nginx proxies without HTTP 413.
   */
  async uploadLibrarySubtitle(itemId: string, file: File): Promise<{ saved: boolean }> {
    const CHUNK = 450 * 1024
    const total = file.size
    if (total <= 0) throw new Error('Subtitle file is empty')
    let offset = 0
    while (offset < total) {
      const end = Math.min(offset + CHUNK, total)
      const isFinal = end >= total
      const slice = file.slice(offset, end)
      const qs = new URLSearchParams({
        filename: file.name,
        offset: String(offset),
        final: isFinal ? '1' : '0',
      })
      const res = await fetch(`/api/library/${encodeURIComponent(itemId)}/subtitle?${qs.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Offset': String(offset),
        },
        body: slice,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Subtitle upload failed (${res.status})`)
      }
      offset = end
    }
    return { saved: true }
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

  // ── IMDb Photo Lookup & Artwork Claiming (Banner / Poster / Icon) ─────────

  artwork() {
    return get<ArtworkSnapshot>('/api/artwork', false)
  },

  imdbLookup(idOrUrl: string) {
    return get<ImdbTitleResult>(`/api/imdb/lookup?id=${encodeURIComponent(idOrUrl)}`, false)
  },

  imdbSearch(q: string) {
    return get<{ query: string; results: ImdbSearchItem[] }>(
      `/api/imdb/search?q=${encodeURIComponent(q)}`,
      false,
    )
  },

  claimImdbPhoto(payload: {
    targetType: ArtworkTargetType
    targetKey: string
    slot: ArtworkSlot
    imageUrl: string
    imdbId?: string
    imdbTitle?: string
    focus?: ArtworkFocus
    applyTitle?: boolean
    asMovie?: boolean
  }) {
    return send<{
      targetType: ArtworkTargetType
      targetKey: string
      slot: ArtworkSlot
      record: ClaimedArtworkRecord | null
      snapshot: ArtworkSnapshot
    }>('/api/imdb/claim', 'POST', payload)
  },

  claimImdbBundle(payload: {
    targetType: ArtworkTargetType
    targetKey: string
    slots: Partial<Record<ArtworkSlot, string>>
    focus?: Partial<Record<ArtworkSlot, ArtworkFocus>>
    imdbId?: string
    imdbTitle?: string
    applyTitle?: boolean
    asMovie?: boolean
  }) {
    return send<{
      targetType: ArtworkTargetType
      targetKey: string
      record: ClaimedArtworkRecord | null
      snapshot: ArtworkSnapshot
    }>('/api/imdb/claim-bundle', 'POST', payload)
  },

  updateArtworkFocus(payload: {
    targetType: ArtworkTargetType
    targetKey: string
    slot: ArtworkSlot
    focus: ArtworkFocus
  }) {
    return send<{ record: ClaimedArtworkRecord | null; snapshot: ArtworkSnapshot }>(
      '/api/artwork/focus',
      'PATCH',
      payload,
    )
  },

  clearArtwork(payload: {
    targetType: ArtworkTargetType
    targetKey: string
    slot?: ArtworkSlot
  }) {
    return send<{ removed: boolean; record: ClaimedArtworkRecord | null; snapshot: ArtworkSnapshot }>(
      '/api/artwork',
      'DELETE',
      payload,
    )
  },
}
