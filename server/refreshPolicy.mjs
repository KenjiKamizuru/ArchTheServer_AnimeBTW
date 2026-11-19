// Metadata refresh policy per entity type (AV-018).
//
// Every entity type the app fetches from providers gets a freshness window:
// data older than the type's `maxAge` (Unix seconds) is stale and should be
// re-fetched; anything fresher can be served from cache. Airing data changes
// fast, canonical media records slowly, and artwork claims almost never — so
// each gets its own budget instead of one global TTL. All helpers are pure
// with an injectable clock so staleness logic is testable without waiting.

/** Freshness windows (seconds) per entity type. */
export const REFRESH_POLICY = {
  // Canonical media records (titles, scores, counts): one day.
  media: { maxAge: 86_400 },
  // Next-episode / schedule data: 15 minutes (airing times shift and pass).
  airing: { maxAge: 900 },
  // Studio catalogs: weekly (new productions appear rarely).
  studio: { maxAge: 604_800 },
  character: { maxAge: 604_800 },
  staff: { maxAge: 604_800 },
  // Franchise/relation graphs: weekly.
  franchise: { maxAge: 604_800 },
  // Artwork claims (IMDb/local): monthly — stable once chosen.
  artwork: { maxAge: 2_592_000 },
}

/** Fallback policy for entity types without a specific window. */
export const DEFAULT_REFRESH_POLICY = { maxAge: 86_400 }

/** Returns the policy for an entity type (case-insensitive); default when unknown. */
export function refreshPolicyFor(type) {
  return REFRESH_POLICY[String(type ?? '').trim().toLowerCase()] ?? DEFAULT_REFRESH_POLICY
}

/**
 * Unix seconds at which the entity should next be refreshed:
 * `refreshedAt + maxAge`, or 0 when the entity was never refreshed
 * (unknown/invalid timestamps mean "refresh immediately").
 */
export function nextRefreshAt(type, refreshedAt) {
  const at = Number(refreshedAt)
  if (!Number.isFinite(at) || at <= 0) return 0
  return at + refreshPolicyFor(type).maxAge
}

/** True when the entity's metadata is older than its type's freshness window. */
export function isStale(type, refreshedAt, now = Math.floor(Date.now() / 1000)) {
  return now >= nextRefreshAt(type, refreshedAt)
}

/**
 * Freshness verdict for display (AV-019): 'missing' when never refreshed,
 * 'stale' when older than the type's window, else 'fresh'. The returned
 * `nextRefreshAt` lets callers show when data becomes due again.
 */
export function describeFreshness(type, refreshedAt, now = Math.floor(Date.now() / 1000)) {
  const at = Number(refreshedAt)
  const known = Number.isFinite(at) && at > 0
  return {
    state: !known ? 'missing' : isStale(type, at, now) ? 'stale' : 'fresh',
    refreshedAt: known ? at : null,
    nextRefreshAt: nextRefreshAt(type, at),
  }
}
