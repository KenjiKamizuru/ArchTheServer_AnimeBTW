// Tests for manual ordering of custom lists (AV-128a): persisted per-list
// `order`, `setOrder` permutations, and the 'order' sort.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-list-order-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/listStore.mjs')
const { sortListEntries, LIST_SORTS } = await import('../server/listSort.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const media = (id) => ({ id, title: `Title ${id}`, cover: 'https://example.com/cover.jpg' })
const list = await store.createList({ name: 'Ordered' })
const sortedIds = (sort = 'order') => sortListEntries(store.readList(list.id).entries, sort, store.readList(list.id).order).map((e) => e.mediaId)

test('new custom list starts with an empty order', () => assert.deepEqual(store.readList(list.id).order, []))
test('adds append to the order in sequence', async () => {
  await store.add(list.id, media(1))
  await store.add(list.id, media(2))
  await store.add(list.id, media(3))
  assert.deepEqual(store.readList(list.id).order, [1, 2, 3])
})
test('LIST_SORTS accepts order', () => assert.ok(LIST_SORTS.includes('order')))
test('order sort follows the persisted order', async () => {
  await store.setOrder(list.id, [3, 1, 2])
  assert.deepEqual(sortedIds(), [3, 1, 2])
})
test('other sorts are unaffected by manual order', () => {
  assert.deepEqual(sortedIds('oldest').slice().sort(), [1, 2, 3], 'oldest still sorts by addedAt')
})
test('setOrder is idempotent for the same permutation', async () => {
  await store.setOrder(list.id, [3, 1, 2])
  assert.deepEqual(store.readList(list.id).order, [3, 1, 2])
})
test('setOrder rejects built-in status lists', () => assert.rejects(store.setOrder('status:planned', [1]), { status: 400 }))
test('setOrder rejects unknown lists', () => assert.rejects(store.setOrder('nope', [1]), { status: 404 }))
test('setOrder rejects non-arrays', () => assert.rejects(store.setOrder(list.id, '1,2,3'), { status: 400 }))
test('setOrder rejects invalid ids', () => assert.rejects(store.setOrder(list.id, [3, 1, 0]), { status: 400 }))
test('setOrder rejects a missing member', () => assert.rejects(store.setOrder(list.id, [3, 1]), { status: 400 }))
test('setOrder rejects an extra id', () => assert.rejects(store.setOrder(list.id, [3, 1, 2, 9]), { status: 400 }))
test('setOrder rejects duplicates', () => assert.rejects(store.setOrder(list.id, [3, 1, 1]), { status: 400 }))
test('failed setOrder leaves the order unchanged', () => assert.deepEqual(store.readList(list.id).order, [3, 1, 2]))
test('new adds after a reorder append at the end', async () => {
  await store.add(list.id, media(4))
  assert.deepEqual(store.readList(list.id).order, [3, 1, 2, 4])
  assert.deepEqual(sortedIds(), [3, 1, 2, 4])
})
test('removing a member drops it from the order', async () => {
  await store.remove(list.id, 1)
  assert.deepEqual(store.readList(list.id).order, [3, 2, 4])
  assert.deepEqual(sortedIds(), [3, 2, 4])
})
test('order sort without an order array falls back to added', () => {
  const entries = [{ mediaId: 1, addedAt: 100 }, { mediaId: 2, addedAt: 200 }]
  assert.deepEqual(sortListEntries(entries, 'order').map((e) => e.mediaId), [2, 1], 'added desc fallback')
})
test('unlisted entries sort after ordered ones', () => {
  const entries = [{ mediaId: 9, addedAt: 900 }, { mediaId: 2, addedAt: 200 }, { mediaId: 3, addedAt: 300 }]
  assert.deepEqual(sortListEntries(entries, 'order', [3, 2]).map((e) => e.mediaId), [3, 2, 9])
})
test('unknown sort still rejected', () => assert.throws(() => sortListEntries([], 'bogus'), { status: 400 }))
test('order survives restart', async () => {
  await store.flush()
  const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.readList(${JSON.stringify(list.id)}).order))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), [3, 2, 4])
})
test('legacy list files without order load and accept adds', async () => {
  // Files from before AV-128 have no `order` key: init backfills it to [].
  const legacyDir = await mkdtemp(path.join(os.tmpdir(), 'animevault-list-legacy-'))
  const id = 'l_0123456789abcdef01234567'
  await writeFile(path.join(legacyDir, 'lists.json'), JSON.stringify({
    version: 1,
    lists: [{ id, name: 'Legacy', description: '' }],
    entries: [],
  }))
  const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init(); await s.add(${JSON.stringify(id)}, { id: 7, title: 'T7', cover: null }); console.log(JSON.stringify(s.readList(${JSON.stringify(id)}).order))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: legacyDir }, encoding: 'utf8' })
  await rm(legacyDir, { recursive: true, force: true })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), [7], 'backfilled order grows from adds')
})
test('corrupt order fails closed', async () => {
  const badDir = await mkdtemp(path.join(os.tmpdir(), 'animevault-list-bad-'))
  const id = 'l_0123456789abcdef01234567'
  await writeFile(path.join(badDir, 'lists.json'), JSON.stringify({
    version: 1,
    lists: [{ id, name: 'Bad', description: '', order: [1, 1] }],
    entries: [],
  }))
  const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init()`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: badDir }, encoding: 'utf8' })
  await rm(badDir, { recursive: true, force: true })
  assert.notEqual(run.status, 0, 'duplicate order entries must fail closed')
})
