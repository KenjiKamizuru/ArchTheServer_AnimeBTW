export type MediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'

export interface MediaLink {
  site: string
  url: string
  type: string | null
}

export interface MediaClaim {
  source: string
  value: string | number | boolean | null
}

export interface MediaProvenanceEntry {
  source: string | null
  refreshedAt: number | null
  /** Losing provider claims kept as evidence when providers disagree (AV-004). */
  alternates?: MediaClaim[]
}

export interface MediaProvenance extends MediaProvenanceEntry {
  fields: Record<string, MediaProvenanceEntry>
  /** Absent-field annotations (AV-014): UNANNOUNCED or NOT_APPLICABLE (default is UNKNOWN). */
  states: Record<string, 'UNANNOUNCED' | 'NOT_APPLICABLE'>
  /** Set when the last refresh attempt failed while last-known-good data was served (AV-022). */
  fetchFailure?: MediaFetchFailure
}

export interface MediaTag {
  /** Stable slug identifier (AV-007). */
  id: string
  name: string
  rank: number
  isMediaSpoiler: boolean
}

export interface MediaScore {
  /** Provider that made the claim (AV-012). */
  source: string
  /** The provider's original value on its own scale (never rounded). */
  value: number
  /** The provider's scale maximum (100 = percent). */
  scale: number
}

export interface MediaFreshness {
  /** 'missing' when never refreshed, 'stale' past the refresh window, else 'fresh' (AV-019). */
  state: 'fresh' | 'stale' | 'missing'
  /** Unix seconds of the last refresh; null when never refreshed. */
  refreshedAt: number | null
  /** Unix seconds when the metadata becomes due for refresh. */
  nextRefreshAt: number
}

export interface MediaArtworkVariant {
  kind: 'POSTER' | 'BANNER' | 'THUMBNAIL'
  url: string
  source: string | null
  width: number | null
  height: number | null
  attribution: string | null
}

export interface MediaFetchFailure {
  /** Unix seconds of the failed refresh attempt. */
  at: number
  /** Bounded failure message (≤200 chars). */
  message: string
}

export interface MediaDate {
  year: number
  /** Null when unannounced (fuzzy partial date). */
  month: number | null
  /** Null when unannounced; only meaningful with a month. */
  day: number | null
}

export interface MediaBroadcast {
  dayOfWeek: string
  /** 24h HH:MM; null when unannounced. */
  time: string | null
}

export interface MediaAgeRating {
  /** Rating-system region or system name (JP, US, PEGI, INTL, …) (AV-011). */
  region: string
  rating: string
}

export interface MediaCompany {
  id: string
  name: string
  /** Canonical roles: MAIN_STUDIO, PRODUCER, LICENSOR, DISTRIBUTOR (AV-008). */
  roles: string[]
}

export interface Media {
  id: number
  /** Canonical record schema version (AV-015). */
  schemaVersion: number
  /** Provider slug → string id, e.g. { anilist: '21', myanimelist: '20' } (AV-002). */
  externalIds: Record<string, string>
  /** Metadata source + last-refresh timestamp covering every field (AV-003). */
  meta: MediaProvenance
  /** Structured artwork variants with source, dimensions and attribution (AV-023). */
  artworkVariants: MediaArtworkVariant[]
  /** Weighted metadata completeness score, 0–100 (AV-024). */
  completeness: number
  /** Staff names for entity search (AV-058). */
  staffNames: string[]
  /** Voice-actor names for entity search (AV-058). */
  voiceActorNames: string[]
  /** Character names for entity search (AV-059). */
  characterNames: string[]
  /** Related-title names in the franchise neighbourhood (AV-060). */
  relationNames: string[]
  /** Relation kinds (lowercase, e.g. 'prequel', 'side_story') (AV-060). */
  relationTypes: string[]
  /** Episode-title index for episode search (AV-062). */
  episodeTitles: string[]
  title: string
  romaji: string | null
  english: string | null
  native: string | null
  synonyms: string[]
  cover: string | null
  banner: string | null
  color: string | null
  description: string
  episodes: number | null
  airedEpisodes: number
  duration: number | null
  status: string
  format: string | null
  season: MediaSeason | null
  seasonYear: number | null
  /** Normalized partial dates (AV-013): month/day null when unannounced. */
  startDate: MediaDate | null
  endDate: MediaDate | null
  /** Broadcast slot (AV-013): day-of-week plus 24h HH:MM, time null when unannounced. */
  broadcast: MediaBroadcast | null
  score: number | null
  /** Provider score claims on their original scales (AV-012); distinct from the score-distribution `scores`. */
  scoreClaims: MediaScore[]
  popularity: number
  genres: string[]
  /** Stable slug identifiers parallel to `genres` (AV-007). */
  genreIds: string[]
  tags: MediaTag[]
  ageRating: string | null
  /** Region-aware age-rating entries (AV-011). */
  ageRatings: MediaAgeRating[]
  /** ISO 3166-1 alpha-2 country of origin (AV-009). */
  countryOfOrigin: string | null
  /** BCP-47 original language (AV-009); derived from country when the provider omits it. */
  originalLanguage: string | null
  nextEpisode: { episode: number; airingAt: number } | null
  studios: string[]
  /** Linked company entities (AV-008): studios, producers, licensors, distributors. */
  companies: MediaCompany[]
  links: MediaLink[]
  streams: MediaLink[]
  anidb: string | null
  anidbSearch: boolean
  siteUrl: string | null
}

