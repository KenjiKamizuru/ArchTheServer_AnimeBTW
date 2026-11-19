// Tests for bulk removal + undo restore (AV-135).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-list-undo-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/listStore.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const media = (id) => ({ id, title: `Title ${id}`, cover: 'https://example.com/cover.jpg' })
const list = await store.createList({ name: 'Undoable' })
let snapshots

test('setup: entries with per-list context and order', async () => {
  await store.add(list.id, media(1))
  await store.add(list.id, media(2))
  await store.add(list.id, media(3))
  await store.setNote(list.id, 1, 'keep me')
  await store.setRating(list.id, 1, { priority: 3, rating: 9 })
  await store.setOrder(list.id, [3, 1, 2])
})
test('bulk remove returns exact undo snapshots', async () => {
  const result = await store.removeEntries(list.id, [3, 1])
  assert.equal(result.removed, 2)
  snapshots = result.records
  assert.equal(snapshots.length, 2)
  const first = snapshots.find((r) => r.media.id === 3)
  assert.deepEqual(
    { status: first.status, addedAt: first.addedAt, note: first.note, priority: first.priority, rating: first.rating, orderIndex: first.orderIndex },
    { status: 'planned', addedAt: first.addedAt, note: '', priority: null, rating: null, orderIndex: 0 },
    'snapshot captures status, timestamps, context, and order position',
  )
  const second = snapshots.find((r) => r.media.id === 1)
  assert.equal(second.note, 'keep me')
  assert.equal(second.priority, 3)
  assert.equal(second.rating, 9)
  assert.equal(second.orderIndex, 1)
  assert.equal(store.readList(list.id).count, 1)
})
test('custom removal keeps the status membership (remove() semantics)', () => {
  // add() gives new entries the default status 'planned', so removing the
  // custom membership keeps the entry alive under its status list.
  assert.equal(store.readList(list.id).count, 1)
  assert.equal(store.summary().totalEntries, 3, 'entries survive with their status intact')
})
test('restore reinserts exactly (content, context, order)', async () => {
  const result = await store.restoreEntries(list.id, snapshots)
  assert.deepEqual(result, { restored: 2 })
  assert.deepEqual(store.readList(list.id).order, [3, 1, 2], 'order positions restored')
  const restored = store.readList(list.id).entries.find((e) => e.mediaId === 1)
  assert.equal(restored.note, 'keep me')
  assert.equal(restored.priority, 3)
  assert.equal(restored.rating, 9)
  assert.equal(restored.status, 'planned')
  assert.equal(store.readList(list.id).count, 3)
})
test('restore is idempotent (double undo)', async () => {
  const result = await store.restoreEntries(list.id, snapshots)
  assert.deepEqual(result, { restored: 0 })
  assert.equal(store.readList(list.id).count, 3)
  assert.deepEqual(store.readList(list.id).order, [3, 1, 2], 'order not duplicated')
})
test('undo survives a full delete of the entry', async () => {
  await store.add(list.id, media(7))
  await store.remove('status:planned', 7) // strip the default status first
  const { records } = await store.removeEntries(list.id, [7])
  assert.equal(store.summary().totalEntries, 3, 'entry 7 fully deleted (no status, no memberships)')
  await store.restoreEntries(list.id, records)
  const back = store.readList(list.id).entries.find((e) => e.mediaId === 7)
  assert.equal(back.media.title, 'Title 7')
  assert.equal(back.status, null, 'snapshot status (none) restored on recreation')
})
test('validation matrix', async () => {
  await assert.rejects(store.removeEntries(list.id, []), { status: 400 })
  await assert.rejects(store.removeEntries(list.id, [1, 1]), { status: 400 })
  await assert.rejects(store.removeEntries(list.id, [55]), { status: 400 }, 'non-members rejected')
  await assert.rejects(store.removeEntries('status:watching', [1]), { status: 400 }, 'status removal of non-members rejected')
  await assert.rejects(store.restoreEntries(list.id, []), { status: 400 })
  await assert.rejects(store.restoreEntries(list.id, [{ media: { id: -1 }, status: null, addedAt: 1 }]), { status: 400 }, 'bad media')
  await assert.rejects(store.restoreEntries(list.id, [{ media: media(8), status: 'bogus', addedAt: 1 }]), { status: 400 }, 'bad status')
  await assert.rejects(store.restoreEntries(list.id, [{ media: media(8), status: null, addedAt: Number.NaN }]), { status: 400 }, 'bad addedAt')
  await assert.rejects(store.restoreEntries(list.id, [{ media: media(8), status: null, addedAt: 1, note: 'x'.repeat(1001) }]), { status: 400 }, 'long note')
  await assert.rejects(store.restoreEntries(list.id, [{ media: media(8), status: null, addedAt: 1, priority: 6 }]), { status: 400 }, 'bad priority')
  await assert.rejects(store.restoreEntries(list.id, [{ media: media(8), status: null, addedAt: 1, rating: 0 }]), { status: 400 }, 'bad rating')
  await assert.rejects(store.restoreEntries('status:watching', [{ media: media(8), status: 'planned', addedAt: 1 }]), { status: 400 }, 'status snapshots must match the target list')
  assert.equal(store.readList(list.id).count, 4, 'failed restores change nothing')
})
test('status-list bulk remove + restore round-trip', async () => {
  await store.add('status:watching', media(9))
  const { records, removed } = await store.removeEntries('status:watching', [9])
  assert.equal(removed, 1)
  assert.equal(store.readList('status:watching').count, 0)
  const result = await store.restoreEntries('status:watching', records)
  assert.equal(result.restored, 1)
  assert.equal(store.readList('status:watching').count, 1)
  assert.equal(store.readList('status:watching').entries[0].status, 'watching')
})
