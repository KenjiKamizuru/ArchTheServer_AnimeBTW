// Tests for local-library matching + the relationship store (AV-117d2).
// Phase 8 rule pinned: entries combine ONLY on established identity — never
// on franchise membership or similar titles.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lookupKey,
  candidateKeys,
  matchLibraryEntry,
  shouldCombineLocalEntries,
} from '../server/metadata/libraryMatch.mjs'
import {
  mergeStoredRelationship,
  createRelationshipStore,
} from '../server/metadata/relationshipStore.mjs'

test('candidateKeys: filename inference generates candidates, never decides', () => {
  const infer = (title) => ({
    seriesTitle: String(title).replace(/\s*season\s*\d+.*$/i, ''),
    seriesFolder: 'folder',
  })
  const keys = candidateKeys(['Re:ZERO -Starting Life in Another World- Season 2', null], { infer })
  assert.ok(keys.has(lookupKey('Re:ZERO -Starting Life in Another World- Season 2')))
  assert.ok(keys.has(lookupKey('Re:ZERO -Starting Life in Another World-')), 'inference generates a candidate')
  assert.ok(keys.has(lookupKey('folder')))
  assert.ok(!keys.has(''))
  assert.deepEqual([...candidateKeys([])], [])
  assert.equal(lookupKey('Re:ZERO -Starting Life in Another World-'), lookupKey('Re:ZERO -Starting Life in Another World'), 'alias-stable keys')
})

test('library matching: identity ladder decides; franchises never merge', () => {
  const online = {
    externalIds: { anilist: '21355', mal: '31240' },
    titles: { canonical: 'Re:ZERO -Starting Life in Another World-' },
    format: 'TV',
    release: { year: 2016 },
    franchise: { key: 'rezero', role: 'main' },
  }

  // Established identity via external id → match (duplicate row because the
  // displayed titles differ).
  const localDup = { externalIds: { mal: '31240' }, seriesTitle: 'Re:ZERO -Starting Life in Another World', season: 1 }
  const dup = matchLibraryEntry(localDup, online)
  assert.equal(dup.matched, true)
  assert.equal(dup.kind, 'duplicate-entry')
  assert.equal(shouldCombineLocalEntries(dup), true, 'confirmed duplicates may combine')

  // Same record (identical displayed title).
  const localSame = { externalIds: { anilist: '21355' }, seriesTitle: 'Re:ZERO -Starting Life in Another World-' }
  const same = matchLibraryEntry(localSame, online)
  assert.equal(same.matched, true)
  assert.equal(same.kind, 'same-record')

  // Title-only local entry → NOT matched, kept separate (no guessing).
  const localTitleOnly = { seriesTitle: 'Re:ZERO -Starting Life in Another World-', season: 1 }
  const titleOnly = matchLibraryEntry(localTitleOnly, online)
  assert.equal(titleOnly.matched, false)
  assert.ok(titleOnly.reasons.some((reason) => reason.includes('stay separate')))
  assert.equal(shouldCombineLocalEntries(titleOnly), false)

  // Franchise membership is not identity.
  const franchiseSibling = {
    externalIds: { anilist: '128705' },
    titles: { canonical: 'The Slime Diaries' },
    franchise: { key: 'rezero', role: 'branch:spin-off' },
    format: 'TV',
    release: { year: 2021 },
  }
  const sibling = matchLibraryEntry(franchiseSibling, online)
  assert.equal(sibling.matched, false, 'same franchise ≠ same record')
  assert.equal(shouldCombineLocalEntries(sibling), false)
})

test('relationship store: verified records are never overwritten', async () => {
  const verified = {
    type: 'spin-off', confidence: 'high', source: 'anilist',
    sourceIds: { a: { anilist: '1' }, b: { anilist: '2' } },
    verification: 'verified', uncertain: false, reasons: [], checkedAt: 1,
  }
  const assertMerged = mergeStoredRelationship(verified, {
    type: 'next-season', verification: 'unverified', uncertain: true, reasons: [], checkedAt: 2,
  })
  assert.equal(assertMerged.outcome, 'kept-verified')
  assert.equal(assertMerged.record.type, 'spin-off')
  assert.equal(assertMerged.record.conflicts.length, 1, 'the disagreement is retained')

  const fresh = mergeStoredRelationship(null, verified)
  assert.equal(fresh.outcome, 'accepted')

  // kv-backed store: order-independent pair keys, round-trip persistence.
  const data = new Map()
  const kv = {
    get: async (key, fallback = null) => (data.has(key) ? data.get(key) : fallback),
    set: async (key, value) => {
      data.set(key, value)
    },
  }
  const store = createRelationshipStore(kv)
  const saved = await store.save('anilist:1', 'anilist:2', verified)
  assert.equal(saved.outcome, 'accepted')
  assert.deepEqual(await store.get('anilist:2', 'anilist:1'), verified, 'pair key is order-independent')
  const again = await store.save('anilist:2', 'anilist:1', { ...verified, type: 'next-season', verification: 'unverified' })
  assert.equal(again.outcome, 'kept-verified')
  assert.equal((await store.get('anilist:1', 'anilist:2')).type, 'spin-off')
})
