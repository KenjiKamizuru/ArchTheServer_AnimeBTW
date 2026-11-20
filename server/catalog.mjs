import { createHash } from 'node:crypto'
import { sanitizePublicHttpUrl } from './security.mjs'

/**
 * Provider-neutral catalog record used by the application. Provider adapters
 * translate their responses into these field names; provider-specific anime
 * identifiers live in `identifiers.mjs`, while linked organizations carry
 * source-scoped IDs when needed for entity identity. `id` is the current numeric
 * catalog identity (AniList today).
 *
 * Missing canonical values default to `unknown`; field metadata can explicitly
 * distinguish `unannounced` and `not_applicable` without inferring either from
 * neighboring fields. Duration is normalized to positive whole minutes, score
 * is a 0–100 percentage, and `providerScores` retains source values and scales.
 * `nextEpisode.airingAt` is Unix seconds. `fieldMetadata` tracks each field's
 * value state, chosen source and refresh time, competing provider observations,
 * and a derived conflict flag. Conflicts never silently replace the canonical
 * value. The factory supplies stable defaults and copies collections.
 */
export const CATALOG_METADATA_FIELDS = Object.freeze([
  'title', 'romaji', 'english', 'native', 'cover', 'banner', 'color', 'description',
  'episodes', 'airedEpisodes', 'duration', 'status', 'format', 'season', 'seasonYear', 'startDate', 'endDate',
  'score', 'providerScores', 'popularity', 'favourites', 'genres', 'genreEntities', 'tags', 'source', 'countryOfOrigin',
  'originalLanguage', 'ageRatings', 'nextEpisode', 'studios', 'organizations', 'links', 'streams', 'anidb', 'anidbSearch', 'siteUrl',
])

const MAX_TAXONOMY_LABEL_LENGTH = 160

function normalizeTaxonomyLabel(raw) {
  if (typeof raw !== 'string') return null
  const label = raw.trim()
  if (!label || label.length > MAX_TAXONOMY_LABEL_LENGTH) return null
  const key = label.normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase()
  if (!key) return null
  const ascii = key
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const slug = (ascii || 'unicode').slice(0, 48).replace(/-+$/g, '') || 'unicode'
  return { label, key, slug }
}

// Catalog country values use ISO 3166-1 alpha-2 codes, independent of display locale.
function normalizeCountryOfOrigin(raw) {
  if (typeof raw !== 'string') return null
  const code = raw.normalize('NFKC').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

// Canonicalize ISO 639 / BCP-47 language tags without guessing from country.
function normalizeOriginalLanguage(raw) {
  if (typeof raw !== 'string') return null
  const tag = raw.normalize('NFKC').trim().replace(/_/g, '-')
  if (!tag || tag.length > 64 || /[\u0000-\u001f\u007f]/u.test(tag)) return null
  const subtags = tag.split('-')
  if (!/^[a-z]{2,3}$/i.test(subtags[0]) || subtags.slice(1).some((part) => !/^[a-z0-9]{2,8}$/i.test(part))) {
    return null
  }
  try {
    const locale = new Intl.Locale(tag)
    if (!locale.language || locale.language.toLowerCase() === 'und') return null
    return locale.baseName
  } catch {
    return null
  }
}

function parseNonnegativeInteger(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || text.length > 16 || !/^\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

function optionalDatePart(raw, min, max) {
  if (raw === null || raw === undefined) return { valid: true, value: null }
  const value = parseNonnegativeInteger(raw)
  return value !== null && value >= min && value <= max
    ? { valid: true, value }
    : { valid: false, value: null }
}

/**
 * Normalize a provider FuzzyDate without filling missing parts. Only valid
 * year, year-month, or full calendar dates are retained; an all-unknown date
 * is null. Date-only values never acquire a timezone.
 */
export function normalizeFuzzyDate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const yearPart = optionalDatePart(raw.year, 1, 9999)
  const monthPart = optionalDatePart(raw.month, 1, 12)
  const dayPart = optionalDatePart(raw.day, 1, 31)
  if (!yearPart.valid || !monthPart.valid || !dayPart.valid) return null
  const { year, month, day } = {
    year: yearPart.value,
    month: monthPart.value,
    day: dayPart.value,
  }
  if (year === null) return null
  if (day !== null && month === null) return null
  if (day !== null) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const daysInMonth = month === 2
      ? leapYear ? 29 : 28
      : [4, 6, 9, 11].includes(month) ? 30 : 31
    if (day > daysInMonth) return null
  }
  return { year, month, day }
}

const MAX_BROADCAST_TIMESTAMP_SECONDS = 99_999_999_999
const MAX_AIRING_EPISODE = 99_999

