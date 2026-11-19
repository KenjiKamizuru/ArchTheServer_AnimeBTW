// Episode navigation gate (AV-159): when does a "next episode" exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextEpisodeNumber, previousEpisodeNumber, clampEpisode } from '../src/lib/format.ts'

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

test('the previous-episode gate refuses invalid input and stops at episode 1 (AV-185)', () => {
  // strict contract: non-integers and values below 1 are refused, not coerced
  assert.equal(previousEpisodeNumber(2.9, 5), null)
  assert.equal(previousEpisodeNumber(0, 5), null)
  assert.equal(previousEpisodeNumber(-1, 5), null)
  assert.equal(previousEpisodeNumber(Number.NaN, 5), null)
  assert.equal(previousEpisodeNumber(3, Number.NaN), null)
  // clamps first (mirroring nextEpisodeNumber), then steps down
  assert.equal(previousEpisodeNumber(3, 5), 2)
  assert.equal(previousEpisodeNumber(2, 1), null, 'clamped down to the first episode — no previous')
  assert.equal(previousEpisodeNumber(9, 5), 4, 'clamped to 5 first, then 4')
  // no previous at the first episode
  assert.equal(previousEpisodeNumber(1, 5), null)
  assert.equal(previousEpisodeNumber(1, 0), null)
})
