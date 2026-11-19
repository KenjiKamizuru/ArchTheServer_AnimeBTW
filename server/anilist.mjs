// Official metadata client.
//
// Everything here comes from AniList's public GraphQL API (https://anilist.co),
// which is the canonical seasonal database used by most anime trackers. Each
// entry carries its own AniDB / official-site / legal-stream links, which the UI
// surfaces as metadata references.

import { readResponseTextLimited, sanitizeCoverUrl, sanitizePublicHttpUrl } from './security.mjs'
import { normalizeExternalLinks } from './links.mjs'
import { parseBrowseFilters } from './browse.mjs'
import { createAnimeRecord, normalizeExternalIds, normalizePartialDate, normalizeNameList, withFetchFailure } from './catalog.mjs'
import { describeFreshness } from './refreshPolicy.mjs'
import { createQuotaTracker } from './quota.mjs'
import { cacheTierForKey, cacheTtlFor } from './cachePolicy.mjs'

const ENDPOINT = 'https://graphql.anilist.co'
const MAX_GQL_BYTES = 6 * 1024 * 1024
const MAX_ENTRIES = 300

const cache = new Map()
// Per-provider request quota + backoff (AV-020).
const quotaTracker = createQuotaTracker()

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  synonyms
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
  broadcast { dayOfWeek time }
  averageScore
  popularity
  favourites
  genres
  tags { name rank isMediaSpoiler }
  source
  countryOfOrigin
  ageRating
  siteUrl
  nextAiringEpisode { episode airingAt }
  studios(isMain: true) { nodes { name } }
  producers: studios(isMain: false) { nodes { name } }
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
      const gate = quotaTracker.tryAcquire('anilist')
      if (!gate.allowed) {
        const err = new Error(`Metadata request quota reached; retry in ${gate.retryAfterSeconds}s.`)
        err.status = 503
        err.code = 'RATE_LIMITED'
        err.upstreamSafe = true
        throw err
      }
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel?.().catch(() => {})
        lastError = new Error(`AniList responded ${res.status}`)
        quotaTracker.recordFailure('anilist')
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
      quotaTracker.recordSuccess('anilist')
      return json.data
    } catch (err) {
      // Quota blocks surface immediately instead of burning retry sleeps.
      if (err?.code === 'RATE_LIMITED') throw err
      lastError = err
      // Only provider-health failures (network/timeouts) trigger backoff;
      // GraphQL/JSON errors are client-side problems, not upstream trouble.
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err instanceof TypeError) {
        quotaTracker.recordFailure('anilist')
      }
      if (attempt < 2) await sleep(400 * (attempt + 1))
    }
  }
  // Surface upstream trouble as a 502 so clients can distinguish "AniList is
  // down" from a bug in our own handlers (which stays a 500).
  const failure =
    lastError instanceof Error ? lastError : new Error('Metadata request failed')
  if (failure.status === undefined) failure.status = 502
  if (failure.code === undefined) failure.code = 'UPSTREAM_UNAVAILABLE'
  // Raw undici messages ("fetch failed") are useless to a viewer; the error
  // middleware sanitizes, so give it something human to pass through.
  if (!failure.upstreamSafe) {
    failure.message = 'Anime metadata service is unreachable right now. Please try again shortly.'
    failure.upstreamSafe = true
  }
  throw failure
}

