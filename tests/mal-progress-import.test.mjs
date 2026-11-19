import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mapWatchedProgress, MAX_EPISODES_PER_ENTRY } from '../server/malProgressImport.mjs'
import { parseMalExport, matchResolved } from '../server/malImport.mjs'

const seasonOf = (media) => (media.season ? `${media.season}-${media.seasonYear}` : 'unknown')

test('watched counts become per-episode manual marks and status rows (AV-173)', () => {
  const parsed = parseMalExport([
    { anime_id: 1, title: 'A', status: 'Completed', watched_episodes: 3, episodes: 3, score: 0 },
    { anime_id: 2, title: 'B', status: 'Watching', watched_episodes: 2, episodes: 12, score: 0 },
    { anime_id: 3, title: 'C', status: 'Plan to Watch', watched_episodes: 0, episodes: 0, score: 0 },
    { anime_id: 4, title: 'D', status: 'Dropped', watched_episodes: 26, episodes: 0, score: 0 },
  ])
  assert.equal(parsed.ok, true, parsed.error)
  assert.equal(parsed.value.entries[0].watchedEpisodes, 3)
  assert.equal(parsed.value.entries[2].episodesTotal, 0)
  const { matched, unmatched } = matchResolved(parsed.value.entries, new Map([
    [1, { id: 101, season: 'spring', seasonYear: 2024 }],
    [2, { id: 102 }],
    [3, { id: 103 }],
    // 4 intentionally unresolved
  ]))
  assert.equal(matched.length, 3)
  assert.equal(unmatched.length, 1, 'unmatched entries are reported, never guessed')
  const { marks, statuses, truncated } = mapWatchedProgress(matched, { seasonOf })
  // episodes 1..N get explicit manual marks; 0-watched emits none
  assert.equal(marks.length, 5, '3 + 2 + 0')
  assert.deepEqual(marks.map((mark) => [mark.mediaId, mark.episode]), [
    [101, 1], [101, 2], [101, 3], [102, 1], [102, 2],
  ])
  assert.ok(marks.every((mark) => mark.state === 'manual' && mark.positionSeconds === 0))
  assert.equal(marks[0].season, 'spring-2024', 'the season key comes from the injected resolver')
  assert.equal(marks[3].season, 'unknown')
  assert.deepEqual(statuses.map((row) => [row.mediaId, row.status]), [
    [101, 'completed'], [102, 'watching'], [103, 'planned'],
  ])
  assert.deepEqual(truncated, [])
})

test('the per-entry mark cap reports truncation instead of flooding (AV-173)', () => {
  const entries = [{ status: 'watching', watchedEpisodes: MAX_EPISODES_PER_ENTRY + 5, media: { id: 9 } }]
  const { marks, truncated } = mapWatchedProgress(entries, { seasonOf })
  assert.equal(marks.length, MAX_EPISODES_PER_ENTRY)
  assert.deepEqual(truncated, [{ mediaId: 9, watchedEpisodes: MAX_EPISODES_PER_ENTRY + 5, importedMarks: MAX_EPISODES_PER_ENTRY }])
  assert.throws(() => mapWatchedProgress([], {}), /seasonOf/)
})
