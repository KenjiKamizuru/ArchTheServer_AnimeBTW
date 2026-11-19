// Tests for people/entity search (AV-058): query syntax, name matching, and
// the staff/voice-actor name indexes on records.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSearchQuery, hasStructuredFilters, matchEntityNames } from '../server/search.mjs'
import { createAnimeRecord, normalizeNameList } from '../server/catalog.mjs'

test('staff and voice-actor fields parse into structured filters', () => {
  const parsed = parseSearchQuery('frieren director:"hideaki anno" staff:kubo va:matsuoka seiyuu:hayami genre:drama')
  assert.equal(parsed.text, 'frieren')
  assert.deepEqual(parsed.filters.staff, ['hideaki anno', 'kubo'])
  assert.deepEqual(parsed.filters.voiceActor, ['matsuoka', 'hayami'])
  assert.deepEqual(parsed.filters.genre, ['drama'])
  assert.equal(hasStructuredFilters(parsed.filters), true)
  assert.deepEqual(parseSearchQuery('just words').filters.staff, [])
})

test('matchEntityNames matches normalized and romanized names', () => {
  const names = ['Studio Khara', '庵野秀明', 'Noriko Hidaka']
  assert.equal(matchEntityNames('khara', names), true)
  assert.equal(matchEntityNames('studio kha', names), true)
  assert.equal(matchEntityNames('hidaka', names), true)
  assert.equal(matchEntityNames('庵野', names), true, 'native-script names match as substrings')
  assert.equal(matchEntityNames('hidaka noriko', names), false, 'word order is not transposed')
  assert.equal(matchEntityNames('miyazaki', names), false)
  assert.equal(matchEntityNames('', names), false)
  assert.equal(matchEntityNames('khara', null), false)
})

test('records carry bounded, deduped people-name indexes', () => {
  const record = createAnimeRecord({
    id: 320,
    staffNames: ['  Hideaki Anno ', 'hideaki anno', '', null, 'Kazuya Tsurumaki'],
    voiceActorNames: Array.from({ length: 20 }, (_, i) => `Actor ${i}`),
  })
  assert.deepEqual(record.staffNames, ['Hideaki Anno', 'Kazuya Tsurumaki'])
  assert.equal(record.voiceActorNames.length, 12, 'bounded at 12 names')
  assert.deepEqual(createAnimeRecord({ id: 321 }).staffNames, [])
  assert.deepEqual(createAnimeRecord({ id: 322 }).voiceActorNames, [])
  assert.deepEqual(normalizeNameList('not-an-array'), [])
})

test('character names parse into filters and index onto records', () => {
  const parsed = parseSearchQuery('char:"frieren" character:stark')
  assert.deepEqual(parsed.filters.character, ['frieren', 'stark'])
  assert.equal(hasStructuredFilters(parsed.filters), true)
  const record = createAnimeRecord({ id: 323, characterNames: ['Frieren', 'frieren', ' Stark '] })
  assert.deepEqual(record.characterNames, ['Frieren', 'Stark'])
  assert.deepEqual(createAnimeRecord({ id: 324 }).characterNames, [])
  assert.equal(matchEntityNames('stark', record.characterNames), true)
})
