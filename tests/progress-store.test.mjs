// Tests for watch-progress persistence (AV-151a): per-profile isolation and
// per anime/season/episode keys.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-progress-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/progressStore.mjs')
await store.init()
after(async () => { await store.flush(); await rm(dir, { recursive: true, force: true }) })
const rec = (mediaId, season, episode, positionSeconds) => ({ mediaId, season, episode, positionSeconds })

test('save returns the stored record', async () => {
  const saved = await store.saveProgress('u_kenji', rec(10, 's1', 3, 120.5), { now: 1000 })
  assert.deepEqual(saved, { profileId: 'u_kenji', mediaId: 10, season: 's1', episode: 3, positionSeconds: 120.5, updatedAt: 1000 })
})
test('upsert updates position in place', async () => {
  await store.saveProgress('u_kenji', rec(10, 's1', 3, 200), { now: 2000 })
  const entries = store.listProgress('u_kenji')
  assert.equal(entries.length, 1, 'same key does not duplicate')
  assert.equal(entries[0].positionSeconds, 200)
  assert.equal(entries[0].updatedAt, 2000)
})
test('profiles are fully isolated (AV-151)', async () => {
  await store.saveProgress('u_aki', rec(10, 's1', 3, 50), { now: 3000 })
  assert.equal(store.listProgress('u_aki').length, 1)
  assert.equal(store.listProgress('u_kenji').length, 1, 'other profile untouched')
  assert.equal(store.getProgress('u_kenji', 10, 's1', 3).positionSeconds, 200, 'records are per-profile copies')
  assert.equal(store.getProgress('u_aki', 10, 's1', 3).positionSeconds, 50)
})
test('guest profile keys are distinct from the owner (AV-151)', async () => {
  await store.saveProgress('u_kenji:g:abc123', rec(10, 's1', 3, 7), { now: 4000 })
  assert.equal(store.listProgress('u_kenji:g:abc123').length, 1)
  assert.equal(store.listProgress('u_kenji').length, 1, 'guest progress never lands in the owner profile')
})
test('anime, season, and episode keys are independent (AV-152 groundwork)', async () => {
  await store.saveProgress('u_kenji', rec(11, 's1', 3, 1), { now: 5000 })
  await store.saveProgress('u_kenji', rec(10, 's2', 3, 2), { now: 5001 })
  await store.saveProgress('u_kenji', rec(10, 's1', 4, 3), { now: 5002 })
  assert.equal(store.getProgress('u_kenji', 11, 's1', 3).positionSeconds, 1)
  assert.equal(store.getProgress('u_kenji', 10, 's2', 3).positionSeconds, 2)
  assert.equal(store.getProgress('u_kenji', 10, 's1', 4).positionSeconds, 3)
  assert.equal(store.getProgress('u_kenji', 10, 's1', 3).positionSeconds, 200, 'original untouched')
})
test('list sorts by most recently updated', () => {
  assert.deepEqual(store.listProgress('u_kenji').map((e) => e.updatedAt), [5002, 5001, 5000, 2000])
})
test('validation rejects malformed records', async () => {
  await assert.rejects(store.saveProgress('u_x', rec(0, 's1', 1, 0)), { status: 400 }, 'mediaId must be positive')
  await assert.rejects(store.saveProgress('u_x', rec(1, 's1', 0, 0)), { status: 400 }, 'episode must be positive')
  await assert.rejects(store.saveProgress('u_x', rec(1, 's1', 1.5, 0)), { status: 400 }, 'episode must be an integer')
  await assert.rejects(store.saveProgress('u_x', rec(1, '', 1, 0)), { status: 400 }, 'season key required')
  await assert.rejects(store.saveProgress('u_x', rec(1, 'x'.repeat(41), 1, 0)), { status: 400 }, 'season key bounded')
  await assert.rejects(store.saveProgress('u_x', rec(1, 's1', 1, -1)), { status: 400 }, 'position non-negative')
  await assert.rejects(store.saveProgress('u_x', rec(1, 's1', 1, Number.NaN)), { status: 400 }, 'position finite')
  await assert.rejects(store.saveProgress('bad id!', rec(1, 's1', 1, 0)), { status: 400 }, 'profile id pattern')
  assert.equal(store.listProgress('u_x').length, 0, 'rejected saves never persist')
})
test('clear is scoped by record, anime, or profile', async () => {
  assert.deepEqual(await store.clearProgress('u_kenji', { mediaId: 11, season: 's1', episode: 3 }), { removed: 1 })
  assert.equal(store.getProgress('u_kenji', 11, 's1', 3), null)
  const perAnime = await store.clearProgress('u_kenji', { mediaId: 10 })
  assert.equal(perAnime.removed, 3, 'all s1/s2/episode rows for that anime')
  assert.equal(store.listProgress('u_kenji').length, 0)
  assert.equal(store.listProgress('u_aki').length, 1, 'clearing one profile never touches another')
  assert.deepEqual(await store.clearProgress('u_aki'), { removed: 1 })
  assert.deepEqual(await store.clearProgress('nobody'), { removed: 0 })
})
test('progress survives restart', async () => {
  await store.saveProgress('u_restart', rec(42, 'winter-2024', 7, 333), { now: 9000 })
  await store.flush()
  const script = `import * as s from ${JSON.stringify(new URL('../server/progressStore.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.getProgress('u_restart', 42, 'winter-2024', 7)))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout).positionSeconds, 333)
})
test('missing file starts empty', async () => {
  const freshDir = await mkdtemp(path.join(os.tmpdir(), 'animevault-progress-empty-'))
  const script = `import * as s from ${JSON.stringify(new URL('../server/progressStore.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.listProgress('u_any')))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: freshDir }, encoding: 'utf8' })
  await rm(freshDir, { recursive: true, force: true })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), [])
})
test('corrupt file fails closed', async () => {
  const badDir = await mkdtemp(path.join(os.tmpdir(), 'animevault-progress-bad-'))
  await writeFile(path.join(badDir, 'progress.json'), '{bad')
  const script = `import * as s from ${JSON.stringify(new URL('../server/progressStore.mjs', import.meta.url).href)}; await s.init()`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: badDir }, encoding: 'utf8' })
  await rm(badDir, { recursive: true, force: true })
  assert.notEqual(run.status, 0)
})
