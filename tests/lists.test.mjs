import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-lists-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/listStore.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const media = (id, title = `Title ${id}`) => ({ id, title, cover: 'https://example.com/cover.jpg', genres: ['Drama'] })
let custom

test('five built-in status lists: Watching/Planned/Completed/Paused/Dropped (AV-126)', () => {
  const { statuses } = store.summary()
  assert.deepEqual(statuses.map((s) => s.id), ['status:watching', 'status:planned', 'status:completed', 'status:paused', 'status:dropped'])
  assert.deepEqual(statuses.map((s) => s.name), ['Watching', 'Planned', 'Completed', 'Paused', 'Dropped'])
  assert.ok(statuses.every((s) => s.count === 0))
})
test('lists start empty', () => assert.equal(store.summary().totalEntries, 0))
test('unknown status rejected', () => assert.throws(() => store.readList('status:bad'), { status: 404 }))
test('missing custom list rejected', () => assert.throws(() => store.readList('nope'), { status: 404 }))
test('blank list name rejected', async () => assert.rejects(store.createList({ name: '  ' }), { status: 400 }))
test('long name rejected', async () => assert.rejects(store.createList({ name: 'x'.repeat(81) }), { status: 400 }))
test('long description rejected', async () => assert.rejects(store.createList({ name: 'ok', description: 'x'.repeat(501) }), { status: 400 }))
test('create custom list', async () => { custom = await store.createList({ name: ' Favorites ', description: ' Picks ' }); assert.match(custom.id, /^l_[a-f0-9]{24}$/); assert.equal(custom.name, 'Favorites'); assert.equal(custom.description, 'Picks') })
test('custom list starts empty', () => assert.equal(store.readList(custom.id).count, 0))
test('add to watching', async () => { const e = await store.add('status:watching', media(1)); assert.equal(e.status, 'watching') })
test('watching count updated', () => assert.equal(store.readList('status:watching').count, 1))
test('duplicate status add is idempotent', async () => { await store.add('status:watching', media(1)); assert.equal(store.readList('status:watching').count, 1) })
test('moving status does not duplicate', async () => { await store.add('status:completed', media(1)); assert.equal(store.readList('status:watching').count, 0); assert.equal(store.readList('status:completed').count, 1) })
test('custom membership independent of status', async () => { await store.add(custom.id, media(1)); assert.equal(store.readList(custom.id).count, 1); assert.equal(store.readList('status:completed').count, 1) })
test('duplicate custom add is idempotent', async () => { await store.add(custom.id, media(1)); assert.equal(store.readList(custom.id).count, 1) })
test('new custom member gets planned status', async () => { await store.add(custom.id, media(2)); assert.equal(store.readList('status:planned').count, 1) })
test('invalid media rejected', async () => assert.rejects(store.add(custom.id, { id: -1 }), { status: 400 }))
test('invalid list rejected before add', async () => assert.rejects(store.add('bad', media(3)), { status: 404 }))
test('malicious cover sanitized', async () => { const entry = await store.add('status:planned', { id: 3, title: 'x', cover: 'javascript:alert(1)' }); assert.equal(entry.media.cover, null) })
test('remove missing entry is harmless', async () => assert.deepEqual(await store.remove(custom.id, 999), { removed: false }))
test('invalid removal id rejected', async () => assert.rejects(store.remove(custom.id, 'x'), { status: 400 }))
test('removing nonmember leaves status intact', async () => { assert.equal((await store.remove(custom.id, 3)).removed, false); assert.equal(store.readList('status:planned').count, 2) })
test('removing custom membership retains status', async () => { await store.remove(custom.id, 2); assert.equal(store.readList('status:planned').count, 2) })
test('removing status retains custom membership', async () => { await store.remove('status:completed', 1); assert.equal(store.readList(custom.id).entries[0].status, null) })
test('removing last membership deletes entry', async () => { await store.remove(custom.id, 1); assert.equal(store.summary().totalEntries, 2) })
test('built-in list cannot be deleted', async () => assert.rejects(store.deleteList('status:planned'), { status: 400 }))
test('migration preserves ids and skips existing', async () => { const result = await store.migrateBookmarks([{ media: media(2), addedAt: 42 }, { media: media(4), addedAt: 123 }, { media: { id: -1 } }]); assert.deepEqual(result, { migrated: 1, skipped: 2 }); assert.equal(store.readList('status:planned').entries.find((e) => e.mediaId === 4).addedAt, 123) })
test('migration can be repeated without duplicates', async () => { assert.equal((await store.migrateBookmarks([{ media: media(4) }])).migrated, 0) })
test('persisted JSON contains migrated id', async () => { await store.flush(); const data = JSON.parse(await readFile(path.join(dir, 'lists.json'), 'utf8')); assert.ok(data.entries.some((entry) => entry.mediaId === 4)) })
test('restart reads stored memberships', () => { const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.summary()))`; const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).totalEntries, 3) })
test('delete custom list leaves status entries', async () => { await store.add(custom.id, media(2)); await store.deleteList(custom.id); assert.equal(store.readList('status:planned').count, 3); assert.equal(store.summary().lists.length, 0) })
test('corrupt file fails closed on restart', async () => { await writeFile(path.join(dir, 'lists.json'), '{bad'); const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init()`; const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' }); assert.notEqual(run.status, 0); assert.equal(await readFile(path.join(dir, 'lists.json'), 'utf8'), '{bad') })
