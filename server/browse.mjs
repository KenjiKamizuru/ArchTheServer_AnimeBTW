// Browse/discovery query engine.
//
// Turns a validated query object into (a) an AniList GraphQL variable set and
// (b) a deterministic, explainable local predicate. Filters that AniList can
// express natively are pushed into the query; the rest are applied locally to
// the returned page so results stay correct without over-fetching.
//
// Everything here is pure so it can be unit-tested without network access.

export const BROWSE_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC']

export const BROWSE_STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS']

export const BROWSE_SORTS = {
  popular: 'POPULARITY_DESC',
  trending: 'TRENDING_DESC',
  rated: 'SCORE_DESC',
  newest: 'START_DATE_DESC',
  oldest: 'START_DATE_ASC',
  title: 'TITLE_ROMAJI',
  episodes: 'EPISODES_DESC',
  favourites: 'FAVOURITES_DESC',
}

export const BROWSE_SOURCES = [
  'ORIGINAL',
  'MANGA',
  'LIGHT_NOVEL',
  'VISUAL_NOVEL',
  'VIDEO_GAME',
  'NOVEL',
  'DOUJINSHI',
  'ANIME',
  'OTHER',
]

/** Country-of-origin codes AniList accepts (subset that is actually populated). */
export const BROWSE_COUNTRIES = ['JP', 'KR', 'CN', 'TW'];

/** Original-language codes AniList accepts (subset that is actually populated). */
export const BROWSE_ORIGINAL_LANGUAGES = ['JA', 'KO', 'ZH', 'EN'];

/** Common content-rating labels used for browsing and parental filtering. */
export const BROWSE_CONTENT_RATINGS = [
  'G',
  'PG',
  'PG-13',
  'R',
  'NC-17',
  'TV-Y',
  'TV-Y7',
  'TV-G',
  'TV-PG',
  'TV-14',
  'TV-MA',
]

const MAX_LIST = 8
const MAX_TAGS = 6
const MAX_SELECTED = 40

