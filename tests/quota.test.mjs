// Tests for per-provider quotas and backoff (server/quota.mjs, AV-020).
import test from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDER_QUOTAS, DEFAULT_QUOTA, quotaFor, createQuotaTracker } from '../server/quota.mjs'

const TIGHT = {
  test: { maxRequests: 2, perSeconds: 60, backoffBaseSeconds: 5, backoffMaxSeconds: 20 },
}

test('tryAcquire allows up to the window then blocks with a retry hint', () => {
  const tracker = createQuotaTracker(TIGHT)
  assert.deepEqual(tracker.tryAcquire('test', 100), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual(tracker.tryAcquire('test', 100), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual(tracker.tryAcquire('test', 100), { allowed: false, retryAfterSeconds: 60 })
})

test('the request window resets after the period elapses', () => {
  const tracker = createQuotaTracker(TIGHT)
  tracker.tryAcquire('test', 100)
  tracker.tryAcquire('test', 100)
  assert.equal(tracker.tryAcquire('test', 160).allowed, true)
  assert.equal(tracker.tryAcquire('test', 160).allowed, true)
  assert.equal(tracker.tryAcquire('test', 160).allowed, false)
})

test('failures back off exponentially and cap at the maximum', () => {
  const tracker = createQuotaTracker(TIGHT)
  tracker.recordFailure('test', 100)
  assert.deepEqual(tracker.snapshot('test', 100), { count: 0, failures: 1, pausedUntil: 105, retryAfterSeconds: 5 })
  tracker.recordFailure('test', 100)
  assert.equal(tracker.snapshot('test', 100).retryAfterSeconds, 10)
  tracker.recordFailure('test', 100)
  tracker.recordFailure('test', 100)
  tracker.recordFailure('test', 100)
  assert.equal(tracker.snapshot('test', 100).retryAfterSeconds, 20, 'capped at backoffMaxSeconds')
  assert.equal(tracker.tryAcquire('test', 100).allowed, false, 'paused providers cannot acquire')
  assert.equal(tracker.tryAcquire('test', 126).allowed, true, 'pause lifts after the backoff')
})

test('success clears the streak and providers are isolated', () => {
  const tracker = createQuotaTracker(TIGHT)
  tracker.recordFailure('test', 100)
  assert.equal(tracker.tryAcquire('other', 100).allowed, true, 'other providers unaffected')
  tracker.recordSuccess('test', 100)
  assert.deepEqual(tracker.snapshot('test', 100), { count: 0, failures: 0, pausedUntil: 0, retryAfterSeconds: 0 })
  assert.equal(tracker.tryAcquire('test', 100).allowed, true)
})

test('unknown providers follow the default quota', () => {
  const tracker = createQuotaTracker()
  assert.equal(quotaFor(PROVIDER_QUOTAS, 'ANILIST'), PROVIDER_QUOTAS.anilist)
  assert.equal(quotaFor(PROVIDER_QUOTAS, 'mystery'), DEFAULT_QUOTA)
  for (let i = 0; i < DEFAULT_QUOTA.maxRequests; i += 1) {
    assert.equal(tracker.tryAcquire('mystery', 100).allowed, true)
  }
  assert.equal(tracker.tryAcquire('mystery', 100).allowed, false)
})
