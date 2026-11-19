// Tests for list cover artwork (AV-129) + the importList order fix.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-list-cover-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/listStore.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const media = (id) => ({ id, title: `Title ${id}`, cover: 'https://example.com/cover.jpg' })
const list = await store.createList({ name: 'Covered' })

test('new lists start with an empty cover', () => assert.deepEqual(store.readList(list.id).cover, []))
test('set cover from member titles', async () => {
  await store.add(list.id, media(1))
  await store.add(list.id, media(2))
  await store.add(list.id, media(3))
  const view = await store.setCover(list.id, [3, 1])
  assert.deepEqual(view.cover, [3, 1], 'selection order preserved (mosaic layout)')
})
test('clearing the cover', async () => {
  assert.deepEqual((await store.setCover(list.id, [])).cover, [])
})
test('validation matrix', async () => {
  await assert.rejects(store.setCover('status:planned', [1]), { status: 400 }, 'status lists rejected')
  await assert.rejects(store.setCover(list.id, '1'), { status: 400 }, 'non-array rejected')
  await assert.rejects(store.setCover(list.id, [1, 2, 3, 4, 5]), { status: 400 }, 'at most 4 titles')
  await assert.rejects(store.setCover(list.id, [1, 1]), { status: 400 }, 'duplicates rejected')
  await assert.rejects(store.setCover(list.id, [0]), { status: 400 }, 'invalid ids rejected')
  await assert.rejects(store.setCover(list.id, [55]), { status: 400 }, 'non-members rejected')
  await assert.rejects(store.setCover('missing', [1]), { status: 404 })
  assert.deepEqual(store.readList(list.id).cover, [], 'failed sets change nothing')
})
test('cover survives restart', async () => {
  await store.setCover(list.id, [1, 2])
  await store.flush()
  const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.readList(${JSON.stringify(list.id)}).cover))`
  const run = await import('node:child_process').then((m) => m.spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' }))
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), [1, 2])
})
test('summary exposes covers for list cards', () => {
  const entry = store.summary().lists.find((item) => item.id === list.id)
  assert.deepEqual(entry.cover, [1, 2])
})
test('imported lists accept later adds (order fix)', async () => {
  // Regression pin: importList once created lists WITHOUT an order array and
  // bypassed add(); a later add() crashed on record.order.includes.
  const result = await store.importList({
    format: 'animevault-list',
    version: 1,
    list: { name: 'Imported', description: '', entries: [{ mediaId: 4, media: media(4), status: 'planned', addedAt: 5, note: '', priority: null, rating: null }] },
  })
  await store.add(result.list.id, media(6))
  assert.deepEqual(store.readList(result.list.id).order, [4, 6], 'import order seeded, adds append')
})
