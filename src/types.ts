export type MediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'

/** Provider-supplied date precision; null components are kept unknown, never filled. */
export interface MediaDate {
  year: number | null
  month: number | null
  day: number | null
}

export interface MediaLink {
  site: string
  url: string
}

export interface GenreEntity {
  id: string
  label: string
}

export interface MediaTag {
  id: string
  name: string
  rank: number | null
  isMediaSpoiler: boolean
}

export type OrganizationKind = 'studio' | 'producer' | 'licensor' | 'distributor'

export interface OrganizationAlias {
  name: string
  source: string | null
}

export interface OrganizationEntity {
  /** Stable source-scoped entity key, or a normalized-name key when IDs are absent. */
  id: string
  kind: OrganizationKind
  name: string
  source: string | null
  /** Provider ID for this organization, distinct from the anime's external IDs. */
  providerId: string | null
  aliases: OrganizationAlias[]
  siteUrl: string | null
  isAnimationStudio: boolean | null
}

export interface MediaAgeRating {
  /** ISO alpha-2-like region code, GLOBAL, or null when unspecified. */
  region: string | null
  /** Rating scheme such as BBFC, MPAA, or PEGI. */
  system: string | null
  /** Display value from that scheme; never inferred from minimumAge. */
  rating: string
  minimumAge: number | null
  source: string | null
}

export interface ProviderScore {
  /** Provider's original score value before normalization. */
  value: number
  /** Provider's declared maximum score scale. */
  scale: number
  /** Normalized percentage on a 0–100 scale. */
  normalized: number
  source: string | null
}

export type FieldValueState = 'known' | 'unknown' | 'unannounced' | 'not_applicable'

export interface FieldObservation {
  source: string
  value: unknown
  /** Explicit value state reported by the provider; inferred when absent. */
  valueState: FieldValueState
  lastRefreshedAt: string | null
}

/** A manual correction applied to a canonical field value. Provider
 * observations are preserved untouched so the original source data can be
 * restored or compared later. */
export interface FieldManualCorrection {
  /** The manually corrected canonical value. */
  value: unknown
  /** Who or what applied the correction (for example a user id or 'user'). */
  correctedBy: string
  /** ISO timestamp when the correction was applied. */
  correctedAt: string
  /** Optional free-text reason for the correction. */
  reason?: string
}

/** Entity types used to select a metadata refresh policy. Matches the
 * normalized `format` values a catalog record can carry. */
export type EntityType = 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special' | 'Other'

/** Refresh categories group catalog fields with similar staleness tolerance. */
export type RefreshCategory = 'identity' | 'airing' | 'score' | 'descriptive' | 'links'

/** Result of a freshness check for a single field. */
export type FieldFreshness = 'fresh' | 'stale' | 'never_refreshed' | 'unknown'

/** Metadata refresh policy for one category of fields on one entity type. */
export interface RefreshPolicyEntry {
  /** Maximum age in milliseconds before the field is considered stale. */
  maxAgeMs: number
  /** Refresh category this field belongs to. */
  category: RefreshCategory
}

/** Overall refresh assessment for a catalog record. */
export interface RecordRefreshStatus {
  /** Whether any field is stale or never refreshed. */
  needsRefresh: boolean
  /** Fields whose data is stale or was never refreshed. */
  staleFields: string[]
  /** Per-field freshness assessment. */
  freshness: Record<string, FieldFreshness>
}

/** Per-provider quota: maximum requests allowed within a sliding time window. */
export interface ProviderQuota {
  maxRequests: number
  windowMs: number
}

/** Exponential backoff configuration. */
export interface BackoffConfig {
  initialMs: number
  maxMs: number
  multiplier: number
}

/** Result of checking whether a provider request may proceed. */
export interface ProviderQuotaCheck {
  ok: boolean
  reason: 'ok' | 'quota_exceeded' | 'cooling_down'
  retryAfterMs: number
}

/** Current status of a provider. */
export type ProviderRateStatus = 'ok' | 'quota_exceeded' | 'cooling_down' | 'unknown'

/** Quota usage info for a provider. */
export interface ProviderQuotaInfo {
  used: number
  maxRequests: number
  windowMs: number
  resetAt: number
}

