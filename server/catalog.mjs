/**
 * Provider-neutral catalog record used by the application. Provider adapters
 * translate their responses into these field names; no GraphQL shapes leak
 * into the record. `id` is the installation's current numeric media identity
 * (today supplied by AniList); provider-specific identifiers live in the
 * dedicated `externalIds` collection (AV-002).
 *
 * Null means unavailable; units are minutes for duration, percent for score,
 * and Unix seconds for nextEpisode.airingAt. The factory supplies stable
 * defaults and copies collections so adapter inputs cannot mutate the record.
 */
export function createAnimeRecord(input, options = {}) {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.id) || input.id <= 0) {
    throw new TypeError('Anime record requires a positive safe integer id')
  }
  const copyLinks = (links) => Array.isArray(links) ? links.map(({ site, url }) => ({ site, url })) : []
  const genreEntries = normalizeGenres(input.genres)
  const tagEntries = normalizeTags(input.tags)
  const companyEntries = normalizeCompanies(input.companies, input.studios)
  const metaValue = normalizeMeta(options)
  const scoreValue = normalizeScore(input.score)
  const record = {
    id: input.id,
    // Metadata schema version (AV-015): bumped whenever the record shape
    // changes; migrateRecord() upgrades older stored shapes to current.
    schemaVersion: SCHEMA_VERSION,
    // Dedicated external-identifier collection (AV-002): a normalized map of
    // provider slug → string id, e.g. { anilist: '21', myanimelist: '20' }.
    externalIds: normalizeExternalIds(input.externalIds),
    // Metadata provenance (AV-003): source + last-refresh timestamp covering
    // every field, with per-field overrides where provenance differs.
    meta: metaValue,
    // Title variants (AV-005): normalized romaji/English/native/synonym slots
    // with the preferred display name resolved by policy.
    title: preferredDisplayTitle(input, input.id),
    romaji: normalizeTitleVariant(input.romaji),
    english: normalizeTitleVariant(input.english),
    native: normalizeTitleVariant(input.native),
    // Alternate titles (AniList "synonyms") power alias matching in search.
    synonyms: normalizeSynonyms(input.synonyms),
    cover: input.cover ?? null,
    banner: input.banner ?? null,
    color: input.color ?? null,
    description: input.description ?? '',
    episodes: normalizeEpisodeCount(input.episodes),
    airedEpisodes: normalizeAiredCount(input.airedEpisodes),
    duration: normalizeDurationMinutes(input.duration),
    status: normalizeStatus(input.status),
    format: normalizeFormat(input.format),
    season: normalizeSeason(input.season),
    seasonYear: normalizeSeasonYear(input.seasonYear),
    score: scoreValue,
    // Provider score claims on their original scales (AV-012).
    scoreClaims: normalizeScores(input.scoreClaims, scoreValue, metaValue.source),
    popularity: input.popularity ?? 0,
    favourites: input.favourites ?? null,
    genres: genreEntries.map((g) => g.name),
    // Stable slug identifiers parallel to `genres` (AV-007).
    genreIds: genreEntries.map((g) => g.id),
    tags: tagEntries,
    source: input.source ?? null,
    countryOfOrigin: normalizeCountry(input.countryOfOrigin),
    originalLanguage: normalizeLanguage(input.originalLanguage) ?? COUNTRY_LANGUAGE[normalizeCountry(input.countryOfOrigin)] ?? null,
    ageRating: normalizeAgeRating(input.ageRating),
    // Region-aware age-rating entries (AV-011); explicit entries win over the
    // INTL derivation from the scalar.
    ageRatings: normalizeAgeRatings(input.ageRatings, normalizeAgeRating(input.ageRating)),
    nextEpisode: input.nextEpisode ? { episode: input.nextEpisode.episode, airingAt: input.nextEpisode.airingAt } : null,
    // Normalized partial dates and broadcast slot (AV-013).
    startDate: normalizePartialDate(input.startDate),
    endDate: normalizePartialDate(input.endDate),
    broadcast: normalizeBroadcast(input.broadcast),
    studios: companyEntries.filter((c) => c.roles.includes('MAIN_STUDIO')).map((c) => c.name),
    // Linked company entities (AV-008): studios/producer/licensor/distributor
    // references with stable ids and canonical roles.
    companies: companyEntries,
    links: copyLinks(input.links),
    streams: copyLinks(input.streams),
    // Structured artwork variants with provenance (AV-023).
    artworkVariants: normalizeArtworkVariants(input.artworkVariants),
    // People-name indexes for entity search (AV-058/AV-059).
    staffNames: normalizeNameList(input.staffNames),
    voiceActorNames: normalizeNameList(input.voiceActorNames),
    characterNames: normalizeNameList(input.characterNames),
    // Franchise neighbourhood for relationship search (AV-060).
    relationNames: normalizeNameList(input.relationNames),
    relationTypes: normalizeNameList(input.relationTypes),
    // Episode-title index for episode search (AV-062).
    episodeTitles: normalizeNameList(input.episodeTitles, 24),
    anidb: input.anidb ?? null,
    anidbSearch: input.anidbSearch ?? false,
    siteUrl: input.siteUrl ?? null,
  }
  // Metadata completeness score (AV-024): computed from the normalized record,
  // so every derived path (migrate/merge/correct) refreshes it automatically.
  return { ...record, completeness: completenessScore(record) }
}