/** Preserve AniList's Unix-seconds unit; never reinterpret millisecond values. */
export function normalizeNextEpisode(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const episode = parseNonnegativeInteger(raw.episode)
  const airingAt = parseNonnegativeInteger(raw.airingAt)
  if (episode === null || episode < 1 || episode > MAX_AIRING_EPISODE) return null
  if (airingAt === null || airingAt > MAX_BROADCAST_TIMESTAMP_SECONDS) return null
  return { episode, airingAt }
}

const DURATION_TO_MINUTES = new Map([
  ['m', 1], ['min', 1], ['mins', 1], ['minute', 1], ['minutes', 1],
  ['s', 1 / 60], ['sec', 1 / 60], ['secs', 1 / 60], ['second', 1 / 60], ['seconds', 1 / 60],
  ['ms', 1 / 60_000], ['millisecond', 1 / 60_000], ['milliseconds', 1 / 60_000],
  ['h', 60], ['hr', 60], ['hrs', 60], ['hour', 60], ['hours', 60],
])
// Match the existing persisted-record duration bound.
const MAX_DURATION_MINUTES = 10_000

// Catalog runtimes are positive, rounded whole minutes. Unannotated numbers
// remain minutes for backward compatibility; alternate units must be explicit.
function normalizeDurationMinutes(raw, unitHint = 'minutes') {
  let value = raw
  let rawUnit = unitHint
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    value = raw.value
    rawUnit = raw.unit ?? unitHint
  }
  const numericText = typeof value === 'string' ? value.trim() : ''
  const numeric = typeof value === 'number'
    ? value
    : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(numericText)
      ? Number(numericText)
      : Number.NaN
  const unit = typeof rawUnit === 'string' ? rawUnit.trim().toLowerCase() : ''
  const multiplier = DURATION_TO_MINUTES.get(unit)
  if (!Number.isFinite(numeric) || numeric <= 0 || multiplier === undefined) return null
  const roundedMinutes = Math.round(numeric * multiplier)
  return Number.isSafeInteger(roundedMinutes) && roundedMinutes > 0 && roundedMinutes <= MAX_DURATION_MINUTES
    ? roundedMinutes
    : null
}

function normalizeAgeRatingRegion(raw) {
  if (typeof raw !== 'string') return null
  const region = raw.normalize('NFKC').trim().toUpperCase()
  if (region === 'GLOBAL') return region
  return /^[A-Z]{2}$/.test(region) ? region : null
}

function normalizeAgeRatingLabel(raw, maxLength) {
  if (typeof raw !== 'string') return null
  const label = raw.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!label || label.length > maxLength || /[\u0000-\u001f\u007f]/u.test(label)) return null
  return label
}

function normalizeMinimumAge(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const text = typeof raw === 'string' ? raw.trim() : ''
  const age = typeof raw === 'number'
    ? raw
    : /^\d{1,3}$/.test(text)
      ? Number(text)
      : Number.NaN
  return Number.isSafeInteger(age) && age >= 0 && age <= 120 ? age : null
}

function normalizeAgeRatings(raw, defaultSource) {
  const byIdentity = new Map()
  for (const candidate of Array.isArray(raw) ? raw : []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    let region = null
    if (candidate.region !== null && candidate.region !== undefined && candidate.region !== '') {
      region = normalizeAgeRatingRegion(candidate.region)
      if (!region) continue
    }
    const rating = normalizeAgeRatingLabel(candidate.rating ?? candidate.value, 80)
    if (!rating) continue
    const rawSystem = candidate.system ?? candidate.ratingSystem
    const systemLabel = normalizeAgeRatingLabel(rawSystem, 48)
    const system = systemLabel ? systemLabel.toUpperCase() : null
    const minimumAge = normalizeMinimumAge(candidate.minimumAge ?? candidate.minAge)
    const source = normalizeMetadataSource(candidate.source ?? candidate.provider ?? defaultSource)
    const normalized = { region, system, rating, minimumAge, source }
    const identity = JSON.stringify([region, system, rating.toUpperCase(), minimumAge, source])
    const existing = byIdentity.get(identity)
    if (!existing || compareText(rating, existing.rating) < 0) byIdentity.set(identity, normalized)
  }
  return [...byIdentity.values()].sort((a, b) =>
    compareText(a.region ?? '', b.region ?? '') ||
    compareText(a.system ?? '', b.system ?? '') ||
    compareText(a.rating.toUpperCase(), b.rating.toUpperCase()) ||
    compareText(a.source ?? '', b.source ?? '') ||
    (a.minimumAge ?? -1) - (b.minimumAge ?? -1),
  )
}

function parseScoreNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function normalizeScoreValue(rawValue, rawScale) {
  const value = parseScoreNumber(rawValue)
  const scale = parseScoreNumber(rawScale)
  if (value === null || scale === null || value < 0 || scale <= 0 || scale > 10_000 || value > scale) return null
  return { value, scale, normalized: Number(((value / scale) * 100).toFixed(2)) }
}

const MAX_PROVIDER_SCORE_ENTRIES = 32

/**
 * Normalize supplied provider scores without guessing a scale. The selected
 * legacy `score` is included by the caller with its known scale; supplemental
 * entries must each declare their own `value` and `scale`.
 */
export function normalizeProviderScores(raw, selectedScore = null, selectedSource = null) {
  const scores = new Map()
  const add = (source, score) => {
    if (!score) return
    const entry = {
      source: normalizeMetadataSource(source),
      value: score.value,
      scale: score.scale,
      normalized: score.normalized,
    }
    scores.set(JSON.stringify([entry.source, entry.value, entry.scale]), entry)
  }
  for (const candidate of Array.isArray(raw) ? raw.slice(0, MAX_PROVIDER_SCORE_ENTRIES) : []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const score = normalizeScoreValue(candidate.value, candidate.scale)
    add(candidate.source ?? selectedSource, score)
  }
  add(selectedSource, selectedScore)
  return [...scores.values()].sort((a, b) =>
    compareText(a.source ?? '', b.source ?? '') ||
    a.value - b.value ||
    a.scale - b.scale,
  )
}

function taxonomyId(kind, key, slug) {
  const digest = createHash('sha256').update(key, 'utf8').digest('hex')
  return `${kind}:${slug}:${digest}`
}

function normalizeGenres(raw) {
  const labels = []
  const byId = new Map()
  for (const candidate of Array.isArray(raw) ? raw : []) {
    const normalized = normalizeTaxonomyLabel(candidate)
    if (!normalized) continue
    labels.push(candidate)
    const id = taxonomyId('genre', normalized.key, normalized.slug)
    const existing = byId.get(id)
    if (!existing || compareText(normalized.label, existing.label) < 0) {
      byId.set(id, { id, label: normalized.label })
    }
  }
  return {
    labels,
    entities: [...byId.values()].sort((a, b) => compareText(a.id, b.id)),
  }
}

function normalizeTags(raw) {
  const byId = new Map()
  for (const candidate of Array.isArray(raw) ? raw : []) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const normalized = normalizeTaxonomyLabel(candidate.name)
    if (!normalized) continue
    const id = taxonomyId('tag', normalized.key, normalized.slug)
    const rank = Number.isFinite(candidate.rank) ? candidate.rank : null
    const tag = {
      id,
      name: normalized.label,
      rank,
      isMediaSpoiler: candidate.isMediaSpoiler === true,
    }
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, tag)
      continue
    }
    if (compareText(tag.name, existing.name) < 0) existing.name = tag.name
    if (rank !== null && (existing.rank === null || rank > existing.rank)) existing.rank = rank
    existing.isMediaSpoiler ||= tag.isMediaSpoiler
  }
  return [...byId.values()].sort((a, b) => compareText(a.id, b.id))
}

const ORGANIZATION_KINDS = new Set(['studio', 'producer', 'licensor', 'distributor'])

function normalizeOrganizationProviderId(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? String(raw) : null
  if (typeof raw !== 'string') return null
  const id = raw.trim()
  return id && id.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(id) ? id : null
}

function normalizeOrganizationAliases(raw, defaultSource) {
  if (!Array.isArray(raw)) return []
  const aliases = new Map()
  for (const value of raw) {
    const alias = typeof value === 'string' ? { name: value } : value
    if (!alias || typeof alias !== 'object' || Array.isArray(alias)) continue
    const normalized = normalizeTaxonomyLabel(alias.name)
    if (!normalized) continue
    const source = normalizeMetadataSource(alias.source ?? alias.provider ?? defaultSource)
    const key = `${source ?? ''}\0${normalized.key}`
    const existing = aliases.get(key)
    if (!existing || compareText(normalized.label, existing.name) < 0) {
      aliases.set(key, { name: normalized.label, source, _key: normalized.key })
    }
  }
  return [...aliases.values()]
    .sort((a, b) => compareText(a.source ?? '', b.source ?? '') || compareText(a._key, b._key))
    .map(({ name, source }) => ({ name, source }))
}