export interface StreamingEpisode {
  title: string
  thumbnail: string | null
  url: string
  site: string
}

export interface RelatedSeason {
  id: number
  relationType: 'PREQUEL' | 'SEQUEL'
  title: string
  romaji: string | null
  format: string | null
  status: string
  episodes: number | null
  airedEpisodes: number
  season: MediaSeason | null
  seasonYear: number | null
  cover: string | null
}

export interface ProgressEntry {
  profileId: string
  mediaId: number
  season: string
  episode: number
  positionSeconds: number
  runtimeSeconds: number | null
  state: 'started' | 'completed' | 'manual'
  updatedAt: number
}

export interface EpisodeEntry {
  number: number
  title: string | null
  thumbnail: string | null
  url: string | null
  site: string | null
  runtimeMinutes: number | null
  airDate: string | null
  hasMetadata: boolean
  synopsis: string | null
}

export interface RelatedItem {
  id: number
  type: string
  title: string
  romaji: string | null
  native: string | null
  format: string | null
  status: string
  episodes: number | null
  chapters?: number | null
  season: MediaSeason | null
  seasonYear: number | null
  startDate: { year: number | null; month: number | null; day: number | null } | null
  cover: string | null
  averageScore: number | null
  relationType: string
  siteUrl?: string | null
}

export interface RelationGroup {
  key: string
  label: string
  items: RelatedItem[]
}

export interface TimelineEntry {
  id: number
  title: string
  format: string | null
  episodes: number | null
  year: number | null
  season: MediaSeason | null
  cover: string | null
  position: number
  uncertain: boolean
}

export interface ScoreBucket {
  score: number
  amount: number
  percent: number
}

export interface CharacterEntry {
  id: number
  name: string
  nativeName: string | null
  image: string | null
  siteUrl: string | null
  role: string
  voiceActors: { id: number; name: string; image: string | null; language: string; siteUrl: string | null }[]
}

export interface StaffEntry {
  id: number
  name: string
  nativeName: string | null
  image: string | null
  role: string | null
  occupations: string[]
  siteUrl: string | null
}

export interface DetailSection {
  id: string
  label: string
  always?: boolean
}

export interface MediaDetail extends Media {
  streamingEpisodes: StreamingEpisode[]
  relatedSeasons?: RelatedSeason[]
  /** Freshness verdict for the detail-page indicator (AV-019). */
  freshness?: MediaFreshness
  rankings?: { rank: number; type: string; context: string; year: number | null; season: MediaSeason | null; allTime: boolean }[]
  /** Server-computed detail sections. */
  episodesGuide?: EpisodeEntry[]
  relations?: RelationGroup[]
  timeline?: TimelineEntry[]
  scores?: { total: number; buckets: ScoreBucket[] } | null
  scoreMean?: number | null
  scoreMode?: { score: number; amount: number; percent: number } | null
  statusTimeline?: { label: string; detail: string | null; display: string }[]
  synopsis?: { text: string; hiddenCount: number }
  watchOrder?: WatchOrderRecommendation
  seasonOptions?: SeasonOption[]
  companyGroups?: CompanyGroup[]
  synopsisClip?: SynopsisClip
  infoSheet?: string
  overview?: string
  hasSpoilers?: boolean
  sections?: DetailSection[]
  characters?: CharacterEntry[]
  staff?: StaffEntry[]
}

export interface AnimeNote {
  mediaId: number
  note: string
  updatedAt: number | null
}

export interface WatchOrderNote {
  mediaId: number
  note: string
  updatedAt: number | null
}

export interface RegistrationStatus {
  open: boolean
}