/**
 * Upgrades a stored record to the current schema version (AV-015). Legacy
 * records (no `schemaVersion`) are rebuilt through createAnimeRecord with
 * their provenance preserved; current-version records are returned untouched.
 * Returns null for anything that is not a record.
 */
export function migrateRecord(record) {
  if (!record || typeof record !== 'object' || !Number.isSafeInteger(record.id) || record.id <= 0) return null
  if (record.schemaVersion === SCHEMA_VERSION) return record
  const meta = record.meta && typeof record.meta === 'object' ? record.meta : null
  return createAnimeRecord(record, meta ? {
    source: meta.source ?? undefined,
    refreshedAt: meta.refreshedAt ?? undefined,
    fields: meta.fields,
    states: meta.states,
  } : {})
}

/**
 * Duplicate detection (AV-016): certain matches are shared identity (same id
 * or the same provider identifier); probable matches are exact normalized
 * title/synonym overlaps. Returns null when the records look distinct.
 */
function titleKeys(record) {
  const keys = new Set()
  for (const raw of [record.title, record.romaji, record.english, record.native, ...(record.synonyms ?? [])]) {
    const key = normalizeTitleVariant(raw)?.toLowerCase()
    if (key) keys.add(key)
  }
  return keys
}

export function detectDuplicate(a, b) {
  const left = migrateRecord(a)
  const right = migrateRecord(b)
  if (!left || !right) return null
  if (left.id === right.id) return { reason: 'same-id', confidence: 'certain' }
  for (const [provider, id] of Object.entries(right.externalIds)) {
    if (left.externalIds[provider] === id) return { reason: `shared-${provider}-id`, confidence: 'certain' }
  }
  const rightKeys = titleKeys(right)
  for (const key of titleKeys(left)) {
    if (rightKeys.has(key)) return { reason: `matching-title:${key}`, confidence: 'probable' }
  }
  return null
}

/**
 * Safe merge (AV-016): the PRIMARY record wins every conflict — including
 * zero values — and the secondary only fills gaps; collections union with the
 * primary's entries first (the factory dedupes, so primary wins). Inputs are
 * never mutated and the result is rebuilt through createAnimeRecord, so it is
 * always current-schema and normalized. Different ids cannot be merged.
 */
