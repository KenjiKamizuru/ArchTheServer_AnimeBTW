// Official metadata client.
//
// Everything here comes from AniList's public GraphQL API (https://anilist.co),
// which is the canonical seasonal database used by most anime trackers. Each
// entry carries its own AniDB / official-site / legal-stream links, which the UI
// surfaces as metadata references.

import { readResponseTextLimited, sanitizeCoverUrl, sanitizePublicHttpUrl } from './security.mjs'
import { parseBrowseFilters } from './browse.mjs'
import { createAnimeRecord } from './catalog.mjs'
import { remember } from './identifiers.mjs'
import { rateLimiter } from './rateLimit.mjs'
import { cachedImmutable, cachedAiring } from './metadataCache.mjs'

const ENDPOINT = 'https://graphql.anilist.co'
const MAX_GQL_BYTES = 6 * 1024 * 1024

const MEDIA_FIELDS = `
  id
  idMal
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
  startDate { year month day }
  endDate { year month day }
  averageScore
  popularity
  favourites
  genres
  tags { name rank isMediaSpoiler }
  source
  countryOfOrigin
  siteUrl
  nextAiringEpisode { episode airingAt }
  studios(isMain: true) { nodes { id name isAnimationStudio siteUrl } }
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
      // Enforce the per-provider quota and backoff cooldown before calling
      // upstream. A rate-limited provider is surfaced as a 503 so callers can
      // distinguish it from a hard outage.
      const proceed = rateLimiter.canProceed('anilist')
      if (!proceed.ok) {
        const error = new Error(
          `AniList rate limit ${proceed.reason}; retry after ${Math.round(proceed.retryAfterMs / 1000)}s`,
        )
        error.status = 503
        error.code = 'PROVIDER_RATE_LIMITED'
        error.retryable = false
        error.retryAfterMs = proceed.retryAfterMs
        throw error
      }
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // Identify this public API client rather than relying on a generic
          // Node runtime UA (some upstream protections reject anonymous clients).
          'User-Agent': 'AnimeVault/1.0 (+https://github.com/KenjiKamizuru/ArchTheServer_AnimeBTW)',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel?.().catch(() => {})
        // Apply exponential backoff and mark the provider as cooling down so
        // subsequent callers back off too.
        const backoffMs = rateLimiter.recordFailure('anilist', res.status)
        lastError = new Error(`AniList responded ${res.status}`)
        await sleep(Math.max(backoffMs, 500 * (attempt + 1)))
        continue
      }
      if (!res.ok) {
        const responseText = await readResponseTextLimited(res, 16 * 1024, 'AniList error response').catch(() => '')
        let upstreamMessage = ''
        try {
          upstreamMessage = JSON.parse(responseText)?.errors?.[0]?.message ?? ''
        } catch {
          // Keep a status-only diagnostic for non-JSON upstream responses.
        }
        const error = new Error(`AniList responded ${res.status}${upstreamMessage ? `: ${upstreamMessage}` : ''}`)
        error.retryable = res.status === 429 || res.status >= 500
        throw error
      }
      const json = JSON.parse(await readResponseTextLimited(res, MAX_GQL_BYTES, 'AniList response'))
      if (json.errors?.length) {
        const error = new Error(`AniList GraphQL error: ${String(json.errors[0].message ?? 'unknown error').slice(0, 240)}`)
        error.retryable = false
        throw error
      }
      if (!json.data) {
        const error = new Error('AniList returned no data')
        error.retryable = false
        throw error
      }
      rateLimiter.recordSuccess('anilist')
      return json.data
    } catch (err) {
      lastError = err
      // Network-level failures (no HTTP status) are retryable: back off the
      // provider so the next caller isn't immediately hammered again.
      if (err?.status === undefined && err?.retryable !== false) {
        rateLimiter.recordFailure('anilist', undefined)
      }
      if (err?.retryable === false) break
      if (attempt < 2) await sleep(400 * (attempt + 1))
    }
  }
  // Keep the upstream cause in server logs for diagnosis while returning a
  // stable message to clients (which distinguishes an outage from a bad route).
  const failure = new Error(
    'Anime metadata service is unreachable right now. Please try again shortly.',
    lastError instanceof Error ? { cause: lastError } : undefined,
  )
  failure.status = 502
  failure.code = 'UPSTREAM_UNAVAILABLE'
  failure.upstreamSafe = true
  throw failure
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

/** Pulls the numeric AniDB id out of a direct AniDB link when present. */
export function anidbIdFromUrl(raw) {
  const match = String(raw ?? '').match(/anidb\.net\/(?:anime|adb\.anime)\/(\d+)/i)
  return match ? match[1] : null
}

/** Provider identifiers extracted from an AniList payload (AV-002). */
export function extractExternalIds(media) {
  if (!media || !Number.isSafeInteger(media.id)) return {}
  const links = Array.isArray(media.externalLinks) ? media.externalLinks : []
  const directAnidb = links.find((l) => /anidb/i.test(l?.site ?? '') || /anidb\.net/i.test(l?.url ?? ''))?.url ?? null
  const anidbId = anidbIdFromUrl(directAnidb)
  return {
    anilist: String(media.id),
    ...(Number.isFinite(media.idMal) && media.idMal > 0 ? { mal: String(media.idMal) } : {}),
    ...(anidbId ? { anidb: anidbId } : {}),
  }
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
  const studioNodes = Array.isArray(media.studios?.nodes) ? media.studios.nodes : []

  const externalIds = extractExternalIds(media)
  // Provider IDs are persisted separately from the canonical catalog record.
  // Registration is non-fatal: malformed IDs must not break browsing (AV-002/022).
  remember({ id: media.id, externalIds })

  return createAnimeRecord({
    id: media.id,
    metadataSource: 'anilist',
    lastRefreshedAt: new Date().toISOString(),
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
    durationUnit: 'minutes',
    status: media.status ?? 'UNKNOWN',
    format: media.format ?? null,
    season: media.season ?? null,
    seasonYear: media.seasonYear ?? null,
    startDate: media.startDate ?? null,
    endDate: media.endDate ?? null,
    // AniList's `averageScore` is already a percentage on a 0–100 scale.
    score: media.averageScore ?? null,
    scoreScale: 100,
    popularity: media.popularity ?? 0,
    favourites: media.favourites ?? null,
    genres: media.genres ?? [],
    // Rank-sorted, spoiler-flagged tags drive tag search and discovery filters.
    tags: (media.tags ?? [])
      .filter((tag) => tag && typeof tag.name === 'string')
      .map((tag) => ({
        name: tag.name.slice(0, 60),
        rank: Number.isFinite(tag.rank) ? tag.rank : 0,
        isMediaSpoiler: Boolean(tag.isMediaSpoiler),
      })),
    source: media.source ?? null,
    countryOfOrigin: media.countryOfOrigin ?? null,
    nextEpisode: media.nextAiringEpisode
      ? { episode: media.nextAiringEpisode.episode, airingAt: media.nextAiringEpisode.airingAt }
      : null,
    studios: studioNodes
      .map((studio) => studio?.name)
      .filter((name) => typeof name === 'string' && name.length > 0),
    organizations: studioNodes.map((studio) => ({
      kind: 'studio',
      name: studio?.name,
      source: 'anilist',
      providerId: studio?.id,
      siteUrl: studio?.siteUrl,
      isAnimationStudio: studio?.isAnimationStudio,
    })),
    links: links.map((l) => ({ site: l.site, url: l.url })),
    streams,
    anidb,
    anidbSearch: !directAnidb,
    siteUrl: sanitizePublicHttpUrl(media.siteUrl, { httpsOnly: false, maxLen: 512 }),
  })
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
  return cachedImmutable(key, async () => {
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
/**
 * Executes a browse query built by `browse.mjs` and applies the filters AniList
 * cannot express locally. Returns per-item match reasons so the UI can explain
 * results.
 */
export async function browse(filters, browseModule) {
  const { query, variables } = browseModule.buildBrowseQuery(filters)
  const key = `browse:${JSON.stringify(variables)}`
  return cachedImmutable(key, async () => {
    const data = await gql(query, variables)
    const pageInfo = data.Page?.pageInfo ?? {}
    const raw = data.Page?.media ?? []
    const matched = []
    const rejected = []
    for (const entry of raw) {
      const media = normalize(entry)
      if (!media) continue
      const verdict = browseModule.matchMediaLocally(media, filters)
      if (verdict.ok) {
        media.matchReasons = verdict.reasons
        matched.push(media)
      } else {
        rejected.push(media.id)
      }
    }
    return {
      media: matched,
      rejectedCount: rejected.length,
      total: pageInfo.total ?? 0,
      hasNextPage: Boolean(pageInfo.hasNextPage),
      page: filters.page,
      perPage: filters.perPage,
      filters: browseModule.describeFilters(filters),
      params: browseModule.filtersToParams(filters).toString(),
    }
  })
}

/**
 * Discovery picks: a deterministic "spotlight" for the day, a random pick with
 * optional filter awareness, and a hidden-gems collection.
 */
/** Deterministic index for the rotating daily spotlight (AV-040). */
export function dailyPickIndex(length, now = Date.now()) {
  if (!Number.isSafeInteger(length) || length <= 0) return -1
  return Math.floor(now / 86_400_000) % length
}

export async function discover(kind, filters, browseModule) {
  if (kind === 'random') {
    // Random page within a bounded depth keeps the request cheap while still
    // feeling unpredictable.
    const page = 1 + Math.floor(Math.random() * 12)
    const result = await browse({ ...filters, page, perPage: 50 }, browseModule)
    if (result.media.length === 0) return { kind, media: null, page }
    const pick = result.media[Math.floor(Math.random() * result.media.length)]
    return { kind, media: pick, page }
  }

  if (kind === 'spotlight') {
    const result = await browse({ ...filters, page: 1, perPage: 50, sort: 'popular' }, browseModule)
    if (result.media.length === 0) return { kind, media: null }
    // Stable per-day index: same pick all day, changes at midnight.
    return { kind, media: result.media[dailyPickIndex(result.media.length)] }
  }

  if (kind === 'hidden-gems') {
    const gems = await browse(
      {
        ...filters,
        // Low popularity + strong rating is the classic hidden-gem signal.
        maxPopularity: filters.maxPopularity ?? 25_000,
        minScore: Math.max(filters.minScore ?? 0, 72),
        sort: 'rated',
        page: 1,
        perPage: 30,
      },
      browseModule,
    )
    return { kind, items: gems.media, total: gems.total }
  }

  throw Object.assign(new Error('Unknown discovery kind'), { status: 400 })
}

/**
 * Studio search/listing for the studio explorer. Sorted by favourites so the
 * landing page opens on recognisable names.
 */
export async function studios({ page = 1, search = '', sort = '' } = {}) {
  const allowed = new Set(['favourites', 'name'])
  const studioSort = allowed.has(sort) ? sort : 'favourites'
  const key = `studios:${page}:${search}:${studioSort}`
  return cachedImmutable(key, async () => {
    const data = await gql(
      `query Studios($page: Int, $perPage: Int, $search: String, $sort: [StudioSort]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage total }
          studios(search: $search, sort: $sort) {
            id
            name
            isAnimationStudio
            favourites
            siteUrl
          }
        }
      }`,
      {
        page,
        perPage: 30,
        search: search.trim() || undefined,
        // AniList reads StudioSort values as an enum list.
        sort: studioSort === 'name' ? ['NAME'] : ['FAVOURITES_DESC'],
      },
    )
    const raw = data.Page?.studios ?? []
    const media = raw
      .map((node) =>
        node
          ? {
              id: node.id,
              name: node.name,
              isAnimationStudio: Boolean(node.isAnimationStudio),
              favourites: node.favourites ?? null,
              siteUrl: typeof node.siteUrl === 'string' && /^https:\/\//.test(node.siteUrl) ? node.siteUrl : null,
              bucket: node.name ? String(node.name).charAt(0).toUpperCase() : '#',
            }
          : null,
      )
      .filter(Boolean)
    return {
      studios: media,
      page,
      hasNextPage: Boolean(data.Page?.pageInfo?.hasNextPage),
      total: data.Page?.pageInfo?.total ?? media.length,
    }
  })
}

/** A studio's filmography, newest-first by popularity within the page. */
export async function studioFilmography(id, { page = 1, sort = 'popular' } = {}) {
  const sortEnum = {
    popular: 'POPULARITY_DESC',
    rated: 'SCORE_DESC',
    newest: 'START_DATE_DESC',
    oldest: 'START_DATE_ASC',
  }[sort] ?? 'POPULARITY_DESC'
  const key = `studio:${id}:${page}:${sortEnum}`
  return cachedImmutable(key, async () => {
    const data = await gql(
      `query Studio($id: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {
        Studio(id: $id) {
          id
          name
          isAnimationStudio
          favourites
          siteUrl
          media(page: $page, perPage: $perPage, sort: $sort, isMain: true) {
            pageInfo { hasNextPage total }
            nodes {
              ${MEDIA_FIELDS}
            }
          }
        }
      }`,
      { id, page, perPage: 24, sort: [sortEnum] },
    )
    const studio = data.Studio
    if (!studio) throw Object.assign(new Error('Studio not found'), { status: 404 })
    const media = (studio.media?.nodes ?? []).map(normalize).filter(Boolean)
    return {
      studio: {
        id: studio.id,
        name: studio.name,
        isAnimationStudio: Boolean(studio.isAnimationStudio),
        favourites: studio.favourites ?? null,
        siteUrl: typeof studio.siteUrl === 'string' && /^https:\/\//.test(studio.siteUrl) ? studio.siteUrl : null,
      },
      media,
      page,
      hasNextPage: Boolean(studio.media?.pageInfo?.hasNextPage),
      total: studio.media?.pageInfo?.total ?? media.length,
    }
  })
}

/** Catalog page used to build the A–Z index. */
export async function catalogIndex({ page = 1, sort = 'title' } = {}) {
  const sortEnum = { title: 'TITLE_ROMAJI', popular: 'POPULARITY_DESC', rated: 'SCORE_DESC' }[sort] ?? 'TITLE_ROMAJI'
  const key = `index:${page}:${sortEnum}`
  return cachedImmutable(key, async () => {
    const data = await gql(
      `query Index($page: Int, $perPage: Int, $sort: [MediaSort]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage total }
          media(type: ANIME, sort: $sort, isAdult: false) { ${MEDIA_FIELDS} }
        }
      }`,
      { page, perPage: 50, sort: [sortEnum] },
    )
    const media = (data.Page?.media ?? []).map(normalize).filter(Boolean)
    return {
      media,
      page,
      hasNextPage: Boolean(data.Page?.pageInfo?.hasNextPage),
      total: data.Page?.pageInfo?.total ?? media.length,
    }
  })
}

/** Current-season media with relations, for franchise grouping. */
export async function seasonFranchises({ season = '', year } = {}) {
  const resolved = resolveSeason(season || undefined, year)
  const key = `franchises:${resolved.season}:${resolved.year}`
  return cachedImmutable(key, async () => {
    const data = await gql(
      `query Franchises($season: MediaSeason, $seasonYear: Int, $page: Int) {
        Page(page: $page, perPage: 50) {
          media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
            ${MEDIA_FIELDS}
            relations {
              edges {
                relationType
                node { id title { romaji english } seasonYear }
              }
            }
          }
        }
      }`,
      { season: resolved.season, seasonYear: resolved.year, page: 1 },
    )
    const media = (data.Page?.media ?? [])
      .map((entry) => {
        const record = normalize(entry)
        if (!record) return null
        record.relations = (entry.relations?.edges ?? []).map((edge) => ({
          relationType: edge?.relationType,
          node: edge?.node ?? null,
        }))
        return record
      })
      .filter(Boolean)
    return { season: resolved.season, year: resolved.year, media }
  })
}

/** Newest catalog entries (highest IDs first). */
export async function recentlyAdded(limit = 24) {
  const key = `recent:added:${limit}`
  return cachedImmutable(key, async () => {
    const data = await gql(
      `query Recent($perPage: Int, $sort: [MediaSort]) {
        Page(page: 1, perPage: $perPage) {
          media(type: ANIME, sort: $sort, isAdult: false) { ${MEDIA_FIELDS} }
        }
      }`,
      { perPage: Math.min(50, Math.max(1, limit)), sort: ['ID_DESC'] },
    )
    return (data.Page?.media ?? []).map(normalize).filter(Boolean)
  })
}

/** Recently updated metadata — useful to spot refreshed artwork/synopses. */
export async function recentlyUpdated(limit = 24) {
  const key = `recent:updated:${limit}`
  return cachedImmutable(key, async () => {
    const data = await gql(
      `query Updated($perPage: Int, $sort: [MediaSort]) {
        Page(page: 1, perPage: $perPage) {
          media(type: ANIME, sort: $sort, isAdult: false) { ${MEDIA_FIELDS} }
        }
      }`,
      { perPage: Math.min(50, Math.max(1, limit)), sort: ['UPDATED_AT_DESC'] },
    )
    return (data.Page?.media ?? []).map(normalize).filter(Boolean)
  })
}

export async function getAiring({ page = 1, perPage = 50 } = {}) {
  const key = `airing:${page}:${perPage}`
  return cachedAiring(key, async () => {
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
  return cachedImmutable(key, async () => {
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

/**
 * Instant search suggestions (AV-051/053/056). Returns a small, cheap page of
 * candidate titles plus ranked + highlighted entries so the client can show a
 * dropdown without a second round trip.
 */
export async function suggest(term, searchModule) {
  const q = String(term ?? '').trim().slice(0, 80)
  if (q.length < 2) return { query: q, suggestions: [], correction: null }
  const data = await searchAnime(q, 1)
  const candidates = data.media.map((item) => ({
    id: item.id,
    label: item.title,
    sub: [item.format, item.seasonYear].filter(Boolean).join(' · '),
    cover: item.cover,
    aliases: [item.romaji, item.english].filter((t) => typeof t === 'string'),
  }))
  const ranked = searchModule.rankTitles(candidates, q, { limit: 8 })
  // Offer a correction both when nothing matched *and* when the best hit was
  // only approximate — a typo should always be visibly fixable.
  const approximate = ranked.length === 0 || !/exact title match|starts with|word match|contains your search/.test(ranked[0].reason)
  return {
    query: q,
    suggestions: ranked.map((entry) => ({
      id: entry.id,
      title: entry.label,
      sub: entry.sub,
      cover: entry.cover,
      reason: entry.reason,
      score: Number(entry.score.toFixed(2)),
      hintText: searchModule.highlightSegments(entry.label, q),
    })),
    correction: approximate ? searchModule.suggestCorrection(candidates, q) : null,
  }
}

/**
 * Full search with structured `field:value` filters applied on top of AniList's
 * title search. Filters are matched locally so a partially correct query still
 * returns something rather than an empty page.
 */
export async function searchAdvanced(rawQuery, page, searchModule) {
  const parsed = searchModule.parseSearchQuery(rawQuery)
  const { text, filters } = parsed
  const structured = searchModule.hasStructuredFilters(filters)
  if (!text && !structured) {
    return { query: rawQuery, text, filters, media: [], hasNextPage: false, removed: 0, correction: null }
  }

  // A pure filter query (no free text) still needs a candidate set: borrow the
  // popular catalog page so filters have something to act on.
  const base = text
    ? await searchAnime(text, page)
    : await browse(
        parseBrowseFilters({
          sort: 'popular',
          page: String(page),
          genres: filters.genre.join(','),
        }),
        await import('./browse.mjs'),
      )

  const kept = []
  let removed = 0
  for (const media of base.media) {
    const reasons = []
    let ok = true

    for (const studio of filters.studio) {
      const hit = (media.studios ?? []).some((name) => String(name).toLowerCase().includes(studio))
      if (!hit) ok = false
      else reasons.push(`studio ${studio}`)
    }
    if (ok) {
      for (const genre of filters.genre) {
        const hit = (media.genres ?? []).some((g) => String(g).toLowerCase() === genre)
        if (!hit) ok = false
        else reasons.push(`genre ${genre}`)
      }
    }
    if (ok) {
      for (const tag of filters.tag) {
        const hit = (media.tags ?? []).some(
          (t) => !t.isMediaSpoiler && String(t.name).toLowerCase() === tag,
        )
        if (!hit) ok = false
        else reasons.push(`tag ${tag}`)
      }
    }
    if (ok && filters.year) {
      const year = media.seasonYear
      ok = Number.isFinite(year) && year >= filters.year.min && year <= filters.year.max
      if (ok) reasons.push(`year ${year}`)
    }
    if (ok && filters.status.length) {
      const status = String(media.status ?? '').toLowerCase()
      ok = filters.status.includes(status)
      if (ok) reasons.push(status)
    }
    if (ok && filters.format.length) {
      const format = String(media.format ?? '').toLowerCase()
      ok = filters.format.includes(format)
      if (ok) reasons.push(format)
    }
    if (ok && filters.score) {
      const score = media.score
      ok =
        Number.isFinite(score) &&
        (filters.score.min === undefined || score >= filters.score.min) &&
        (filters.score.max === undefined || score <= filters.score.max)
      if (ok) reasons.push(`score ${score}`)
    }
    if (ok && filters.episodes) {
      const eps = media.episodes
      ok =
        Number.isFinite(eps) &&
        (filters.episodes.min === undefined || eps >= filters.episodes.min) &&
        (filters.episodes.max === undefined || eps <= filters.episodes.max)
      if (ok) reasons.push(`episodes ${eps}`)
    }

    if (ok) {
      kept.push({ ...media, matchReasons: reasons })
    } else {
      removed += 1
    }
  }

  const correction =
    text
      ? searchModule.suggestCorrection(
          base.media.map((m) => ({
            id: m.id,
            label: m.title,
            aliases: [m.romaji, m.english].filter((t) => typeof t === 'string'),
          })),
          text,
        )
      : null

  return {
    query: rawQuery,
    text,
    filters,
    media: kept,
    hasNextPage: Boolean(base.hasNextPage),
    removed,
    correction,
  }
}

export async function getDetail(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw Object.assign(new Error('Invalid anime id'), { status: 400 })
  }
  const key = `detail:${numeric}`
  return cachedImmutable(key, async () => {
    const data = await gql(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
          trailer { id site }
          streamingEpisodes { title thumbnail url site }
          stats { scoreDistribution { score amount } }
          rankings { rank type context year season allTime }
          characters(perPage: 12, sort: [ROLE, RELEVANCE, ID]) {
            edges {
              role
              node { id name { full native } image { large } siteUrl }
              voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                id name { full native } image { large } languageV2 siteUrl
              }
            }
          }
          staff(perPage: 10, sort: [RELEVANCE, ID]) {
            edges {
              role
              node { id name { full native } image { large } siteUrl primaryOccupations }
            }
          }
          relations {
            edges {
              relationType
              node {
                id
                type
                format
                status
                episodes
                chapters
                averageScore
                season
                seasonYear
                startDate { year month day }
                title { romaji english native }
                coverImage { large extraLarge }
                nextAiringEpisode { episode airingAt }
              }
            }
          }
        }
      }`,
      { id: numeric },
    )
    const base = normalize(data.Media)
    const relationEdges = (data.Media.relations?.edges ?? []).map((edge) => ({
      relationType: edge?.relationType,
      node: {
        ...(edge?.node ?? {}),
        coverImage: edge?.node?.coverImage ?? null,
      },
    }))
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
      // Raw graph data for the detail engine (grouping, timeline).
      rawRelations: relationEdges,
      timelineNodes: [
        {
          id: base.id,
          title: { romaji: base.romaji, english: base.english, native: base.native },
          format: base.format,
          episodes: base.episodes,
          season: base.season,
          seasonYear: base.seasonYear,
          startDate: base.startDate,
          coverImage: { large: base.cover },
        },
        ...(data.Media.relations?.edges ?? [])
          .filter((edge) => edge?.node?.type === 'ANIME')
          .map((edge) => edge.node),
      ],
      startDate: base.startDate,
      endDate: base.endDate,
      rankings: (data.Media.rankings ?? [])
        .filter((r) => r && Number.isFinite(r.rank))
        .slice(0, 8)
        .map((r) => ({
          rank: r.rank,
          type: r.type ?? 'RATED',
          context: String(r.context ?? '').slice(0, 80),
          year: r.year ?? null,
          season: r.season ?? null,
          allTime: Boolean(r.allTime),
        })),
      scoreBuckets: data.Media.stats?.scoreDistribution ?? [],
      characters: (data.Media.characters?.edges ?? [])
        .map((edge) => {
          const node = edge?.node
          if (!node?.id) return null
          return {
            id: node.id,
            name: node.name?.full || node.name?.native || `Character #${node.id}`,
            nativeName: node.name?.native ?? null,
            image: sanitizeCoverUrl(node.image?.large ?? null),
            siteUrl: sanitizePublicHttpUrl(node.siteUrl, { httpsOnly: false, maxLen: 512 }),
            role: edge.role ?? 'SUPPORTING',
            voiceActors: (edge.voiceActors ?? [])
              .filter((va) => va?.id)
              .slice(0, 3)
              .map((va) => ({
                id: va.id,
                name: va.name?.full || va.name?.native || `Staff #${va.id}`,
                image: sanitizeCoverUrl(va.image?.large ?? null),
                language: va.languageV2 ?? 'JAPANESE',
                siteUrl: sanitizePublicHttpUrl(va.siteUrl, { httpsOnly: false, maxLen: 512 }),
              })),
          }
        })
        .filter(Boolean),
      staff: (data.Media.staff?.edges ?? [])
        .map((edge) => {
          const node = edge?.node
          if (!node?.id) return null
          return {
            id: node.id,
            name: node.name?.full || node.name?.native || `Staff #${node.id}`,
            nativeName: node.name?.native ?? null,
            image: sanitizeCoverUrl(node.image?.large ?? null),
            role: String(edge.role ?? '').slice(0, 120) || null,
            occupations: (node.primaryOccupations ?? []).slice(0, 4),
            siteUrl: sanitizePublicHttpUrl(node.siteUrl, { httpsOnly: false, maxLen: 512 }),
          }
        })
        .filter(Boolean),
    }
  })
}

/** Batch lookup (no synopsis/trailer) — used to decorate local library files. */
export async function getMany(ids) {
  const list = [...new Set((ids ?? []).map(Number))].filter((n) => Number.isInteger(n) && n > 0).slice(0, 60)
  if (!list.length) return []
  const key = `many:${list.join(',')}`
  return cachedImmutable(key, async () => {
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
