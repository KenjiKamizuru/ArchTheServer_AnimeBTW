// Small TTL + size-capped cache shared by the resolver.
const MAX_ENTRIES = 200

const cache = new Map()

export function get(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expires < Date.now()) {
    cache.delete(key)
    return null
  }
  // refresh LRU position
  cache.delete(key)
  cache.set(key, hit)
  return hit.value
}

export function set(key, value, ttlMs) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
  cache.set(key, { value, expires: Date.now() + ttlMs })
}
