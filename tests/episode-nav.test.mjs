// Episode navigation gate (AV-159): when does a "next episode" exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextEpisodeNumber, clampEpisode } from '../src/lib/format.ts'

test('a next episode exists only before the last one (AV-159)', () => {
  assert.equal(nextEpisodeNumber(1, 12), 2)
  assert.equal(nextEpisodeNumber(11, 12), 12)
  assert.equal(nextEpisodeNumber(12, 12), null, 'the last episode has no next')
  assert.equal(nextEpisodeNumber(1, 1), null, 'a single-episode work has no next')
  assert.equal(nextEpisodeNumber(99, 12), null, 'beyond the end never navigates')
})
test('the gate is strict: real episode numbers only', () => {
  // Callers pass clampEpisode output — non-integers are refused, not coerced.
  assert.equal(nextEpisodeNumber(2.9, 5), null, 'non-integer positions are refused')
  assert.equal(nextEpisodeNumber(0, 5), null, 'episode 0 is not a real position')
  assert.equal(nextEpisodeNumber(NaN, 5), null)
  assert.equal(nextEpisodeNumber(1, 0), null, 'a work with no known episodes has no next')
  assert.equal(clampEpisode(99, 12), 12)
  assert.equal(clampEpisode(2.9, 5), 2, 'clampEpisode itself still floors')
})
