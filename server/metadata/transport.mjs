// Shared provider transport (AV-117c1): per-source pacing, response caching,
// and responsible retries. Source rules (docs/ANIME_METADATA_SOURCES.md):
// AniList 90 rpm, MAL ~100 rpm (conservative 600 ms), Kitsu fair-use,
// AniDB 1 req / 2 s + day-level caching, ANN 1 req/s (mandatory), TMDB
// 40 / 10 s, Wikidata fair-use. Failures surface as errors — adapters decide
// how to degrade (relationsOnline turns them into `uncertain`).

const DEFAULTS = { minIntervalMs: 0, cacheTtlMs: 60_000, maxRetries: 2, timeoutMs: 15_000 }

export function createTransport({
  id = 'transport',
  minIntervalMs = DEFAULTS.minIntervalMs,
  cacheTtlMs = DEFAULTS.cacheTtlMs,
  maxRetries = DEFAULTS.maxRetries,
  timeoutMs = DEFAULTS.timeoutMs,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const cache = new Map()
  let lastCallAt = -Infinity
  let chain = Promise.resolve()

  async function request(url, options = {}) {
    const method = options.method ?? 'GET'
    const key = `${method} ${url} ${options.body ?? ''}`
    const ttlMs = options.ttlMs ?? cacheTtlMs
    if (!options.fresh) {
      const hit = cache.get(key)
      if (hit && hit.expiresAt > now()) return hit.value
      if (hit) cache.delete(key)
    }

    // Serialize calls so pacing is honored across concurrent requests.
    const run = chain.then(async () => {
      const wait = lastCallAt + minIntervalMs - now()
      if (wait > 0) await sleep(wait)
    })
    chain = run.catch(() => {})
    await run

    let lastError = null
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      lastCallAt = now()
      try {
        const response = await fetchImpl(url, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.ok) {
          const value = await response.json()
          if (ttlMs > 0) cache.set(key, { value, expiresAt: now() + ttlMs })
          return value
        }
        const retryable = response.status === 429 || response.status >= 500
        lastError = Object.assign(new Error(`${id}: HTTP ${response.status} for ${url}`), { status: response.status })
        if (!retryable || attempt === maxRetries) throw lastError
        const retryAfter = Number(response.headers?.get?.('Retry-After'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * (attempt + 1))
      } catch (err) {
        if (err?.status) {
          lastError = err
          if (attempt === maxRetries) throw err
          continue
        }
        // Network failure / timeout: retry with backoff, then surface.
        lastError = err
        if (attempt === maxRetries) throw Object.assign(new Error(`${id}: ${err?.message ?? 'request failed'} (${url})`), { cause: err })
        await sleep(400 * (attempt + 1))
      }
    }
    throw lastError
  }

  return { request, id, cache }
}
