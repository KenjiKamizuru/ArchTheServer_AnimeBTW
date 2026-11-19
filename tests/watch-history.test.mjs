import { test } from 'node:test'
import assert from 'node:assert/strict'

import { filterWatchHistory, watchHistoryRows } from '../src/lib/history.ts'

const day = (iso) => Date.parse(iso)

const records = [
  { mediaId: 1, season: 'winter-2024', episode: 3, state: 'started', positionSeconds: 300, runtimeSeconds: 1440, updatedAt: day('2024-03-01T10:00:00Z') },
  { mediaId: 2, season: 'unknown', episode: 1, state: 'completed', positionSeconds: 1400, runtimeSeconds: 1440, updatedAt: day('2024-03-05T23:30:00Z') },
  { mediaId: 3, season: 'fall-2023', episode: 12, state: 'manual', positionSeconds: null, runtimeSeconds: null, updatedAt: day('2024-03-05T08:00:00Z') },
]
const mediaById = new Map([
  [1, { id: 1, title: 'Frieren: Beyond Journey' }],
  [2, { id: 2, title: 'SPY x FAMILY' }],
])

test('history rows join media and sort newest first with mediaId tiebreak (AV-161)', () => {
  const rows = watchHistoryRows(records, mediaById)
  assert.deepEqual(
    rows.map((row) => [row.mediaId, row.episode, row.media?.title ?? null]),
    [
      [2, 1, 'SPY x FAMILY'],
      [3, 12, null],
      [1, 3, 'Frieren: Beyond Journey'],
    ],
  )
  // the same instant breaks the tie by ascending mediaId
  const tie = watchHistoryRows(
    [
      { mediaId: 9, season: 's', episode: 1, state: 'started', positionSeconds: 1, runtimeSeconds: 2, updatedAt: 5 },
      { mediaId: 4, season: 's', episode: 1, state: 'started', positionSeconds: 1, runtimeSeconds: 2, updatedAt: 5 },
    ],
    new Map(),
  )
  assert.deepEqual(tie.map((row) => row.mediaId), [4, 9])
})

test('history filters: inclusive UTC day bounds and case-insensitive title (AV-161)', () => {
  const rows = watchHistoryRows(records, mediaById)
  // inclusive single-day bound: both March 5 rows (UTC), never the March 1 row
  assert.deepEqual(
    filterWatchHistory(rows, { from: '2024-03-05', to: '2024-03-05' }).map((row) => row.mediaId),
    [2, 3],
  )
  // from-bound is inclusive of its own day
  assert.deepEqual(
    filterWatchHistory(rows, { from: '2024-03-01' }).map((row) => row.mediaId),
    [2, 3, 1],
  )
  // to-bound excludes later days
  assert.deepEqual(
    filterWatchHistory(rows, { to: '2024-03-04' }).map((row) => row.mediaId),
    [1],
  )
  // title: case-insensitive substring; rows without media match only an empty filter
  assert.deepEqual(
    filterWatchHistory(rows, { title: 'spy' }).map((row) => row.mediaId),
    [2],
  )
  assert.deepEqual(filterWatchHistory(rows, { title: 'unknown title' }), [])
  // combined filters intersect
  assert.deepEqual(
    filterWatchHistory(rows, { from: '2024-03-05', title: 'family' }).map((row) => row.mediaId),
    [2],
  )
  // an empty filter keeps everything
  assert.deepEqual(filterWatchHistory(rows, {}), rows)
})
