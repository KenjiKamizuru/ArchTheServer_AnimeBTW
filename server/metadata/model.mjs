// Unified anime model + field-level provenance merge (AV-117a).
// Rule (Phase 4): a verified value is NEVER overwritten by an unverified or
// conflicting one; disagreements are retained in provenance, not resolved by
// guesswork. Missing information stays unknown — nothing is invented here.

export const FIELD_SOURCES = {
  relations: ['anilist', 'mal', 'anidb', 'kitsu'],
  titles: ['anilist', 'mal', 'kitsu', 'anidb'],
  episodes: ['anilist', 'mal', 'kitsu', 'ann'],
  externalIds: ['wikidata', 'kitsu', 'anilist'],
  studios: ['anilist', 'ann', 'tmdb'],
  release: ['anilist', 'mal', 'kitsu'],
  format: ['anilist', 'mal'],
  status: ['anilist', 'mal'],
}

export function emptyUnifiedAnime() {
  return {
    internalId: null,
    titles: { canonical: null, english: null, romaji: null, native: null, alternatives: [] },
    release: { year: null, season: null, startDate: null, endDate: null },
    format: null,
    episodes: null,
    status: null,
    studios: [],
    genres: [],
    tags: [],
    externalIds: {},
    franchise: { key: null, role: null },
    relations: [],
    provenance: {},
    lastVerifiedAt: null,
  }
}

/** Coerce partial provider output into the unified shape; unknown stays null. */
export function normalizeUnifiedAnime(input = {}) {
  const base = emptyUnifiedAnime()
  return {
    ...base,
    ...input,
    titles: { ...base.titles, ...(input.titles ?? {}) },
    release: { ...base.release, ...(input.release ?? {}) },
    externalIds: { ...(input.externalIds ?? {}) },
    franchise: { ...base.franchise, ...(input.franchise ?? {}) },
    studios: Array.isArray(input.studios) ? input.studios : base.studios,
    genres: Array.isArray(input.genres) ? input.genres : base.genres,
    tags: Array.isArray(input.tags) ? input.tags : base.tags,
    relations: Array.isArray(input.relations) ? input.relations : base.relations,
    provenance: { ...(input.provenance ?? {}) },
  }
}

/**
 * Merge one field from a provider candidate.
 * candidate: { source, sourceId, value, verification: 'verified'|'unverified', updatedAt }
 * Returns { record, outcome: 'accepted' | 'kept-verified' | 'conflict-retained' }.
 */
export function mergeField(record, field, candidate, { now = Date.now() } = {}) {
  const provenance = [...(record.provenance?.[field] ?? [])]
  const entry = {
    source: candidate.source,
    sourceId: candidate.sourceId ?? null,
    value: candidate.value,
    verification: candidate.verification ?? 'unverified',
    updatedAt: candidate.updatedAt ?? now,
  }
  const current = provenance.filter((item) => item.verification === 'verified').pop()
    ?? provenance.filter((item) => item.verification !== 'conflicting').pop()
    ?? null

  // Conflict: a verified value disagrees with a different candidate value.
  if (current && current.verification === 'verified' && entry.verification !== 'verified') {
    if (valuesDiffer(current.value, entry.value)) {
      entry.verification = 'conflicting'
      provenance.push(entry)
      return withProvenance(record, field, provenance, 'kept-verified')
    }
  }
  if (current && valuesDiffer(current.value, entry.value) && current.verification === 'verified') {
    entry.verification = 'conflicting'
    provenance.push(entry)
    return withProvenance(record, field, provenance, 'kept-verified')
  }

  provenance.push(entry)
  const next = withProvenance(record, field, provenance, 'accepted')
  next.record = setFieldPath(next.record, field, current && current.verification === 'verified' && valuesDiffer(current.value, entry.value) ? current.value : entry.value)
  return next
}

function withProvenance(record, field, provenance, outcome) {
  return { record: { ...record, provenance: { ...(record.provenance ?? {}), [field]: provenance } }, outcome }
}

function setFieldPath(record, field, value) {
  if (field.includes('.')) {
    const [head, ...rest] = field.split('.')
    return { ...record, [head]: setFieldPath(record?.[head] ?? {}, rest.join('.'), value) }
  }
  return { ...record, [field]: value }
}

function valuesDiffer(a, b) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
}

/** Episode counts from several providers: spread > 0 ⇒ discrepancy flag. */
export function flagEpisodeDiscrepancy(record) {
  const values = (record.provenance?.episodes ?? [])
    .map((item) => Number(item.value))
    .filter((value) => Number.isFinite(value))
  const unique = [...new Set(values)]
  const flag = unique.length > 1
  return {
    record: { ...record, episodesDiscrepancy: flag || record.episodesDiscrepancy === true ? flag : undefined },
    discrepancy: flag,
    values: unique,
  }
}