export function mergeRecords(primaryInput, secondaryInput) {
  const primary = migrateRecord(primaryInput)
  const secondary = migrateRecord(secondaryInput)
  if (!primary || !secondary) return null
  if (primary.id !== secondary.id) throw new TypeError('Cannot merge records with different ids')
  const fallback = `Anime #${primary.id}`
  const explicitTitle =
    primary.title !== fallback ? primary.title : (secondary.title !== fallback ? secondary.title : null)
  const dedupeLinks = (list) => {
    const seen = new Set()
    return list.filter((l) => {
      const key = `${l.site}|${l.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  const mergedInput = {
    id: primary.id,
    title: explicitTitle,
    romaji: primary.romaji ?? secondary.romaji,
    english: primary.english ?? secondary.english,
    native: primary.native ?? secondary.native,
    synonyms: [...primary.synonyms, ...secondary.synonyms],
    cover: primary.cover ?? secondary.cover,
    banner: primary.banner ?? secondary.banner,
    color: primary.color ?? secondary.color,
    description: primary.description || secondary.description,
    episodes: primary.episodes ?? secondary.episodes,
    // Aired counts only grow; keep the fresher (larger) value.
    airedEpisodes: Math.max(primary.airedEpisodes, secondary.airedEpisodes),
    duration: primary.duration ?? secondary.duration,
    status: primary.status !== 'UNKNOWN' ? primary.status : secondary.status,
    format: primary.format ?? secondary.format,
    season: primary.season ?? secondary.season,
    seasonYear: primary.seasonYear ?? secondary.seasonYear,
    score: primary.score ?? secondary.score,
    popularity: Math.max(primary.popularity, secondary.popularity),
    favourites: primary.favourites ?? secondary.favourites,
    genres: [...primary.genres, ...secondary.genres],
    tags: [...primary.tags, ...secondary.tags],
    source: primary.source ?? secondary.source,
    countryOfOrigin: primary.countryOfOrigin ?? secondary.countryOfOrigin,
    ageRating: primary.ageRating ?? secondary.ageRating,
    ageRatings: [...primary.ageRatings, ...secondary.ageRatings],
    originalLanguage: primary.originalLanguage ?? secondary.originalLanguage,
    nextEpisode: primary.nextEpisode ?? secondary.nextEpisode,
    startDate: primary.startDate ?? secondary.startDate,
    endDate: primary.endDate ?? secondary.endDate,
    broadcast: primary.broadcast ?? secondary.broadcast,
    studios: [...primary.studios, ...secondary.studios],
    companies: [...primary.companies, ...secondary.companies],
    links: dedupeLinks([...primary.links, ...secondary.links]),
    streams: dedupeLinks([...primary.streams, ...secondary.streams]),
    externalIds: { ...secondary.externalIds, ...primary.externalIds },
    scoreClaims: [...primary.scoreClaims, ...secondary.scoreClaims],
    anidb: primary.anidb ?? secondary.anidb,
    anidbSearch: primary.anidbSearch || secondary.anidbSearch,
    siteUrl: primary.siteUrl ?? secondary.siteUrl,
  }
  return createAnimeRecord(mergedInput, {
    source: primary.meta.source ?? secondary.meta.source ?? undefined,
    refreshedAt: primary.meta.refreshedAt ?? secondary.meta.refreshedAt ?? undefined,
    fields: { ...secondary.meta.fields, ...primary.meta.fields },
    states: { ...secondary.meta.states, ...primary.meta.states },
  })
}

/**
 * Manual corrections (AV-017): applies a corrected value to one field and
 * returns a NEW record. The value flows through factory normalization; the
 * provider's original is preserved as a claim in `meta.fields[field].alternates`
 * (never overwritten) and the field's provenance becomes the correction source
 * ('manual' by default). Identity/structure fields cannot be corrected and
 * unknown field names throw.
 */
export function applyCorrection(record, field, value, options = {}) {
  const base = migrateRecord(record)
  if (!base) return null
  const key = String(field ?? '').trim()
  if (!key || key.length > 40 || RESERVED_ID_PROVIDERS.has(key)) {
    throw new TypeError('Unknown field for a manual correction')
  }
  if (['id', 'schemaVersion', 'meta'].includes(key) || !(key in base)) {
    throw new TypeError(`Field "${key}" cannot be manually corrected`)
  }
  const provenance = fieldProvenance(base, key)
  const previousValue = base[key]
  const priorClaim =
    previousValue === null || previousValue === undefined
      ? null
      : { source: provenance.source ?? 'unknown', value: previousValue }
  const alternates = priorClaim ? [priorClaim, ...provenance.alternates] : provenance.alternates
  return createAnimeRecord({ ...base, [key]: value }, {
    source: base.meta.source ?? undefined,
    refreshedAt: base.meta.refreshedAt ?? undefined,
    fields: {
      ...base.meta.fields,
      [key]: {
        source: providerSlug(options.source ?? 'manual') ?? 'manual',
        refreshedAt: normalizeTimestamp(options.refreshedAt) ?? normalizeTimestamp(Date.now() / 1000),
        alternates,
      },
    },
    // A corrected value is known, so any stale absence annotation is cleared.
    states: Object.fromEntries(Object.entries(base.meta.states).filter(([k]) => k !== key)),
  })
}

const RESERVED_ID_PROVIDERS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Schema version of the canonical record (AV-015). Records stamped by earlier
 * builds carry no `schemaVersion` (implicit 0) and are upgraded by
 * migrateRecord(), which rebuilds them through createAnimeRecord — the
 * normalizers are idempotent, so re-running them is the migration.
 */
export const SCHEMA_VERSION = 1

/** Shared provider-slug validation; returns the slug or null. */
function providerSlug(raw) {
  const slug = String(raw ?? '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(slug) || RESERVED_ID_PROVIDERS.has(slug)) return null
  return slug
}

/**
 * Title-variant normalization (AV-005): every variant is trimmed, whitespace
 * collapsed and length-capped so romaji/English/native/synonym slots are stable
 * strings regardless of provider formatting. Empty values become null.
 */
function normalizeTitleVariant(value) {
  const t = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return t || null
}

/** Synonym slots: normalized, deduped case-insensitively (first wins), max 20. */
function normalizeSynonyms(input) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(input) ? input : []) {
    const t = normalizeTitleVariant(raw)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= 20) break
  }
  return out
}

/**
 * Resolves the preferred display name from the title variants (AV-005) using a
 * documented policy: explicit title → English → romaji → native → first
 * synonym → `Anime #<id>` fallback. `variants` may be a raw input object or a
 * stored record; both shapes use the same slots.
 */
export function preferredDisplayTitle(variants, id) {
  const v = variants && typeof variants === 'object' ? variants : {}
  const explicit = normalizeTitleVariant(v.title)
  if (explicit) return explicit
  for (const candidate of [v.english, v.romaji, v.native]) {
    const t = normalizeTitleVariant(candidate)
    if (t) return t
  }
  return normalizeSynonyms(v.synonyms)[0] ?? `Anime #${id}`
}

/**
 * Schedule/format normalization (AV-006): season, year, format, status and
 * episode counts are canonicalized to the vocabularies the UI already compares
 * against (AniList-style uppercase underscore tokens). Unknown seasons/years/
 * episode counts become null (unknown); unknown statuses become the 'UNKNOWN'
 * sentinel; unknown formats keep a stable uppercase-underscore shape so no
 * provider value is silently lost.
 */
const SEASON_VALUES = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL'])
const FORMAT_VALUES = new Set(['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'])
const STATUS_ALIASES = {
  AIRING: 'RELEASING',
  RELEASING: 'RELEASING',
  UPCOMING: 'NOT_YET_RELEASED',
  NOT_YET_RELEASED: 'NOT_YET_RELEASED',
  FINISHED: 'FINISHED',
  COMPLETE: 'FINISHED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
  HIATUS: 'HIATUS',
}

function normalizeToken(value) {
  return String(value ?? '').trim().replace(/[\s-]+/g, '_').toUpperCase()
}

function normalizeSeason(value) {
  const t = normalizeToken(value)
  return SEASON_VALUES.has(t) ? t : null
}

function normalizeFormat(value) {
  const t = normalizeToken(value)
  return t ? (FORMAT_VALUES.has(t) ? t : t.slice(0, 32)) : null
}

function normalizeStatus(value) {
  return STATUS_ALIASES[normalizeToken(value)] ?? 'UNKNOWN'
}

function normalizeSeasonYear(value) {
  const y = Number(value)
  return Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : null
}

function normalizeEpisodeCount(value) {
  // Explicit null/'' mean "unknown", never zero (AV-006: unknown ≠ 0).
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null
}

function normalizeAiredCount(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : 0
}

/**
 * Genre/tag identifier normalization (AV-007): every genre and tag carries a
 * stable slug id (lowercase, hyphen-separated, Unicode-letter safe) with
 * well-known genre variants mapped to the canonical spelling the browse UI
 * already compares against. Genres stay display strings in `genres` with
 * parallel `genreIds`; tags carry `id` beside `name`.
 */
const CANONICAL_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror',
  'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance',
  'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
]

export function identifierSlug(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

const GENRE_BY_SLUG = new Map(CANONICAL_GENRES.map((name) => [identifierSlug(name), name]))
for (const [alias, canonical] of [
  ['science fiction', 'Sci-Fi'],
  ['scifi', 'Sci-Fi'],
  ['sol', 'Slice of Life'],
  ['magical girl', 'Mahou Shoujo'],
]) GENRE_BY_SLUG.set(identifierSlug(alias), canonical)

function normalizeGenres(input) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(input) ? input : []) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name) continue
    const canonical = GENRE_BY_SLUG.get(identifierSlug(name)) ?? name
    const id = identifierSlug(canonical)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: canonical })
  }
  return out
}

