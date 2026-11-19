// Tests for the online relationship pipeline (server/relationsOnline.mjs).
// Lookups are injected fakes standing in for the AniList GraphQL client, so
// the suite runs offline while pinning caching and failure behaviour.
import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyPairOnline, entryCacheKey } from '../server/relationsOnline.mjs'

const evidenceS1 = {
  key: 'anilist:98459',
  sourceIds: { anilist: '98459' },
  title: 'That Time I Got Reincarnated as a Slime',
  format: 'TV',
  relations: [
    { source: 'anilist', sourceId: '116742', title: 'Tensei Shitara Slime Datta Ken 2nd Season Part 2', relationType: 'SEQUEL', format: 'TV' },
  ],
}

const evidenceS2P2 = {
  key: 'anilist:116742',
  sourceIds: { anilist: '116742' },
  title: 'Tensei Shitara Slime Datta Ken 2nd Season Part 2',
  format: 'TV',
  relations: [
    { source: 'anilist', sourceId: '98459', title: 'Tensei Shitara Slime Datta Ken', relationType: 'PREQUEL', format: 'TV' },
  ],
}

test('verifyPairOnline caches lookups and verdicts — no repeat fetching', async () => {
  const cache = new Map()
  let calls = 0
  const lookup = async (entry) => {
    calls += 1
    return entry.sourceIds.anilist === '98459' ? evidenceS1 : evidenceS2P2
  }
  const a = { sourceIds: { anilist: '98459' }, title: 'That Time I Got Reincarnated as a Slime' }
  const b = { sourceIds: { anilist: '116742' }, title: 'Tensei Shitara Slime Datta Ken 2nd Season Part 2' }

  const first = await verifyPairOnline(a, b, { lookup, cache, now: 1_000 })
  assert.equal(first.type, 'next-season')
  assert.equal(first.uncertain, false)
  assert.equal(calls, 2, 'one lookup per entry')

  const second = await verifyPairOnline(a, b, { lookup, cache, now: 2_000 })
  assert.equal(second.cached, true)
  assert.equal(second.type, 'next-season')
  assert.equal(calls, 2, 'verdict + entries came from cache')

  // Reverse order uses the same pair key.
  const third = await verifyPairOnline(b, a, { lookup, cache, now: 3_000 })
  assert.equal(third.cached, true)
  assert.equal(calls, 2)
})

test('lookup failures degrade to uncertain instead of guessing', async () => {
  const cache = new Map()
  const lookup = async (entry) => {
    if (entry.sourceIds?.anilist === '98459') return evidenceS1
    throw new Error('429 rate limited')
  }
  const a = { sourceIds: { anilist: '98459' }, title: 'That Time I Got Reincarnated as a Slime' }
  const b = { title: 'Some Unverified Entry' }
  const verdict = await verifyPairOnline(a, b, { lookup, cache, now: 1_000 })
  assert.equal(verdict.uncertain, true)
  assert.ok(verdict.reasons.some((reason) => reason.includes('rate limited')), 'failure is recorded')
  assert.notEqual(verdict.verification, 'verified')
})

test('uncertain verdicts expire faster than verified ones', async () => {
  const cache = new Map()
  const lookup = async (entry) => (entry.sourceIds?.anilist === '98459' ? evidenceS1 : evidenceS2P2)
  const a = { sourceIds: { anilist: '98459' }, title: 'T' }
  const b = { sourceIds: { anilist: '116742' }, title: 'U' }
  await verifyPairOnline(a, b, { lookup, cache, now: 1_000 })
  // A failed pair caches as uncertain for 1h.
  const failingCache = new Map()
  await verifyPairOnline({ title: 'X' }, { title: 'Y' }, {
    lookup: async () => {
      throw new Error('timeout')
    },
    cache: failingCache,
    now: 1_000,
  })
  assert.equal(await verifyPairOnline({ title: 'X' }, { title: 'Y' }, {
    lookup: async () => {
      throw new Error('should not run')
    },
    cache: failingCache,
    now: 2_000,
  }).then((v) => v.cached), true, 'failure cached briefly')
  assert.equal(await verifyPairOnline({ title: 'X' }, { title: 'Y' }, {
    lookup: async () => {
      throw new Error('fresh timeout')
    },
    cache: failingCache,
    now: 1_000 + 61 * 60 * 1000,
  }).then((v) => v.cached), undefined, 'failure cache expired after the short ttl')
})

test('entryCacheKey prefers source ids over titles', () => {
  assert.equal(entryCacheKey({ sourceIds: { anilist: '1', mal: '2' }, title: 'T' }), 'entry:anilist:1')
  assert.equal(entryCacheKey({ sourceIds: { mal: '2' }, title: 'T' }), 'entry:mal:2')
  assert.equal(entryCacheKey({ title: 'Re:ZERO -Starting Life in Another World-' }), entryCacheKey({ title: 'Re:ZERO -Starting Life in Another World' }), 'alias-stable title keys')
})
