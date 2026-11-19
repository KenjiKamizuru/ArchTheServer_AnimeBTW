import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
const dir = await mkdtemp(path.join(os.tmpdir(), 'list-ratings-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/listStore.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const a = await store.createList({ name: 'a' }); const b = await store.createList({ name: 'b' }); const media = { id: 1, title: 'A' }
await store.add(a.id, media); await store.add(b.id, media)
const get = (id) => store.readList(id).entries[0]
test('priority defaults null', () => assert.equal(get(a.id).priority, null))
test('rating defaults null', () => assert.equal(get(a.id).rating, null))
test('save priority', async () => assert.equal((await store.setRating(a.id, 1, { priority: 3 })).priority, 3))
test('save rating', async () => assert.equal((await store.setRating(a.id, 1, { rating: 8 })).rating, 8))
test('partial update preserves priority', () => assert.equal(get(a.id).priority, 3))
test('partial update preserves rating', async () => { await store.setRating(a.id, 1, { priority: 4 }); assert.equal(get(a.id).rating, 8) })
test('other list rating isolated', () => assert.equal(get(b.id).rating, null))
test('other list priority isolated', () => assert.equal(get(b.id).priority, null))
test('status list isolated', () => assert.equal(get('status:planned').rating, null))
test('rating minimum allowed', async () => assert.equal((await store.setRating(a.id, 1, { rating: 1 })).rating, 1))
test('rating maximum allowed', async () => assert.equal((await store.setRating(a.id, 1, { rating: 10 })).rating, 10))
test('priority minimum allowed', async () => assert.equal((await store.setRating(a.id, 1, { priority: 1 })).priority, 1))
test('priority maximum allowed', async () => assert.equal((await store.setRating(a.id, 1, { priority: 5 })).priority, 5))
test('reject zero rating', async () => assert.rejects(store.setRating(a.id, 1, { rating: 0 }), { status: 400 }))
test('reject high rating', async () => assert.rejects(store.setRating(a.id, 1, { rating: 11 }), { status: 400 }))
test('reject high priority', async () => assert.rejects(store.setRating(a.id, 1, { priority: 6 }), { status: 400 }))
test('reject fractional values', async () => assert.rejects(store.setRating(a.id, 1, { rating: 2.5 }), { status: 400 }))
test('reject string values', async () => assert.rejects(store.setRating(a.id, 1, { priority: '3' }), { status: 400 }))
test('reject unknown field', async () => assert.rejects(store.setRating(a.id, 1, { fake: 3 }), { status: 400 }))
test('reject empty patch', async () => assert.rejects(store.setRating(a.id, 1, {}), { status: 400 }))
test('reject missing entry', async () => assert.rejects(store.setRating(a.id, 9, { rating: 5 }), { status: 404 }))
test('reject invalid id', async () => assert.rejects(store.setRating(a.id, 'abc', { rating: 5 }), { status: 400 }))
test('reject nonmember', async () => assert.rejects(store.setRating('status:watching', 1, { rating: 5 }), { status: 404 }))
test('clearing rating retains priority', async () => { await store.setRating(a.id, 1, { rating: null }); assert.equal(get(a.id).rating, null); assert.equal(get(a.id).priority, 5) })
test('both fields update together', async () => { await store.setRating(a.id, 1, { rating: 9, priority: 2 }); assert.equal(get(a.id).rating, 9); assert.equal(get(a.id).priority, 2) })
test('internal ratings not exposed', () => assert.equal(get(a.id).ratings, undefined))
test('ratings persisted', () => { const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.readList(${JSON.stringify(a.id)}).entries[0]))`; const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).rating, 9) })
test('removing membership clears ratings', async () => { await store.remove(a.id, 1); await store.add(a.id, media); assert.equal(get(a.id).rating, null) })
test('deleting list removes its ratings', async () => { await store.setRating(b.id, 1, { rating: 8 }); await store.deleteList(b.id); const data = JSON.parse(await readFile(path.join(dir, 'lists.json'), 'utf8')); assert.ok(!data.entries[0].ratings.some((r) => r.listId === b.id)) })
test('status change clears old status rating', async () => { await store.setRating('status:planned', 1, { rating: 6 }); await store.add('status:watching', media); assert.equal(get('status:watching').rating, null); await store.add('status:planned', media); assert.equal(get('status:planned').rating, null) })
