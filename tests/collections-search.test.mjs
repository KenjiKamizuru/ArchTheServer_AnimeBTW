// Tests for bookmark/custom-list search (AV-064a): the pure record-title
// matcher used by the collections search route.
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchRecordTitles } from '../server/search.mjs'
import { createAnimeRecord } from '../server/catalog.mjs'

test('matchRecordTitles matches titles, aliases and typos', () => {
  const record = createAnimeRecord({
    id: 350,
    title: 'Frieren',
    romaji: 'Sousou no Frieren',
    synonyms: ['Frieren at the Funeral'],
  })
  assert.equal(matchRecordTitles('frieren', record), true)
  assert.equal(matchRecordTitles('sousou', record), true, 'romaji variants match')
  assert.equal(matchRecordTitles('funeral', record), true, 'synonym fragments match')
  assert.equal(matchRecordTitles('frierne', record), true, 'typos are tolerated')
  assert.equal(matchRecordTitles('naruto', record), false)
  assert.equal(matchRecordTitles('', record), false)
  assert.equal(matchRecordTitles('frieren', null), false)
})

test('matchRecordTitles respects provider alternates from provenance', () => {
  const record = createAnimeRecord(
    { id: 351, title: 'Corrected Title' },
    { source: 'anilist', refreshedAt: 5, fields: { title: { source: 'manual', refreshedAt: 6, alternates: [{ source: 'anidb', value: 'Original Title' }] } } },
  )
  assert.equal(matchRecordTitles('original', record), true, 'correction alternates remain searchable')
  assert.equal(matchRecordTitles('corrected', record), true)
})
