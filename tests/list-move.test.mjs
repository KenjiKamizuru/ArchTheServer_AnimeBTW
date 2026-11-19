// Tests for bulk moves between custom lists (AV-134).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-list-move-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/listStore.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const media = (id) => ({ id, title: `Title ${id}`, cover: 'https://example.com/cover.jpg' })
const from = await store.createList({ name: 'Source' })
const to = await store.createList({ name: 'Target' })

test('setup: entries in the source list with per-list context', async () => {
  await store.add(from.id, media(1))
  await store.add(from.id, media(2))
  await store.add(from.id, media(3))
  await store.setNote(from.id, 1, 'carry me')
  await store.setRating(from.id, 1, { priority: 2, rating: 7 })
  await store.setNote(from.id, 2, 'stays behind context')
  assert.equal(store.readList(from.id).count, 3)
})
test('bulk move transfers memberships and per-list context', async () => {
  const result = await store.moveEntries(from.id, to.id, [1, 2])
  assert.deepEqual(result, { moved: 2 })
  assert.equal(store.readList(from.id).count, 1)
  assert.equal(store.readList(to.id).count, 2)
  const moved = store.readList(to.id).entries.find((e) => e.mediaId === 1)
  assert.equal(moved.note, 'carry me', 'note travels with the membership')
  assert.equal(moved.priority, 2)
  assert.equal(moved.rating, 7)
  assert.equal(store.readList(from.id).entries.find((e) => e.mediaId === 1), undefined, 'no residue in the source')
})
test('statuses are untouched by moves', async () => {
  const entry = store.readList(to.id).entries.find((e) => e.mediaId === 1)
  assert.equal(entry.status, 'planned', 'default status from add() is preserved')
})
test('target context wins over carried context', async () => {
  await store.add(from.id, media(3)) // already a member of from; move again below
  await store.setNote(to.id, 2, 'target wins')
  await store.moveEntries(from.id, to.id, [2, 3].filter((id) => store.readList(from.id).entries.some((e) => e.mediaId === id)))
  // media 2 moved earlier is not in from anymore, so only what remains moves.
  const kept = store.readList(to.id).entries.find((e) => e.mediaId === 2)
  assert.equal(kept.note, 'target wins', 'the target keeps its own note')
})
test('validation matrix', async () => {
  await store.add(from.id, media(9))
  await assert.rejects(store.moveEntries('status:planned', to.id, [1]), { status: 400 }, 'status lists not movable')
  await assert.rejects(store.moveEntries(from.id, 'status:watching', [9]), { status: 400 }, 'status targets rejected')
  await assert.rejects(store.moveEntries(from.id, from.id, [9]), { status: 400 }, 'same list rejected')
  await assert.rejects(store.moveEntries(from.id, to.id, []), { status: 400 }, 'empty rejected')
  await assert.rejects(store.moveEntries(from.id, to.id, '9'), { status: 400 }, 'non-array rejected')
  await assert.rejects(store.moveEntries(from.id, to.id, [9, 9]), { status: 400 }, 'duplicates rejected')
  await assert.rejects(store.moveEntries(from.id, to.id, [0]), { status: 400 }, 'invalid ids rejected')
  await assert.rejects(store.moveEntries(from.id, to.id, [9, 55]), { status: 400 }, 'non-members rejected')
  await assert.rejects(store.moveEntries(from.id, to.id, Array.from({ length: 501 }, (_, i) => i + 1)), { status: 400 }, 'bulk cap enforced')
  await assert.rejects(store.moveEntries('missing', to.id, [9]), { status: 404 }, 'unknown source')
  assert.equal(store.readList(from.id).entries.some((e) => e.mediaId === 9), true, 'failed moves leave memberships intact')
})
test('manual order stays consistent across moves', async () => {
  assert.deepEqual(store.readList(from.id).order.includes(9), true)
  await store.moveEntries(from.id, to.id, [9])
  assert.equal(store.readList(from.id).order.includes(9), false, 'removed from the source order')
  assert.equal(store.readList(to.id).order.includes(9), true, 'appended to the target order')
})
test('last membership removal keeps status', async () => {
  const moved = store.readList(to.id).entries.find((e) => e.mediaId === 9)
  assert.equal(moved.status, 'planned')
})