function normalizeTags(input) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(input) ? input : []) {
    const t = raw && typeof raw === 'object' ? raw : {}
    const name = String(t.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    const id = identifierSlug(name)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const rank = Number(t.rank)
    out.push({
      id,
      name,
      rank: Number.isFinite(rank) ? Math.min(100, Math.max(0, rank)) : 0,
      isMediaSpoiler: Boolean(t.isMediaSpoiler),
    })
  }
  return out
}

/**
 * Linked company entities (AV-008): studios, producers, licensors and
 * distributors are normalized into id-linked references with canonical roles.
 * `studios` stays a display-name array for the UI and is derived from companies
 * holding the MAIN_STUDIO role, so old and new consumers share one source.
 */
const COMPANY_ROLES = ['MAIN_STUDIO', 'PRODUCER', 'LICENSOR', 'DISTRIBUTOR']
const COMPANY_ROLE_SET = new Set(COMPANY_ROLES)
const COMPANY_ROLE_ALIASES = { STUDIO: 'MAIN_STUDIO', MAIN: 'MAIN_STUDIO' }

function normalizeCompanies(inputCompanies, plainStudios) {
  const byId = new Map()
  const add = (rawName, rawRoles) => {
    const name = String(rawName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const id = identifierSlug(name)
    if (!id) return
    const existing = byId.get(id)
    const roles = new Set(existing?.roles ?? [])
    for (const raw of Array.isArray(rawRoles) ? rawRoles : rawRoles ? [rawRoles] : []) {
      const token = normalizeToken(raw)
      const role = COMPANY_ROLE_ALIASES[token] ?? token
      if (COMPANY_ROLE_SET.has(role)) roles.add(role)
    }
    byId.set(id, { id, name: existing?.name ?? name, roles: COMPANY_ROLES.filter((r) => roles.has(r)) })
  }
  for (const name of Array.isArray(plainStudios) ? plainStudios : []) add(name, ['MAIN_STUDIO'])
  for (const raw of Array.isArray(inputCompanies) ? inputCompanies : []) {
    const c = raw && typeof raw === 'object' ? raw : {}
    add(c.name, c.roles)
  }
  return [...byId.values()]
}

/**
 * Country/language normalization (AV-009): country of origin as ISO 3166-1
 * alpha-2 (common full names and 3-letter codes accepted) and original
 * language as BCP-47. When a provider omits the language it is derived from
 * the country (JP → ja, KR → ko, CN → zh, TW/HK → zh-Hant, US/GB → en).
 * Unknown values become null rather than guessed.
 */
const COUNTRY_ALIASES = {
  JAPAN: 'JP', JPN: 'JP',
  KOREA: 'KR', 'SOUTH KOREA': 'KR', KOR: 'KR',
  CHINA: 'CN', CHN: 'CN',
  TAIWAN: 'TW', TWN: 'TW',
  'UNITED STATES': 'US', USA: 'US',
  'UNITED KINGDOM': 'GB', UK: 'GB',
}
const COUNTRY_LANGUAGE = { JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh-Hant', HK: 'zh-Hant', US: 'en', GB: 'en' }
const LANGUAGE_ALIASES = { JAPANESE: 'ja', KOREAN: 'ko', CHINESE: 'zh', ENGLISH: 'en', 'ZH-HANT': 'zh-Hant', 'ZH-TW': 'zh-Hant' }

function normalizeCountry(value) {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!raw) return null
  if (/^[A-Z]{2}$/.test(raw)) return raw
  return COUNTRY_ALIASES[raw] ?? null
}

function normalizeLanguage(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const alias = LANGUAGE_ALIASES[raw.toUpperCase().replace(/\s+/g, '-')]
  if (alias) return alias
  const m = raw.match(/^([A-Za-z]{2})(?:-([A-Za-z0-9]{2,8}))?$/)
  if (!m) return null
  if (!m[2]) return m[1].toLowerCase()
  const sub = m[2]
  const canon = sub.length === 2 ? sub.toUpperCase() : sub.length === 4 ? sub[0].toUpperCase() + sub.slice(1).toLowerCase() : sub.toLowerCase()
  return `${m[1].toLowerCase()}-${canon}`
}

/**
 * Runtime normalization (AV-010): episode runtimes are stored in minutes —
 * positive finite values up to 24 h — accepting plain numbers, unit strings
 * ('24 min', '24m') and mm:ss / h:mm:ss clock strings from file metadata.
 * Unknown or invalid values become null.
 */
function normalizeDurationMinutes(value) {
  const isNumber = typeof value === 'number'
  const isString = typeof value === 'string' && value.trim() !== ''
  if (!isNumber && !isString) return null
  const s = String(value).trim().toLowerCase()
  const finalize = (minutes) =>
    Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? Math.round(minutes * 10) / 10 : null
  const clock = s.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})$/)
  if (clock) {
    const seconds = Number(clock[3])
    if (seconds < 60) return finalize(Number(clock[1] ?? 0) * 60 + Number(clock[2]) + seconds / 60)
    return null
  }
  const numeric = s.match(/^(\d+(?:\.\d+)?)(?:\s*(?:min|mins|minutes|m))?$/)
  return numeric ? finalize(Number(numeric[1])) : null
}

