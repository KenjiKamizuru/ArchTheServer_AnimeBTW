// Tests for the metadata refresh policy (server/refreshPolicy.mjs, AV-018).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REFRESH_POLICY,
  DEFAULT_REFRESH_POLICY,
  refreshPolicyFor,
  nextRefreshAt,
  isStale,
  describeFreshness,
} from '../server/refreshPolicy.mjs'

test('policy table covers known entity types with sane windows', () => {
  for (const [type, policy] of Object.entries(REFRESH_POLICY)) {
    assert.ok(Number.isInteger(policy.maxAge) && policy.maxAge > 0, `${type} has a positive window`)
  }
  assert.ok(REFRESH_POLICY.airing.maxAge < REFRESH_POLICY.media.maxAge, 'airing data refreshes faster than records')
  assert.ok(REFRESH_POLICY.media.maxAge < REFRESH_POLICY.artwork.maxAge, 'records refresh faster than artwork')
})

test('refreshPolicyFor is case-insensitive with a default fallback', () => {
  assert.equal(refreshPolicyFor('airing'), REFRESH_POLICY.airing)
  assert.equal(refreshPolicyFor(' MEDIA '), REFRESH_POLICY.media)
  assert.equal(refreshPolicyFor('unknown-type'), DEFAULT_REFRESH_POLICY)
  assert.equal(refreshPolicyFor(undefined), DEFAULT_REFRESH_POLICY)
})

test('nextRefreshAt offsets by the type window', () => {
  assert.equal(nextRefreshAt('airing', 1_000), 1_000 + REFRESH_POLICY.airing.maxAge)
  assert.equal(nextRefreshAt('media', 1_000), 1_000 + REFRESH_POLICY.media.maxAge)
})

test('never-refreshed entities are due immediately', () => {
  assert.equal(nextRefreshAt('media', null), 0)
  assert.equal(nextRefreshAt('media', 'garbage'), 0)
  assert.equal(nextRefreshAt('media', -5), 0)
  assert.equal(isStale('media', null, 1), true)
})

test('isStale flips exactly at the freshness boundary', () => {
  const refreshedAt = 1_000
  const deadline = refreshedAt + REFRESH_POLICY.media.maxAge
  assert.equal(isStale('media', refreshedAt, deadline - 1), false)
  assert.equal(isStale('media', refreshedAt, deadline), true)
  assert.equal(isStale('airing', refreshedAt, refreshedAt + 60), false)
  assert.equal(isStale('airing', refreshedAt, refreshedAt + 901), true)
})

test('unknown types follow the default window in staleness checks', () => {
  const refreshedAt = 1_000
  const deadline = refreshedAt + DEFAULT_REFRESH_POLICY.maxAge
  assert.equal(isStale('mystery-type', refreshedAt, deadline - 1), false)
  assert.equal(isStale('mystery-type', refreshedAt, deadline), true)
})

test('describeFreshness classifies missing, fresh and stale metadata', () => {
  assert.deepEqual(describeFreshness('media', null, 10_000), { state: 'missing', refreshedAt: null, nextRefreshAt: 0 })
  const at = 1_000
  const fresh = describeFreshness('media', at, at + 60)
  assert.deepEqual(fresh, { state: 'fresh', refreshedAt: at, nextRefreshAt: at + REFRESH_POLICY.media.maxAge })
  assert.equal(describeFreshness('media', at, at + REFRESH_POLICY.media.maxAge).state, 'stale')
})
