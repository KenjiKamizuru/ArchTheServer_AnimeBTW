// Tests for the AV-139 "stalled shows" smart list (pure core).
import test from 'node:test'
import assert from 'node:assert/strict'
import { stalledUnfinished, clampIdleDays, DEFAULT_IDLE_DAYS } from '../server/smartLists.mjs'

const NOW = 1_800_000_000_000
const DAY = 86_400_000
const entry = (mediaId, status, over = {}) => ({
  mediaId,
  media: { id: mediaId, title: `Show ${mediaId}`, cover: null },
  status,
  addedAt: NOW - 30 * DAY,
  ...over,
})

test('only started-but-unfinished statuses qualify (AV-139)', () => {
  const entries = [
    entry(1, 'watching'),
    entry(2, 'paused'),
    entry(3, 'planned'),
    entry(4, 'completed'),
    entry(5, 'dropped'),
    entry(6, 'bogus'),
  ]
  const rows = stalledUnfinished(entries, [], { now: NOW })
  assert.deepEqual(rows.map((row) => row.mediaId), [1, 2], 'watching + paused only')
  assert.deepEqual(rows.map((row) => row.status), ['watching', 'paused'])
})
test('never-progressed entries are stalled with lastProgressAt null', () => {
  const rows = stalledUnfinished([entry(1, 'watching')], [], { now: NOW })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].lastProgressAt, null)
  assert.equal(rows[0].addedAt, NOW - 30 * DAY, 'addedAt is carried through')
})
test('recent progress excludes the entry; stale progress keeps it', () => {
  const fresh = stalledUnfinished([entry(1, 'watching')], [{ mediaId: 1, updatedAt: NOW - 3 * DAY }], { now: NOW, idleDays: 14 })
  assert.equal(fresh.length, 0, 'activity 3 days ago is recent')
  const stale = stalledUnfinished([entry(1, 'watching')], [{ mediaId: 1, updatedAt: NOW - 20 * DAY }], { now: NOW, idleDays: 14 })
  assert.equal(stale.length, 1)
  assert.equal(stale[0].lastProgressAt, NOW - 20 * DAY, 'the last activity time is carried')
})
test('the cutoff boundary: equal to cutoff is recent, one ms older is stalled', () => {
  const cutoff = NOW - 14 * DAY
  assert.equal(stalledUnfinished([entry(1, 'watching')], [{ mediaId: 1, updatedAt: cutoff }], { now: NOW, idleDays: 14 }).length, 0)
  assert.equal(stalledUnfinished([entry(1, 'watching')], [{ mediaId: 1, updatedAt: cutoff - 1 }], { now: NOW, idleDays: 14 }).length, 1)
})
test('a media uses its MOST RECENT record across seasons and episodes', () => {
  const progress = [
    { mediaId: 1, updatedAt: NOW - 60 * DAY },
    { mediaId: 1, updatedAt: NOW - 2 * DAY },
    { mediaId: 1, updatedAt: NOW - 40 * DAY },
  ]
  assert.equal(stalledUnfinished([entry(1, 'watching')], progress, { now: NOW, idleDays: 14 }).length, 0, 'the fresh record wins')
  assert.equal(stalledUnfinished([entry(2, 'watching')], [{ mediaId: 2, updatedAt: NOW - 15 * DAY }, { mediaId: 2, updatedAt: NOW - 90 * DAY }], { now: NOW, idleDays: 14 }).length, 1, 'the oldest pair is still stale')
})
test('order: never-progressed first, then oldest activity, then title', () => {
  const entries = [
    entry(10, 'watching', { media: { id: 10, title: 'Beta', cover: null } }),
    entry(11, 'paused', { media: { id: 11, title: 'Alpha', cover: null } }),
    entry(12, 'watching', { media: { id: 12, title: 'Gamma', cover: null } }),
    entry(13, 'watching', { media: { id: 13, title: 'Delta', cover: null } }),
  ]
  const progress = [
    { mediaId: 12, updatedAt: NOW - 20 * DAY },
    { mediaId: 13, updatedAt: NOW - 20 * DAY },
  ]
  const rows = stalledUnfinished(entries, progress, { now: NOW, idleDays: 14 })
  assert.deepEqual(rows.map((row) => row.mediaId), [11, 10, 13, 12], 'null first (Alpha), then never-touched Beta by title, then equal-time Delta < Gamma by title')
})
test('duplicate media rows collapse to one; malformed rows are ignored', () => {
  const entries = [entry(1, 'watching'), entry(1, 'paused'), entry(-2, 'watching'), entry('x', 'watching'), { mediaId: 3, status: 'watching' }]
  const rows = stalledUnfinished(entries, [
    { mediaId: 1, updatedAt: 'bad' },
    { mediaId: 1, updatedAt: NOW - 30 * DAY },
    { mediaId: 2, updatedAt: NOW - 1 * DAY },
    { updatedAt: NOW },
  ], { now: NOW, idleDays: 14 })
  assert.equal(rows.length, 1, 'one valid row (media 3 has no media object — dropped; media 1 collapses)')
  assert.equal(rows[0].mediaId, 1)
  assert.equal(rows[0].lastProgressAt, NOW - 30 * DAY, 'the malformed record is ignored, the valid one applies')
})
test('idle window clamps to 1–365 days, invalid falls back', () => {
  assert.equal(clampIdleDays(1), 1)
  assert.equal(clampIdleDays(365), 365)
  assert.equal(clampIdleDays(30), 30)
  for (const bad of [0, -1, 1.5, 366, 'x', null, undefined, NaN]) assert.equal(clampIdleDays(bad), DEFAULT_IDLE_DAYS, `${String(bad)} → default`)
  assert.equal(clampIdleDays('7'), 7, 'numeric strings count')
})
test('entries without a media object never render', () => {
  const rows = stalledUnfinished([{ mediaId: 9, status: 'watching' }, entry(10, 'watching')], [], { now: NOW })
  assert.deepEqual(rows.map((row) => row.mediaId), [10])
})
