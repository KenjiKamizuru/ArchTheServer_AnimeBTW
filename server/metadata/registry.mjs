// Provider registry (AV-117c1): one adapter per source implementing the
// common interface from docs/ANIME_METADATA_ARCHITECTURE.md §1. Registry
// defaults encode the researched rate limits; adapters may bring their own
// transport. Missing capabilities are simply absent — never invented.

export const PROVIDER_LIMITS = {
  anilist: { minIntervalMs: 667, note: '90 req/min' },
  mal: { minIntervalMs: 600, note: '~100 req/min reported; confirm in official docs' },
  kitsu: { minIntervalMs: 1_000, note: 'fair-use; 429 on excess' },
  anidb: { minIntervalMs: 2_000, cacheTtlMs: 24 * 60 * 60 * 1000, note: '1 req/2s + day caching, ban policy' },
  ann: { minIntervalMs: 1_000, note: '1 req/s mandatory + attribution' },
  tmdb: { minIntervalMs: 250, note: '40 req/10s, 200k/day' },
  wikidata: { minIntervalMs: 1_000, note: 'fair-use / maxlag' },
}

const providers = new Map()

export function registerProvider(adapter) {
  if (!adapter?.id) throw new Error('provider requires an id')
  providers.set(adapter.id, adapter)
  return adapter
}

export function getProvider(id) {
  return providers.get(id) ?? null
}

export function providersFor(capability) {
  return [...providers.values()].filter((provider) => provider.capabilities?.[capability])
}

export function listProviders() {
  return [...providers.values()]
}

/** For tests: forget registered adapters. */
export function clearProviders() {
  providers.clear()
}
