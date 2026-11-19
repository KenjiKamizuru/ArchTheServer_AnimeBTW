import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickListEntry } from '../server/listRandom.mjs'
const entries = Array.from({ length: 20 }, (_, i) => ({ mediaId: i + 1 }))
test('empty list returns null', () => assert.equal(pickListEntry([]), null))
test('non-array returns null', () => assert.equal(pickListEntry(null), null))
test('empty list does not call random selector', () => assert.equal(pickListEntry([], () => { throw Error('called') }), null))
for (let i = 0; i < entries.length; i++) test(`selects list entry ${i + 1}`, () => assert.equal(pickListEntry(entries, (length) => { assert.equal(length, 20); return i }), entries[i]))
test('single entry works', () => assert.equal(pickListEntry([entries[0]]), entries[0]))
test('negative selector rejected', () => assert.throws(() => pickListEntry(entries, () => -1), RangeError))
test('out of bounds selector rejected', () => assert.throws(() => pickListEntry(entries, () => 20), RangeError))
test('fractional selector rejected', () => assert.throws(() => pickListEntry(entries, () => 0.5), RangeError))
test('real selector stays within list', () => { for (let i = 0; i < 100; i++) assert.ok(entries.includes(pickListEntry(entries))) })
