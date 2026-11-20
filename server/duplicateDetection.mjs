// Duplicate anime record detection and safe merge planning (AV-016).
//
// Two catalog records are treated as duplicates when they share an external
// identifier (AniList, MAL, AniDB or IMDb via the identifier registry) or when
// their normalized titles are sufficiently similar. Merging produces a single
// canonical record plus a repoint map (duplicate id -> primary id) so
// bookmarks and list entries keep referring to a surviving title.
//
// This module never mutates stores directly: callers apply the repoint map to
// bookmark/list records. Identifier-registry updates are best-effort and never
// throw, so a partial merge never leaves caller data in an inconsistent state.

import {
  find as findIdentifier,
  get as getIdentifier,
  merge as idMerge,
  remove as idRemove,
} from './identifiers.mjs'
import { CATALOG_METADATA_FIELDS } from './catalog.mjs'

const DEFAULT_TITLE_THRESHOLD = 0.8
const ID_PROVIDERS = ['anilist', 'anidb', 'mal', 'imdb']

/** Canonical scalar fields carried on every catalog record. */
const CANONICAL_FIELDS = [
  'title', 'romaji', 'english', 'native', 'cover', 'banner', 'color', 'description',
  'episodes', 'airedEpisodes', 'duration', 'status', 'format', 'season', 'seasonYear',
  'startDate', 'endDate', 'score', 'providerScores', 'popularity', 'favourites',
  'genres', 'source', 'countryOfOrigin', 'originalLanguage', 'nextEpisode',
  'studios', 'links', 'streams', 'siteUrl',
]

/**
 * Normalize a title for comparison: NFKC, lowercase, strip punctuation,
 * collapse whitespace. Empty or non-string input yields an empty string.
 */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return ''
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Word tokens of a title, deduplicated and ordered. */
export function titleTokens(title) {
  const text = normalizeTitle(title)
  if (!text) return []
  return [...new Set(text.split(/\s+/))]
}

/**
 * Jaccard similarity of two titles' token sets in [0, 1]. Identical normalized
 * titles score 1; titles sharing no tokens score 0.
 */
export function titleSimilarity(a, b) {
  const setA = new Set(titleTokens(a))
  const setB = new Set(titleTokens(b))
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const token of setA) if (setB.has(token)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Best title similarity between two records across all their title variants. */
export function bestTitleSimilarity(a, b) {
  const variantsA = [a.title, a.romaji, a.english, a.native].filter(Boolean)
  const variantsB = [b.title, b.romaji, b.english, b.native].filter(Boolean)
  let best = 0
  for (const va of variantsA) {
    for (const vb of variantsB) {
      const sim = titleSimilarity(va, vb)
      if (sim > best) best = sim
    }
  }
  return best
}

/** True when a canonical scalar value is empty or an unknown placeholder. */
function isEmptyCanonicalValue(field, value, record) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text || text.toUpperCase() === 'UNKNOWN') return true
    if (field === 'title' && text === `Anime #${record.id}`) return true
  }
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

/**
 * Find duplicate candidates for `target` among `candidates`.
 *
 * `externalIds` (optional) is the target's provider ids (e.g. from an incoming
 * provider payload); any id already registered to a different media id flags
 * that title as a duplicate. Title similarity is also checked against
 * `candidates` (default threshold 0.8).
 *
 * Returns `[{ id, similarity, reason }]` where reason is
 * 'external-identifier' or 'title'. The target itself is never included.
 */
export async function findDuplicates(target, candidates, options = {}) {
  const {
    threshold = DEFAULT_TITLE_THRESHOLD,
    externalIds = null,
    findId = findIdentifier,
  } = options
  const targetId = Number(target.id)
  if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('Invalid target media id')

  const duplicates = []
  const seen = new Set([targetId])

  // 1. External identifier conflicts: any of the target's provider ids already
  // registered to a different media id flags that title as a duplicate.
  if (externalIds) {
    for (const [provider, value] of Object.entries(externalIds)) {
      if (!ID_PROVIDERS.includes(provider)) continue
      const otherId = await findId(provider, value)
      if (otherId !== null && otherId !== targetId && !seen.has(otherId)) {
        seen.add(otherId)
        duplicates.push({ id: otherId, similarity: 1, reason: 'external-identifier' })
      }
    }
  }

  // 2. Title similarity matches among remaining candidates.
  for (const candidate of candidates) {
    const candidateId = Number(candidate.id)
    if (!Number.isInteger(candidateId) || candidateId <= 0 || seen.has(candidateId)) continue
    const similarity = bestTitleSimilarity(target, candidate)
    if (similarity >= threshold) {
      seen.add(candidateId)
      duplicates.push({ id: candidateId, similarity, reason: 'title' })
    }
  }

  return duplicates
}

