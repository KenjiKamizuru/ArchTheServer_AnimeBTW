// Cross-provider identity matching (AV-117b, Phase 5): decides whether two
// records describe the SAME anime. Title similarity is never the final
// decision. The ladder stops at the first conclusive rung and always records
// its evidence. Kept strictly separate: same-record · duplicate-entry ·
// same-franchise · sequel/prequel · spin-off · alternative-version.

import { titleAliasKeys, normalizeTitleKey } from '../relations.mjs'

const RUNGS = ['external-id', 'verified-mapping', 'titles+year+format', 'studios+window+relations']

/**
 * matchIdentity(a, b, { mappings }) ->
 *   { same: true | false | null, kind: 'same-record' | 'duplicate-entry' | null,
 *     rung, confidence, reasons[] }
 * `same: null` = not established (insufficient evidence) — never guessed.
 * `mappings` = verified cross-database map: { 'mal:37430': 'anilist:98459', ... }
 */
export function matchIdentity(a, b, { mappings = {} } = {}) {
  const reasons = []

  // Rung 1: exact external ID match on any shared database.
  for (const db of ['anilist', 'mal', 'kitsu', 'anidb', 'ann', 'imdb', 'tmdb']) {
    const idA = a?.externalIds?.[db]
    const idB = b?.externalIds?.[db]
    if (idA !== undefined && idA !== null && String(idA) === String(idB)) {
      reasons.push(`same ${db} id ${idA}`)
      return verdict(true, 'same-record', RUNGS[0], 'high', reasons)
    }
  }

  // Rung 2: verified cross-database mappings (Kitsu mappings / Wikidata / store).
  for (const [dbA, idA] of Object.entries(a?.externalIds ?? {})) {
    for (const [dbB, idB] of Object.entries(b?.externalIds ?? {})) {
      const keyA = `${dbA}:${idA}`
      const keyB = `${dbB}:${idB}`
      if (mappings[keyA] === keyB || mappings[keyB] === keyA) {
        reasons.push(`verified mapping ${keyA} ↔ ${keyB}`)
        return verdict(true, 'same-record', RUNGS[1], 'high', reasons)
      }
    }
  }

  // Rung 3: title alias sets + year + format agreement (sets, not fuzzy ratios).
  const keysA = titleAliasKeys(a ?? {})
  const keysB = titleAliasKeys(b ?? {})
  const sharedTitles = [...keysA].some((key) => keysB.has(key))
  const yearA = a?.release?.year ?? a?.seasonYear ?? null
  const yearB = b?.release?.year ?? b?.seasonYear ?? null
  const yearAgrees = yearA !== null && yearB !== null ? Number(yearA) === Number(yearB) : false
  const formatAgrees = Boolean(a?.format && b?.format && a.format === b.format)
  if (sharedTitles && yearAgrees && formatAgrees) {
    reasons.push('alias titles + year + format agree')
    return verdict(true, 'same-record', RUNGS[2], 'medium', reasons)
  }
  if (sharedTitles) {
    reasons.push('title aliases overlap (hint only — not evidence)')
  }

  // Rung 4: studios + release window + relation-graph position.
  const studiosAgree = (a?.studios ?? []).length && (b?.studios ?? []).length
    && a.studios.some((studio) => b.studios.includes(studio))
  const windowsAgree = yearA !== null && yearB !== null && Math.abs(Number(yearA) - Number(yearB)) <= 1
  if (sharedTitles && studiosAgree && windowsAgree && formatAgrees) {
    reasons.push('studios + release window + format agree')
    return verdict(true, 'same-record', RUNGS[3], 'low', reasons)
  }

  // No conclusive evidence: similar names alone must not merge records.
  if (sharedTitles && !yearAgrees && !studiosAgree) {
    reasons.push('similar titles but no confirming metadata')
  } else if (!reasons.length) {
    reasons.push('no identity evidence shared')
  }
  return verdict(null, null, null, 'none', reasons)
}

function verdict(same, kind, rung, confidence, reasons) {
  return { same, kind, rung, confidence, reasons }
}

/** Duplicate-entry check: one database record surfaced under two local rows. */
export function isDuplicateEntry(match, a, b) {
  if (match?.same !== true) return false
  // Duplicates are same-record matches whose DISPLAYED titles differ
  // (e.g. "Re:ZERO -Starting Life in Another World" vs the trailing-dash form).
  const shownA = String(a?.titles?.canonical ?? a?.title ?? '')
  const shownB = String(b?.titles?.canonical ?? b?.title ?? '')
  return shownA !== shownB
}

/** Franchise membership is a DIFFERENT question from identity — kept separate. */
export function franchiseOf(entry) {
  return entry?.franchise?.key ?? null
}
