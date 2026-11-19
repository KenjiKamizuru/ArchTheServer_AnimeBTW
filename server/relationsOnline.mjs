// Online relationship verification pipeline (AV-116b): resolves both entries
// through a database lookup (AniList GraphQL — API access, never HTML
// scraping), caches every resolution and every pair verdict so the same anime
// is never searched twice, and degrades to `uncertain` on lookup failure,
// rate limits, or timeouts instead of guessing.

import { verifyRelationship, relationshipCacheKey, normalizeTitleKey } from './relations.mjs'

export const VERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const UNVERIFIED_TTL_MS = 60 * 60 * 1000

/** Stable cache key for one entry: explicit source ids first, title last. */
export function entryCacheKey(entry = {}) {
  if (entry.sourceIds?.anilist) return `entry:anilist:${entry.sourceIds.anilist}`
  if (entry.sourceIds?.mal) return `entry:mal:${entry.sourceIds.mal}`
  if (entry.sourceIds?.kitsu) return `entry:kitsu:${entry.sourceIds.kitsu}`
  return `entry:title:${normalizeTitleKey(entry.title)}`
}

function cacheRead(cache, key, now) {
  if (!cache) return null
  const entry = cache.get(key)
  if (!entry) return null
  if (Number(entry.expiresAt) <= now) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function cacheWrite(cache, key, value, ttlMs, now) {
  if (!cache) return
  cache.set(key, { value, expiresAt: now + ttlMs })
}

/**
 * Verify a pair with online evidence.
 *
 * - `lookup(entry)` resolves one entry to its evidence shape (relations,
 *   sourceIds, official titles) — usually server/anilist.mjs's GraphQL
 *   lookup; injected here so tests run offline and callers can swap sources.
 * - `cache` is any Map-like store (the kv-backed map at runtime).
 * - Failures/timeouts/rate limits surface as `lookupFailed` reasons and the
 *   verdict becomes uncertain — never a guessed relationship.
 */
export async function verifyPairOnline(entryA, entryB, { lookup, cache = new Map(), now = Date.now(), fresh = false } = {}) {
  const pairKey = relationshipCacheKey(entryCacheKey(entryA), entryCacheKey(entryB))
  if (!fresh) {
    const cached = cacheRead(cache, pairKey, now)
    if (cached) return { ...cached, cached: true }
  }

  const reasons = []
  const [resolvedA, failedA] = await resolveEntry(entryA, { lookup, cache, now, fresh, reasons })
  const [resolvedB, failedB] = await resolveEntry(entryB, { lookup, cache, now, fresh, reasons })

  const relationship = verifyRelationship(resolvedA, resolvedB, { now })
  relationship.reasons = [...reasons, ...relationship.reasons]
  if (failedA || failedB) {
    relationship.uncertain = true
    if (relationship.verification === 'verified') relationship.verification = 'unverified'
  }

  const ttlMs = relationship.uncertain || relationship.verification !== 'verified' ? UNVERIFIED_TTL_MS : VERIFIED_TTL_MS
  cacheWrite(cache, pairKey, relationship, ttlMs, now)
  return relationship
}

async function resolveEntry(entry, { lookup, cache, now, fresh, reasons }) {
  const key = entryCacheKey(entry)
  if (!fresh) {
    const cached = cacheRead(cache, key, now)
    if (cached) return [cached, false]
  }
  if (typeof lookup !== 'function') {
    reasons.push(`no lookup available for ${key}`)
    return [entry, true]
  }
  try {
    const resolved = await lookup(entry)
    if (!resolved || !Array.isArray(resolved.relations)) {
      reasons.push(`lookup returned no evidence for ${key}`)
      return [entry, true]
    }
    cacheWrite(cache, key, resolved, VERIFIED_TTL_MS, now)
    return [resolved, false]
  } catch (err) {
    // Rate limits, timeouts, outages: record and degrade to uncertain.
    reasons.push(`lookup failed for ${key}: ${err?.message ?? 'unknown error'}`)
    return [entry, true]
  }
}
