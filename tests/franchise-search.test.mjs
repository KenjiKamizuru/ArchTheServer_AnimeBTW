// Tests for franchise and relationship search (AV-060): query syntax and the
// pure franchise matcher over relation names/types.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSearchQuery, hasStructuredFilters, matchesFranchise } from '../server/search.mjs'
import { createAnimeRecord } from '../server/catalog.mjs'

test('franchise fields parse and count as structured filters', () => {
  const parsed = parseSearchQuery('zero related:sequel franchise:"fate stay night" series:monogatari')
  assert.equal(parsed.text, 'zero')
  assert.deepEqual(parsed.filters.franchise, ['sequel', 'fate stay night', 'monogatari'])
  assert.equal(hasStructuredFilters(parsed.filters), true)
  assert.deepEqual(parseSearchQuery('plain').filters.franchise, [])
})

test('matchesFranchise handles relation-type tokens and name matching', () => {
  const record = createAnimeRecord({
    id: 330,
    relationNames: ['Fate/stay night', 'Fate/Zero'],
    relationTypes: ['sequel', 'prequel'],
  })
  assert.equal(matchesFranchise('sequel', record), true, 'relation-type token matches by presence')
  assert.equal(matchesFranchise('side story', record), false)
  assert.equal(matchesFranchise('fate', record), true, 'franchise names match related titles')
  assert.equal(matchesFranchise('stay night', record), true)
  assert.equal(matchesFranchise('monogatari', record), false)
  assert.equal(matchesFranchise('', record), false)
  assert.equal(matchesFranchise('sequel', null), false)
})