function toInt(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function toStringList(raw, allowed, max = MAX_LIST) {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? raw.split(',') : []
  const seen = new Set()
  const out = []
  for (const item of values) {
    const value = String(item ?? '').trim()
    if (!value) continue
    // Unknown values are ignored rather than failing the request: a stale
    // bookmark should not break the whole browse page.
    if (allowed && !allowed.includes(value)) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

function clampRange(min, max, lo, hi) {
  const a = toInt(min, null)
  const b = toInt(max, null)
  const out = {}
  if (a !== null) out.min = Math.min(hi, Math.max(lo, a))
  if (b !== null) out.max = Math.min(hi, Math.max(lo, b))
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
    // Swap rather than error: a reversed slider should still do something sane.
    ;[out.min, out.max] = [out.max, out.min]
  }
  return out.min === undefined && out.max === undefined ? null : out
}

/**
 * Validates and normalizes raw query params into a stable filter object.
 * Unknown values are dropped; out-of-range numbers are clamped.
 */
export function parseBrowseFilters(raw = {}) {
  const sort = Object.hasOwn(BROWSE_SORTS, String(raw.sort ?? '')) ? String(raw.sort) : 'popular'
  const decade = toInt(raw.decade, null)
  const yearMin = toInt(raw.yearMin, null)
  const yearMax = toInt(raw.yearMax, null)

  // A decade shorthand ("1990s") expands to a year range unless explicit years
  // were supplied, in which case the explicit values win.
  let years = clampRange(yearMin, yearMax, 1940, 2100)
  if (!years && decade !== null && decade >= 1940 && decade <= 2100) {
    years = { min: decade, max: decade + 9 }
  }

  return {
    season: ['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(String(raw.season ?? '').toUpperCase())
      ? String(raw.season).toUpperCase()
      : null,
    year: toInt(raw.year, null),
    // `older` is what the share URL uses; `includeOlderSeasons` is the long form.
    includeOlderSeasons: ['1', 'true', 'yes', 'on'].includes(
      String(raw.includeOlderSeasons ?? raw.older ?? '').toLowerCase(),
    ),
    formats: toStringList(raw.formats, BROWSE_FORMATS),
    statuses: toStringList(raw.statuses, BROWSE_STATUSES),
    sources: toStringList(raw.sources, BROWSE_SOURCES),
    countries: toStringList(raw.countries, BROWSE_COUNTRIES),
    originalLanguages: toStringList(raw.originalLanguages, BROWSE_ORIGINAL_LANGUAGES),
    contentRatings: toStringList(raw.contentRatings, BROWSE_CONTENT_RATINGS),
    genres: toStringList(raw.genres, null),
    genresExclude: toStringList(raw.genresExclude, null),
    studio: toStringList(raw.studio, null),
    staff: toStringList(raw.staff, null),
    voiceActor: toStringList(raw.voiceActor, null),
    tags: toStringList(raw.tags, null, MAX_TAGS),
    tagMode: ['and', 'or', 'not'].includes(String(raw.tagMode ?? '')) ? String(raw.tagMode) : 'and',
    years,
    episodes: clampRange(raw.episodesMin, raw.episodesMax, 1, 9999),
    duration: clampRange(raw.durationMin, raw.durationMax, 1, 600),
    minScore: toInt(raw.minScore, null) === null ? null : Math.min(100, Math.max(0, toInt(raw.minScore, null))),
    maxPopularity: toInt(raw.maxPopularity, null) === null ? null : Math.min(1_000_000, Math.max(0, toInt(raw.maxPopularity, null))),
    sort,
    page: Math.min(25, Math.max(1, toInt(raw.page, 1) ?? 1)),
    perPage: Math.min(50, Math.max(1, toInt(raw.perPage, 30) ?? 30)),
    query: String(raw.q ?? '').trim().slice(0, 100) || null,
  }
}

/** Serializes a filter object back into query params (for shareable URLs). */
export function filtersToParams(filters) {
  const params = new URLSearchParams()
  const put = (key, value) => {
    if (value === null || value === undefined || value === '' ) return
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','))
      return
    }
    if (typeof value === 'boolean') {
      if (value) params.set(key, '1')
      return
    }
    params.set(key, String(value))
  }
  put('sort', filters.sort === 'popular' ? null : filters.sort)
  put('season', filters.season)
  put('year', filters.year)
  put('older', filters.includeOlderSeasons)
  put('formats', filters.formats)
  put('statuses', filters.statuses)
  put('sources', filters.sources)
  put('countries', filters.countries)
  put('originalLanguages', filters.originalLanguages)
  put('contentRatings', filters.contentRatings)
  put('genres', filters.genres)
  put('genresExclude', filters.genresExclude)
  put('studio', filters.studio)
  put('staff', filters.staff)
  put('voiceActor', filters.voiceActor)
  put('tags', filters.tags)
  put('tagMode', filters.tagMode === 'and' ? null : filters.tagMode)
  put('yearMin', filters.years?.min)
  put('yearMax', filters.years?.max)
  put('episodesMin', filters.episodes?.min)
  put('episodesMax', filters.episodes?.max)
  put('durationMin', filters.duration?.min)
  put('durationMax', filters.duration?.max)
  put('minScore', filters.minScore)
  put('maxPopularity', filters.maxPopularity)
  put('q', filters.query)
  return params
}

/**
 * Builds the AniList query. Only filters AniList understands natively are
 * pushed down; everything else is evaluated by {@link matchMediaLocally}.
 */
