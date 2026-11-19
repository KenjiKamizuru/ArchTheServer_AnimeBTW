export type MediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'

export interface MediaLink {
  site: string
  url: string
}

export interface Media {
  id: number
  title: string
  romaji: string | null
  english: string | null
  native: string | null
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
  score: number | null
  popularity: number
  genres: string[]
  nextEpisode: { episode: number; airingAt: number } | null
  studios: string[]
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
  startDate?: { year: number | null; month: number | null; day: number | null } | null
  endDate?: { year: number | null; month: number | null; day: number | null } | null
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
  durationSec?: number | null
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