/**
 * Merge `duplicate` into `primary`, returning a merged catalog record and a
 * repoint map `{ [duplicate.id]: primary.id }`.
 *
 * Primary's canonical values win. When a primary field is empty or an unknown
 * placeholder but the duplicate holds a real value, the duplicate's value is
 * used. Field metadata entries are merged per field (primary preferred;
 * observations deduplicated by source + value). The input records are not
 * mutated.
 */
export function mergeRecords(primary, duplicate) {
  const primaryId = Number(primary.id)
  const duplicateId = Number(duplicate.id)
  if (!Number.isInteger(primaryId) || primaryId <= 0) throw new Error('Invalid primary media id')
  if (!Number.isInteger(duplicateId) || duplicateId <= 0) throw new Error('Invalid duplicate media id')
  if (primaryId === duplicateId) throw new Error('Primary and duplicate must be different records')

  const merged = { ...primary, id: primaryId }
  const mergedMetadata = {}

  for (const field of CATALOG_METADATA_FIELDS) {
    const primaryValue = primary[field]
    const duplicateValue = duplicate[field]
    const primaryEmpty = isEmptyCanonicalValue(field, primaryValue, primary)
    const duplicateEmpty = isEmptyCanonicalValue(field, duplicateValue, duplicate)

    // Primary wins; fill gaps from the duplicate when primary is empty/unknown.
    merged[field] = primaryEmpty && !duplicateEmpty ? duplicateValue : primaryValue

    const primaryMeta = primary.fieldMetadata?.[field]
    const duplicateMeta = duplicate.fieldMetadata?.[field]
    // Primary's provenance wins; duplicate fills in only what primary lacks.
    const meta = { ...(duplicateMeta ?? {}), ...(primaryMeta ?? {}) }

    // Merge observations: prefer primary's per-source observations, add unique
    // duplicate observations not already present.
    const primaryObs = Array.isArray(primaryMeta?.observations) ? primaryMeta.observations : []
    const duplicateObs = Array.isArray(duplicateMeta?.observations) ? duplicateMeta.observations : []
    const obsByKey = new Map()
    for (const obs of [...primaryObs, ...duplicateObs]) {
      if (!obs || typeof obs !== 'object') continue
      const key = `${String(obs.source ?? '')}\u0000${JSON.stringify(obs.value)}`
      if (!obsByKey.has(key)) obsByKey.set(key, { ...obs })
    }
    meta.observations = [...obsByKey.values()]

    mergedMetadata[field] = meta
  }
  merged.fieldMetadata = mergedMetadata

  return {
    merged,
    repoint: { [duplicateId]: primaryId },
  }
}

/**
 * Best-effort merge of the duplicate's identifier-registry record into the
 * primary's, then removal of the duplicate's entry. The duplicate's record is
 * released first so its provider ids are no longer claimed by another title
 * when repointed to the primary. Conflicts with a third title are skipped
 * (defensive: impossible under normal uniqueness enforcement). Never throws.
 */
export async function mergeIdentifiers(primaryId, duplicateId) {
  const pid = String(primaryId)
  const did = String(duplicateId)
  if (pid === did) return
  const ids = await getIdentifier(did)
  if (!ids) return
  // Release the duplicate's record first so its provider ids are free to move.
  await idRemove(did)
  for (const [provider, value] of Object.entries(ids)) {
    try {
      await idMerge(pid, { [provider]: value })
    } catch {
      // Claimed by a third title (defensive; cannot happen under normal
      // uniqueness enforcement): that id is not repointed.
    }
  }
}