export function buildBrowseQuery(filters) {
  const variables = {
    page: filters.page,
    perPage: filters.perPage,
    type: 'ANIME',
  }
  const args = ['type: $type', 'isAdult: false']

  const media = []
  const orParts = []

  // Season/year pair, a plain year ("any season"), or a year range.
  // Order matters: an explicit season+year is the narrowest, a bare year is
  // next, and a range is the broadest fallback.
  if (filters.season && filters.year && !filters.includeOlderSeasons) {
    variables.season = filters.season
    variables.seasonYear = filters.year
    media.push('season: $season', 'seasonYear: $seasonYear')
  } else if (filters.year) {
    variables.seasonYear = filters.year
    media.push('seasonYear: $seasonYear')
  } else if (filters.years) {
    if (filters.years.min !== undefined) {
      variables.yearMin = filters.years.min
      media.push('startDate_greater: $yearMin')
    }
    if (filters.years.max !== undefined) {
      variables.yearMax = filters.years.max
      media.push('startDate_lesser: $yearMax')
    }
  }

  if (filters.formats.length) {
    variables.formats = filters.formats
    media.push('format_in: $formats')
  }
  if (filters.statuses.length) {
    variables.statuses = filters.statuses
    media.push('status_in: $statuses')
  }
  if (filters.sources.length) {
    variables.sources = filters.sources
    media.push('source_in: $sources')
  }
  if (filters.countries.length) {
    variables.countries = filters.countries
    media.push('countryOfOrigin_in: $countries')
  }
  if (filters.originalLanguages.length) {
    variables.originalLanguages = filters.originalLanguages
    media.push('originalLanguage_in: $originalLanguages')
  }
  if (filters.genres.length) {
    variables.genres = filters.genres
    media.push('genre_in: $genres')
  }
  if (filters.tags.length && filters.tagMode === 'and') {
    variables.tags = filters.tags
    media.push('tag_in: $tags')
  }
  if (filters.episodes?.min !== undefined) {
    variables.episodesMin = filters.episodes.min
    media.push('episodes_greater: $episodesMin')
  }
  if (filters.episodes?.max !== undefined) {
    variables.episodesMax = filters.episodes.max
    media.push('episodes_lesser: $episodesMax')
  }
  if (filters.duration?.min !== undefined) {
    variables.durationMin = filters.duration.min
    media.push('duration_greater: $durationMin')
  }
  if (filters.duration?.max !== undefined) {
    variables.durationMax = filters.duration.max
    media.push('duration_lesser: $durationMax')
  }
  if (filters.minScore !== null) {
    variables.minScore = filters.minScore
    media.push('averageScore_greater: $minScore')
  }
  if (filters.maxPopularity !== null) {
    variables.maxPopularity = filters.maxPopularity
    media.push('popularity_lesser: $maxPopularity')
  }
  if (filters.query) {
    variables.search = filters.query
    media.push('search: $search')
  }

  if (orParts.length) media.push(...orParts)

  const sort = [BROWSE_SORTS[filters.sort] ?? BROWSE_SORTS.popular]
  variables.sort = sort
  args.push(`sort: $sort`)
  args.push(...media)

  const declaration = []
  const add = (name, type) => declaration.push(`$${name}: ${type}`)
  add('page', 'Int')
  add('perPage', 'Int')
  add('type', 'MediaType')
  add('sort', '[MediaSort]')
  if (variables.season) add('season', 'MediaSeason')
  if (variables.seasonYear !== undefined) add('seasonYear', 'Int')
  if (variables.yearMin !== undefined) add('yearMin', 'FuzzyDateInt')
  if (variables.yearMax !== undefined) add('yearMax', 'FuzzyDateInt')
  if (variables.formats) add('formats', '[MediaFormat]')
  if (variables.statuses) add('statuses', '[MediaStatus]')
  if (variables.sources) add('sources', '[MediaSource]')
  if (variables.countries) add('countries', '[CountryCode]')
  if (variables.originalLanguages) add('originalLanguages', '[String]')
  if (variables.genres) add('genres', '[String]')
  if (variables.tags) add('tags', '[String]')
  if (variables.episodesMin !== undefined) add('episodesMin', 'Int')
  if (variables.episodesMax !== undefined) add('episodesMax', 'Int')
  if (variables.durationMin !== undefined) add('durationMin', 'Int')
  if (variables.durationMax !== undefined) add('durationMax', 'Int')
  if (variables.minScore !== undefined) add('minScore', 'Int')
  if (variables.maxPopularity !== undefined) add('maxPopularity', 'Int')
  if (variables.search !== undefined) add('search', 'String')

  // Year ranges need FuzzyDateInt (YYYYMMDD); convert before sending.
  if (variables.yearMin !== undefined) variables.yearMin = Number(`${variables.yearMin}0101`)
  if (variables.yearMax !== undefined) variables.yearMax = Number(`${variables.yearMax}1231`)

  const query = `query Browse(${declaration.join(', ')}) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage total }
    media(${args.join(', ')}) {
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
      startDate { year month day }
      endDate { year month day }
      averageScore
      popularity
      favourites
      genres
      tags { name rank isMediaSpoiler }
      source
      countryOfOrigin
      originalLanguage
      siteUrl
      nextAiringEpisode { episode airingAt }
      studios(isMain: true) { nodes { id name isAnimationStudio siteUrl } }
      externalLinks { site url type }
    }
  }
}`

  return { query, variables }
}

