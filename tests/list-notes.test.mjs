import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(path.join(os.tmpdir(), 'list-notes-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/listStore.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const list = await store.createList({ name: 'Notes' })
const other = await store.createList({ name: 'Other' })
const media = { id: 1, title: 'Test' }
await store.add(list.id, media)
await store.add(other.id, media)
const note = (id) => store.readList(id).entries[0]?.note

test('entry note initially blank', () => assert.equal(note(list.id), ''))
test('write note', async () => assert.deepEqual(await store.setNote(list.id, 1, 'hello'), { mediaId: 1, note: 'hello' }))
test('read note', () => assert.equal(note(list.id), 'hello'))
test('note isolated from other list', () => assert.equal(note(other.id), ''))
test('note isolated from status', () => assert.equal(note('status:planned'), ''))
test('other list has independent note', async () => { await store.setNote(other.id, 1, 'other'); assert.equal(note(other.id), 'other'); assert.equal(note(list.id), 'hello') })
test('status can have its own note', async () => { await store.setNote('status:planned', 1, 'planned'); assert.equal(note('status:planned'), 'planned') })
test('replacing note works', async () => { await store.setNote(list.id, 1, 'updated'); assert.equal(note(list.id), 'updated') })
test('accepts exactly 1000 characters', async () => { await store.setNote(list.id, 1, 'x'.repeat(1000)); assert.equal(note(list.id).length, 1000) })
test('rejects 1001 characters', async () => assert.rejects(store.setNote(list.id, 1, 'x'.repeat(1001)), { status: 400 }))
test('rejects null', async () => assert.rejects(store.setNote(list.id, 1, null), { status: 400 }))
test('rejects numeric note', async () => assert.rejects(store.setNote(list.id, 1, 1), { status: 400 }))
test('rejects invalid media id', async () => assert.rejects(store.setNote(list.id, 'bad', 'x'), { status: 400 }))
test('rejects unknown list', async () => assert.rejects(store.setNote('not-a-list', 1, 'x'), { status: 404 }))
test('rejects unknown entry', async () => assert.rejects(store.setNote(list.id, 999, 'x'), { status: 404 }))
test('rejects entry absent from status', async () => assert.rejects(store.setNote('status:watching', 1, 'x'), { status: 404 }))
test('clear note with blank string', async () => { await store.setNote(list.id, 1, ''); assert.equal(note(list.id), '') })
test('whitespace-only clears note', async () => { await store.setNote(list.id, 1, '   '); assert.equal(note(list.id), '') })
test('preserves meaningful whitespace', async () => { await store.setNote(list.id, 1, ' hello\n'); assert.equal(note(list.id), ' hello\n') })
test('raw notes are not exposed by read list', () => assert.equal(store.readList(list.id).entries[0].notes, undefined))
test('persisted note exists on disk', async () => { await store.flush(); assert.ok((await readFile(path.join(dir, 'lists.json'), 'utf8')).includes('hello')) })
test('note survives restart', () => { const script = `import * as s from ${JSON.stringify(new URL('../server/listStore.mjs', import.meta.url).href)}; await s.init(); console.log(s.readList(${JSON.stringify(list.id)}).entries[0].note)`; const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout, ' hello\n\n') })
test('changing status removes old status note', async () => { await store.add('status:watching', media); assert.equal(note('status:watching'), ''); assert.equal(note(list.id), ' hello\n') })
test('removing custom membership clears its note', async () => { await store.remove(list.id, 1); await store.add(list.id, media); assert.equal(note(list.id), ''); assert.equal(note(other.id), 'other') })
test('deleting custom list clears its notes', async () => { await store.deleteList(other.id); const raw = JSON.parse(await readFile(path.join(dir, 'lists.json'), 'utf8')); assert.ok(!raw.entries[0].notes.some((n) => n.listId === other.id)) })