/**
 * Age-rating normalization (AV-011): the scalar `ageRating` maps onto the
 * common content scale the browse filters use (NONE/G/PG/PG_13/R_17/R_18/RX)
 * with aliases for provider spellings ('pg-13', 'R+', 'R17', 'NC-17', …);
 * unrecognized ratings keep a stable token shape instead of being dropped.
 * `ageRatings` adds region-aware entries ({ region, rating }) for rating
 * systems that carry jurisdiction detail (JP/US/PEGI/…); when a provider only
 * supplies the scalar, it derives one INTL entry so every record is uniform.
 */
const AGE_RATING_ALIASES = {
  NONE: 'NONE', G: 'G', PG: 'PG',
  PG13: 'PG_13', PG_13: 'PG_13',
  R: 'R_17', 'R+': 'R_17', R17: 'R_17', R_17: 'R_17',
  R18: 'R_18', R_18: 'R_18', NC17: 'R_18', NC_17: 'R_18',
  RX: 'RX',
}
const AGE_REGION_ALIASES = {
  JAPAN: 'JP', JPN: 'JP',
  USA: 'US', UNITED_STATES: 'US',
  UK: 'GB', UNITED_KINGDOM: 'GB',
  KOREA: 'KR', CHINA: 'CN', TAIWAN: 'TW', AUSTRALIA: 'AU',
  EU: 'EU', PEGI: 'PEGI',
}

function normalizeAgeRating(value) {
  const token = normalizeToken(value)
  return token ? (AGE_RATING_ALIASES[token] ?? token.slice(0, 16)) : null
}

