// Tests for the cache tier policy (server/cachePolicy.mjs, AV-021a).
import test from 'node:test'
import assert from 'node:assert/strict'
import { CACHE_TIERS, CACHE_KEY_TIERS, cacheTierForKey, cacheTtlFor } from '../server/cachePolicy.mjs'

test('rapidly changing keys map to the airing tier, catalog keys to media', () => {
  assert.equal(cacheTierForKey('airing:1:50'), 'airing')
  assert.equal(cacheTierForKey('recent:updated:24'), 'airing')
  assert.equal(cacheTierForKey('recent:added:24'), 'airing')
  assert.equal(cacheTierForKey('detail:airing:151807'), 'airing')
  assert.equal(cacheTierForKey('many:1,2,3'), 'airing')
  assert.equal(cacheTierForKey('season:winter:2024:popular:1:30'), 'media')
  assert.equal(cacheTierForKey('browse:{"format":"TV"}'), 'media')
  assert.equal(cacheTierForKey('studios:1::name'), 'media')
  assert.equal(cacheTierForKey('studio:21:1:popular'), 'media')
  assert.equal(cacheTierForKey('index:1:title'), 'media')
  assert.equal(cacheTierForKey('franchises:winter:2024'), 'media')
  assert.equal(cacheTierForKey('search:frieren:1'), 'media')
  assert.equal(cacheTierForKey('detail:151807'), 'media')
})

test('unknown keys fall back to the media tier', () => {
  assert.equal(cacheTierForKey('mystery:key'), 'media')
  assert.equal(cacheTierForKey(''), 'media')
  assert.equal(cacheTierForKey(null), 'media')
})

test('the airing tier expires much sooner than the media tier', () => {
  const airing = cacheTtlFor('airing')
  const media = cacheTtlFor('media')
  assert.equal(airing, CACHE_TIERS.airing.ttlSeconds)
  assert.equal(media, CACHE_TIERS.media.ttlSeconds)
  assert.ok(Number.isInteger(airing) && airing > 0)
  assert.ok(Number.isInteger(media) && media > 0)
  assert.ok(airing < media, 'rapidly changing data must expire first')
})

test('tier lookups are case-insensitive and default to media', () => {
  assert.equal(cacheTtlFor('AIRING'), CACHE_TIERS.airing.ttlSeconds)
  assert.equal(cacheTtlFor('Media'), CACHE_TIERS.media.ttlSeconds)
  assert.equal(cacheTtlFor('mystery'), CACHE_TIERS.media.ttlSeconds)
  assert.equal(cacheTtlFor(null), CACHE_TIERS.media.ttlSeconds)
})

test('every declared key prefix maps to a known tier', () => {
  const tiers = new Set(Object.keys(CACHE_TIERS))
  for (const [prefix, tier] of CACHE_KEY_TIERS) {
    assert.ok(prefix.length > 0, 'prefixes must be non-empty')
    assert.ok(tiers.has(tier), `prefix ${prefix} maps to unknown tier ${tier}`)
    assert.equal(cacheTierForKey(`${prefix}x`), tier)
  }
})