export interface RegisteredUser {
  id: string
  username: string
  displayName: string | null
  emailVerified: boolean
  bio: string | null
  createdAt: number
}

export interface PasskeyCredential {
  credentialId: string
  name: string | null
  createdAt: number
  lastUsedAt: number | null
  counter: number
}

export interface WatchOrderRecommendation {
  recommended: 'release' | 'chronological'
  label: string
  rationale: string
  agree: boolean
  alternative: 'release' | 'chronological'
}

export interface SeasonOption {
  id: number
  title: string
  seasonYear: number | null
  season: string | null
  current: boolean
}

export interface CompanyGroup {
  role: string
  label: string
  names: string[]
}

export interface SynopsisClip {
  text: string
  tooLong: boolean
}

export interface CharacterAppearance {
  id: number
  type: string
  format: string | null
  title: string
  year: number | null
  characterRole: string | null
}

export interface CharacterDetail {
  id: number
  name: string
  nativeName: string | null
  alternativeNames: string[]
  image: string | null
  description: string
  siteUrl: string | null
  media: CharacterAppearance[]
}

export interface StaffCredit {
  id: number
  type: string
  format: string | null
  title: string
  year: number | null
  role: string | null
}

export interface VoiceRoleCredit {
  characterId: number
  characterName: string
  role: string | null
  mediaId: number
  mediaTitle: string
}

export interface StaffDetail {
  id: number
  name: string
  nativeName: string | null
  alternativeNames: string[]
  image: string | null
  description: string
  siteUrl: string | null
  primaryOccupations: string[]
  characterCredits: VoiceRoleCredit[]
  media: StaffCredit[]
}

export interface Bookmark {
  mediaId: number
  addedAt: number
  media: Media
}

export interface AppSettings {
  detailSectionOrder?: string[]
  registrationOpen?: boolean
  emailAccounts?: boolean
  quality: string
  dub: boolean
  resultIndex: number
  libraryDir: string
  libraryDirLocked: boolean
  maxConcurrentDownloads: number
  episodeCompletionThresholdPercent: number
  progressSaveIntervalSeconds: number
  preferLocalPlayback: boolean
  allowedExternalHosts: string[]
  envExternalHostsConfigured: boolean
  theme: 'dark' | 'light'
  systemTheme: boolean
  hideListCapacityWarnings: boolean
  updatedAt: number
}

export interface ProviderSearchResult {
  index: number
  slug: string
  title: string
}

export interface ProviderEpisodesResult {
  title: string
  slug: string
  index: number
  episodes: number[]
}

export interface ProviderMatch {
  mediaId: number
  query: string
  index: number
  title: string
  updatedAt: number
}

export interface ResolverStatus {
  reachable: boolean
  ffmpeg: boolean
  error: string | null
}

export interface WatchResult {
  resolved: boolean
  height: number
  hls: boolean
  hasSubtitle?: boolean
  title: string
  slug: string
}

export type DownloadStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadJob {
  id: string
  sourceType: 'resolver' | 'external'
  mediaId: number | null
  animeTitle: string
  seriesTitle: string
  season: number
  episode: number
  code: string
  fileName: string
  folder: string
  quality: string
  resolvedHeight: number | null
  dub: boolean
  format: string | null
  cover: string | null
  status: DownloadStatus
  progress: number | null
  downloadedBytes: number
  totalBytes: number | null
  durationSec: number | null
  downloadedSec: number
  speedBps: number | null
  canPause: boolean
  canResume: boolean
  fileId: string | null
  error: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
}

export interface DownloadsSnapshot {
  jobs: DownloadJob[]
  maxConcurrent: number
  counts: {
    active: number
    queued: number
    paused: number
    completed: number
    failed: number
    total: number
  }
}

export interface LibraryItem {
  id: string
  fileName: string
  folder: string
  container: string
  mediaId: number | null
  seriesTitle: string | null
  animeTitle: string | null
  season: number | null
  episode: number | null
  quality: string | null
  resolvedHeight: number | null
  dub: boolean
  format: string | null
  isMovie: boolean
  known: boolean
  cover: string | null
  imdbId?: string | null
  size: number
  addedAt: number
  modifiedAt: number
  hasSubtitle: boolean
  directPlayable: boolean
}

export interface LibraryStats {
  totalFiles: number
  episodeCount: number
  movieCount: number
  unknownCount: number
  totalBytes: number
}

export interface LibraryResponse {
  items: LibraryItem[]
  stats: LibraryStats
}

