// Two-tier metadata cache (AV-021).
//
// Immutable metadata (titles, covers, genres, studios, descriptions, ...) changes
// rarely and is cached with a long TTL. Rapidly changing airing data (currently
// airing shows and their next-episode broadcast times) is cached with a short TTL
// so the schedule stays fresh without re-fetching stable metadata on every
// request. Both tiers share a bounded LRU eviction policy.

const IMMUTABLE_TTL_MS = 60 * 60 * 1000   // 1 hour
const AIRING_TTL_MS = 2 * 60 * 1000       // 2 minutes
const MAX_ENTRIES = 300
const MAX_FAILURES = 100

const immutableCache = new Map()
const airingCache = new Map()
const failures = [] // { key, tier, at, error } — newest push wins; capped at MAX_FAILURES.

function evict(cache) {
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
}

/** Record a metadata fetch failure without touching any cached value. */
function recordFailure(key, tier, at, error) {
  failures.push({ key, tier, at, error: String(error?.message ?? error) })
  if (failures.length > MAX_FAILURES) failures.shift()
}

async function cached(cache, tier, key, loader, ttlMs, options = {}) {
  const { fresh = false } = options
  const resolveNow = typeof options.now === 'function' ? options.now : (() => options.now ?? Date.now())
  const now = resolveNow()
  const hit = cache.get(key)
  if (!fresh && hit && now - hit.at < ttlMs) {
    cache.delete(key)
    cache.set(key, hit)
    return hit.value
  }
  try {
    const value = await loader()
    cache.set(key, { at: now, value })
    evict(cache)
    return value
  } catch (err) {
    // Record the failure for diagnosis, but never erase the last-known-good
    // value: stale data beats an error page.
    recordFailure(key, tier, now, err)
    if (hit) return hit.value
    throw err
  }
}

/** Cache a metadata result that changes rarely (titles, covers, genres, studios, ...). */
export async function cachedImmutable(key, loader, options = {}) {
  return cached(immutableCache, 'immutable', key, loader, IMMUTABLE_TTL_MS, options)
}

/** Cache a rapidly changing airing result (currently airing shows, next air times). */
export async function cachedAiring(key, loader, options = {}) {
  return cached(airingCache, 'airing', key, loader, AIRING_TTL_MS, options)
}

/** Clear both cache tiers. Used by tests and shutdown recovery. */
export function flush() {
  immutableCache.clear()
  airingCache.clear()
}

/** Diagnostic snapshot of cache occupancy. */
export function snapshot() {
  return { immutable: immutableCache.size, airing: airingCache.size }
}

/** Recent metadata fetch failures (key, tier, timestamp, error), oldest first. */
export function recentFailures() {
  return failures.slice()
}
