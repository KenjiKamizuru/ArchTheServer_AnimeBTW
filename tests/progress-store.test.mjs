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
  assert.deepEqual(saved, { profileId: 'u_kenji', mediaId: 10, season: 's1', episode: 3, positionSeconds: 120.5, runtimeSeconds: null, state: 'started', updatedAt: 1000 })
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

// ── Episode state (AV-154): started / completed / manually marked ───────
test('new records default to state started and views expose it (AV-154)', async () => {
  const saved = await store.saveProgress('u_state', rec(60, 's1', 1, 10), { now: 1 })
  assert.equal(saved.state, 'started')
  assert.equal(store.getProgress('u_state', 60, 's1', 1).state, 'started')
  assert.equal(store.listProgress('u_state')[0].state, 'started')
})
test('completed and manual states are stored', async () => {
  assert.equal((await store.saveProgress('u_state', { ...rec(61, 's1', 1, 1400), state: 'completed' }, { now: 2 })).state, 'completed')
  assert.equal((await store.saveProgress('u_state', { ...rec(62, 's1', 1, 0), state: 'manual' }, { now: 3 })).state, 'manual')
})
test('invalid states are rejected and never stored', async () => {
  for (const bad of ['finished', '', 'STARTED', 'watching', null, 3, 'manual ']) {
    await assert.rejects(store.saveProgress('u_state', { ...rec(63, 's1', 1, 5), state: bad }, { now: 4 }), (err) => err.status === 400, `state=${JSON.stringify(bad)} rejected`)
  }
  assert.equal(store.getProgress('u_state', 63, 's1', 1), null, 'nothing was stored')
})
test('positional upserts preserve state; explicit state replaces it', async () => {
  await store.saveProgress('u_state', { ...rec(64, 's1', 2, 100), state: 'completed' }, { now: 5 })
  await store.saveProgress('u_state', rec(64, 's1', 2, 250), { now: 6 })
  assert.equal(store.getProgress('u_state', 64, 's1', 2).state, 'completed', 'a position update never downgrades a completed mark')
  assert.equal(store.getProgress('u_state', 64, 's1', 2).positionSeconds, 250)
  await store.saveProgress('u_state', { ...rec(64, 's1', 2, 260), state: 'started' }, { now: 7 })
  assert.equal(store.getProgress('u_state', 64, 's1', 2).state, 'started', 'an explicit state replaces')
})
test('episode states are independent per key and per profile', async () => {
  await store.saveProgress('u_state', { ...rec(65, 's1', 1, 0), state: 'manual' }, { now: 8 })
  await store.saveProgress('u_state', rec(65, 's1', 2, 0), { now: 9 })
  await store.saveProgress('u_other', { ...rec(65, 's1', 1, 0), state: 'completed' }, { now: 10 })
  assert.equal(store.getProgress('u_state', 65, 's1', 1).state, 'manual')
  assert.equal(store.getProgress('u_state', 65, 's1', 2).state, 'started', 'other keys default independently')
  assert.equal(store.getProgress('u_other', 65, 's1', 1).state, 'completed', 'profiles never share state')
})
test('state survives restart; legacy records without state load as started', async () => {
  await store.saveProgress('u_state', { ...rec(66, 's1', 1, 5), state: 'manual' }, { now: 11 })
  await store.flush()
  const script = `import * as s from ${JSON.stringify(new URL('../server/progressStore.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify({ mine: s.getProgress('u_state', 66, 's1', 1), legacy: s.getProgress('u_legacy', 70, 's1', 1) }))`
  // A pre-AV-154 file: records with no `state` field must load as 'started'.
  await writeFile(path.join(dir, 'progress.json'), JSON.stringify({
    version: 1,
    entries: [
      { profileId: 'u_state', mediaId: 66, season: 's1', episode: 1, positionSeconds: 5, state: 'manual', updatedAt: 11 },
      { profileId: 'u_legacy', mediaId: 70, season: 's1', episode: 1, positionSeconds: 42, updatedAt: 99 },
    ],
  }))
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const parsed = JSON.parse(run.stdout)
  assert.equal(parsed.mine.state, 'manual', 'state survives a restart')
  assert.equal(parsed.legacy.state, 'started', 'pre-AV-154 records default to started instead of failing closed')
})

