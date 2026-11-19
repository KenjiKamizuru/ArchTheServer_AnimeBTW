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
  WatchOrderNote,
  CharacterDetail,
  StaffDetail,
  RegistrationStatus,
  RegisteredUser,
  PasskeyCredential,
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

export interface CollectionHit {
  media: Media
  addedAt: number | null
  inBookmarks: boolean
  lists: string[]
  highlight: SearchLibraryItem['highlight']
}

export interface SearchCollectionsResponse {
  query: string
  count: number
  items: CollectionHit[]
  totalBookmarks: number
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

  studios(params: { page?: number; q?: string; sort?: 'favourites' | 'name' } = {}) {
    const qs = new URLSearchParams()
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    if (params.q) qs.set('q', params.q)
    if (params.sort) qs.set('sort', params.sort)
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

  suggest(q: string) {
    return get<SuggestResponse>(`/api/search/suggest?q=${encodeURIComponent(q)}`, false)
  },

  searchAdvanced(q: string, params: { page?: number; perPage?: number } = {}) {
    const qs = new URLSearchParams({ q })
    if (params.page && params.page > 1) qs.set('page', String(params.page))
    if (params.perPage) qs.set('perPage', String(params.perPage))
    return get<AdvancedSearchResponse>(`/api/search/advanced?${qs.toString()}`, false)
  },

  searchLibrary(q: string) {
    return get<SearchLibraryResponse>(`/api/search/library?q=${encodeURIComponent(q)}`, false)
  },

  searchCollections(q: string) {
    return get<SearchCollectionsResponse>(`/api/search/collections?q=${encodeURIComponent(q)}`, false)
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

  watchOrderNote(id: number) {
    return get<WatchOrderNote>(`/api/anime/${id}/watch-order`, false)
  },

  saveWatchOrderNote(id: number, note: string) {
    return send<WatchOrderNote>(`/api/anime/${id}/watch-order`, 'PUT', { note })
  },

  character(id: number) {
    return get<CharacterDetail>(`/api/characters/${id}`, true)
  },

  staff(id: number) {
    return get<StaffDetail>(`/api/staff/${id}`, true)
  },

  reportAnimeIssue(
    id: number,
    payload: { field?: string; message: string; kind?: 'metadata' | 'episode-order'; suggestedValue?: string },
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

  registrationStatus() {
    return get<RegistrationStatus>('/api/auth/registration-status', false)
  },

  register(payload: { username: string; password: string; displayName?: string; email?: string }) {
    return send<{ user: RegisteredUser }>('/api/auth/register', 'POST', payload)
  },

  verifyEmail(token: string) {
    return send<{ ok: boolean; user: RegisteredUser }>('/api/auth/verify-email', 'POST', { token })
  },

  login(payload: { username: string; password: string }) {
    return send<{ user: RegisteredUser }>('/api/auth/login', 'POST', payload)
  },

  logout() {
    return send<{ ok: boolean }>('/api/auth/logout', 'POST')
  },

  me() {
    return get<{ user: RegisteredUser | null }>('/api/auth/me', false)
  },

  requestReset(identifier: string) {
    return send<{ ok: boolean }>('/api/auth/request-reset', 'POST', { identifier })
  },

  resetPassword(payload: { token: string; password: string }) {
    return send<{ ok: boolean }>('/api/auth/reset-password', 'POST', payload)
  },

  updateProfile(payload: { bio: string | null }) {
    return send<{ user: RegisteredUser }>('/api/auth/profile', 'PUT', payload)
  },

  passkeyChallenge(purpose: 'register' | 'authenticate') {
    return send<{ challenge: string }>('/api/auth/passkey/challenge', 'POST', { purpose })
  },

  passkeyRegister(payload: { clientDataJSON: string; attestationObject: string; name?: string }) {
    return send<{ credential: PasskeyCredential }>('/api/auth/passkey/register', 'POST', payload)
  },

  passkeyAuthenticate(payload: { credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string }) {
    return send<{ user: RegisteredUser }>('/api/auth/passkey/authenticate', 'POST', payload)
  },

  listPasskeys() {
    return get<{ passkeys: PasskeyCredential[] }>('/api/auth/passkey', false)
  },

  removePasskey(credentialId: string) {
    return send<{ ok: boolean }>(`/api/auth/passkey/${encodeURIComponent(credentialId)}`, 'DELETE')
  },

  twoFactorStatus() {
    return get<{ enabled: boolean; confirmedAt: number | null }>('/api/auth/2fa', false)
  },

  twoFactorSetup() {
    return send<{ secret: string; otpauthUrl: string }>('/api/auth/2fa/setup', 'POST')
  },

  twoFactorEnable(code: string) {
    return send<{ enabled: boolean }>('/api/auth/2fa/enable', 'POST', { code })
  },

  twoFactorDisable(code: string) {
    return send<{ enabled: boolean }>('/api/auth/2fa/disable', 'POST', { code })
  },

  recoveryCodesStatus() {
    return get<{ total: number; remaining: number }>('/api/auth/recovery-codes', false)
  },

  regenerateRecoveryCodes() {
    return send<{ codes: string[] }>('/api/auth/recovery-codes', 'POST')
  },

  async uploadAvatar(bytes: ArrayBuffer) {
    const res = await fetch('/api/auth/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error ?? 'Could not upload the avatar')
    }
    return res.json() as Promise<{ ok: boolean; mime: string; width: number; height: number }>
  },

  removeAvatar() {
    return send<{ ok: boolean }>('/api/auth/avatar', 'DELETE')
  },

  profileSettings() {
    return get<{ token: string; path: string; visibility: string; showActivity: boolean }>('/api/auth/profile-link', false)
  },

  setProfileActivity(showActivity: boolean) {
    return send<{ showActivity: boolean }>('/api/auth/profile-activity', 'PUT', { showActivity })
  },

  deleteAccount(body: { password: string; confirm: string; code?: string }) {
    return send<{ ok: boolean; removed: string[]; retained: string[] }>('/api/auth/account', 'DELETE', body)
  },

  listSessions() {
    return get<{ sessions: { hash: string; createdAt: number | null; expiresAt: number | null; current: boolean }[] }>('/api/auth/sessions', false)
  },

  revokeOtherSessions() {
    return send<{ ok: boolean; revoked: number }>('/api/auth/sessions/others', 'DELETE')
  },

  revokeSession(hash: string) {
    return send<{ ok: boolean }>(`/api/auth/sessions/${encodeURIComponent(hash)}`, 'DELETE')
  },

  listGuests() {
    return get<{ guests: { id: string; name: string; createdAt: number | null }[] }>('/api/auth/guests', false)
  },

  createGuest(name: string) {
    return send<{ guest: { id: string; name: string; createdAt: number | null } }>('/api/auth/guests', 'POST', { name })
  },

  removeGuest(id: string) {
    return send<{ ok: boolean }>(`/api/auth/guests/${encodeURIComponent(id)}`, 'DELETE')
  },

  selectGuest(id: string) {
    return send<{ guest: { id: string; name: string } }>(`/api/auth/guests/${encodeURIComponent(id)}/select`, 'POST')
  },

  clearGuest() {
    return send<{ ok: boolean }>('/api/auth/guests/clear', 'POST')
  },

  activeGuest() {
    return get<{ guest: { id: string; name: string } | null }>('/api/auth/guests/active', false)
  },

  /** Device-profile resolution (AV-123): who is using this device and with which preferences. */
  getActiveProfile() {
    return get<{ profile: { mode: 'owner' | 'guest'; name: string; guestId?: string; prefs: { preferredLanguage: string | null; locale: string | null; defaultSubtitle: string | null; defaultAudio: string | null; defaultQuality: string | null; maxContentRating: string | null; theme: string | null; preferLocalPlayback: boolean | null; loginNotifications: boolean | null } } }>('/api/auth/profile/active', false)
  },

  setProfileVisibility(visibility: 'public' | 'private' | 'link-only') {
    return send<{ visibility: string }>('/api/auth/profile-visibility', 'PUT', { visibility })
  },

  rotateProfileLink() {
    return send<{ token: string; path: string }>('/api/auth/profile-link/rotate', 'POST')
  },

  viewProfile(userId: string, token?: string | null) {
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    return get<{ user: RegisteredUser; visibility: string; activity: { memberSince: number | null; activeSessions: number } | null }>(`/api/profile/${encodeURIComponent(userId)}${qs}`, false)
  },

  preferences() {
    return get<{ preferredLanguage: string | null; locale: string | null; defaultSubtitle: string | null; defaultAudio: string | null; defaultQuality: string | null; maxContentRating: string | null; theme: string | null; preferLocalPlayback: boolean | null; loginNotifications: boolean | null }>('/api/auth/preferences', false)
  },

  updatePreferences(body: { preferredLanguage?: string | null; locale?: string | null; defaultSubtitle?: string | null; defaultAudio?: string | null; defaultQuality?: string | null; maxContentRating?: string | null; theme?: string | null; preferLocalPlayback?: boolean | null; loginNotifications?: boolean | null }) {
    return send<{ preferredLanguage: string | null; locale: string | null; defaultSubtitle: string | null; defaultAudio: string | null; defaultQuality: string | null; maxContentRating: string | null; theme: string | null; preferLocalPlayback: boolean | null; loginNotifications: boolean | null }>('/api/auth/preferences', 'PUT', body)
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

// Admin metadata inspector (AV-025b).
export interface InspectionRow {
  field: string
  raw: unknown
  normalized: unknown
  changed: boolean
}

export interface InspectionResponse {
  raw: Record<string, unknown>
  record: Media
  rows: InspectionRow[]
}

export async function adminInspect(id: number | string): Promise<InspectionResponse> {
  return request<InspectionResponse>(`/api/admin/inspect/${encodeURIComponent(String(id))}`)
}
