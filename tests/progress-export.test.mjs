import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PROGRESS_EXPORT_FORMAT, buildProgressExport } from '../server/progressExport.mjs'

const mediaById = new Map([
  [10, { id: 10, title: 'Frieren', externalIds: { myanimelist: '52991', anilist: '154587' } }],
  [11, { id: 11, title: 'Odd Days', externalIds: { myanimelist: '1', empty: '', bad: 42 } }],
])

test('the export carries stable external IDs and never drops rows (AV-174)', () => {
  const rows = [
    { mediaId: 11, season: 's1', episode: 2, state: 'started', positionSeconds: 60, runtimeSeconds: 1400, updatedAt: 500 },
    { mediaId: 10, season: 's1', episode: 1, state: 'completed', positionSeconds: 1400, runtimeSeconds: 1400, updatedAt: 900 },
    { mediaId: 99, season: 'unknown', episode: 3, state: 'manual', positionSeconds: 0, runtimeSeconds: null, updatedAt: 100 },
    { mediaId: 10, season: 's1', episode: 2, state: 'started', positionSeconds: 30, runtimeSeconds: 1400, updatedAt: 800 },
  ]
  const out = buildProgressExport(rows, mediaById, { exportedAt: 123456 })
  assert.equal(out.format, PROGRESS_EXPORT_FORMAT)
  assert.equal(out.exportedAt, 123456)
  assert.equal(out.externalIdsUnavailable, false)
  // deterministic ordering: mediaId, season, episode ascending — not input order
  assert.deepEqual(out.entries.map((entry) => [entry.mediaId, entry.episode]), [
    [10, 1],
    [10, 2],
    [11, 2],
    [99, 3],
  ])
  // stable external IDs are copied per row; empty/non-string values dropped
  assert.deepEqual(out.entries[0].externalIds, { myanimelist: '52991', anilist: '154587' })
  assert.deepEqual(out.entries[2].externalIds, { myanimelist: '1' })
  // missing media keeps the row with an empty map and a null title
  assert.deepEqual(out.entries[3], {
    mediaId: 99,
    title: null,
    season: 'unknown',
    episode: 3,
    state: 'manual',
    positionSeconds: 0,
    runtimeSeconds: null,
    updatedAt: 100,
    externalIds: {},
  })
  // the profile key is deliberately not exported
  assert.equal('profileId' in out.entries[0], false)
})

test('the export surfaces an enrichment failure instead of implying IDs (AV-174)', () => {
  const out = buildProgressExport([], new Map(), { exportedAt: 1, externalIdsUnavailable: true })
  assert.equal(out.externalIdsUnavailable, true)
  assert.deepEqual(out.entries, [])
})