/** Tiered TTL + LRU cache so repeat views are instant and we stay far under rate limits. */
async function cached(key, loader, { fresh = false } = {}) {
  const hit = cache.get(key)
  // Per-tier TTL (AV-021a): airing feeds expire in minutes, catalog metadata
  // stays cached for an hour — see server/cachePolicy.mjs.
  const ttl = cacheTtlFor(cacheTierForKey(key)) * 1000
  if (!fresh && hit && Date.now() - hit.at < ttl) {
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
  const links = normalizeExternalLinks(media.externalLinks)
  const title = media.title?.english || media.title?.romaji || media.title?.native || `Anime #${media.id}`
  const streams = links
    .filter((l) => l.type === 'STREAMING' || STREAM_SITES.has(l.site))
    .map((l) => ({ site: l.site, url: l.url }))

  // AniList only carries a direct AniDB link for some titles; otherwise deep-link
  // to AniDB's own search so every entry still resolves on AniDB.
  const directAnidb = links.find((l) => /anidb/i.test(l.site ?? '') || /anidb\.net/i.test(l.url))?.url ?? null
  const anidb = directAnidb ?? `https://anidb.net/search/anime?adb.search=${encodeURIComponent(title)}`
  // Provider identifier collection (AV-002): AniList's own id, the MyAnimeList
  // id from the schema, and any numeric AniDB id recoverable from a direct link.
  const anidbId = directAnidb?.match(/anidb\.net\/anime\/(\d+)/i)?.[1] ?? null
  const externalIds = normalizeExternalIds([
    { provider: 'anilist', id: media.id },
    ...(media.idMal ? [{ provider: 'myanimelist', id: media.idMal }] : []),
    ...(anidbId ? [{ provider: 'anidb', id: anidbId }] : []),
  ])
  // Value states (AV-014): AniList signals what is merely pending vs unknown.
  const states = {}
  if (media.episodes == null && media.status === 'NOT_YET_RELEASED') states.episodes = 'UNANNOUNCED'
  if (media.endDate == null && media.status === 'RELEASING') states.endDate = 'UNANNOUNCED'
  const rawColor = typeof media.coverImage?.color === 'string' ? media.coverImage.color.trim() : ''
  const color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : null

  return createAnimeRecord({
    id: media.id,
    externalIds,
    title,
    romaji: media.title?.romaji ?? null,
    english: media.title?.english ?? null,
    native: media.title?.native ?? null,
    synonyms: (media.synonyms ?? [])
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => t.trim().slice(0, 120)),
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
    startDate: media.startDate,
    endDate: media.endDate,
    broadcast: media.broadcast,
    ageRating: media.ageRating ?? null,
    studios: (media.studios?.nodes ?? []).map((n) => n.name).filter(Boolean),
    // Linked company entities (AV-008): AniList's non-main studios are the
    // closest signal for producers; licensor/distributor roles arrive from
    // other providers (the vocabulary is ready for them).
    companies: [
      ...(media.studios?.nodes ?? []).map((n) => ({ name: n.name, roles: ['MAIN_STUDIO'] })),
      ...(media.producers?.nodes ?? []).map((n) => ({ name: n.name, roles: ['PRODUCER'] })),
    ],
    links: links.map((l) => ({ site: l.site, url: l.url, type: l.type ?? null })),
    streams,
    anidb,
    anidbSearch: !directAnidb,
    siteUrl: sanitizePublicHttpUrl(media.siteUrl, { httpsOnly: false, maxLen: 512 }),
    // People-name indexes for entity search (AV-058/AV-059).
    staffNames: normalizeNameList((media.staff?.edges ?? []).map((e) => e?.node?.name?.full)),
    voiceActorNames: normalizeNameList(
      (media.characters?.edges ?? []).flatMap((e) => (e?.voiceActors ?? []).map((v) => v?.name?.full)),
    ),
    characterNames: normalizeNameList((media.characters?.edges ?? []).map((e) => e?.node?.name?.full)),
    // Franchise neighbourhood (AV-060): related-title names and relation kinds.
    relationNames: normalizeNameList(
      (media.relations?.edges ?? [])
        .filter((e) => e?.node?.type === 'ANIME')
        .map((e) => e?.node?.title?.english || e?.node?.title?.romaji || e?.node?.title?.native),
    ),
    relationTypes: normalizeNameList(
      (media.relations?.edges ?? [])
        .filter((e) => e?.node?.type === 'ANIME')
        .map((e) => String(e?.relationType ?? '').toLowerCase()),
    ),
    // Episode-title index for episode search (AV-062).
    episodeTitles: normalizeNameList(
      (media.streamingEpisodes ?? []).map((e) => e?.title),
      24,
    ),
  }, { source: 'anilist', refreshedAt: Math.floor(Date.now() / 1000), states })
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
/**
 * Executes a browse query built by `browse.mjs` and applies the filters AniList
 * cannot express locally. Returns per-item match reasons so the UI can explain
 * results.
 */
export async function browse(filters, browseModule) {
  const { query, variables } = browseModule.buildBrowseQuery(filters)
  const key = `browse:${JSON.stringify(variables)}`
  return cached(key, async () => {
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
    const day = Math.floor(Date.now() / 86_400_000)
    return { kind, media: result.media[day % result.media.length] }
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
  return cached(key, async () => {
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

/**
 * Studio filmography query (AV-088): the studio's COMPLETE known catalog —
 * every credited work, not only those where it is the main studio — with
 * pagination. Exported so tests can pin the no-`isMain` completeness contract.
 */
export const STUDIO_FILMOGRAPHY_QUERY = `query Studio($id: Int, $page: Int, $perPage: Int, $sort: [MediaSort]) {
  Studio(id: $id) {
    id
    name
    isAnimationStudio
    favourites
    siteUrl
    media(page: $page, perPage: $perPage, sort: $sort) {
      pageInfo { hasNextPage total }
      nodes {
        ${MEDIA_FIELDS}
      }
    }
  }
}`

/** A studio's filmography, newest-first by popularity within the page. */
export async function studioFilmography(id, { page = 1, sort = 'popular' } = {}) {
  const sortEnum = {
    popular: 'POPULARITY_DESC',
    rated: 'SCORE_DESC',
    newest: 'START_DATE_DESC',
    oldest: 'START_DATE_ASC',
  }[sort] ?? 'POPULARITY_DESC'
  const key = `studio:${id}:${page}:${sortEnum}`
  return cached(key, async () => {
    const data = await gql(STUDIO_FILMOGRAPHY_QUERY, { id, page, perPage: 24, sort: [sortEnum] })
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
  return cached(key, async () => {
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
  return cached(key, async () => {
    const data = await gql(
      `query Franchises($season: MediaSeason, $seasonYear: Int, $page: Int) {
        Page(page: $page, perPage: 50) {
          media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
            ${MEDIA_FIELDS}
            relations { relationType nodes { id title { romaji english } seasonYear } }
          }
        }
      }`,
      { season: resolved.season, seasonYear: resolved.year, page: 1 },
    )
    const media = (data.Page?.media ?? []).map(normalize).filter(Boolean)
    return { season: resolved.season, year: resolved.year, media }
  })
}

/** Newest catalog entries (highest IDs first). */
export async function recentlyAdded(limit = 24) {
  const key = `recent:added:${limit}`
  return cached(key, async () => {
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
  return cached(key, async () => {
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
            staff(perPage: 5, sort: [RELEVANCE, ID]) {
              edges { node { name { full } } }
            }
            characters(perPage: 5, sort: [RELEVANCE]) {
              edges {
                node { name { full } }
                voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { name { full } }
              }
            }
            relations {
              edges {
                relationType
                node { id type title { romaji english native } }
              }
            }
            streamingEpisodes { title }
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
    // AV-057: provider-tagged alias index (canonical variants, synonyms and
    // provenance alternates) instead of a hand-rolled field list.
    aliases: searchModule.buildTitleAliasIndex(item).map((entry) => entry.label),
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
      for (const staff of filters.staff) {
        const hit = searchModule.matchEntityNames(staff, media.staffNames)
        if (!hit) ok = false
        else reasons.push(`staff ${staff}`)
      }
    }
    if (ok) {
      for (const va of filters.voiceActor) {
        const hit = searchModule.matchEntityNames(va, media.voiceActorNames)
        if (!hit) ok = false
        else reasons.push(`voice actor ${va}`)
      }
    }
    if (ok) {
      for (const character of filters.character) {
        const hit = searchModule.matchEntityNames(character, media.characterNames)
        if (!hit) ok = false
        else reasons.push(`character ${character}`)
      }
    }
    if (ok) {
      for (const f of filters.franchise) {
        const hit = searchModule.matchesFranchise(f, media)
        if (!hit) ok = false
        else reasons.push(`franchise ${f}`)
      }
    }
    if (ok) {
      for (const episode of filters.episode) {
        const hit = searchModule.matchesEpisode(episode, media)
        if (!hit) ok = false
        else reasons.push(`episode ${episode}`)
      }
    }
    if (ok) {
      for (const genre of filters.genre) {
        const hit = searchModule.matchNameToken(genre, media.genres)
        if (!hit) ok = false
        else reasons.push(`genre ${genre}`)
      }
    }
    if (ok) {
      for (const tag of filters.tag) {
        const names = (media.tags ?? []).filter((t) => !t.isMediaSpoiler).map((t) => String(t.name))
        const hit = searchModule.matchNameToken(tag, names)
        if (!hit) ok = false
        else reasons.push(`tag ${tag}`)
      }
    }
    if (ok) {
      // AV-061: themes are searched as tag fragments (AniList keeps thematic
      // vocabulary in its tag list; `theme:` is the fuzzy thematic dimension).
      for (const theme of filters.theme) {
        const names = (media.tags ?? []).filter((t) => !t.isMediaSpoiler).map((t) => String(t.name))
        const hit = searchModule.matchEntityNames(theme, names)
        if (!hit) ok = false
        else reasons.push(`theme ${theme}`)
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
            aliases: [m.romaji, m.english, m.native, ...(m.synonyms ?? [])].filter(
              (t) => typeof t === 'string' && t,
            ),
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

/**
 * AV-021b volatile overlay: only the rapidly changing slice (airing progress
 * and scores), composed over the full detail record so its fields win when
 * present. The leading comment marker lets tests dispatch mock responses.
 */
const DETAIL_VOLATILE_QUERY = `# volatile-overlay
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    status
    episodes
    nextAiringEpisode { episode airingAt }
    averageScore
    meanScore
    popularity
    favourites
  }
}`

/**
 * AV-025a: admin metadata inspector — the raw provider payload (the exact
 * MEDIA_FIELDS shape normalize() consumes, plus the volatile overlay when
 * available) next to the normalized record, so raw → record transformations
 * are visible. The overlay is best-effort, same as getDetail.
 */
export async function inspectDetail(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw Object.assign(new Error('Invalid anime id'), { status: 400 })
  }
  const raw = await cached(`inspect:${numeric}`, () =>
    gql(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }`,
      { id: numeric },
    ),
  )
  let overlay = {}
  let overlayFailure = null
  try {
    const volatile = await cached(`detail:airing:${numeric}`, () => gql(DETAIL_VOLATILE_QUERY, { id: numeric }))
    overlay = volatile?.Media ?? {}
  } catch (err) {
    overlay = {}
    overlayFailure = { at: Math.floor(Date.now() / 1000), message: err?.message || 'Volatile overlay fetch failed' }
  }
  const composed = { ...(raw?.Media ?? {}), ...overlay }
  return { raw: composed, record: withFetchFailure(normalize(composed), overlayFailure) }
}

export async function getDetail(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw Object.assign(new Error('Invalid anime id'), { status: 400 })
  }
  // AV-021b: cache immutable metadata separately from rapidly changing airing
  // data. The full record (every field) is the long-lived last-known-good base
  // on the media tier; a tiny volatile overlay (airing progress + scores) is
  // cached on the short airing tier and wins when composed. The overlay is
  // best-effort: if it has never succeeded, the base answers on its own.
  const metaData = await cached(`detail:${numeric}`, () =>
    gql(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
          trailer { id site }
          streamingEpisodes { title thumbnail url site }
          scoreDistribution { score amount }
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
                siteUrl
                nextAiringEpisode { episode airingAt }
              }
            }
          }
        }
      }`,
      { id: numeric },
    ),
  )
  let overlay = {}
  let overlayFailure = null
  try {
    const volatile = await cached(`detail:airing:${numeric}`, () => gql(DETAIL_VOLATILE_QUERY, { id: numeric }))
    overlay = volatile?.Media ?? {}
  } catch (err) {
    // AV-021b/AV-022: the volatile overlay never takes the page down; the
    // failure is recorded on the served record's meta without touching values.
    overlay = {}
    overlayFailure = { at: Math.floor(Date.now() / 1000), message: err?.message || 'Volatile overlay fetch failed' }
  }
  const data = { Media: { ...(metaData?.Media ?? {}), ...overlay } }
  const base = withFetchFailure(normalize(data.Media), overlayFailure)
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
      // Metadata freshness verdict (AV-019) for the detail-page indicator.
      // meta.refreshedAt and refreshPolicy both use Unix seconds.
      freshness: describeFreshness('media', base.meta.refreshedAt),
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
          startDate: data.Media.startDate ?? null,
          coverImage: { large: base.cover },
        },
        ...(data.Media.relations?.edges ?? [])
          .filter((edge) => edge?.node?.type === 'ANIME')
          .map((edge) => edge.node),
      ],
      startDate: normalizePartialDate(data.Media.startDate),
      endDate: normalizePartialDate(data.Media.endDate),
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
      scoreBuckets: data.Media.scoreDistribution ?? [],
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
}

/** Batch lookup (no synopsis/trailer) — used to decorate local library files. */
/**
 * Character detail (AV-085): names, description and media appearances for the
 * character detail page. Cached on the long-lived media tier like anime
 * metadata.
 */
export async function getCharacter(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw Object.assign(new Error('Invalid character id'), { status: 400 })
  }
  return cached(`character:${numeric}`, () =>
    gql(
      `query ($id: Int) {
        Character(id: $id) {
          id
          name { full native alternative }
          image { large }
          description(asHtml: false)
          siteUrl
          media(perPage: 25, sort: [FAVOURITES_DESC]) {
            edges {
              characterRole
              node { id type format title { romaji english native } startDate { year } }
            }
          }
        }
      }`,
      { id: numeric },
    ),
  )
}

/**
 * Staff member detail (AV-086): names, occupations and media credits for the
 * staff detail page — also serves voice-actor profiles (AV-087), since AniList
 * models both as Staff. Cached on the long-lived media tier.
 */
export async function getStaffMember(id) {
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw Object.assign(new Error('Invalid staff id'), { status: 400 })
  }
  return cached(`staff:${numeric}`, () =>
    gql(
      `query ($id: Int) {
        Staff(id: $id) {
          id
          name { full native alternative }
          image { large }
          description(asHtml: false)
          siteUrl
          primaryOccupations
          characters(perPage: 25, sort: [FAVOURITES_DESC]) {
            edges {
              role
              node { id name { full native } }
              media { nodes { id title { romaji english native } } }
            }
          }
          staffMedia(perPage: 25, sort: [FAVOURITES_DESC]) {
            edges {
              role
              node { id type format title { romaji english native } startDate { year } }
            }
          }
        }
      }`,
      { id: numeric },
    ),
  )
}

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