function normalizeAgeRatings(input, scalarRating) {
  const out = []
  const seen = new Set()
  const add = (rawRegion, rawRating) => {
    if (out.length >= 8) return
    const regionToken = normalizeToken(rawRegion)
    const region = AGE_REGION_ALIASES[regionToken] ?? regionToken.slice(0, 16)
    const rating = normalizeAgeRating(rawRating)
    if (!region || !rating) return
    const key = `${region}|${rating}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ region, rating })
  }
  const entries = Array.isArray(input) ? input : []
  for (const raw of entries) {
    const e = raw && typeof raw === 'object' ? raw : {}
    add(e.region, e.rating)
  }
  if (out.length === 0 && scalarRating) add('INTL', scalarRating)
  return out
}

/**
 * Score normalization (AV-012): the scalar `score` is the normalized percent
 * (0–100, 0.1 precision; zero preserved, invalid → null). `scores` retains
 * each provider's claim on its ORIGINAL scale ({ source, value, scale }, e.g.
 * MAL 8.4/10) without rounding — fidelity of the raw claim — while
 * `scorePercent()` converts any claim to the normalized scale. A scalar-only
 * record from a known provider source derives one percent-scale claim so every
 * record is uniform.
 */
function normalizeScore(value) {
  const s = String(value ?? '').trim().replace(/%+$/, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : null
}

function normalizeScores(input, scalarScore, recordSource) {
  const out = []
  const seen = new Set()
  const add = (rawSource, rawValue, rawScale) => {
    if (out.length >= 8) return
    const source = providerSlug(rawSource)
    const value = Number(rawValue)
    const scale = rawScale === undefined || rawScale === null || rawScale === '' ? 100 : Number(rawScale)
    if (!source || !Number.isFinite(value) || value < 0 || !Number.isFinite(scale) || scale <= 0 || value > scale) return
    if (seen.has(source)) return
    seen.add(source)
    out.push({ source, value, scale })
  }
  for (const raw of Array.isArray(input) ? input : []) {
    const e = raw && typeof raw === 'object' ? raw : {}
    add(e.source, e.value, e.scale)
  }
  if (out.length === 0 && scalarScore !== null && recordSource) add(recordSource, scalarScore, 100)
  return out
}

/** Converts a retained provider claim to the normalized percent scale (AV-012). */
export function scorePercent(entry) {
  const value = Number(entry?.value)
  const scale = Number(entry?.scale)
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0 || value < 0 || value > scale) return null
  return Math.round((value / scale) * 1000) / 10
}

/**
 * Date and broadcast normalization (AV-013): partial dates keep AniList's
 * fuzzy semantics in a consistent shape ({ year, month, day }; month/day null
 * when unannounced — a day without its month is dropped) and broadcast slots
 * normalize to a day-of-week plus 24h HH:MM time (time null when unannounced;
 * a slot without a day is meaningless and becomes null).
 */
const BROADCAST_DAYS = new Set(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'])
const BROADCAST_DAY_ALIASES = {
  SUN: 'SUNDAY', MON: 'MONDAY', TUE: 'TUESDAY', TUES: 'TUESDAY',
  WED: 'WEDNESDAY', THU: 'THURSDAY', THUR: 'THURSDAY', THURS: 'THURSDAY',
  FRI: 'FRIDAY', SAT: 'SATURDAY',
}

export function normalizePartialDate(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'string')) return null
  let rawYear = null
  let rawMonth = null
  let rawDay = null
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/)
    if (!m) return null
    rawYear = m[1]
    rawMonth = m[2] ?? null
    rawDay = m[3] ?? null
  } else {
    rawYear = value.year ?? null
    rawMonth = value.month ?? null
    rawDay = value.day ?? null
  }
  const year = Number(rawYear)
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null
  const month = Number(rawMonth)
  const day = Number(rawDay)
  const monthOk = rawMonth !== null && Number.isInteger(month) && month >= 1 && month <= 12
  const dayOk = rawDay !== null && Number.isInteger(day) && day >= 1 && day <= 31
  return { year, month: monthOk ? month : null, day: monthOk && dayOk ? day : null }
}

function normalizeBroadcastTime(value) {
  const m = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function normalizeBroadcast(value) {
  if (!value || typeof value !== 'object') return null
  const token = normalizeToken(value.dayOfWeek)
  const dayOfWeek = BROADCAST_DAYS.has(token) ? token : (BROADCAST_DAY_ALIASES[token] ?? null)
  if (!dayOfWeek) return null
  return { dayOfWeek, time: normalizeBroadcastTime(value.time) }
}

const MAX_REFRESH_TS = 4102444800 // 2100-01-01; guards nonsense timestamps

function normalizeTimestamp(value) {
  const ts = Number(value)
  return Number.isFinite(ts) && ts > 0 && ts <= MAX_REFRESH_TS ? Math.floor(ts) : null
}

/** One provider's claim about a field value (AV-004): who said what. */
function normalizeClaim(rawClaim) {
  const claim = rawClaim && typeof rawClaim === 'object' ? rawClaim : {}
  const source = providerSlug(claim.source)
  if (!source) return null
  const raw = claim.value
  let value
  if (typeof raw === 'string') value = raw.trim().slice(0, 200)
  else if (typeof raw === 'number' && Number.isFinite(raw)) value = raw
  else if (typeof raw === 'boolean' || raw === null || raw === undefined) value = raw ?? null
  else if (typeof raw === 'object') {
    // Object-valued claims (dates, episode slots) are JSON-cloned and bounded
    // so corrections can preserve structured originals without leaking refs.
    try {
      const json = JSON.stringify(raw)
      if (typeof json !== 'string' || json.length > 1000) return null
      value = JSON.parse(json)
    } catch {
      return null
    }
  } else return null
  return { source, value }
}

/** Normalizes alternate-claim lists: valid claims only, one per provider (last wins), max 8. */
function normalizeAlternates(input) {
  const bySource = new Map()
  for (const raw of Array.isArray(input) ? input : []) {
    const claim = normalizeClaim(raw)
    if (claim) bySource.set(claim.source, claim)
  }
  return [...bySource.values()].slice(0, 8)
}

/**
 * Metadata provenance (AV-003): which provider produced the record and when it
 * was last refreshed. `fields` holds per-field overrides ({ source, refreshedAt })
 * only where provenance differs from the record-level default; every other field
 * inherits the default, so source + timestamp cover every field without storing
 * duplicate entries. Null means unknown.
 */
export function normalizeMeta(options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const fields = {}
  const overrides = opts.fields && typeof opts.fields === 'object' ? Object.entries(opts.fields) : []
  for (const [rawField, rawProvenance] of overrides) {
    const field = String(rawField ?? '').trim()
    if (!field || field.length > 40 || RESERVED_ID_PROVIDERS.has(field)) continue
    const p = rawProvenance && typeof rawProvenance === 'object' ? rawProvenance : {}
    const fSource = providerSlug(p.source)
    const fAt = normalizeTimestamp(p.refreshedAt)
    const alternates = normalizeAlternates(p.alternates)
    if (!fSource && fAt === null && alternates.length === 0) continue
    fields[field] = { source: fSource, refreshedAt: fAt, alternates }
  }
  const meta = { source: providerSlug(opts.source), refreshedAt: normalizeTimestamp(opts.refreshedAt), fields, states: normalizeValueStates(opts.states) }
  // AV-022: optional bounded failure note; absent when the last fetch worked.
  const fetchFailure = normalizeFetchFailure(opts.fetchFailure)
  if (fetchFailure) meta.fetchFailure = fetchFailure
  return meta
}

/**
 * AV-022: a bounded note that the last metadata refresh attempt failed. The
 * record's last-known-good values are never touched — only `meta.fetchFailure`
 * is added or removed.
 */
function normalizeFetchFailure(input) {
  const f = input && typeof input === 'object' ? input : null
  if (!f) return null
  const at = normalizeTimestamp(f.at)
  const message = String(f.message ?? '').trim().slice(0, 200)
  if (at === null || !message) return null
  return { at, message }
}

/** Returns a copy of `record` with a fetch-failure note on its meta (AV-022). */
export function withFetchFailure(record, failure) {
  if (!record || typeof record !== 'object') throw new TypeError('record required')
  const note = normalizeFetchFailure(failure)
  if (!note) return record
  return { ...record, meta: { ...record.meta, fetchFailure: note } }
}

/** Returns a copy of `record` without its fetch-failure note (AV-022). */
export function clearFetchFailure(record) {
  if (!record || typeof record !== 'object') throw new TypeError('record required')
  if (!record.meta?.fetchFailure) return record
  const meta = { ...record.meta }
  delete meta.fetchFailure
  return { ...record, meta }
}

/**
 * AV-023: structured artwork variants — kind, source URL, pixel dimensions and
 * attribution. Bounded (≤12 entries), deduped by kind|url, every entry cloned;
 * unknown kinds and non-http(s) URLs are dropped. Dimensions are positive
 * integers ≤ 20000 or null.
 */
const ARTWORK_KINDS = new Set(['POSTER', 'BANNER', 'THUMBNAIL'])

function normalizeDimension(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null
}

function normalizeArtworkVariants(input) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(input) ? input.slice(0, 48) : []) {
    const v = raw && typeof raw === 'object' ? raw : null
    if (!v) continue
    const kind = normalizeToken(v.kind)
    if (!ARTWORK_KINDS.has(kind)) continue
    const url = String(v.url ?? '').trim().slice(0, 512)
    if (!/^https?:\/\//i.test(url)) continue
    const key = `${kind}|${url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind,
      url,
      source: providerSlug(v.source),
      width: normalizeDimension(v.width),
      height: normalizeDimension(v.height),
      attribution: v.attribution == null ? null : String(v.attribution).trim().slice(0, 200) || null,
    })
    if (out.length >= 12) break
  }
  return out
}