function normalizeOrganization(candidate, defaultSource) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const kind = typeof candidate.kind === 'string' ? candidate.kind.trim().toLowerCase() : ''
  if (!ORGANIZATION_KINDS.has(kind)) return null
  const normalizedName = normalizeTaxonomyLabel(candidate.name)
  if (!normalizedName) return null
  const source = normalizeMetadataSource(candidate.source ?? candidate.provider ?? defaultSource)
  let rawProviderId = candidate.providerId ?? candidate.sourceId
  if (rawProviderId === undefined || rawProviderId === null) {
    if (typeof candidate.id === 'number' || (typeof candidate.id === 'string' && /^\d{1,20}$/.test(candidate.id.trim()))) {
      rawProviderId = candidate.id
    }
  }
  const providerId = normalizeOrganizationProviderId(rawProviderId)
  const digest = createHash('sha256')
    .update(providerId && source ? `${source}\0${providerId}` : normalizedName.key, 'utf8')
    .digest('hex')
  const id = providerId && source
    ? `${kind}:${source}:${digest}`
    : `${kind}:name:${normalizedName.slug}:${digest}`
  return {
    id,
    kind,
    name: normalizedName.label,
    nameKey: normalizedName.key,
    source,
    providerId,
    aliases: normalizeOrganizationAliases(candidate.aliases, source),
    siteUrl: sanitizePublicHttpUrl(candidate.siteUrl, { httpsOnly: true, maxLen: 512 }),
    isAnimationStudio: typeof candidate.isAnimationStudio === 'boolean' ? candidate.isAnimationStudio : null,
  }
}

function mergeOrganizationGroup(group) {
  const sorted = [...group].sort((a, b) =>
    compareText(a.nameKey, b.nameKey) ||
    compareText(a.name, b.name) ||
    compareText(a.source ?? '', b.source ?? '') ||
    compareText(a.providerId ?? '', b.providerId ?? ''),
  )
  const primary = sorted[0]
  const aliases = new Map()
  const addAlias = (name, source) => {
    const normalized = normalizeTaxonomyLabel(name)
    if (!normalized || (normalized.key === primary.nameKey && source === primary.source)) return
    const key = `${source ?? ''}\0${normalized.key}`
    const existing = aliases.get(key)
    if (!existing || compareText(normalized.label, existing.name) < 0) {
      aliases.set(key, { name: normalized.label, source, nameKey: normalized.key })
    }
  }
  for (const item of sorted) {
    if (item.nameKey !== primary.nameKey || item.source !== primary.source) addAlias(item.name, item.source)
    for (const alias of item.aliases) addAlias(alias.name, alias.source)
  }
  const mergedAliases = [...aliases.values()]
    .sort((a, b) => compareText(a.source ?? '', b.source ?? '') || compareText(a.nameKey, b.nameKey))
    .map(({ name, source }) => ({ name, source }))
  const siteUrls = sorted.map((item) => item.siteUrl).filter(Boolean).sort(compareText)
  const studioFlags = sorted.map((item) => item.isAnimationStudio).filter((value) => value !== null)
  return {
    id: primary.id,
    kind: primary.kind,
    name: primary.name,
    source: primary.source,
    providerId: primary.providerId,
    aliases: mergedAliases,
    siteUrl: siteUrls[0] ?? null,
    isAnimationStudio: studioFlags.length ? studioFlags.some(Boolean) : null,
  }
}

