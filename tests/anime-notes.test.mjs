// Tests for per-anime private notes (server/notes.mjs, AV-099).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNotePayload, noteView } from '../server/notes.mjs'
import { buildDetailResponse } from '../server/detail.mjs'

test('buildNotePayload follows the note storage contract', () => {
  assert.deepEqual(buildNotePayload('  hello  ', { now: 5 }), { note: '  hello  ', updatedAt: 5 }, 'stored verbatim; trimming only gates emptiness')
  assert.equal(buildNotePayload('   '), null, 'blank notes delete the entry')
  assert.equal(buildNotePayload(null), null)
  assert.equal(buildNotePayload('x'.repeat(5000), { now: 1 }).note.length, 4000, 'capped at 4000')
})

test('noteView shapes the owner-only response', () => {
  assert.deepEqual(noteView(7, { note: 'n', updatedAt: 9 }), { mediaId: 7, note: 'n', updatedAt: 9 })
  assert.deepEqual(noteView(7, null), { mediaId: 7, note: '', updatedAt: null })
  assert.deepEqual(noteView(7, { note: 42 }), { mediaId: 7, note: '', updatedAt: null }, 'malformed stored values never leak through')
})

test('shared payloads never carry private notes', () => {
  const res = buildDetailResponse({ title: 'T', description: 'd' })
  assert.ok(!('note' in res) && !('notes' in res), 'the detail payload is note-free')
})
