// Per-provider request quotas and backoff policies (AV-020).
//
// Each metadata provider gets a fixed-window request quota (requests per
// period) and an exponential backoff that pauses further requests after
// consecutive failures — so a struggling upstream is protected instead of
// hammered by retries. All state lives inside the tracker closure and every
// method takes an injectable `now` (Unix seconds), keeping the logic pure and
// testable without real time or network.

/** Quota + backoff settings per provider. */
export const PROVIDER_QUOTAS = {
  // AniList publicly allows 90 requests/minute.
  anilist: { maxRequests: 90, perSeconds: 60, backoffBaseSeconds: 5, backoffMaxSeconds: 300 },
}

/** Fallback settings for providers without a specific policy. */
export const DEFAULT_QUOTA = { maxRequests: 60, perSeconds: 60, backoffBaseSeconds: 5, backoffMaxSeconds: 300 }

/** Case-insensitive quota lookup with the default as fallback. */
export function quotaFor(quotas, provider) {
  return quotas[String(provider ?? '').trim().toLowerCase()] ?? DEFAULT_QUOTA
}

/**
 * Creates an isolated quota tracker. Methods:
 * - tryAcquire(provider, now) → { allowed, retryAfterSeconds } (consumes one
 *   request when allowed)
 * - recordSuccess(provider, now) → clears the failure streak and any pause
 * - recordFailure(provider, now) → extends the pause exponentially
 * - snapshot(provider, now) → inspection state (tests, diagnostics)
 */
export function createQuotaTracker(quotas = PROVIDER_QUOTAS) {
  const state = new Map()
  const entry = (provider) => {
    const key = String(provider ?? '').trim().toLowerCase() || 'unknown'
    let s = state.get(key)
    if (!s) {
      s = { windowStart: 0, count: 0, failures: 0, pausedUntil: 0 }
      state.set(key, s)
    }
    return s
  }

  return {
    tryAcquire(provider, now = Math.floor(Date.now() / 1000)) {
      const quota = quotaFor(quotas, provider)
      const s = entry(provider)
      if (now < s.pausedUntil) return { allowed: false, retryAfterSeconds: s.pausedUntil - now }
      if (now - s.windowStart >= quota.perSeconds) {
        s.windowStart = now
        s.count = 0
      }
      if (s.count >= quota.maxRequests) {
        return { allowed: false, retryAfterSeconds: Math.max(1, s.windowStart + quota.perSeconds - now) }
      }
      s.count += 1
      return { allowed: true, retryAfterSeconds: 0 }
    },

    recordSuccess(provider, now = Math.floor(Date.now() / 1000)) {
      const s = entry(provider)
      s.failures = 0
      s.pausedUntil = 0
    },

    recordFailure(provider, now = Math.floor(Date.now() / 1000)) {
      const quota = quotaFor(quotas, provider)
      const s = entry(provider)
      s.failures += 1
      const backoff = Math.min(quota.backoffBaseSeconds * 2 ** (s.failures - 1), quota.backoffMaxSeconds)
      s.pausedUntil = Math.max(s.pausedUntil, now + backoff)
    },

    snapshot(provider, now = Math.floor(Date.now() / 1000)) {
      const s = entry(provider)
      return {
        count: s.count,
        failures: s.failures,
        pausedUntil: s.pausedUntil,
        retryAfterSeconds: Math.max(0, s.pausedUntil - now),
      }
    },
  }
}