export interface EnqueueDownloadPayload {
  sourceType?: 'resolver' | 'external'
  mediaId?: number | null
  animeTitle: string
  seriesTitle?: string
  query?: string
  resultIndex?: number
  providerTitle?: string
  season?: number
  episode?: number
  quality?: string
  dub?: boolean
  format?: string | null
  cover?: string | null
  durationMinutes?: number | null
  url?: string
  subtitleUrl?: string
  referer?: string
  headers?: Record<string, string>
}

export interface EnqueueDownloadResult {
  status: 'queued' | 'already_downloaded' | 'already_queued'
  job: DownloadJob | null
  file: LibraryItem | null
}

export interface BulkSeasonSpec {
  mediaId?: number | null
  animeTitle: string
  query?: string
  resultIndex?: number
  providerTitle?: string
  season: number
  episodes?: number[]
  episodeCount?: number
  discoverFromProvider?: boolean
  format?: string | null
  cover?: string | null
  durationMinutes?: number | null
}

export interface BulkMultiAnimeItem {
  mediaId?: number | null
  animeTitle: string
  query?: string
  resultIndex?: number
  providerTitle?: string
  season?: number
  episodes?: number[]
  episodeCount?: number
  discoverFromProvider?: boolean
  format?: string | null
  cover?: string | null
  durationMinutes?: number | null
}

export interface BulkEnqueuePayload {
  mode: 'episodes' | 'range' | 'season' | 'series' | 'multi-anime'
  mediaId?: number | null
  animeTitle?: string
  seriesTitle?: string
  query?: string
  resultIndex?: number
  providerTitle?: string
  season?: number
  episodes?: number[]
  startEpisode?: number
  endEpisode?: number
  episodeCount?: number
  discoverFromProvider?: boolean
  seasons?: BulkSeasonSpec[]
  items?: BulkMultiAnimeItem[]
  latestOnly?: boolean
  quality?: string
  dub?: boolean
  format?: string | null
  cover?: string | null
  durationMinutes?: number | null
}

export interface BulkEnqueueResult {
  queued: DownloadJob[]
  queuedCount: number
  skippedDownloaded: number
  skippedQueued: number
  totalRequested: number
  errors?: string[]
}

export type BulkDownloadAction = 'delete' | 'cancel' | 'retry' | 'pause' | 'resume' | 'clear-finished'

export type UploadCategory = 'movie' | 'episode' | 'unknown'

export interface UploadSessionSpec {
  fileName: string
  totalSize: number
  lastModified?: number
  category: UploadCategory
  title?: string
  season?: number
  episode?: number
  quality?: string
  dub?: boolean
  keepBoth?: boolean
  imdbId?: string
}

export interface UploadSessionInfo {
  uploadId: string
  chunkSize: number
  maxChunkSize?: number
  uploadedBytes: number
  totalSize: number
  fileName: string
  folder: string
  category: UploadCategory
  resumed?: boolean
}

export type ArtworkSlot = 'banner' | 'poster' | 'icon'
export type ArtworkTargetType = 'app' | 'media' | 'series' | 'file'
export type ArtworkFocus = 'top' | 'center' | 'bottom'

export interface ClaimedArtworkSlot {
  artId: string
  url: string
  focus: ArtworkFocus
  imdbId: string | null
  updatedAt: number
}

export interface ClaimedArtworkRecord {
  imdbId: string | null
  imdbTitle: string | null
  banner: ClaimedArtworkSlot | null
  poster: ClaimedArtworkSlot | null
  icon: ClaimedArtworkSlot | null
}

export interface ArtworkSnapshot {
  app: ClaimedArtworkRecord | null
  media: Record<string, ClaimedArtworkRecord>
  series: Record<string, ClaimedArtworkRecord>
  file: Record<string, ClaimedArtworkRecord>
}

export interface ImdbImageItem {
  id: string
  url: string
  previewUrl: string
  width: number | null
  height: number | null
  kind: 'poster' | 'backdrop' | 'still' | 'video' | 'logo' | 'gallery'
  isPrimary: boolean
  caption: string | null
  suggestedSlot: ArtworkSlot
}

export interface ImdbTitleResult {
  imdbId: string
  imdbUrl: string
  title: string
  originalTitle: string | null
  type: string | null
  year: number | null
  rating: number | null
  plot: string | null
  recommended: {
    banner: string | null
    poster: string | null
    icon: string | null
  }
  images: ImdbImageItem[]
}

export interface ImdbSearchItem {
  imdbId: string
  title: string
  year: number | null
  type: string | null
  stars: string | null
  previewUrl: string | null
}