/**
 * AV-024: metadata completeness score (0–100) for a catalog entry — weighted
 * coverage of the fields that make a record useful to a viewer. Weights sum to
 * 100 and live in COMPLETENESS_WEIGHTS. A field counts as filled when its
 * normalized value is present: zero and empty strings do not count, and the
 * fallback display title ('Anime #id') does not count as a real title.
 */
const COMPLETENESS_WEIGHTS = {
  title: 10,
  description: 15,
  genres: 10,
  tags: 5,
  companies: 10,
  score: 10,
  startDate: 5,
  endDate: 5,
  episodes: 5,
  duration: 5,
  ageRating: 5,
  links: 5,
  cover: 5,
  externalIds: 5,
}

/** Bounded, deduped non-empty name strings (AV-058 people fields). */
export function normalizeNameList(input, max = 12) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(input) ? input.slice(0, 48) : []) {
    const name = String(raw ?? '').trim().slice(0, 120)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= max) break
  }
  return out
}

export function completenessScore(record) {
  const r = record && typeof record === 'object' ? record : {}
  const filled = {
    title: Boolean(r.romaji || r.english || r.native),
    description: Boolean(r.description),
    genres: Array.isArray(r.genres) && r.genres.length > 0,
    tags: Array.isArray(r.tags) && r.tags.length > 0,
    companies: Array.isArray(r.companies) && r.companies.length > 0,
    score: r.score !== null && r.score !== undefined,
    startDate: Boolean(r.startDate),
    endDate: Boolean(r.endDate),
    episodes: r.episodes !== null && r.episodes !== undefined,
    duration: r.duration !== null && r.duration !== undefined,
    ageRating: Boolean(r.ageRating),
    links: Array.isArray(r.links) && r.links.length > 0,
    cover: Boolean(r.cover),
    externalIds: Boolean(r.externalIds && Object.keys(r.externalIds).length > 0),
  }
  let score = 0
  for (const [field, weight] of Object.entries(COMPLETENESS_WEIGHTS)) {
    if (filled[field]) score += weight
  }
  return score
}

