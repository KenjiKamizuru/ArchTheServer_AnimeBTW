// AV-020: per-provider request quotas and exponential backoff.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter, rateLimiter, DEFAULT_QUOTAS, PROVIDER_STATUS_COOLING_DOWN } from '../server/rateLimit.mjs'

const HOUR = 60 * 60 * 1000

// Fixed clock so time advances only when the test moves it.
function fakeClock(start) {
  let now = start
  return { now: () => now, advance: (ms) => { now += ms } }
}

// ── Defaults / exports ────────────────────────────────────────────────

test('default quotas configure anilist and imdb', () => {
  assert.equal(DEFAULT_QUOTAS.get('anilist').maxRequests, 90)
  assert.equal(DEFAULT_QUOTAS.get('anilist').windowMs, 60 * 1000)
  assert.equal(DEFAULT_QUOTAS.get('imdb').maxRequests, 30)
  assert.equal(DEFAULT_QUOTAS.get('imdb').windowMs, 60 * 1000)
})

test('shared rateLimiter is a RateLimiter instance', () => {
  assert.ok(rateLimiter instanceof RateLimiter)
})

// ── canProceed / quota ────────────────────────────────────────────────

test('canProceed allows requests under the quota', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({ quotas: new Map([['p', { maxRequests: 2, windowMs: 60_000 }]]), now: clock.now })
  assert.equal(limiter.canProceed('p').ok, true)
  assert.equal(limiter.canProceed('p').ok, true)
})

test('canProceed rejects requests over the quota with retryAfterMs', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({ quotas: new Map([['p', { maxRequests: 2, windowMs: 60_000 }]]), now: clock.now })
  limiter.canProceed('p')
  limiter.canProceed('p')
  const check = limiter.canProceed('p')
  assert.equal(check.ok, false)
  assert.equal(check.reason, 'quota_exceeded')
  assert.ok(check.retryAfterMs > 0)
  assert.ok(check.retryAfterMs <= 60_000)
})

test('sliding window expires old requests', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({ quotas: new Map([['p', { maxRequests: 1, windowMs: 100 }]]), now: clock.now })
  limiter.canProceed('p')
  assert.equal(limiter.canProceed('p').ok, false)
  clock.advance(150)
  // The first request fell out of the 100ms window.
  assert.equal(limiter.canProceed('p').ok, true)
})

test('unconfigured provider is not quota limited', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({ quotas: new Map(), now: clock.now })
  assert.equal(limiter.canProceed('unknown-provider').ok, true)
})

// ── backoff ───────────────────────────────────────────────────────────

test('recordFailure cools a provider down; canProceed rejects during cooldown', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([['p', { maxRequests: 100, windowMs: 60_000 }]]),
    backoff: { initialMs: 500, maxMs: 30_000, multiplier: 2 },
    now: clock.now,
  })
  limiter.recordFailure('p', 429)
  const check = limiter.canProceed('p')
  assert.equal(check.ok, false)
  assert.equal(check.reason, 'cooling_down')
  assert.ok(check.retryAfterMs > 0)
})

test('recordSuccess clears cooldown', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([['p', { maxRequests: 100, windowMs: 60_000 }]]),
    backoff: { initialMs: 500, maxMs: 30_000, multiplier: 2 },
    now: clock.now,
  })
  limiter.recordFailure('p', 429)
  assert.equal(limiter.canProceed('p').ok, false)
  limiter.recordSuccess('p')
  assert.equal(limiter.canProceed('p').ok, true)
})

test('backoff grows exponentially across consecutive failures', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([['p', { maxRequests: 100, windowMs: 60_000 }]]),
    backoff: { initialMs: 500, maxMs: 30_000, multiplier: 2 },
    now: clock.now,
  })
  const d1 = limiter.recordFailure('p', 429, clock.now())
  assert.equal(d1, 500)
  clock.advance(1)
  const d2 = limiter.recordFailure('p', 429, clock.now())
  assert.equal(d2, 1000)
  clock.advance(1)
  const d3 = limiter.recordFailure('p', 500, clock.now())
  assert.equal(d3, 2000)
})

test('backoff caps at maxMs', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([['p', { maxRequests: 100, windowMs: 60_000 }]]),
    backoff: { initialMs: 500, maxMs: 1000, multiplier: 10 },
    now: clock.now,
  })
  limiter.recordFailure('p', 429)
  const d2 = limiter.recordFailure('p', 429, clock.now())
  assert.equal(d2, 1000)
})

test('non-retryable 4xx errors do not cool a provider down', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([['p', { maxRequests: 100, windowMs: 60_000 }]]),
    now: clock.now,
  })
  limiter.recordFailure('p', 400)
  limiter.recordFailure('p', 403)
  assert.equal(limiter.canProceed('p').ok, true)
})

// ── status / quotaInfo ────────────────────────────────────────────────

test('status reports cooling_down during backoff', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([['p', { maxRequests: 100, windowMs: 60_000 }]]),
    backoff: { initialMs: 500, maxMs: 30_000, multiplier: 2 },
    now: clock.now,
  })
  assert.equal(limiter.status('p'), 'ok')
  limiter.recordFailure('p', 429)
  assert.equal(limiter.status('p'), 'cooling_down')
})

test('status reports quota_exceeded at the limit', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({ quotas: new Map([['p', { maxRequests: 1, windowMs: 60_000 }]]), now: clock.now })
  limiter.canProceed('p')
  assert.equal(limiter.status('p'), 'quota_exceeded')
})

test('quotaInfo reports usage and reset time', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({ quotas: new Map([['p', { maxRequests: 3, windowMs: 60_000 }]]), now: clock.now })
  limiter.canProceed('p')
  limiter.canProceed('p')
  const info = limiter.quotaInfo('p')
  assert.equal(info.used, 2)
  assert.equal(info.maxRequests, 3)
  assert.equal(info.windowMs, 60_000)
  assert.ok(info.resetAt > clock.now())
})

test('reset clears quota window and backoff', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([['p', { maxRequests: 2, windowMs: 60_000 }]]),
    backoff: { initialMs: 500, maxMs: 30_000, multiplier: 2 },
    now: clock.now,
  })
  limiter.canProceed('p')
  limiter.recordFailure('p', 429)
  assert.equal(limiter.canProceed('p').ok, false) // cooling down
  limiter.reset('p')
  assert.equal(limiter.canProceed('p').ok, true) // request allowed again
  assert.equal(limiter.status('p'), 'ok') // fresh state after reset
})

// ── isolated providers ────────────────────────────────────────────────

test('providers are tracked independently', () => {
  const clock = fakeClock(1_000_000_000_000)
  const limiter = new RateLimiter({
    quotas: new Map([
      ['a', { maxRequests: 1, windowMs: 60_000 }],
      ['b', { maxRequests: 1, windowMs: 60_000 }],
    ]),
    now: clock.now,
  })
  limiter.canProceed('a')
  assert.equal(limiter.canProceed('a').ok, false)
  assert.equal(limiter.canProceed('b').ok, true)
})
