// Cache tier policy (AV-021a): separate immutable/slow-changing metadata from
// rapidly changing airing data so each is cached as long as it is actually
// trustworthy. Cache keys are semantic (see the prefix table below), which
// keeps the tier choice in one tested place instead of spread across call
// sites. Pure module — no I/O, no clock.

/**
 * Response-cache tiers. 'media' covers catalog listings dominated by
 * slow-changing metadata (titles, studios, staff, relations); 'airing' covers
 * feeds that shift intraday (airing schedules, recently-updated/added rows,
 * the detail volatile overlay, and batch records that carry airing progress).
 * The detail immutable base lives on the media tier (AV-021b).
 */
export const CACHE_TIERS = {
  media: { ttlSeconds: 3600 },
  airing: { ttlSeconds: 300 },
}

/** Cache-key prefix → tier. Longest listed prefix wins; unknown keys are 'media'. */
export const CACHE_KEY_TIERS = [
  ['airing:', 'airing'],
  ['recent:updated:', 'airing'],
  ['recent:added:', 'airing'],
  ['detail:airing:', 'airing'],
  ['detail:', 'media'],
  ['character:', 'media'],
  ['staff:', 'media'],
  ['many:', 'airing'],
  ['season:', 'media'],
  ['browse:', 'media'],
  ['studios:', 'media'],
  ['studio:', 'media'],
  ['index:', 'media'],
  ['franchises:', 'media'],
  ['search:', 'media'],
]

const DEFAULT_TIER = 'media'

/** Tier for a cache key (prefix-based, case-sensitive like the keys). */
export function cacheTierForKey(key) {
  const k = String(key ?? '')
  for (const [prefix, tier] of CACHE_KEY_TIERS) {
    if (k.startsWith(prefix)) return tier
  }
  return DEFAULT_TIER
}

/** TTL in seconds for a tier (unknown tiers fall back to the media tier). */
export function cacheTtlFor(tier) {
  return (CACHE_TIERS[String(tier ?? '').trim().toLowerCase()] ?? CACHE_TIERS[DEFAULT_TIER]).ttlSeconds
}
