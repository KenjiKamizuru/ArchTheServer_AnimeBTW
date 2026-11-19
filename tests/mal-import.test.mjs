// Tests for MyAnimeList list-export import (AV-142a): pure parsing +
// mapping; resolution is injected and never title-based.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMalExport, matchResolved, toImportDocument, MAX_MAL_ENTRIES } from '../server/malImport.mjs'
import { parseListImport } from '../server/listImport.mjs'

// Official-shape entry (format source: github.com/seanbreckenridge/malezport).
const malEntry = (over = {}) => ({
  anime_id: 31646,
  title: '3-gatsu no Lion',
  media_type: 'TV',
  episodes: 22,
  my_id: 0,
  watched_episodes: 22,
  score: 9,
  status: 'Completed',
  comments: 'a masterpiece',
  tags: 'Slice of Life',
  ...over,
})

test('parses an official-shape export and maps fields (AV-142a)', () => {
  const parsed = parseMalExport([malEntry()])
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.value.entries, [
    { malId: 31646, title: '3-gatsu no Lion', status: 'completed', rating: 9, note: 'Slice of Life\na masterpiece', watchedEpisodes: 22, episodesTotal: 22 },
  ])
})
test('status mapping covers the five MAL statuses', () => {
  const cases = [
    ['Watching', 'watching'],
    ['Completed', 'completed'],
    ['On-Hold', 'paused'],
    ['On Hold', 'paused'],
    ['Dropped', 'dropped'],
    ['Plan to Watch', 'planned'],
    ['PLANNING', 'planned'],
  ]
  for (const [malStatus, expected] of cases) {
    const parsed = parseMalExport([malEntry({ status: malStatus })])
    assert.equal(parsed.value.entries[0].status, expected, `${malStatus} → ${expected}`)
  }
})
test('score 0 means unrated', () => {
  assert.equal(parseMalExport([malEntry({ score: 0 })]).value.entries[0].rating, null)
  assert.equal(parseMalExport([malEntry({ score: 1 })]).value.entries[0].rating, 1)
})
test('tags/comments form the note; empty yields none', () => {
  assert.equal(parseMalExport([malEntry({ tags: '  ', comments: '' })]).value.entries[0].note, '')
  assert.equal(parseMalExport([malEntry({ tags: '', comments: 'only notes' })]).value.entries[0].note, 'only notes')
})
test('strict validation rejects malformed documents', () => {
  assert.equal(parseMalExport({}).ok, false, 'non-array rejected')
  assert.equal(parseMalExport('[]').ok, false, 'string rejected')
  assert.equal(parseMalExport([malEntry({ anime_id: -1 })]).ok, false)
  assert.equal(parseMalExport([malEntry({ anime_id: 1.5 })]).ok, false)
  assert.equal(parseMalExport([malEntry({ title: '   ' })]).ok, false)
  assert.equal(parseMalExport([malEntry({ status: 'Bogus' })]).ok, false)
  assert.equal(parseMalExport([malEntry({ score: 11 })]).ok, false)
  assert.equal(parseMalExport([malEntry({ score: -1 })]).ok, false)
  assert.equal(parseMalExport([malEntry({ score: 2.5 })]).ok, false)
  assert.equal(parseMalExport([malEntry({ comments: 'x'.repeat(1001) })]).ok, false)
  assert.equal(parseMalExport(Array.from({ length: MAX_MAL_ENTRIES + 1 }, () => malEntry())).ok, false, 'entry cap')
  assert.equal(parseMalExport([]).ok, true, 'an empty export is valid')
})
test('matching uses ids only — similar titles never match', () => {
  const parsed = parseMalExport([malEntry(), malEntry({ anime_id: 1, title: 'Unknown Show' })])
  const media = { id: 100, title: '3-gatsu no Lion', cover: null }
  const { matched, unmatched } = matchResolved(parsed.value.entries, new Map([[31646, media]]))
  assert.equal(matched.length, 1)
  assert.equal(matched[0].media.id, 100)
  assert.equal(unmatched.length, 1)
  assert.equal(unmatched[0].malId, 1, 'the unmatched entry keeps its mal id for the report')
})
test('resolver output with an invalid media id stays unmatched', () => {
  const parsed = parseMalExport([malEntry()])
  const { matched, unmatched } = matchResolved(parsed.value.entries, new Map([[31646, { id: -3, title: 'x' }]]))
  assert.equal(matched.length, 0)
  assert.equal(unmatched.length, 1)
})
test('the import document round-trips through parseListImport', () => {
  const parsed = parseMalExport([malEntry(), malEntry({ anime_id: 5, title: 'Other', status: 'Plan to Watch', score: 0, tags: '', comments: '' })])
  const media = { id: 100, title: '3-gatsu no Lion', cover: null }
  const { matched } = matchResolved(parsed.value.entries, new Map([[31646, media], [5, { id: 50, title: 'Other', cover: null }]]))
  const document = toImportDocument(matched, { name: '  My list  ', now: 1000 })
  // parseListImport THROWS on invalid input and returns the parsed value.
  const roundTrip = parseListImport(document)
  assert.equal(roundTrip.name, 'My list')
  assert.equal(roundTrip.entries[0].status, 'completed')
  assert.equal(roundTrip.entries[0].rating, 9)
  assert.equal(roundTrip.entries[0].note, 'Slice of Life\na masterpiece')
  assert.equal(roundTrip.entries[1].rating, null)
  assert.deepEqual(roundTrip.entries.map((e) => e.addedAt), [1000, 1001], 'stable import timestamps')
})
