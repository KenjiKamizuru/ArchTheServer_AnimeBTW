// Admin metadata inspector rows (AV-025b): field-by-field raw → normalized
// comparisons for GET /api/admin/inspect/:id.
//
// Pure functions only — the shapes here are what the inspector route returns,
// so the transformations are verifiable without touching the network.

/** [field, pick(raw, record) → [rawValue, recordValue]] in display order. */
const INSPECTED_FIELDS = [
  ['title', (raw, record) => [titlePart(raw, null), record.title ?? null]],
  ['romaji', (raw, record) => [titlePart(raw, 'romaji'), record.romaji ?? null]],
  ['english', (raw, record) => [titlePart(raw, 'english'), record.english ?? null]],
  ['native', (raw, record) => [titlePart(raw, 'native'), record.native ?? null]],
  ['status', (raw, record) => [raw.status ?? null, record.status ?? null]],
  ['format', (raw, record) => [raw.format ?? null, record.format ?? null]],
  ['episodes', (raw, record) => [raw.episodes ?? null, record.episodes ?? null]],
  ['duration', (raw, record) => [raw.duration ?? null, record.duration ?? null]],
  ['score', (raw, record) => [raw.averageScore ?? null, record.score ?? null]],
  ['popularity', (raw, record) => [raw.popularity ?? null, record.popularity ?? null]],
  ['genres', (raw, record) => [raw.genres ?? null, record.genres ?? null]],
  ['tags', (raw, record) => [raw.tags ?? null, record.tags ?? null]],
  ['studios', (raw, record) => [raw.studios?.nodes ?? null, record.studios ?? null]],
  ['startDate', (raw, record) => [raw.startDate ?? null, record.startDate ?? null]],
  ['endDate', (raw, record) => [raw.endDate ?? null, record.endDate ?? null]],
  ['broadcast', (raw, record) => [raw.broadcast ?? null, record.broadcast ?? null]],
  ['countryOfOrigin', (raw, record) => [raw.countryOfOrigin ?? null, record.countryOfOrigin ?? null]],
  ['source', (raw, record) => [raw.source ?? null, record.source ?? null]],
  ['ageRating', (raw, record) => [raw.isAdult === true ? 'ADULT' : raw.isAdult === false ? null : (raw.isAdult ?? null), record.ageRating ?? null]],
  ['description', (raw, record) => [raw.description ?? null, record.description ?? null]],
  ['externalIds', (raw, record) => [raw.id ?? null, record.externalIds ?? null]],
]

function titlePart(raw, part) {
  const t = raw?.title && typeof raw.title === 'object' ? raw.title : {}
  if (part === null) return raw?.title ?? null
  return t[part] ?? null
}

/**
 * Builds comparison rows: `{ field, raw, normalized, changed }` where `changed`
 * marks a value whose representation was transformed by normalization. Missing
 * inputs yield all-null rows without throwing.
 */
export function buildInspectionRows(raw, record) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const n = record && typeof record === 'object' ? record : {}
  return INSPECTED_FIELDS.map(([field, pick]) => {
    const [rawValue, normalizedValue] = pick(r, n)
    const a = rawValue ?? null
    const b = normalizedValue ?? null
    return { field, raw: a, normalized: b, changed: JSON.stringify(a) !== JSON.stringify(b) }
  })
}
