// Official metadata client.
//
// Everything here comes from AniList's public GraphQL API (https://anilist.co),
// which is the canonical seasonal database used by most anime trackers. Each
// entry carries its own AniDB / official-site / legal-stream links, which the UI
// surfaces as metadata references.

import { readResponseTextLimited, sanitizeCoverUrl, sanitizePublicHttpUrl } from './security.mjs'

const ENDPOINT = 'https://graphql.anilist.co'
const MAX_GQL_BYTES = 6 * 1024 * 1024
const TTL = 10 * 60 * 1000
const MAX_ENTRIES = 300

const cache = new Map()

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  description(asHtml: false)
  episodes
  duration
  status
  format
  season
  seasonYear
  averageScore
  popularity
  genres
  siteUrl
  nextAiringEpisode { episode airingAt }
  studios(isMain: true) { nodes { name } }
  externalLinks { site url type }
`

const SEASON_SORTS = {
  popular: 'POPULARITY_DESC',
  trending: 'TRENDING_DESC',
  rated: 'SCORE_DESC',
  newest: 'START_DATE_DESC',
}

const STREAM_SITES = new Set([
  'Crunchyroll',
  'Netflix',
  'Hulu',
  'Amazon Prime Video',
  'Disney Plus',
  'HIDIVE',
  'Bilibili TV',
  'iQ',
  'YouTube',
  'Muse Asia',
  'Anime Onegai',
  'Retrocrush',
  'Tubi TV',
  'Viz Media',
  'Aniplus TV',
  'Bahamut Anime Crazy',
  'Laftel',
  'Funimation',
  'Anime Digital Network',
  'Wakanim',
  'ADN',
  'Bilibili',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function gql(query, variables) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel?.().catch(() => {})
        lastError = new Error(`AniList responded ${res.status}`)
        await sleep(500 * (attempt + 1))
        continue
      }
      if (!res.ok) {
        await res.body?.cancel?.().catch(() => {})
        throw new Error(`AniList responded ${res.status}`)
      }
      const json = JSON.parse(await readResponseTextLimited(res, MAX_GQL_BYTES, 'AniList response'))
      if (json.errors?.length) throw new Error(json.errors[0].message)
      if (!json.data) throw new Error('AniList returned no data')
      return json.data
    } catch (err) {
      lastError = err
      if (attempt < 2) await sleep(400 * (attempt + 1))
    }
  }
  throw lastError ?? new Error('Metadata request failed')
}

/** TTL + LRU cache so repeat views are instant and we stay far under rate limits. */
async function cached(key, loader, { fresh = false } = {}) {
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < TTL) {
    cache.delete(key)
    cache.set(key, hit)
    return hit.value
  }
  try {
    const value = await loader()
    cache.set(key, { at: Date.now(), value })
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
    return value
  } catch (err) {
    // Stale data beats an error page.
    if (hit) return hit.value
    throw err
  }
}

function plainText(value) {
  if (!value) return ''
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function airedEpisodes(media) {
  if (media.nextAiringEpisode?.episode) return Math.max(0, media.nextAiringEpisode.episode - 1)
  if (media.status === 'RELEASING' && !media.episodes) return 0
  return media.episodes ?? 0
}

function normalize(media) {
  if (!media) return null
  const links = (media.externalLinks ?? [])
    .map((l) => {
      const safeUrl = l?.url ? sanitizePublicHttpUrl(l.url, { httpsOnly: false, maxLen: 512 }) : null
      return safeUrl && l?.site ? { site: String(l.site).slice(0, 80), url: safeUrl, type: l.type } : null
    })
    .filter(Boolean)
  const title = media.title?.english || media.title?.romaji || media.title?.native || `Anime #${media.id}`
  const streams = links
    .filter((l) => l.type === 'STREAMING' || STREAM_SITES.has(l.site))
    .map((l) => ({ site: l.site, url: l.url }))

  // AniList only carries a direct AniDB link for some titles; otherwise deep-link
  // to AniDB's own search so every entry still resolves on AniDB.
  const directAnidb = links.find((l) => /anidb/i.test(l.site ?? '') || /anidb\.net/i.test(l.url))?.url ?? null
  const anidb = directAnidb ?? `https://anidb.net/search/anime?adb.search=${encodeURIComponent(title)}`
  const rawColor = typeof media.coverImage?.color === 'string' ? media.coverImage.color.trim() : ''
  const color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : null

  return {
    id: media.id,
    title,
    romaji: media.title?.romaji ?? null,
    english: media.title?.english ?? null,
    native: media.title?.native ?? null,
    cover: sanitizeCoverUrl(media.coverImage?.extraLarge ?? media.coverImage?.large ?? null),
    banner: sanitizeCoverUrl(media.bannerImage ?? null),
    color,
    description: plainText(media.description),
    episodes: media.episodes ?? null,
    airedEpisodes: airedEpisodes(media),
    duration: media.duration ?? null,
    status: media.status ?? 'UNKNOWN',
    format: media.format ?? null,
    season: media.season ?? null,
    seasonYear: media.seasonYear ?? null,
    score: media.averageScore ?? null,
    popularity: media.popularity ?? 0,
    genres: media.genres ?? [],
    nextEpisode: media.nextAiringEpisode
      ? { episode: media.nextAiringEpisode.episode, airingAt: media.nextAiringEpisode.airingAt }
      : null,
    studios: (media.studios?.nodes ?? []).map((n) => n.name).filter(Boolean),
    links: links.map((l) => ({ site: l.site, url: l.url })),
    streams,
    anidb,
    anidbSearch: !directAnidb,
    siteUrl: sanitizePublicHttpUrl(media.siteUrl, { httpsOnly: false, maxLen: 512 }),
  }
}

