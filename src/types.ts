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

export interface MediaDetail extends Media {
  streamingEpisodes: StreamingEpisode[]
}

export interface Bookmark {
  mediaId: number
  addedAt: number
  media: Media
}

export type DownloadProvider = 'anicli' | 'template'

export interface AppSettings {
  downloadProvider: DownloadProvider
  sourceTemplate: string
  anicliBin: string
  anicliQuality: string
  anicliDub: boolean
  anicliResultIndex: number
  updatedAt: number
  libraryDir: string
}

export interface AniCliSearchResult {
  index: number
  slug: string
  title: string
}

export interface AniCliMatch {
  mediaId: number
  query: string
  index: number
  title: string
  updatedAt: number
}

export interface AniCliStatus {
  available: boolean
  installed: boolean
  bin: string
  path: string | null
  version: string | null
  curl: boolean
  menu: boolean
  downloader: 'yt-dlp' | 'ffmpeg' | null
  error: string | null
}

export interface BulkDownloadResult {
  created: Job[]
  errors: { episode: number; error: string }[]
}

export type JobStatus = 'queued' | 'downloading' | 'completed' | 'error' | 'canceled'

export interface Job {
  id: string
  provider?: 'anicli' | 'http'
  mediaId: number | null
  title: string
  episode: number | null
  url: string
  query?: string | null
  resultIndex?: number | null
  quality?: string | null
  dub?: boolean
  filename: string
  path: string
  received: number
  total: number
  speed: number
  progress?: number | null
  status: JobStatus
  error: string | null
  contentType: string
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

export interface LibraryEntry {
  id: string
  mediaId: number | null
  title: string
  episode: number | null
  filename: string
  path: string
  relPath?: string
  size: number
  finishedAt: number | null
  contentType: string
  tracked: boolean
  provider?: 'anicli' | 'http' | 'file'
}