function normalizeOrganizations(raw, legacyStudios, defaultSource) {
  const supplied = Array.isArray(raw) ? raw : []
  const hasStudioEntity = supplied.some((item) =>
    item && typeof item === 'object' && !Array.isArray(item) &&
    String(item.kind ?? '').trim().toLowerCase() === 'studio' &&
    normalizeTaxonomyLabel(item.name),
  )
  const candidates = [...supplied]
  if (!hasStudioEntity && Array.isArray(legacyStudios)) {
    for (const name of legacyStudios) candidates.push({ kind: 'studio', name })
  }
  const groups = new Map()
  for (const candidate of candidates) {
    const organization = normalizeOrganization(candidate, defaultSource)
    if (!organization) continue
    const group = groups.get(organization.id) ?? []
    group.push(organization)
    groups.set(organization.id, group)
  }
  return [...groups.values()]
    .map(mergeOrganizationGroup)
    .sort((a, b) => compareText(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`))
}

function normalizeMetadataSource(raw) {
  if (typeof raw !== 'string') return null
  const source = raw.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(source) ? source : null
}

function normalizeRefreshTime(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  let millis
  if (raw instanceof Date) millis = raw.getTime()
  else if (typeof raw === 'number') millis = raw
  else if (typeof raw === 'string' && raw.length <= 64) millis = Date.parse(raw)
  else return null
  if (!Number.isFinite(millis)) return null
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const MAX_FIELD_OBSERVATIONS = 8
const MAX_OBSERVATION_DEPTH = 5
const MAX_OBSERVATION_VALUE_BYTES = 16 * 1024
const FIELD_VALUE_STATES = new Set(['known', 'unknown', 'unannounced', 'not_applicable'])
// Bumped whenever the canonical fieldMetadata / valueState shape changes. Stored
// records (bookmarks, imports) produced by an older schema are upgraded with
// migrateMetadataSchema instead of being silently reinterpreted.
export const METADATA_SCHEMA_VERSION = 1

function cloneObservationValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 4_000)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (depth >= MAX_OBSERVATION_DEPTH) return null
  if (Array.isArray(value)) {
    return value.slice(0, 50)
      .map((item) => cloneObservationValue(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return null
    const result = {}
    for (const key of Object.keys(value).sort().slice(0, 50)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      const item = cloneObservationValue(value[key], depth + 1)
      if (item !== undefined) result[key] = item
    }
    return result
  }
  return undefined
}

function stableValueKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function timestampRank(value) {
  if (!value) return Number.NEGATIVE_INFINITY
  const rank = Date.parse(value)
  return Number.isFinite(rank) ? rank : Number.NEGATIVE_INFINITY
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Keep one current observation per provider. Newer observations win; equal-time
 * duplicates from the same provider are resolved by stable value ordering.
 * Distinct providers are never silently ranked against each other.
 */
function normalizeObservations(raw, fallbackTime, field, record) {
  if (!Array.isArray(raw)) return []
  const values = []
  for (const candidate of raw.slice(0, MAX_FIELD_OBSERVATIONS)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const source = normalizeMetadataSource(candidate.source)
    if (!source || !Object.hasOwn(candidate, 'value') || candidate.value === undefined) continue
    const value = cloneObservationValue(candidate.value)
    if (value === undefined) continue
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_OBSERVATION_VALUE_BYTES) continue
    values.push({
      source,
      value,
      valueState: normalizeFieldValueState(candidate.valueState, field, value, record),
      lastRefreshedAt: normalizeRefreshTime(candidate.lastRefreshedAt) ?? fallbackTime,
    })
  }

  values.sort((a, b) => {
    const bySource = compareText(a.source, b.source)
    if (bySource) return bySource
    const timeA = timestampRank(a.lastRefreshedAt)
    const timeB = timestampRank(b.lastRefreshedAt)
    if (timeA !== timeB) return timeB > timeA ? 1 : -1
    return compareText(stableValueKey([a.valueState, a.value]), stableValueKey([b.valueState, b.value]))
  })
  const latestBySource = new Map()
  for (const observation of values) {
    if (!latestBySource.has(observation.source)) latestBySource.set(observation.source, observation)
  }
  return [...latestBySource.values()]
}

function isUnknownMetadataValue(field, value, record) {
  if (value === null || value === undefined) return true
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text || text.toUpperCase() === 'UNKNOWN') return true
  return field === 'title' && text === `Anime #${record.id}`
}

function normalizeFieldValueState(raw, field, value, record) {
  const inferred = isUnknownMetadataValue(field, value, record) ? 'unknown' : 'known'
  if (typeof raw !== 'string') return inferred
  const requested = raw.trim().toLowerCase().replace(/[\\s-]+/g, '_')
  if (!FIELD_VALUE_STATES.has(requested)) return inferred
  // `known` cannot make a missing placeholder known, but explicit unknown,
  // unannounced and not-applicable states are authoritative when supplied.
  if (requested === 'known') return inferred
  return requested
}

function normalizeManualCorrection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const correctedBy = typeof raw.correctedBy === 'string' && raw.correctedBy.trim()
    ? raw.correctedBy.trim()
    : null
  const correctedAt = normalizeRefreshTime(raw.correctedAt)
  if (!correctedBy || !correctedAt) return null
  return {
    value: raw.value,
    correctedBy,
    correctedAt,
    ...(typeof raw.reason === 'string' && raw.reason.trim() ? { reason: raw.reason.trim() } : {}),
  }
}

function observationsConflict(field, record, selectedSource, observations, canonicalState) {
  const comparableValues = new Set()
  const addComparable = (value, valueState) => {
    if (valueState === 'unknown') return
    comparableValues.add(valueState === 'known'
      ? stableValueKey(['known', value])
      : stableValueKey([valueState]))
  }
  addComparable(record[field], canonicalState)
  for (const observation of observations) {
    if (selectedSource && observation.source === selectedSource) continue
    addComparable(observation.value, observation.valueState)
  }
  return comparableValues.size > 1
}

function createFieldMetadata(input, record) {
  const defaults = {
    source: normalizeMetadataSource(input.metadataSource),
    lastRefreshedAt: normalizeRefreshTime(input.lastRefreshedAt),
  }
  const provided = input.fieldMetadata && typeof input.fieldMetadata === 'object' && !Array.isArray(input.fieldMetadata)
    ? input.fieldMetadata
    : {}
  return Object.fromEntries(CATALOG_METADATA_FIELDS.map((field) => {
    const fieldInfo = provided[field] && typeof provided[field] === 'object' && !Array.isArray(provided[field])
      ? provided[field]
      : null
    const source = fieldInfo && Object.hasOwn(fieldInfo, 'source')
      ? normalizeMetadataSource(fieldInfo.source)
      : defaults.source
    const lastRefreshedAt = fieldInfo && Object.hasOwn(fieldInfo, 'lastRefreshedAt')
      ? normalizeRefreshTime(fieldInfo.lastRefreshedAt)
      : defaults.lastRefreshedAt
    const observations = normalizeObservations(fieldInfo?.observations, lastRefreshedAt, field, record)
    const canonicalState = normalizeFieldValueState(fieldInfo?.valueState, field, record[field], record)
    const manualCorrection = normalizeManualCorrection(fieldInfo?.manualCorrection)
    return [field, {
      // The canonical field value is selected by the adapter/input record; this
      // metadata preserves conflicting provider observations without replacing it.
      valueState: canonicalState,
      source,
      lastRefreshedAt,
      observations,
      conflict: observationsConflict(field, record, source, observations, canonicalState),
      ...(manualCorrection ? { manualCorrection } : {}),
    }]
  }))
}

/**
 * Apply a manual correction to one field of a catalog record, returning a new
 * record. The corrected value becomes the canonical value and is recorded in
 * `fieldMetadata[field].manualCorrection`; provider observations are preserved
 * untouched so the original source data can be restored or compared later.
 * The input record is never mutated.
 */
export function applyManualCorrection(record, field, correction) {
  const normalized = normalizeManualCorrection(correction)
  if (!normalized) throw new TypeError('Invalid manual correction: correctedBy and correctedAt are required')
  if (!CATALOG_METADATA_FIELDS.includes(field)) throw new TypeError(`Unknown catalog field: ${field}`)

  const next = { ...record, [field]: normalized.value }
  const fieldMeta = next.fieldMetadata && typeof next.fieldMetadata === 'object' && !Array.isArray(next.fieldMetadata)
    ? next.fieldMetadata
    : {}
  const existing = fieldMeta[field] && typeof fieldMeta[field] === 'object' && !Array.isArray(fieldMeta[field])
    ? fieldMeta[field]
    : null
  const observations = Array.isArray(existing?.observations) ? existing.observations : []
  const lastRefreshedAt = existing && Object.hasOwn(existing, 'lastRefreshedAt') ? existing.lastRefreshedAt : null
  const valueState = normalizeFieldValueState(undefined, field, normalized.value, next)
  // The corrected value's source is the corrector, so provider observations
  // from other sources are still compared against it for conflicts.
  const conflict = observationsConflict(field, next, normalized.correctedBy, observations, valueState)

  next.fieldMetadata = {
    ...fieldMeta,
    [field]: {
      valueState,
      source: normalized.correctedBy,
      lastRefreshedAt,
      observations,
      conflict,
      manualCorrection: normalized,
    },
  }
  return next
}

/** Catalog fields grouped by how quickly their data goes stale. */
const REFRESH_CATEGORIES = {
  identity: [
    'title', 'romaji', 'english', 'native', 'cover', 'banner', 'color', 'source',
    'countryOfOrigin', 'originalLanguage', 'siteUrl',
  ],
  airing: ['status', 'format', 'season', 'seasonYear', 'startDate', 'endDate',
    'episodes', 'airedEpisodes', 'nextEpisode'],
  score: ['score', 'providerScores', 'popularity', 'favourites'],
  descriptive: ['description', 'genres', 'genreEntities', 'tags', 'ageRatings',
    'studios', 'organizations'],
  links: ['links', 'streams', 'anidb', 'anidbSearch'],
}

/** Maximum staleness age (ms) per entity type and refresh category. */
const REFRESH_MAX_AGE_MS = {
  TV: { identity: 30 * 24 * 60 * 60 * 1000, airing: 60 * 60 * 1000,
    score: 6 * 60 * 60 * 1000, descriptive: 7 * 24 * 60 * 60 * 1000,
    links: 30 * 24 * 60 * 60 * 1000 },
  Movie: { identity: 30 * 24 * 60 * 60 * 1000, airing: 7 * 24 * 60 * 60 * 1000,
    score: 24 * 60 * 60 * 1000, descriptive: 7 * 24 * 60 * 60 * 1000,
    links: 30 * 24 * 60 * 60 * 1000 },
  OVA: { identity: 30 * 24 * 60 * 60 * 1000, airing: 7 * 24 * 60 * 60 * 1000,
    score: 3 * 24 * 60 * 60 * 1000, descriptive: 7 * 24 * 60 * 60 * 1000,
    links: 30 * 24 * 60 * 60 * 1000 },
  ONA: { identity: 30 * 24 * 60 * 60 * 1000, airing: 7 * 24 * 60 * 60 * 1000,
    score: 3 * 24 * 60 * 60 * 1000, descriptive: 7 * 24 * 60 * 60 * 1000,
    links: 30 * 24 * 60 * 60 * 1000 },
  Special: { identity: 30 * 24 * 60 * 60 * 1000, airing: 7 * 24 * 60 * 60 * 1000,
    score: 3 * 24 * 60 * 60 * 1000, descriptive: 7 * 24 * 60 * 60 * 1000,
    links: 30 * 24 * 60 * 60 * 1000 },
  Other: { identity: 30 * 24 * 60 * 60 * 1000, airing: 7 * 24 * 60 * 60 * 1000,
    score: 3 * 24 * 60 * 60 * 1000, descriptive: 7 * 24 * 60 * 60 * 1000,
    links: 30 * 24 * 60 * 60 * 1000 },
}

const DEFAULT_REFRESH_CATEGORY = 'descriptive'

/** Map a catalog `format` string to an entity type used to select a refresh
 * policy. Unknown or missing formats fall back to `Other`. */
export function entityTypeFromFormat(format) {
  if (typeof format !== 'string') return 'Other'
  const normalized = format.trim().toUpperCase().replace(/[\\s-]+/g, '_')
  switch (normalized) {
    case 'TV': return 'TV'
    case 'MOVIE': return 'Movie'
    case 'OVA': return 'OVA'
    case 'ONA': return 'ONA'
    case 'SPECIAL': return 'Special'
    default: return 'Other'
  }
}

/** Refresh category for a catalog field. Fields without an explicit category
 * fall back to `descriptive`. */
export function fieldCategory(field) {
  for (const [category, fields] of Object.entries(REFRESH_CATEGORIES)) {
    if (fields.includes(field)) return category
  }
  return DEFAULT_REFRESH_CATEGORY
}

/** Refresh policy entry for one field on one entity type. */
export function refreshPolicy(entityType, field) {
  const type = entityType && REFRESH_MAX_AGE_MS[entityType] ? entityType : 'Other'
  const category = fieldCategory(field)
  return {
    maxAgeMs: REFRESH_MAX_AGE_MS[type][category],
    category,
  }
}

/** Freshness of one field given its last-refresh time. */
export function fieldFreshness(field, lastRefreshedAt, entityType, now = Date.now()) {
  if (lastRefreshedAt === null || lastRefreshedAt === undefined) return 'never_refreshed'
  let millis
  if (typeof lastRefreshedAt === 'number') millis = lastRefreshedAt
  else millis = Date.parse(lastRefreshedAt)
  if (!Number.isFinite(millis)) return 'unknown'
  const maxAgeMs = refreshPolicy(entityType, field).maxAgeMs
  return now - millis > maxAgeMs ? 'stale' : 'fresh'
}

/** True when a field is stale or was never refreshed. */
export function isFieldStale(field, lastRefreshedAt, entityType, now = Date.now()) {
  return fieldFreshness(field, lastRefreshedAt, entityType, now) !== 'fresh'
}

/**
 * Overall refresh assessment for a catalog record. Evaluates every
 * `CATALOG_METADATA_FIELDS` entry against its entity-type refresh policy and
 * reports which fields are stale or were never refreshed. The record is not
 * mutated.
 */
export function recordRefreshStatus(record, now = Date.now()) {
  const entityType = entityTypeFromFormat(record && record.format)
  const freshness = {}
  const staleFields = []
  for (const field of CATALOG_METADATA_FIELDS) {
    const meta = record.fieldMetadata && typeof record.fieldMetadata === 'object'
      ? record.fieldMetadata[field]
      : null
    const lastRefreshedAt = meta && typeof meta === 'object' && !Array.isArray(meta)
      ? meta.lastRefreshedAt
      : null
    const status = fieldFreshness(field, lastRefreshedAt, entityType, now)
    freshness[field] = status
    if (status !== 'fresh') staleFields.push(field)
  }
  return {
    needsRefresh: staleFields.length > 0,
    staleFields,
    freshness,
  }
}

/** Backfill a missing valueState on a stored observation, inferred from its value. */
function backfillObservationValueState(observation, field, record) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return observation
  if (Object.hasOwn(observation, 'valueState') && observation.valueState != null) return observation
  return {
    ...observation,
    valueState: normalizeFieldValueState(undefined, field, observation.value, record),
  }
}

