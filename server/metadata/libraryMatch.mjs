// Local-library matching (AV-117d2, Phase 8): filename/title parsing is
// CANDIDATE GENERATION only — identity is decided by the matchIdentity ladder
// (metadata/identity.mjs). Two local entries are combined ONLY when identity is
// established (same-record / confirmed duplicates); sharing a franchise is
// never a reason to merge, and title similarity alone never matches.

import { matchIdentity, isDuplicateEntry } from './identity.mjs'

/** Lookup-key normalization — identical to library.mjs normalizeLookupKey. */
export function lookupKey(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, '')
}

/** Candidate keys from local titles + injected filename inference (`infer`).
 * The inference output generates candidates; it never decides identity. */
export function candidateKeys(titles, { infer } = {}) {
  const keys = new Set()
  for (const candidate of Array.isArray(titles) ? titles : [titles]) {
    if (!candidate) continue
    keys.add(lookupKey(candidate))
    if (typeof infer === 'function') {
      const inferred = infer(candidate)
      keys.add(lookupKey(inferred?.seriesTitle))
      keys.add(lookupKey(inferred?.seriesFolder))
    }
  }
  keys.delete('')
  return keys
}

function asIdentityInput(entry = {}) {
  return {
    externalIds: entry.externalIds ?? {},
    titles: entry.titles ?? {
      canonical: entry.seriesTitle ?? entry.animeTitle ?? entry.title ?? null,
    },
    title: entry.title ?? entry.seriesTitle ?? entry.animeTitle ?? null,
    romaji: entry.romaji ?? null,
    english: entry.english ?? null,
    native: entry.native ?? null,
    synonyms: entry.synonyms ?? [],
    format: entry.format ?? null,
    release: entry.release ?? { year: entry.year ?? null },
    studios: entry.studios ?? [],
    franchise: entry.franchise ?? undefined,
  }
}

/**
 * Match a local library entry against a resolved online record.
 * Returns { matched, kind, confidence, rung, reasons[] }:
 *   matched=true + kind 'same-record' | 'duplicate-entry' → the identity ladder
 *   established identity; anything else keeps the entries SEPARATE.
 */
export function matchLibraryEntry(local, online, options = {}) {
  const match = matchIdentity(asIdentityInput(local), asIdentityInput(online), options)
  if (match.same === true) {
    return {
      matched: true,
      kind: isDuplicateEntry(match, asIdentityInput(local), asIdentityInput(online))
        ? 'duplicate-entry'
        : 'same-record',
      confidence: match.confidence,
      rung: match.rung,
      reasons: match.reasons,
    }
  }
  return {
    matched: false,
    kind: null,
    confidence: match.confidence,
    rung: match.rung,
    reasons: [
      ...match.reasons,
      'local entries stay separate unless identity is established (franchise membership or similar titles are not identity)',
    ],
  }
}

/** Combine local entries ONLY for confirmed identity — never for franchise. */
export function shouldCombineLocalEntries(match) {
  return match?.matched === true && ['same-record', 'duplicate-entry'].includes(match.kind)
}