export function currentSeason(date = new Date()) {
  const month = date.getMonth() // 0-11
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL'
  return { season, year: date.getFullYear() }
}

export function resolveSeason(seasonParam, yearParam) {
  const fallback = currentSeason()
  const season = ['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(String(seasonParam).toUpperCase())
    ? String(seasonParam).toUpperCase()
    : fallback.season
  const parsedYear = Number(yearParam)
  const year =
    Number.isFinite(parsedYear) && parsedYear > 1940 && parsedYear <= fallback.year + 5
      ? Math.floor(parsedYear)
      : fallback.year
  return { season, year }
}

export function resolveSort(sortParam) {
  return typeof sortParam === 'string' && Object.hasOwn(SEASON_SORTS, sortParam) ? sortParam : 'popular'
}

export async function getSeason({ season, year, sort = 'popular', page = 1, perPage = 30 }) {
  const sortKey = resolveSort(sort)
  const key = `season:${season}:${year}:${sortKey}:${page}:${perPage}`
  return cached(key, async () => {
    const data = await gql(
      `query ($page: Int, $perPage: Int, $season: MediaSeason, $year: Int, $sort: [MediaSort]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage total }
          media(season: $season, seasonYear: $year, type: ANIME, sort: $sort, isAdult: false) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { page, perPage, season, year, sort: [SEASON_SORTS[sortKey]] },
    )
    const page_ = data.Page
    return {
      hasNextPage: Boolean(page_.pageInfo?.hasNextPage),
      total: page_.pageInfo?.total ?? 0,
      media: (page_.media ?? []).map(normalize).filter(Boolean),
    }
  })
}

/** Shows still releasing, sorted by their next broadcast (soonest first). */
export async function getAiring({ page = 1, perPage = 50 } = {}) {
  const key = `airing:${page}:${perPage}`
  return cached(key, async () => {
    const data = await gql(
      `query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          media(status: RELEASING, type: ANIME, sort: [POPULARITY_DESC], isAdult: false) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { page, perPage },
    )
    const media = (data.Page.media ?? []).map(normalize).filter(Boolean)
    media.sort((a, b) => (a.nextEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER) - (b.nextEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER))
    return { media, hasNextPage: Boolean(data.Page.pageInfo?.hasNextPage) }
  })
}

export async function searchAnime(term, page = 1) {
  const q = String(term ?? '').trim()
  if (!q) return { media: [], hasNextPage: false }
  const key = `search:${q.toLowerCase()}:${page}`
  return cached(key, async () => {
    const data = await gql(
      `query ($page: Int, $search: String) {
        Page(page: $page, perPage: 40) {
          pageInfo { hasNextPage }
          media(search: $search, type: ANIME, sort: [POPULARITY_DESC], isAdult: false) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { page, search: q },
    )
    return {
      media: (data.Page.media ?? []).map(normalize).filter(Boolean),
      hasNextPage: Boolean(data.Page.pageInfo?.hasNextPage),
    }
  })
}

export async function getDetail(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw Object.assign(new Error('Invalid anime id'), { status: 400 })
  }
  const key = `detail:${numeric}`
  return cached(key, async () => {
    const data = await gql(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
          trailer { id site }
          streamingEpisodes { title thumbnail url site }
          relations {
            edges {
              relationType
              node {
                id
                type
                format
                status
                episodes
                season
                seasonYear
                title { romaji english native }
                coverImage { large }
                nextAiringEpisode { episode airingAt }
              }
            }
          }
        }
      }`,
      { id: numeric },
    )
    const base = normalize(data.Media)
    const seasonOrder = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 }
    const relatedSeasons = (data.Media.relations?.edges ?? [])
      .filter(
        (edge) =>
          edge?.node?.type === 'ANIME' &&
          (edge.relationType === 'PREQUEL' || edge.relationType === 'SEQUEL') &&
          edge.node.status !== 'NOT_YET_RELEASED',
      )
      .map((edge) => {
        const node = edge.node
        const title = node.title?.english || node.title?.romaji || node.title?.native || `Anime #${node.id}`
        return {
          id: node.id,
          relationType: edge.relationType,
          title,
          romaji: node.title?.romaji ?? null,
          format: node.format ?? null,
          status: node.status ?? 'UNKNOWN',
          episodes: node.episodes ?? null,
          airedEpisodes: airedEpisodes(node),
          season: node.season ?? null,
          seasonYear: node.seasonYear ?? null,
          cover: sanitizeCoverUrl(node.coverImage?.large ?? null),
        }
      })
      .sort(
        (a, b) =>
          (a.seasonYear ?? 9999) - (b.seasonYear ?? 9999) ||
          (seasonOrder[a.season] ?? 9) - (seasonOrder[b.season] ?? 9) ||
          a.id - b.id,
      )
    return {
      ...base,
      streamingEpisodes: (data.Media.streamingEpisodes ?? [])
        .map((e) => {
          const safeUrl = e?.url ? sanitizePublicHttpUrl(e.url, { httpsOnly: false, maxLen: 512 }) : null
          if (!safeUrl || !e?.site) return null
          return {
            title: String(e.title ?? '').slice(0, 200),
            thumbnail: sanitizeCoverUrl(e.thumbnail ?? null),
            url: safeUrl,
            site: String(e.site).slice(0, 80),
          }
        })
        .filter(Boolean),
      relatedSeasons,
    }
  })
}

/** Batch lookup (no synopsis/trailer) — used to decorate local library files. */
export async function getMany(ids) {
  const list = [...new Set((ids ?? []).map(Number))].filter((n) => Number.isInteger(n) && n > 0).slice(0, 60)
  if (!list.length) return []
  const key = `many:${list.join(',')}`
  return cached(key, async () => {
    const data = await gql(
      `query ($ids: [Int]) {
        Page(page: 1, perPage: 50) {
          media(id_in: $ids, type: ANIME) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { ids: list },
    )
    return (data.Page.media ?? []).map(normalize).filter(Boolean)
  })
}