/**
 * Upgrade a catalog record produced by an older metadata schema to the current
 * METADATA_SCHEMA_VERSION. Records at or above the current version are copied
 * unchanged. Older records gain a complete `fieldMetadata` entry for every
 * catalog field, missing `valueState`s are inferred from the canonical values,
 * and observation states are backfilled. The input is never mutated.
 */
export function migrateMetadataSchema(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record
  const current = Number(record.metadataSchemaVersion)
  if (Number.isFinite(current) && current >= METADATA_SCHEMA_VERSION) {
    return { ...record }
  }
  const migrated = { ...record, metadataSchemaVersion: METADATA_SCHEMA_VERSION }
  const fieldMetadata = {}
  for (const field of CATALOG_METADATA_FIELDS) {
    const existing = record.fieldMetadata && typeof record.fieldMetadata === 'object' && !Array.isArray(record.fieldMetadata)
      && record.fieldMetadata[field] && typeof record.fieldMetadata[field] === 'object' && !Array.isArray(record.fieldMetadata[field])
      ? record.fieldMetadata[field]
      : null
    const observations = Array.isArray(existing?.observations) ? existing.observations : []
    const valueState = existing && Object.hasOwn(existing, 'valueState') && existing.valueState != null
      ? existing.valueState
      : normalizeFieldValueState(undefined, field, record[field], record)
    const processedObservations = observations.map((obs) => backfillObservationValueState(obs, field, record))
    fieldMetadata[field] = {
      valueState,
      source: existing && Object.hasOwn(existing, 'source') ? existing.source : null,
      lastRefreshedAt: existing && Object.hasOwn(existing, 'lastRefreshedAt') ? existing.lastRefreshedAt : null,
      observations: processedObservations,
      conflict: existing && Object.hasOwn(existing, 'conflict') ? existing.conflict
        : observationsConflict(field, record, null, processedObservations, valueState),
    }
  }
  migrated.fieldMetadata = fieldMetadata
  return migrated
}

