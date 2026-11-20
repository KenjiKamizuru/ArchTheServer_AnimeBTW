// AV-021: two-tier metadata cache (immutable vs airing).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cachedImmutable,
  cachedAiring,
  flush,
  snapshot,
} from '../server/metadataCache.mjs'

function fakeClock(start) {
  let now = start
  return { now: () => now, advance: (ms) => { now += ms } }
}

// ── TTL tiers ─────────────────────────────────────────────────────────

test('immutable cache keeps entries fresh for the long TTL', async () => {
  const clock = fakeClock(1_000_000_000_000)
  let calls = 0
  const value = await cachedImmutable('imm:1', async () => {
    calls += 1
    return { t: clock.now() }
  }, { now: clock.now })
  assert.equal(calls, 1)
  assert.deepEqual(value, { t: 1_000_000_000_000 })
  // 55 minutes later: still fresh (1 hour TTL).
  clock.advance(55 * 60 * 1000)
  const again = await cachedImmutable('imm:1', async () => {
    calls += 1
    return { t: clock.now() }
  }, { now: clock.now })
  assert.equal(calls, 1)
  assert.deepEqual(again, value)
})

test('immutable cache expires after the long TTL', async () => {
  const clock = fakeClock(1_000_000_000_000)
  let calls = 0
  await cachedImmutable('imm:2', async () => {
    calls += 1
    return 'first'
  }, { now: clock.now })
  // 61 minutes later: stale → reload.
  clock.advance(61 * 60 * 1000)
  const second = await cachedImmutable('imm:2', async () => {
    calls += 1
    return 'second'
  }, { now: clock.now })
  assert.equal(calls, 2)
  assert.equal(second, 'second')
})

test('airing cache expires after the short TTL', async () => {
  const clock = fakeClock(1_000_000_000_000)
  let calls = 0
  await cachedAiring('air:1', async () => {
    calls += 1
    return 'first'
  }, { now: clock.now })
  // 2 minutes 1 second later: stale (2 minute TTL).
  clock.advance(2 * 60 * 1000 + 1000)
  const second = await cachedAiring('air:1', async () => {
    calls += 1
    return 'second'
  }, { now: clock.now })
  assert.equal(calls, 2)
  assert.equal(second, 'second')
})

test('airing cache is still fresh well within the short TTL', async () => {
  const clock = fakeClock(1_000_000_000_000)
  let calls = 0
  await cachedAiring('air:2', async () => {
    calls += 1
    return 'first'
  }, { now: clock.now })
  // 1 minute later: still fresh.
  clock.advance(1 * 60 * 1000)
  const second = await cachedAiring('air:2', async () => {
    calls += 1
    return 'second'
  }, { now: clock.now })
  assert.equal(calls, 1)
  assert.equal(second, 'first')
})

// ── Tiers are independent ─────────────────────────────────────────────

test('immutable and airing caches are independent', async () => {
  const clock = fakeClock(1_000_000_000_000)
  await cachedImmutable('shared', async () => 'imm', { now: clock.now })
  await cachedAiring('shared', async () => 'air', { now: clock.now })
  // Airing TTL (2 min) expires while immutable (1 hr) still fresh.
  clock.advance(2 * 60 * 1000 + 1000)
  const air = await cachedAiring('shared', async () => 'air-reload', { now: clock.now })
  const imm = await cachedImmutable('shared', async () => 'imm-reload', { now: clock.now })
  assert.equal(air, 'air-reload')
  assert.equal(imm, 'imm')
})

// ── LRU eviction ──────────────────────────────────────────────────────

test('immutable cache evicts the oldest entry when over capacity', async () => {
  const clock = fakeClock(1_000_000_000_000)
  // MAX_ENTRIES is 300; fill with 301 entries to force one eviction.
  for (let i = 0; i < 301; i += 1) {
    await cachedImmutable(`key:${i}`, async () => i, { now: clock.now })
  }
  const snap = snapshot()
  assert.ok(snap.immutable <= 300, snap)
  const reloaded = await cachedImmutable('key:0', async () => 'reloaded', { now: clock.now })
  assert.equal(reloaded, 'reloaded')
})

// ── Stale-beats-error ─────────────────────────────────────────────────

test('stale hit is returned when the loader throws (stale-beats-error)', async () => {
  await flush()
  const clock = fakeClock(1_000_000_000_000)
  await cachedImmutable('err:1', async () => 'good', { now: clock.now })
  clock.advance(61 * 60 * 1000) // stale
  const result = await cachedImmutable('err:1', async () => { throw new Error('boom') }, { now: clock.now })
  assert.equal(result, 'good') // stale hit returned, loader error swallowed
})

test('error propagates when there is no cached hit at all', async () => {
  await flush()
  await assert.rejects(
    cachedImmutable('err:3', async () => { throw new Error('boom') }, { now: 1_000_000_000_000 }),
    /boom/
  )
})

test('fresh hit is returned when the loader throws', async () => {
  const clock = fakeClock(1_000_000_000_000)
  await cachedImmutable('err:2', async () => 'good', { now: clock.now })
  const result = await cachedImmutable('err:2', async () => { throw new Error('boom') }, { now: clock.now })
  assert.equal(result, 'good')
})

// ── flush / snapshot ──────────────────────────────────────────────────

test('flush clears both tiers', async () => {
  await flush()
  const clock = fakeClock(1_000_000_000_000)
  await cachedImmutable('flush:imm', async () => 'imm', { now: clock.now })
  await cachedAiring('flush:air', async () => 'air', { now: clock.now })
  assert.equal(snapshot().immutable, 1)
  assert.equal(snapshot().airing, 1)
  flush()
  assert.equal(snapshot().immutable, 0)
  assert.equal(snapshot().airing, 0)
  const imm = await cachedImmutable('flush:imm', async () => 'imm2', { now: clock.now })
  const air = await cachedAiring('flush:air', async () => 'air2', { now: clock.now })
  assert.equal(imm, 'imm2')
  assert.equal(air, 'air2')
})