/**
 * Local predicate for filters AniList cannot express (exclusions, OR tags,
 * mixed country/origin logic). Returns { ok, reasons } so the UI can explain
 * why a result matched.
 */
export function matchMediaLocally(media, filters) {
  const reasons = []
  if (!media) return { ok: false, reasons }

  if (filters.originalLanguages.length) {
    const lang = media.originalLanguage
    if (!lang || !filters.originalLanguages.includes(lang.toUpperCase())) {
      return { ok: false, reasons }
    }
    reasons.push(`language ${filters.originalLanguages.join('/')}`)
  }

  if (filters.contentRatings.length) {
    const wanted = new Set(filters.contentRatings.map((r) => r.toUpperCase()))
    const has = (media.ageRatings ?? []).some((a) =>
      a && typeof a.rating === 'string' && wanted.has(a.rating.toUpperCase()),
    )
    if (!has) return { ok: false, reasons }
    reasons.push(`rating ${filters.contentRatings.join('/')}`)
  }

  if (filters.genresExclude.length) {
    const genres = new Set(media.genres ?? [])
    for (const g of filters.genresExclude) {
      if (genres.has(g)) return { ok: false, reasons }
    }
    reasons.push(`no ${filters.genresExclude.join('/')}`)
  }

  // Studio filter: media must be produced by at least one of the listed studios.
  if (filters.studio.length) {
    const studios = new Set((media.studios ?? []).map((s) => String(s).toLowerCase()))
    const hit = filters.studio.filter((s) => studios.has(s))
    if (hit.length === 0) return { ok: false, reasons }
    reasons.push(`studio ${hit.join('/')}`)
  }

  // Spoiler tags must never drive discovery, so strip them before matching.
  // (Non-mutating: the caller's normalized object stays intact.)
  if (filters.tags.length) {
    const names = new Set(
      (media.tags ?? []).filter((t) => !t.isMediaSpoiler).map((t) => t.name),
    )
    const hit = filters.tags.filter((t) => names.has(t))
    if (filters.tagMode === 'not') {
      // NOT mode: exclude any media that carries even one of the requested tags.
      if (hit.length > 0) return { ok: false, reasons }
      reasons.push(`no tags ${filters.tags.join(', ')}`)
    } else {
      if (hit.length === 0) return { ok: false, reasons }
      // AniList's `tag_in` is any-of, so AND mode needs an explicit local check
      // or a title matching only one requested tag would slip through.
      if (filters.tagMode === 'and' && hit.length !== filters.tags.length) {
        return { ok: false, reasons }
      }
      reasons.push(`tag ${hit.join(filters.tagMode === 'and' ? ' + ' : ' or ')}`)
    }
  }

  if (filters.minScore !== null && (media.averageScore ?? 0) < filters.minScore) {
    return { ok: false, reasons }
  }

  if (filters.maxPopularity !== null && (media.popularity ?? 0) > filters.maxPopularity) {
    return { ok: false, reasons }
  }

  if (filters.years) {
    const y = media.seasonYear
    if (y === null || y === undefined) return { ok: false, reasons }
    if (filters.years.min !== undefined && y < filters.years.min) return { ok: false, reasons }
    if (filters.years.max !== undefined && y > filters.years.max) return { ok: false, reasons }
  }

  if (filters.episodes) {
    const eps = media.episodes
    if (eps === null || eps === undefined) return { ok: false, reasons }
    if (filters.episodes.min !== undefined && eps < filters.episodes.min) return { ok: false, reasons }
    if (filters.episodes.max !== undefined && eps > filters.episodes.max) return { ok: false, reasons }
  }

  if (filters.duration) {
    const d = media.duration
    if (d === null || d === undefined) return { ok: false, reasons }
    if (filters.duration.min !== undefined && d < filters.duration.min) return { ok: false, reasons }
    if (filters.duration.max !== undefined && d > filters.duration.max) return { ok: false, reasons }
  }

  return { ok: true, reasons }
}

