// Per-provider request quotas and exponential backoff (AV-020).
//
// Each provider (AniList, IMDb, ...) gets its own sliding-window request
// quota and independent backoff state. Quotas keep the installation from
// accidentally hammering a provider; backoff backs off exponentially when a
// provider returns 429 Too Many Requests or 5xx upstream errors, and cools
// down before allowing new requests.
//
// The clock is injectable (`now`) so tests can simulate time deterministically.

/** Default per-provider quotas (requests per sliding window). */
export const DEFAULT_QUOTAS = new Map([
  ['anilist', { maxRequests: 90, windowMs: 60 * 1000 }],
  ['imdb', { maxRequests: 30, windowMs: 60 * 1000 }],
])

/** Default exponential backoff configuration. */
export const DEFAULT_BACKOFF = {
  initialMs: 500,
  maxMs: 30 * 1000,
  multiplier: 2,
}

/** Statuses a provider can be in. */
export const PROVIDER_STATUS_OK = 'ok'
export const PROVIDER_STATUS_QUOTA_EXCEEDED = 'quota_exceeded'
export const PROVIDER_STATUS_COOLING_DOWN = 'cooling_down'
export const PROVIDER_STATUS_UNKNOWN = 'unknown'

/** Retryable upstream outcomes: 429, 5xx, or a network error (no status). */
function isRetryable(statusCode) {
  return statusCode === undefined || statusCode === 429 || (statusCode >= 500 && statusCode < 600)
}

/** Sliding window of request timestamps for one provider. */
class RequestWindow {
  constructor(windowMs) {
    this.windowMs = windowMs
    this.timestamps = []
  }

  record(timestamp) {
    this.timestamps.push(timestamp)
    this.prune(timestamp)
  }

  /** Drop timestamps older than `now - windowMs`, then return the count. */
  count(now) {
    this.prune(now)
    return this.timestamps.length
  }

  prune(now) {
    const cutoff = now - this.windowMs
    while (this.timestamps.length && this.timestamps[0] <= cutoff) {
      this.timestamps.shift()
    }
  }

  /** Unix ms when the oldest tracked request falls out of the window (0 if empty). */
  resetAt() {
    if (!this.timestamps.length) return 0
    return this.timestamps[0] + this.windowMs
  }
}

/** Exponential backoff state for one provider. */
class BackoffState {
  constructor(config) {
    this.initialMs = config.initialMs
    this.maxMs = config.maxMs
    this.multiplier = config.multiplier
    this.consecutiveFailures = 0
    this.cooldownUntil = 0
  }

  recordFailure(now) {
    this.consecutiveFailures += 1
    const delay = Math.min(
      this.initialMs * Math.pow(this.multiplier, this.consecutiveFailures - 1),
      this.maxMs,
    )
    this.cooldownUntil = now + delay
  }

  recordSuccess() {
    this.consecutiveFailures = 0
    this.cooldownUntil = 0
  }

  remainingMs(now) {
    return Math.max(0, this.cooldownUntil - now)
  }
}

/**
 * Rate limiter with per-provider quotas and backoff.
 *
 * `canProceed(provider)` both checks whether a request may go out and records
 * the attempt against the provider's sliding window. `recordSuccess` /
 * `recordFailure` update backoff state based on the outcome.
 */
export class RateLimiter {
  constructor({ quotas = DEFAULT_QUOTAS, backoff = DEFAULT_BACKOFF, now = Date.now } = {}) {
    this.quotas = new Map(quotas)
    this.backoffConfig = backoff
    this.now = now
    this.windows = new Map() // provider -> RequestWindow
    this.backoff = new Map() // provider -> BackoffState
  }

  /** Quota config for a provider, or null when the provider is unconfigured. */
  quotaFor(provider) {
    return this.quotas.get(provider) ?? null
  }

  /**
   * Check whether a request to `provider` may proceed, and record the attempt
   * against the provider's sliding window when allowed.
   *
   * Returns { ok, reason, retryAfterMs }:
   *  - ok: true when the request may proceed
   *  - reason: 'ok' | 'quota_exceeded' | 'cooling_down'
   *  - retryAfterMs: ms to wait before retrying (0 when ok)
   */
  canProceed(provider, now = this.now()) {
    const backoff = this.backoff.get(provider)
    if (backoff && backoff.cooldownUntil > now) {
      return { ok: false, reason: 'cooling_down', retryAfterMs: backoff.cooldownUntil - now }
    }

    const quota = this.quotaFor(provider)
    if (quota) {
      let window = this.windows.get(provider)
      if (!window) {
        window = new RequestWindow(quota.windowMs)
        this.windows.set(provider, window)
      }
      if (window.count(now) >= quota.maxRequests) {
        return {
          ok: false,
          reason: 'quota_exceeded',
          retryAfterMs: Math.max(0, window.resetAt() - now),
        }
      }
      window.record(now)
    }

    return { ok: true, reason: 'ok', retryAfterMs: 0 }
  }

  /** Record a successful request: clears backoff for the provider. */
  recordSuccess(provider) {
    const state = this.backoff.get(provider)
    if (state) state.recordSuccess()
  }

  /**
   * Record a failed request: applies exponential backoff for retryable
   * outcomes (429, 5xx, or network errors with no status code). Non-retryable
   * client errors (4xx other than 429) do not affect backoff.
   */
  recordFailure(provider, statusCode, now = this.now()) {
    if (!isRetryable(statusCode)) return
    let state = this.backoff.get(provider)
    if (!state) {
      state = new BackoffState(this.backoffConfig)
      this.backoff.set(provider, state)
    }
    state.recordFailure(now)
    return state.remainingMs(now)
  }

  /** Current status of a provider. */
  status(provider, now = this.now()) {
    const backoff = this.backoff.get(provider)
    if (backoff && backoff.cooldownUntil > now) return PROVIDER_STATUS_COOLING_DOWN
    const quota = this.quotaFor(provider)
    if (quota) {
      const window = this.windows.get(provider)
      if (window && window.count(now) >= quota.maxRequests) {
        return PROVIDER_STATUS_QUOTA_EXCEEDED
      }
    }
    return PROVIDER_STATUS_OK
  }

  /** Reset a provider's quota window and backoff state (mostly for tests). */
  reset(provider) {
    this.windows.delete(provider)
    this.backoff.delete(provider)
  }

  /** Quota usage info for a provider. */
  quotaInfo(provider, now = this.now()) {
    const quota = this.quotaFor(provider)
    const window = this.windows.get(provider)
    const backoff = this.backoff.get(provider)
    return {
      used: window ? window.count(now) : 0,
      maxRequests: quota ? quota.maxRequests : 0,
      windowMs: quota ? quota.windowMs : 0,
      resetAt: window ? Math.max(window.resetAt(), backoff ? backoff.cooldownUntil : 0) : 0,
    }
  }
}

// Single shared limiter used by provider adapters.
export const rateLimiter = new RateLimiter()
