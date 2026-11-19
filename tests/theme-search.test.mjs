// Tests for theme/genre/tag search (AV-061): query syntax and the
// closed-vocabulary name matcher used by the genre/tag filters.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSearchQuery, hasStructuredFilters, matchNameToken, matchEntityNames } from '../server/search.mjs'

test('theme fields parse into their own structured dimension', () => {
  const parsed = parseSearchQuery('x theme:time motif:"found family" genre:sci-fi tag:time-travel')
  assert.equal(parsed.text, 'x')
  assert.deepEqual(parsed.filters.theme, ['time', 'found family'])
  assert.deepEqual(parsed.filters.genre, ['sci-fi'])
  assert.deepEqual(parsed.filters.tag, ['time-travel'])
  assert.equal(hasStructuredFilters(parsed.filters), true)
  assert.deepEqual(parseSearchQuery('plain').filters.theme, [])
})

test('matchNameToken matches genres and tags regardless of separators', () => {
  assert.equal(matchNameToken('sci-fi', ['Sci-Fi']), true)
  assert.equal(matchNameToken('sci fi', ['Sci-Fi']), true)
  assert.equal(matchNameToken('scifi', ['Sci-Fi']), true)
  assert.equal(matchNameToken('sci', ['Sci-Fi']), false, 'no substring over-matching')
  assert.equal(matchNameToken('science fiction', ['Sci-Fi']), false)
  assert.equal(matchNameToken('time-travel', ['Time Travel', 'Mecha']), true)
  assert.equal(matchNameToken('', ['Drama']), false)
  assert.equal(matchNameToken('drama', null), false)
})

test('theme search matches tag vocabulary as fragments', () => {
  const tags = ['Time Travel', 'Found Family', 'Mecha']
  assert.equal(matchEntityNames('time', tags), true)
  assert.equal(matchEntityNames('family', tags), true)
  assert.equal(matchEntityNames('space opera', tags), false)
})