// ── Completion threshold (AV-155): percent of KNOWN runtime ─────────────
test('deriveEpisodeState: unknown runtime never auto-completes (AV-155)', () => {
  assert.equal(store.deriveEpisodeState(9_000, null, undefined, 90), 'started', 'a long position without runtime is uncertain')
  assert.equal(store.deriveEpisodeState(9_000, 0, 'started', 90), 'started')
  assert.equal(store.deriveEpisodeState(9_000, 'x', 'started', 90), 'started')
})
test('deriveEpisodeState: crossing the threshold completes; below stays started', () => {
  assert.equal(store.deriveEpisodeState(899, 1000, 'started', 90), 'started', 'below 90%')
  assert.equal(store.deriveEpisodeState(900, 1000, 'started', 90), 'completed', 'exactly at the threshold completes')
  assert.equal(store.deriveEpisodeState(950, 1000, undefined, 90), 'completed')
  assert.equal(store.deriveEpisodeState(500, 1000, 'started', 50), 'completed', 'threshold is configurable')
})
test('deriveEpisodeState: completed and manual marks are never downgraded', () => {
  assert.equal(store.deriveEpisodeState(10, 1000, 'completed', 90), 'completed')
  assert.equal(store.deriveEpisodeState(10, 1000, 'manual', 90), 'manual')
})
test('deriveEpisodeState: an invalid threshold falls back to the default', () => {
  for (const bad of [undefined, null, 0, 49, 101, 'x', 2.5]) {
    assert.equal(store.deriveEpisodeState(899, 1000, 'started', bad), 'started', `${String(bad)} → default 90%`)
    assert.equal(store.deriveEpisodeState(901, 1000, 'started', bad), 'completed', `${String(bad)} → default 90%`)
  }
})
test('the completion threshold drives saves through the store option', async () => {
  await store.saveProgress('u_thr', { ...rec(80, 's1', 1, 950), runtimeSeconds: 1000 }, { now: 20, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 80, 's1', 1).state, 'completed', 'auto-completed at 90% of runtime')
  await store.saveProgress('u_thr', { ...rec(80, 's1', 2, 100), runtimeSeconds: 1000 }, { now: 21, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 80, 's1', 2).state, 'started', 'below threshold')
  await store.saveProgress('u_thr', rec(80, 's1', 2, 200), { now: 22, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 80, 's1', 2).state, 'started', 'the runtime is preserved and the threshold still applies')
  await store.saveProgress('u_thr', rec(80, 's1', 2, 1000), { now: 23, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 80, 's1', 2).state, 'completed', 'a later crossing completes')
  await store.saveProgress('u_thr', rec(80, 's1', 2, 10), { now: 24, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 80, 's1', 2).state, 'completed', 'never downgraded by a later position')
  await store.saveProgress('u_thr', { ...rec(81, 's1', 1, 5000), runtimeSeconds: 1000 }, { now: 25 })
  assert.equal(store.getProgress('u_thr', 81, 's1', 1).state, 'started', 'WITHOUT the option no derivation happens (AV-154 behavior)')
})
test('an explicit state beats the threshold; manual survives the auto path', async () => {
  await store.saveProgress('u_thr', { ...rec(82, 's1', 1, 50), runtimeSeconds: 1000, state: 'manual' }, { now: 26, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 82, 's1', 1).state, 'manual')
  await store.saveProgress('u_thr', rec(82, 's1', 1, 990), { now: 27, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 82, 's1', 1).state, 'manual', 'auto-derivation never clobbers a manual mark')
  await store.saveProgress('u_thr', { ...rec(82, 's1', 1, 500), state: 'started' }, { now: 28, completionThresholdPercent: 90 })
  assert.equal(store.getProgress('u_thr', 82, 's1', 1).state, 'started', 'an explicit state still wins')
})
test('runtimeSeconds validation and preservation', async () => {
  for (const bad of [0, -5, 2.5, 'x', 100_001]) {
    await assert.rejects(store.saveProgress('u_thr', { ...rec(83, 's1', 1, 5), runtimeSeconds: bad }, { now: 29 }), (err) => err.status === 400, `runtime=${String(bad)} rejected`)
  }
  await store.saveProgress('u_thr', { ...rec(84, 's1', 1, 5), runtimeSeconds: 1440 }, { now: 30 })
  assert.equal(store.getProgress('u_thr', 84, 's1', 1).runtimeSeconds, 1440)
  await store.saveProgress('u_thr', rec(84, 's1', 1, 20), { now: 31 })
  assert.equal(store.getProgress('u_thr', 84, 's1', 1).runtimeSeconds, 1440, 'an omitted runtime never wipes a known one')
  await store.saveProgress('u_thr', { ...rec(84, 's1', 1, 20), runtimeSeconds: 1500 }, { now: 32 })
  assert.equal(store.getProgress('u_thr', 84, 's1', 1).runtimeSeconds, 1500, 'a provided runtime updates it')
  assert.equal(store.getProgress('u_thr', 84, 's1', 1).state, 'started')
})