/**
 * Value-state annotations (AV-014): `meta.states` marks absent fields whose
 * meaning differs from plain "unknown" — 'UNANNOUNCED' (known to be pending)
 * or 'NOT_APPLICABLE' (the concept does not apply). Absent values default to
 * UNKNOWN; only these two annotations are storable.
 */
const VALUE_STATES = new Set(['UNANNOUNCED', 'NOT_APPLICABLE'])

function normalizeValueStates(input) {
  const out = {}
  for (const [rawField, rawState] of input && typeof input === 'object' ? Object.entries(input) : []) {
    const field = String(rawField ?? '').trim()
    const state = normalizeToken(rawState)
    if (!field || field.length > 40 || RESERVED_ID_PROVIDERS.has(field)) continue
    if (!VALUE_STATES.has(state)) continue
    out[field] = state
  }
  return out
}

/**
 * Distinguishes unknown, unannounced and not-applicable values (AV-014): a
 * present value is KNOWN (including 0 and ''), an absent value takes its
 * annotated state from `meta.states`, and everything else is UNKNOWN.
 */
export function fieldValueState(record, field) {
  const key = String(field)
  const value = record?.[key]
  if (value !== null && value !== undefined) return 'KNOWN'
  const states = record?.meta?.states
  const state = states && Object.hasOwn(states, key) ? states[key] : null
  return state ?? 'UNKNOWN'
}

/** Resolves source + last-refresh timestamp for any field (AV-003). */
export function fieldProvenance(record, field) {
  const meta = record?.meta
  const key = String(field)
  const override = meta?.fields && Object.hasOwn(meta.fields, key) ? meta.fields[key] : null
  const entry = override ?? { source: meta?.source ?? null, refreshedAt: meta?.refreshedAt ?? null }
  return {
    source: entry.source ?? null,
    refreshedAt: entry.refreshedAt ?? null,
    alternates: (entry.alternates ?? []).map((claim) => ({ ...claim })),
  }
}

/**
 * Records a field-level provider disagreement (AV-004) and returns a NEW meta.
 * The winning claim becomes the field's provenance; every alternate claim is
 * kept as evidence in `alternates`, merged with claims already recorded.
 */
export function withFieldDisagreement(meta, field, winning, alternates = []) {
  const key = String(field ?? '').trim()
  if (!key || key.length > 40 || RESERVED_ID_PROVIDERS.has(key)) {
    throw new TypeError('Field name is required for a provenance disagreement')
  }
  const base = normalizeMeta(meta) // re-validates whatever came before
  const claim = winning && typeof winning === 'object' ? winning : {}
  const prev = Object.hasOwn(base.fields, key) ? base.fields[key] : null
  return {
    ...base,
    fields: {
      ...base.fields,
      [key]: {
        source: providerSlug(claim.source) ?? prev?.source ?? null,
        refreshedAt: normalizeTimestamp(claim.refreshedAt) ?? prev?.refreshedAt ?? null,
        alternates: normalizeAlternates([...(prev?.alternates ?? []), ...(Array.isArray(alternates) ? alternates : [])]),
      },
    },
  }
}

/**
 * Normalizes a provider-identifier collection (AV-002) into a fresh map of
 * provider slug → string id. Accepts either a map ({ anilist: 21 }) or an
 * array of { provider, id } entries so adapters can supply whichever shape
 * they naturally produce. Invalid or reserved entries are dropped and ids are
 * stringified, so numeric provider ids and URL-derived ids both work.
 */
export function normalizeExternalIds(input) {
  const entries = Array.isArray(input)
    ? input.map((entry) => [entry?.provider, entry?.id])
    : input && typeof input === 'object'
      ? Object.entries(input)
      : []
  const out = {}
  for (const [rawProvider, rawId] of entries) {
    const provider = providerSlug(rawProvider)
    if (!provider) continue
    const id = String(rawId ?? '').trim()
    if (!id || id.length > 64) continue
    out[provider] = id
  }
  return out
}

/**
 * Returns a NEW identifier map with `provider` set to `id`. Passing an empty
 * id removes the entry. The input map is never mutated.
 */
export function setExternalId(externalIds, provider, id) {
  const next = { ...normalizeExternalIds(externalIds) }
  const key = String(provider ?? '').trim().toLowerCase()
  const value = String(id ?? '').trim()
  if (!value) delete next[key]
  else next[key] = value
  return next
}

/** Looks up one provider id (case-insensitive); returns null when absent. */
export function getExternalId(externalIds, provider) {
  const key = String(provider ?? '').trim().toLowerCase()
  return externalIds && Object.hasOwn(externalIds, key) ? externalIds[key] : null
}
