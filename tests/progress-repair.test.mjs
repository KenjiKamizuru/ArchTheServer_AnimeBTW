import { test } from 'node:test'
import assert from 'node:assert/strict'

import { findProgressGaps, repairMarks } from '../server/progressRepair.mjs'

const row = (mediaId, season, episode, state = 'manual') => ({ mediaId, season, episode, state, positionSeconds: 0, runtimeSeconds: null, updatedAt: 1 })

test('only interior gaps count — trailing episodes are not gaps (AV-175)', () => {
  assert.deepEqual(findProgressGaps([
    row(1, 's1', 1), row(1, 's1', 2), row(1, 's1', 5), // 3, 4 missing
    row(1, 's2', 2), // season s2: episode 1 missing below the max
    row(2, 's1', 1), row(2, 's1', 2), // intact — absent entirely
    row(3, 's1', 4), row(3, 's1', 1), row(3, 's1', 2), row(3, 's1', 3), // intact
  ]), [
    { mediaId: 1, season: 's1', missing: [3, 4] },
    { mediaId: 1, season: 's2', missing: [1] },
  ])
  // the plan is deterministic and repair marks are explicit manual claims
  const marks = repairMarks(findProgressGaps([row(1, 's1', 3)]))
  assert.deepEqual(marks, [
    { mediaId: 1, season: 's1', episode: 1, positionSeconds: 0, state: 'manual' },
    { mediaId: 1, season: 's1', episode: 2, positionSeconds: 0, state: 'manual' },
  ])
  // no rows, no gaps; invalid episode numbers never create ranges
  assert.deepEqual(findProgressGaps([]), [])
  assert.deepEqual(findProgressGaps([row(9, 's1', 0), row(9, 's1', -2)]), [])
})
