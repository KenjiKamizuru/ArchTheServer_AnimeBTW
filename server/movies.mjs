import * as imdb from './imdb.mjs'
import * as cache from './cache.mjs'
import { readResponseTextLimited, safeFetch } from './security.mjs'

const SERIES_META_TTL_MS = 15 * 60_000
const MAX_META_BYTES = 8 * 1024 * 1024

function normalizeKind(rawType) {
  const t = String(rawType ?? '').toLowerCase()
  if (t.includes('series') || t === 'tvseries' || t === 'tvminiseries' || t === 'tv') {
    return 'series'
  }
  return 'movie'
}

export async function searchMoviesAndSeries(query) {
  const q = String(query ?? '').trim()
  if (!q) return []
  const raw = await imdb.searchTitles(q)
  return (Array.isArray(raw) ? raw : [])
    .filter((item) => item && item.imdbId)
    .map((item) => {
      const kind = normalizeKind(item.type)
      return {
        imdbId: item.imdbId,
        title: item.title || item.imdbId,
        year: item.year ?? null,
        kind,
        typeLabel: kind === 'series' ? 'TV Series' : 'Movie',
        poster: item.poster || null,
        actors: item.actors || null,
      }
    })
}

export async function getMovieOrSeriesDetails(rawImdbId) {
  const imdbId = imdb.parseImdbId(rawImdbId)
  if (!imdbId) {
    const err = new Error('Invalid IMDb ID')
    err.status = 400
    throw err
  }

  const info = await imdb.lookupTitle(imdbId)
  if (!info) {
    const err = new Error(`Title ${imdbId} not found`)
    err.status = 404
    throw err
  }

  const kind = normalizeKind(info.type)
  let seasons = []

  if (kind === 'series') {
    seasons = await fetchSeriesSeasons(imdbId)
  }

  return {
    imdbId,
    title: info.title || imdbId,
    year: info.year ?? null,
    kind,
    typeLabel: kind === 'series' ? 'TV Series' : 'Movie',
    poster: info.poster || null,
    backdrop: info.backdrop || null,
    plot: info.plot || null,
    genres: Array.isArray(info.genres) ? info.genres : [],
    rating: info.rating ?? null,
    seasons,
  }
}

async function fetchSeriesSeasons(imdbId) {
  const cacheKey = `movies:seasons:${imdbId}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  try {
    const { response } = await safeFetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      requireApprovedHost: false,
    })
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {})
      return []
    }
    const text = await readResponseTextLimited(response, MAX_META_BYTES, 'Cinemeta series metadata')
    const data = JSON.parse(text)
    const videos = Array.isArray(data?.meta?.videos) ? data.meta.videos : []

    const bySeason = new Map()
    for (const v of videos) {
      const seasonNum = Number(v.season)
      const episodeNum = Number(v.episode ?? v.number)
      if (!Number.isInteger(seasonNum) || seasonNum < 0) continue
      if (!Number.isInteger(episodeNum) || episodeNum < 1) continue
      if (!bySeason.has(seasonNum)) bySeason.set(seasonNum, [])
      bySeason.get(seasonNum).push({
        season: seasonNum,
        episode: episodeNum,
        title: String(v.title || v.name || `Episode ${episodeNum}`),
        overview: v.overview ? String(v.overview) : null,
      })
    }

    const seasons = [...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, episodes]) => ({
        season,
        episodes: episodes.sort((a, b) => a.episode - b.episode),
      }))

    cache.set(cacheKey, seasons, SERIES_META_TTL_MS)
    return seasons
  } catch {
    return []
  }
}

export function buildVidsrcEmbedUrl({ imdbId, kind, season = 1, episode = 1 }) {
  const cleanId = imdb.parseImdbId(imdbId)
  if (!cleanId) {
    const err = new Error('Valid IMDb ID (tt...) is required')
    err.status = 400
    throw err
  }
  const normalizedKind = kind === 'series' ? 'series' : 'movie'
  if (normalizedKind === 'series') {
    const s = Math.max(1, Math.floor(Number(season) || 1))
    const e = Math.max(1, Math.floor(Number(episode) || 1))
    return {
      provider: 'vidsrc',
      imdbId: cleanId,
      kind: 'series',
      season: s,
      episode: e,
      embedUrl: `https://vidsrc.sh/embed/tv?imdb=${encodeURIComponent(cleanId)}&season=${s}&episode=${e}`,
    }
  }
  return {
    provider: 'vidsrc',
    imdbId: cleanId,
    kind: 'movie',
    season: null,
    episode: null,
    embedUrl: `https://vidsrc.sh/embed/movie?imdb=${encodeURIComponent(cleanId)}`,
  }
}
