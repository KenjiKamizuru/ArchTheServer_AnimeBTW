// Tests for episode search (AV-062): query syntax and the dual-semantics
// episode matcher (episode number vs episode title).
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSearchQuery, hasStructuredFilters, matchesEpisode } from '../server/search.mjs'
import { createAnimeRecord } from '../server/catalog.mjs'

test('episode fields parse into their own structured dimension', () => {
  const parsed = parseSearchQuery('x episode:7 episodename:"the child of hope" ep:12')
  assert.equal(parsed.text, 'x')
  assert.deepEqual(parsed.filters.episode, ['7', 'the child of hope'])
  assert.deepEqual(parsed.filters.episodes, { min: 12, max: 12 }, 'ep: keeps its count-range meaning')
  assert.equal(hasStructuredFilters(parsed.filters), true)
  assert.deepEqual(parseSearchQuery('plain').filters.episode, [])
})

test('matchesEpisode treats numbers as episode existence', () => {
  const record = createAnimeRecord({ id: 340, episodes: 12, airedEpisodes: 5 })
  assert.equal(matchesEpisode('7', record), true, 'announced total covers episode 7')
  assert.equal(matchesEpisode('5', record), true, 'aired count covers episode 5')
  assert.equal(matchesEpisode('13', record), false)
  assert.equal(matchesEpisode('0', record), true, 'episode 0 trivially exists on the numeric path')
  assert.equal(matchesEpisode('7', { episodes: null, airedEpisodes: 0 }), false)
})

test('matchesEpisode fragment-matches episode titles otherwise', () => {
  const record = createAnimeRecord({
    id: 341,
    episodeTitles: ['Episode 1', 'The Child of Hope', 'Blue Spring'],
  })
  assert.equal(matchesEpisode('child of hope', record), true)
  assert.equal(matchesEpisode('blue', record), true)
  assert.equal(matchesEpisode('the great escape', record), false)
  assert.equal(matchesEpisode('', record), false)
  assert.equal(matchesEpisode('blue', null), false)
})
