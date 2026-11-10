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

export type PlayerTarget = 'mpv' | 'app'

export interface AppSettings {
  anicliBin: string
  anicliQuality: string
  anicliDub: boolean
  anicliResultIndex: number
  playerTarget: PlayerTarget
  updatedAt: number
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
  mpv: boolean
  ffmpeg: boolean
  error: string | null
}

export interface WatchResult {
  launched: boolean
  bin: string
  args: string[]
  pid: number | null
}
