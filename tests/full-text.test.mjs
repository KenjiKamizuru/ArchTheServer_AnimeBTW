// Tests for the full-text index core (server/fullText.mjs, AV-075a).
import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, buildTextIndex, indexDocument, removeDocument, searchTextIndex } from '../server/fullText.mjs'

test('tokenize folds case, accents and punctuation', () => {
  assert.deepEqual(tokenize('Sousou, no FRIEREN!'), ['sousou', 'no', 'frieren'])
  assert.deepEqual(tokenize('  '), [])
})

test('search matches all query tokens and nothing else', () => {
  const index = buildTextIndex([
    { id: 1, text: 'Frieren Beyond Journey End' },
    { id: 2, text: 'Fullmetal Alchemist Brotherhood' },
    { id: 3, text: 'Frieren the Slayer' },
  ])
  assert.deepEqual(searchTextIndex(index, 'frieren').map((r) => r.id).sort(), [1, 3])
  assert.deepEqual(searchTextIndex(index, 'frieren slayer').map((r) => r.id), [3], 'AND semantics')
  assert.deepEqual(searchTextIndex(index, 'frieren gundam'), [], 'a missing token empties the result')
  assert.deepEqual(searchTextIndex(index, ''), [])
})

test('ranking weights rare tokens above common ones', () => {
  const index = buildTextIndex([
    { id: 1, text: 'mecha mecha mecha robot' },
    { id: 2, text: 'mecha zephyr' },
  ])
  const ranked = searchTextIndex(index, 'mecha zephyr')
  assert.equal(ranked.length, 1)
  const byToken = searchTextIndex(index, 'zephyr')
  assert.equal(byToken[0].id, 2)
  const mecha = searchTextIndex(index, 'mecha')
  assert.equal(mecha[0].id, 1, 'higher term frequency ranks first on ties of rarity')
})

test('incremental updates replace and remove cleanly', () => {
  const index = buildTextIndex([{ id: 1, text: 'alpha beta' }])
  assert.equal(searchTextIndex(index, 'alpha').length, 1)
  indexDocument(index, { id: 1, text: 'gamma delta' })
  assert.deepEqual(searchTextIndex(index, 'alpha'), [], 'stale tokens stop matching after replace')
  assert.equal(searchTextIndex(index, 'gamma').length, 1)
  removeDocument(index, 1)
  assert.deepEqual(searchTextIndex(index, 'gamma'), [])
  assert.equal(index.tokens.size, 0, 'postings are pruned when empty')
  indexDocument(index, { id: 1, text: 'alpha' })
  indexDocument(index, { id: 1, text: 'alpha' })
  assert.equal(searchTextIndex(index, 'alpha').length, 1, 're-indexing the same id stays a single document')
})

test('sparse inputs never throw', () => {
  assert.deepEqual(searchTextIndex(null, 'x'), [])
  assert.deepEqual(searchTextIndex(buildTextIndex(), 'x'), [])
  assert.deepEqual(buildTextIndex([null, { text: 'no id' }, { id: 2 }]).docs.size, 1)
  assert.equal(tokenize(null).length, 0)
})