export function createAnimeRecord(input) {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.id) || input.id <= 0) {
    throw new TypeError('Anime record requires a positive safe integer id')
  }
  const copyLinks = (links) => Array.isArray(links) ? links.map(({ site, url }) => ({ site, url })) : []
  const genres = normalizeGenres(input.genres)
  const tags = normalizeTags(input.tags)
  const organizations = normalizeOrganizations(input.organizations, input.studios, input.metadataSource)
  const selectedScore = normalizeScoreValue(input.score, input.scoreScale === undefined ? 100 : input.scoreScale)
  const scoreFieldMetadata = input.fieldMetadata?.score
  const selectedScoreSource = scoreFieldMetadata && typeof scoreFieldMetadata === 'object' &&
    !Array.isArray(scoreFieldMetadata) && Object.hasOwn(scoreFieldMetadata, 'source')
    ? scoreFieldMetadata.source
    : input.metadataSource
  const providerScores = normalizeProviderScores(input.providerScores, selectedScore, selectedScoreSource)
  const studios = Array.isArray(input.studios)
    ? input.studios.filter((name) => typeof name === 'string')
    : organizations.filter((organization) => organization.kind === 'studio').map((organization) => organization.name)
  const record = {
    id: input.id,
    title: input.title || `Anime #${input.id}`,
    romaji: input.romaji ?? null,
    english: input.english ?? null,
    native: input.native ?? null,
    cover: input.cover ?? null,
    banner: input.banner ?? null,
    color: input.color ?? null,
    description: input.description ?? '',
    episodes: input.episodes ?? null,
    airedEpisodes: input.airedEpisodes ?? 0,
    duration: normalizeDurationMinutes(input.duration, input.durationUnit),
    status: input.status ?? 'UNKNOWN',
    format: input.format ?? null,
    season: input.season ?? null,
    seasonYear: input.seasonYear ?? null,
    startDate: normalizeFuzzyDate(input.startDate),
    endDate: normalizeFuzzyDate(input.endDate),
    score: selectedScore?.normalized ?? null,
    providerScores,
    popularity: input.popularity ?? 0,
    favourites: input.favourites ?? null,
    genres: genres.labels,
    genreEntities: genres.entities,
    tags,
    source: input.source ?? null,
    countryOfOrigin: normalizeCountryOfOrigin(input.countryOfOrigin),
    originalLanguage: normalizeOriginalLanguage(input.originalLanguage),
    ageRatings: normalizeAgeRatings(input.ageRatings, input.metadataSource),
    nextEpisode: normalizeNextEpisode(input.nextEpisode),
    studios,
    organizations,
    links: copyLinks(input.links),
    streams: copyLinks(input.streams),
    anidb: input.anidb ?? null,
    anidbSearch: input.anidbSearch ?? false,
    siteUrl: input.siteUrl ?? null,
    metadataSchemaVersion: METADATA_SCHEMA_VERSION,
  }
  record.fieldMetadata = createFieldMetadata(input, record)
  return record
}