/** Human-readable one-line summary used by chips and share links. */
export function describeFilters(filters) {
  const parts = []
  if (filters.query) parts.push(`"${filters.query}"`)
  if (filters.formats.length) parts.push(filters.formats.join('/'))
  if (filters.statuses.length) parts.push(filters.statuses.join('/'))
  if (filters.genres.length) parts.push(filters.genres.join(', '))
  if (filters.genresExclude.length) parts.push(`without ${filters.genresExclude.join(', ')}`)
  if (filters.tags.length)
    parts.push(
      `tags ${
        filters.tagMode === 'and'
          ? 'all of'
          : filters.tagMode === 'or'
            ? 'any of'
            : 'none of'
      } ${filters.tags.join(', ')}`,
    )
  if (filters.years) parts.push(yearsLabel(filters.years))
  if (filters.season && filters.year) parts.push(`${filters.season} ${filters.year}`)
  else if (filters.year) parts.push(filters.includeOlderSeasons ? `any season ${filters.year}` : String(filters.year))
  if (filters.episodes) parts.push(`episodes ${rangeLabel(filters.episodes)}`)
  if (filters.duration) parts.push(`${rangeLabel(filters.duration)} min`)
  if (filters.minScore !== null) parts.push(`score ≥ ${filters.minScore}`)
  if (filters.maxPopularity !== null) parts.push(`popularity ≤ ${filters.maxPopularity}`)
  if (filters.sources.length) parts.push(filters.sources.join('/'))
  if (filters.countries.length) parts.push(filters.countries.join('/'))
  if (filters.originalLanguages.length)
    parts.push(`lang ${filters.originalLanguages.join('/')}`)
  if (filters.contentRatings.length)
    parts.push(`rating ${filters.contentRatings.join('/')}`)
  return parts.length ? parts.join(' · ') : 'everything'
}

function rangeLabel(range) {
  if (range.min !== undefined && range.max !== undefined) return `${range.min}–${range.max}`
  if (range.min !== undefined) return `≥ ${range.min}`
  return `≤ ${range.max}`
}

function yearsLabel(range) {
  if (range.min !== undefined && range.max !== undefined) {
    if (range.max - range.min === 9 && range.min % 10 === 0) return `${range.min}s`
    return `${range.min}–${range.max}`
  }
  if (range.min !== undefined) return `since ${range.min}`
  return `up to ${range.max}`
}

/** Count of active filters, used for the "Filters (3)" badge. */
export function activeFilterCount(filters) {
  let n = 0
  if (filters.formats.length) n += 1
  if (filters.statuses.length) n += 1
  if (filters.sources.length) n += 1
  if (filters.countries.length) n += 1
  if (filters.originalLanguages.length) n += 1
  if (filters.contentRatings.length) n += 1
  if (filters.genres.length) n += 1
  if (filters.genresExclude.length) n += 1
  if (filters.tags.length) n += 1
  if (filters.years) n += 1
  if (filters.season && filters.year) n += 1
  else if (filters.year) n += 1
  if (filters.episodes) n += 1
  if (filters.duration) n += 1
  if (filters.minScore !== null) n += 1
  if (filters.maxPopularity !== null) n += 1
  if (filters.query) n += 1
  return Math.min(MAX_SELECTED, n)
}

export const EMPTY_FILTERS = parseBrowseFilters({})
