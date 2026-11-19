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

// ── Returning soon (AV-138) ─────────────────────────────────────────────
import { returningSoon, seasonKey, currentSeasonKey, RETURNING_RELATIONS } from '../server/smartLists.mjs'

const JUNE_2026 = Date.UTC(2026, 5, 1) // SPRING 2026 in progress (key 20261)
const edge = (relationType, id) => ({ relationType, node: { id } })
const record = (id, title, season, seasonYear, format = 'TV') => ({ id, title, season, seasonYear, format })

test('season keys: WINTER..FALL map through the year (AV-138)', () => {
  assert.equal(seasonKey(record(1, 'a', 'WINTER', 2027)), 20270)
  assert.equal(seasonKey(record(1, 'a', 'SPRING', 2026)), 20261)
  assert.equal(seasonKey(record(1, 'a', 'SUMMER', 2026)), 20262)
  assert.equal(seasonKey(record(1, 'a', 'FALL', 2026)), 20263)
  assert.equal(currentSeasonKey(JUNE_2026), 20261, 'June sits in SPRING')
  assert.equal(currentSeasonKey(Date.UTC(2026, 11, 31)), 20263, 'December sits in FALL')
  assert.equal(currentSeasonKey(Date.UTC(2027, 0, 1)), 20270, 'January rolls the year')
  assert.equal(seasonKey({ season: 'FALL', seasonYear: null }), null)
  assert.equal(seasonKey({ season: null, seasonYear: 2027 }), null, 'year alone is uncertain')
  assert.equal(seasonKey(record(1, 'a', 'FALL', 1899)), null, 'out-of-range years rejected')
})
test('a sequel dated into a future season makes the entry return', () => {
  const entries = [entry(1, 'completed')]
  const edges = new Map([[1, [edge('SEQUEL', 90)]]])
  const records = new Map([[90, record(90, 'Show Season 2', 'WINTER', 2027)]])
  const rows = returningSoon(entries, edges, records, { now: JUNE_2026 })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].mediaId, 1)
  assert.deepEqual(rows[0].upcoming, [{ id: 90, title: 'Show Season 2', format: 'TV', season: 'WINTER', seasonYear: 2027 }])
})
test('only SEQUEL counts as returning', () => {
  const entries = [entry(1, 'completed')]
  const edges = new Map([[1, ['PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'ADAPTATION', 'OTHER'].map((type, index) => edge(type, 100 + index)).concat([edge('SEQUEL', 90)])]])
  const records = new Map([...['PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'ADAPTATION', 'OTHER'].map((type, index) => [100 + index, record(100 + index, type, 'WINTER', 2027)]), [90, record(90, 'Season 2', 'WINTER', 2027)]])
  const rows = returningSoon(entries, edges, records, { now: JUNE_2026 })
  assert.deepEqual(rows[0].upcoming.map((item) => item.id), [90], 'side stories and spin-offs are new shows, not returns')
  assert.ok(RETURNING_RELATIONS.has('SEQUEL'))
})
test('the current season is not future; the next one is', () => {
  const entries = [entry(1, 'completed')]
  const edges = new Map([[1, [edge('SEQUEL', 10), edge('SEQUEL', 11), edge('SEQUEL', 12)]]])
  const records = new Map([
    [10, record(10, 'This season', 'SPRING', 2026)],
    [11, record(11, 'Next season', 'SUMMER', 2026)],
    [12, record(12, 'Last season', 'WINTER', 2026)],
  ])
  const rows = returningSoon(entries, edges, records, { now: JUNE_2026 })
  assert.deepEqual(rows[0].upcoming.map((item) => item.id), [11], 'only strictly-future seasons count')
})
test('undated or uncertain related records are excluded, never guessed', () => {
  const entries = [entry(1, 'completed')]
  const edges = new Map([[1, [edge('SEQUEL', 20), edge('SEQUEL', 21), edge('SEQUEL', 22), edge('SEQUEL', 23)]]])
  const records = new Map([
    [20, record(20, 'No date', null, null)],
    [21, record(21, 'Year only', null, 2027)],
    [22, record(22, 'Same year, unknown season', null, 2026)],
    [23, record(23, 'Also fine', 'FALL', 2026)],
  ])
  const rows = returningSoon(entries, edges, records, { now: JUNE_2026 })
  assert.deepEqual(rows[0].upcoming.map((item) => item.id), [23], 'only fully-dated future seasons survive')
})
test('upcoming lists and rows are sorted by soonness, then title', () => {
  const entries = [entry(1, 'completed'), entry(2, 'watching'), entry(3, 'paused')]
  const edges = new Map([
    [1, [edge('SEQUEL', 40), edge('SEQUEL', 41), edge('SEQUEL', 42)]],
    [2, [edge('SEQUEL', 43)]],
    [3, [edge('SEQUEL', 44)]],
  ])
  const records = new Map([
    [40, record(40, 'Zeta late', 'WINTER', 2027)],
    [41, record(41, 'Alpha soon', 'SUMMER', 2026)],
    [42, record(42, 'Beta soon', 'SUMMER', 2026)],
    [43, record(43, 'Fall show', 'FALL', 2026)],
    [44, record(44, 'Zeta twin', 'WINTER', 2027)],
  ])
  const rows = returningSoon(entries, edges, records, { now: JUNE_2026 })
  assert.deepEqual(rows[0].upcoming.map((item) => item.id), [41, 42, 40], 'SUMMER first (Alpha < Beta), then WINTER')
  assert.deepEqual(rows.map((row) => row.mediaId), [1, 2, 3], 'soonest installment first: SUMMER row (20262), then FALL (20263), then WINTER (20270)')
})
test('malformed edges and records never break the scan', () => {
  const entries = [entry(1, 'completed'), entry(1, 'watching'), { mediaId: 2, status: 'completed' }, entry(-3, 'completed')]
  const edges = new Map([[1, [null, { relationType: 'SEQUEL' }, edge('SEQUEL', 1), edge('SEQUEL', -5), edge('SEQUEL', 'x'), edge('SEQUEL', 50)]]])
  const records = new Map([[50, record(50, 'Real', 'WINTER', 2027)], [60, record(60, 'Ghost', 'WINTER', 2027)]])
  const rows = returningSoon(entries, edges, records, { now: JUNE_2026 })
  assert.equal(rows.length, 1, 'the duplicate entry and the media-less entry collapse/drop')
  assert.deepEqual(rows[0].upcoming.map((item) => item.id), [50], 'self-edges, bad ids and missing records are ignored')
  assert.equal(returningSoon([], null, null, { now: JUNE_2026 }).length, 0, 'sparse inputs are safe')
})

// ── New episodes available (AV-137) ────────────────────────────────────
import { newEpisodesAvailable } from '../server/smartLists.mjs'

const progress = (mediaId, episode, season = 's1') => ({ mediaId, season, episode, positionSeconds: 10, updatedAt: JUNE_2026 })
const aired = (id, airedEpisodes) => ({ id, airedEpisodes })

test('a started show with aired episodes past its marker is listed (AV-137)', () => {
  const rows = newEpisodesAvailable([entry(1, 'watching')], [progress(1, 8)], new Map([[1, aired(1, 12)]]))
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    mediaId: 1,
    media: { id: 1, title: 'Show 1', cover: null },
    status: 'watching',
    addedAt: NOW - 30 * DAY,
    airedEpisodes: 12,
    watchedThrough: 8,
    newCount: 4,
  })
})
test('watching and paused qualify; planned, completed, dropped and unknown do not', () => {
  const entries = [entry(1, 'watching'), entry(2, 'paused'), entry(3, 'planned'), entry(4, 'completed'), entry(5, 'dropped'), entry(6, 'weird')]
  const records = new Map([1, 2, 3, 4, 5, 6].map((id) => [id, aired(id, 10)]))
  const rows = newEpisodesAvailable(entries, [1, 2, 3, 4, 5, 6].map((id) => progress(id, 1)), records)
  assert.deepEqual(rows.map((row) => row.mediaId), [1, 2], 'only started-but-unfinished statuses')
})
test('entries without recorded progress are excluded as uncertain', () => {
  const rows = newEpisodesAvailable([entry(1, 'watching')], [], new Map([[1, aired(1, 12)]]))
  assert.equal(rows.length, 0, 'pre-AV-151 viewing is unrecorded — how far along is unknown')
})
test('caught up (or ahead of airing) means no new episodes', () => {
  const records = new Map([[1, aired(1, 12)], [2, aired(2, 12)]])
  assert.equal(newEpisodesAvailable([entry(1, 'watching')], [progress(1, 12)], records).length, 0, 'aired == marker')
  assert.equal(newEpisodesAvailable([entry(2, 'watching')], [progress(2, 15)], records).length, 0, 'marker past airing')
  assert.equal(newEpisodesAvailable([entry(1, 'watching')], [progress(1, 11)], records).length, 1, 'one behind counts')
})
test('the marker is the max episode across all seasons and episodes', () => {
  const rows = newEpisodesAvailable([entry(1, 'watching')], [progress(1, 3, 's1'), progress(1, 9, 's2'), progress(1, 5, 's1')], new Map([[1, aired(1, 12)]]))
  assert.equal(rows[0].watchedThrough, 9, 'the highest marker wins regardless of season key')
  assert.equal(rows[0].newCount, 3)
})
test('airedEpisodes must be a valid positive integer', () => {
  for (const bad of [null, undefined, 0, -3, 2.5, 'x']) {
    const rows = newEpisodesAvailable([entry(1, 'watching')], [progress(1, 1)], new Map([[1, aired(1, bad)]]))
    assert.equal(rows.length, 0, `airedEpisodes=${String(bad)} never lists`)
  }
})
test('malformed progress rows are ignored; rows are deduped and sorted', () => {
  const entries = [entry(1, 'watching'), entry(1, 'paused'), entry(2, 'watching'), entry(3, 'watching'), { mediaId: 4, status: 'watching' }, entry(-5, 'watching')]
  const progressRows = [
    null,
    { mediaId: 'x', episode: 4 },
    { mediaId: 1, episode: 0 },
    { mediaId: 1, episode: 'q' },
    progress(1, 2),
    progress(1, 7),
    progress(2, 1),
    progress(3, 1),
  ]
  const records = new Map([[1, aired(1, 10)], [2, aired(2, 10)], [3, aired(3, 8)]])
  const rows = newEpisodesAvailable(entries, progressRows, records)
  assert.deepEqual(rows.map((row) => [row.mediaId, row.newCount]), [[2, 9], [3, 7], [1, 3]], 'sorted by most new first (2 with 9, then 3 with 7, then 1 with 3)')
  assert.equal(newEpisodesAvailable([], null, null).length, 0, 'sparse inputs are safe')
})

// ── Continue watching (AV-158) ─────────────────────────────────────────
import { continueWatching } from '../server/smartLists.mjs'

const prog = (mediaId, episode, positionSeconds, state, updatedAt, over = {}) => ({
  mediaId, season: 'winter-2024', episode, positionSeconds, runtimeSeconds: 1440, state, updatedAt, ...over,
})

test('only in-progress episodes qualify (AV-158)', () => {
  const rows = continueWatching([
    prog(1, 3, 300, 'started', 100),
    prog(2, 3, 300, 'completed', 100),
    prog(3, 3, 300, 'manual', 100),
    prog(4, 3, 0, 'started', 100),
    prog(5, 3, -5, 'started', 100),
  ])
  assert.deepEqual(rows.map((row) => row.mediaId), [1], 'started with a real position only')
})
test('one row per media: the most recently touched in-progress episode wins', () => {
  const rows = continueWatching([
    prog(1, 1, 500, 'started', 30),
    prog(1, 2, 700, 'started', 90),
    prog(1, 3, 100, 'completed', 200), // finished e3 later — the in-progress e2 still continues
    prog(2, 1, 100, 'started', 50),
  ])
  assert.equal(rows.length, 2)
  const first = rows.find((row) => row.mediaId === 1)
  assert.equal(first.episode, 2, 'the newest STARTED episode, not the newest record overall')
  assert.equal(first.positionSeconds, 700)
  assert.deepEqual(rows.map((row) => row.mediaId), [1, 2], 'most recently touched show first')
})
test('runtime survives only when valid; malformed rows are ignored', () => {
  const rows = continueWatching([
    prog(1, 1, 10, 'started', 5, { runtimeSeconds: null }),
    prog(2, 1, 10, 'started', 4, { runtimeSeconds: 0 }),
    prog(3, 1, 10, 'started', 3, { runtimeSeconds: 1440 }),
    prog(4, 1, 10, 'started', 2, { season: 7 }),
    null,
    prog(0, 1, 10, 'started', 1),
    prog(6, 'x', 10, 'started', 1),
  ])
  assert.deepEqual(rows.map((row) => [row.mediaId, row.runtimeSeconds]), [[1, null], [2, null], [3, 1440], [4, 1440]], 'invalid runtimes become null, valid ones survive')
  assert.equal(rows.find((row) => row.mediaId === 4).season, 'unknown', 'a non-string season key falls back to unknown')
})
test('the list caps and orders deterministically', () => {
  const records = Array.from({ length: 25 }, (_, index) => prog(index + 1, 1, 10, 'started', index))
  assert.equal(continueWatching(records).length, 20, 'default cap')
  assert.equal(continueWatching(records, { limit: 5 }).length, 5)
  assert.equal(continueWatching(records, { limit: 999 }).length, 25, 'no hard growth past the cap of 50 is not enforced on this side — the route caps')
  const tie = continueWatching([prog(9, 1, 10, 'started', 5), prog(8, 1, 10, 'started', 5)])
  assert.deepEqual(tie.map((row) => row.mediaId), [8, 9], 'ties break by mediaId')
  assert.equal(continueWatching(null).length, 0, 'sparse input is safe')
})
