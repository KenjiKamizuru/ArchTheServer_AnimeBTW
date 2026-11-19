import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortListEntries, LIST_SORTS } from '../server/listSort.mjs'
const entries = [
  { mediaId: 3, addedAt: 300, media: { title: 'Zebra', score: null, seasonYear: 2000 } },
  { mediaId: 2, addedAt: 100, media: { title: 'alpha 10', score: 80, seasonYear: null } },
  { mediaId: 1, addedAt: 200, media: { title: 'Alpha 2', score: 90, seasonYear: 2024 } },
]
const ids = (sort) => sortListEntries(entries, sort).map((entry) => entry.mediaId)
test('sorts supported', () => assert.equal(LIST_SORTS.length, 5))
test('default newest first', () => assert.deepEqual(ids(undefined), [3, 1, 2]))
test('explicit newest', () => assert.deepEqual(ids('added'), [3, 1, 2]))
test('oldest first', () => assert.deepEqual(ids('oldest'), [2, 1, 3]))
test('title case insensitive and natural', () => assert.deepEqual(ids('title'), [1, 2, 3]))
test('score descending', () => assert.deepEqual(ids('score'), [1, 2, 3]))
test('year descending with missing last', () => assert.deepEqual(ids('year'), [1, 3, 2]))
test('input order unchanged', () => assert.deepEqual(entries.map((e) => e.mediaId), [3, 2, 1]))
test('returns new array', () => assert.notEqual(sortListEntries(entries), entries))
test('empty list', () => assert.deepEqual(sortListEntries([], 'score'), []))
test('single item', () => assert.equal(sortListEntries(entries.slice(0, 1), 'title')[0], entries[0]))
test('unknown sort rejected', () => assert.throws(() => sortListEntries(entries, 'wrong'), { status: 400 }))
test('score zero is not missing', () => assert.deepEqual(sortListEntries([{ mediaId: 1, media: { score: null } }, { mediaId: 2, media: { score: 0 } }], 'score').map(e => e.mediaId), [2, 1]))
test('year zero is not missing', () => assert.deepEqual(sortListEntries([{ mediaId: 1, media: {} }, { mediaId: 2, media: { seasonYear: 0 } }], 'year').map(e => e.mediaId), [2, 1]))
test('missing scores tie by id', () => assert.deepEqual(sortListEntries([{ mediaId: 3, media: {} }, { mediaId: 1, media: {} }], 'score').map(e => e.mediaId), [1, 3]))
test('matching scores tie by id', () => assert.deepEqual(sortListEntries([{ mediaId: 3, media: { score: 80 } }, { mediaId: 1, media: { score: 80 } }], 'score').map(e => e.mediaId), [1, 3]))
test('matching years tie by id', () => assert.deepEqual(sortListEntries([{ mediaId: 3, media: { seasonYear: 2024 } }, { mediaId: 1, media: { seasonYear: 2024 } }], 'year').map(e => e.mediaId), [1, 3]))
test('matching titles tie by id', () => assert.deepEqual(sortListEntries([{ mediaId: 3, media: { title: 'abc' } }, { mediaId: 1, media: { title: 'ABC' } }], 'title').map(e => e.mediaId), [1, 3]))
test('matching dates tie by id newest', () => assert.deepEqual(sortListEntries([{ mediaId: 3, addedAt: 1 }, { mediaId: 1, addedAt: 1 }], 'added').map(e => e.mediaId), [1, 3]))
test('matching dates tie by id oldest', () => assert.deepEqual(sortListEntries([{ mediaId: 3, addedAt: 1 }, { mediaId: 1, addedAt: 1 }], 'oldest').map(e => e.mediaId), [1, 3]))
test('non-finite score is missing', () => assert.deepEqual(sortListEntries([{ mediaId: 1, media: { score: NaN } }, { mediaId: 2, media: { score: 2 } }], 'score').map(e => e.mediaId), [2, 1]))
test('sort never changes entries', () => { const before = JSON.stringify(entries); for (const sort of LIST_SORTS) sortListEntries(entries, sort); assert.equal(JSON.stringify(entries), before) })