export interface FieldMetadata {
  /** State of the canonical field value: known, unknown, unannounced, or not_applicable. */
  valueState: FieldValueState
  /** Source of the currently selected canonical field value. */
  source: string | null
  lastRefreshedAt: string | null
  observations: FieldObservation[]
  conflict: boolean
  /** Manual correction applied to the canonical value. Provider observations
   * are preserved untouched so the original source data can be restored or
   * compared later. */
  manualCorrection?: FieldManualCorrection
}

export interface Media {
  id: number
  /** Present on canonical metadata responses; older filtered/bookmark records may omit it. */
  fieldMetadata?: Record<string, FieldMetadata>
  title: string
  romaji: string | null
  english: string | null
  native: string | null
  cover: string | null
  banner: string | null
  /** Artwork variants with source, dimensions, and attribution metadata. */
  artwork?: ArtworkVariant[]
  color: string | null
  description: string
  episodes: number | null
  airedEpisodes: number
  /** Typical episode runtime in positive whole minutes. */
  duration: number | null
  status: string
  format: string | null
  season: MediaSeason | null
  seasonYear: number | null
  /** Partial provider-supplied FuzzyDates; absent on legacy records. */
  startDate?: MediaDate | null
  endDate?: MediaDate | null
  /** ISO 3166-1 alpha-2 country code; absent on legacy records. */
  countryOfOrigin?: string | null
  /** Canonical BCP-47 language tag; absent when the provider does not supply it. */
  originalLanguage?: string | null
  /** Region-specific age classifications; absent on legacy media records. */
  ageRatings?: MediaAgeRating[]
  /** Normalized percentage on a 0–100 scale; null when unavailable. */
  score: number | null
  /** Original value and scale for each known provider score; absent on legacy records. */
  providerScores?: ProviderScore[]
  popularity: number
  /** Original provider labels retained for display and existing filters. */
  genres: string[]
  /** Stable internal taxonomy entities; absent on filtered legacy records. */
  genreEntities?: GenreEntity[]
  tags?: MediaTag[]
  /** Next episode air time as a whole Unix timestamp in seconds. */
  nextEpisode: { episode: number; airingAt: number } | null
  /** Linked production/rights entities; absent on legacy records. */
  organizations?: OrganizationEntity[]
  /** Original studio labels retained for display and existing filters. */
  studios: string[]
  links: MediaLink[]
  streams: MediaLink[]
  anidb: string | null
  anidbSearch: boolean
  siteUrl: string | null
  /** Metadata schema version applied when the record was created or last migrated. */
  metadataSchemaVersion?: number
  /** Derived metadata completeness score (0-100); absent on legacy records. */
  completenessScore?: MetadataCompletenessScore
}

/** Metadata completeness score for a catalog entry, 0 (empty) to 100 (complete). */
export type MetadataCompletenessScore = number

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
  startDate: MediaDate | null
  cover: string | null
  averageScore: number | null
  relationType: string
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
  startDate?: MediaDate | null
  endDate?: MediaDate | null
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
  overview?: string
  hasSpoilers?: boolean
  sections?: DetailSection[]
  characters?: CharacterEntry[]
  staff?: StaffEntry[]
  /** Server-computed freshness assessment for each metadata field. */
  refreshStatus?: RecordRefreshStatus
}

export interface AnimeNote {
  mediaId: number
  note: string
  updatedAt: number | null
}

export interface Bookmark {
  mediaId: number
  addedAt: number
  media: Media
}

export interface AppSettings {
  quality: string
  dub: boolean
  resultIndex: number
  libraryDir: string
  libraryDirLocked: boolean
  maxConcurrentDownloads: number
  preferLocalPlayback: boolean
  allowedExternalHosts: string[]
  envExternalHostsConfigured: boolean
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

/** A single artwork variant with its source, dimensions, and attribution. */
export interface ArtworkVariant {
  /** Where the artwork originated: 'anilist', 'imdb', 'local', etc. */
  source: string
  /** Public https URL of the artwork image. */
  url: string
  /** Semantic kind of the artwork. */
  kind: 'poster' | 'banner' | 'icon' | 'still' | 'logo'
  /** Intrinsic width in pixels, when known. */
  width: number | null
  /** Intrinsic height in pixels, when known. */
  height: number | null
  /** Provider attribution / credit text, when known. */
  attribution: string | null
}

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
