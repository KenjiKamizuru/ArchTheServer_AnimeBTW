// Round-trip tests for installation settings (AV-140 field + store wiring).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-settings-'))
process.env.ANIMEVAULT_DATA = dir
const settings = await import('../server/settings.mjs')
await settings.init()
after(async () => { await rm(dir, { recursive: true, force: true }) })

test('capacity warnings default to on (AV-140)', () => {
  assert.equal(settings.get().hideListCapacityWarnings, false)
})
test('capacity warnings can be disabled and persist (AV-140)', async () => {
  await settings.save({ hideListCapacityWarnings: true })
  assert.equal(settings.get().hideListCapacityWarnings, true)
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().hideListCapacityWarnings))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout), true, 'setting survives a restart')
})
test('unknown settings keys are ignored', async () => {
  await settings.save({ bogus: 1 })
  assert.equal('bogus' in settings.get(), false)
})
test('multi-user and detail-layout settings are exposed and survive restart (AV-139 fix)', async () => {
  assert.equal(settings.get().registrationOpen, false, 'registration defaults closed')
  assert.equal(settings.get().emailAccounts, false)
  await settings.save({ registrationOpen: true, emailAccounts: true, detailSectionOrder: ['episodes', 'overview'] })
  assert.equal(settings.get().registrationOpen, true)
  assert.equal(settings.get().emailAccounts, true)
  assert.deepEqual(settings.get().detailSectionOrder, ['episodes', 'overview'])
  // Previously: save() persisted these fields but init() dropped them and
  // get() never surfaced them — registration silently re-closed on restart.
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get()))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const after = JSON.parse(run.stdout)
  assert.equal(after.registrationOpen, true, 'registration survives a restart')
  assert.equal(after.emailAccounts, true)
  assert.deepEqual(after.detailSectionOrder, ['episodes', 'overview'])
})
test('list summary exposes capacity limits (AV-140)', async () => {
  const listStore = await import('../server/listStore.mjs')
  await listStore.init()
  const { limits } = listStore.summary()
  assert.equal(limits.maxItems, 2000)
  assert.equal(limits.maxLists, 50)
})
test('the episode completion threshold is configurable and survives restart (AV-155)', async () => {
  assert.equal(settings.get().episodeCompletionThresholdPercent, 90, 'defaults to 90% of runtime')
  await settings.save({ episodeCompletionThresholdPercent: 75 })
  assert.equal(settings.get().episodeCompletionThresholdPercent, 75)
  await settings.save({ episodeCompletionThresholdPercent: -5 })
  assert.equal(settings.get().episodeCompletionThresholdPercent, 50, 'clamped to the 50–100 bound')
  await settings.save({ episodeCompletionThresholdPercent: 130 })
  assert.equal(settings.get().episodeCompletionThresholdPercent, 100, 'clamped at the top')
  await settings.save({ episodeCompletionThresholdPercent: 80 })
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().episodeCompletionThresholdPercent))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout), 80, 'the threshold survives a restart')
})
test('the playback save interval is configurable and survives restart (AV-153)', async () => {
  assert.equal(settings.get().progressSaveIntervalSeconds, 15, 'defaults to 15 seconds')
  await settings.save({ progressSaveIntervalSeconds: 30 })
  assert.equal(settings.get().progressSaveIntervalSeconds, 30)
  await settings.save({ progressSaveIntervalSeconds: 1 })
  assert.equal(settings.get().progressSaveIntervalSeconds, 5, 'clamped to the 5–300 bound')
  await settings.save({ progressSaveIntervalSeconds: 9999 })
  assert.equal(settings.get().progressSaveIntervalSeconds, 300, 'clamped at the top')
  await settings.save({ progressSaveIntervalSeconds: 60 })
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().progressSaveIntervalSeconds))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout), 60, 'the interval survives a restart')
})
test('the auto-next-episode toggle is configurable and survives restart (AV-160)', async () => {
  assert.equal(settings.get().autoplayNextEpisode, true, 'defaults on — industry norm, cancellable countdown')
  await settings.save({ autoplayNextEpisode: false })
  assert.equal(settings.get().autoplayNextEpisode, false)
  await settings.save({ autoplayNextEpisode: true })
  assert.equal(settings.get().autoplayNextEpisode, true)
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().autoplayNextEpisode))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout), true, 'the toggle survives a restart')
})

test('private-history mode is configurable and survives restart (AV-165)', async () => {
  assert.equal(settings.get().privateHistoryMode, false, 'defaults off')
  await settings.save({ privateHistoryMode: true })
  assert.equal(settings.get().privateHistoryMode, true)
  await settings.save({ privateHistoryMode: false })
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().privateHistoryMode))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout), false, 'the toggle survives a restart')
})

test('player shortcuts persist and conflicts are rejected (AV-179)', async () => {
  assert.deepEqual(settings.get().playerShortcuts, {}, 'empty map = built-in defaults')
  await settings.save({ playerShortcuts: { mute: 'x', 'next-episode': 'P' } })
  assert.deepEqual(settings.get().playerShortcuts, { mute: 'x', 'next-episode': 'p' }, 'keys normalized on save')
  await assert.rejects(
    () => settings.save({ playerShortcuts: { mute: 'q', 'seek-back': 'Space', 'play-pause': ' ' } }),
    /Shortcut conflict/,
    'two actions on one key are rejected at the boundary',
  )
  assert.deepEqual(settings.get().playerShortcuts, { mute: 'x', 'next-episode': 'p' }, 'a rejected save changes nothing')
  await settings.save({ playerShortcuts: {} })
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().playerShortcuts))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), {}, 'shortcuts survive a restart')
})

test('skip intervals are configurable within bounds (AV-183/184)', async () => {
  assert.equal(settings.get().skipForwardSeconds, 10)
  assert.equal(settings.get().skipBackwardSeconds, 10)
  await settings.save({ skipForwardSeconds: 30, skipBackwardSeconds: 15 })
  assert.equal(settings.get().skipForwardSeconds, 30)
  assert.equal(settings.get().skipBackwardSeconds, 15)
  // out-of-range values clamp to the 5–600 window, never store nonsense
  await settings.save({ skipForwardSeconds: 2 })
  assert.equal(settings.get().skipForwardSeconds, 5)
  await settings.save({ skipBackwardSeconds: 5000 })
  assert.equal(settings.get().skipBackwardSeconds, 600)
  await settings.save({ skipForwardSeconds: 10, skipBackwardSeconds: 10 })
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify([s.get().skipForwardSeconds, s.get().skipBackwardSeconds]))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), [10, 10], 'intervals survive a restart')
})

test('playback speed is remembered within range (AV-188)', async () => {
  assert.equal(settings.get().playbackSpeed, 1)
  await settings.save({ playbackSpeed: 1.5 })
  assert.equal(settings.get().playbackSpeed, 1.5)
  // out-of-range values clamp to 0.25–4 at the boundary
  await settings.save({ playbackSpeed: 9 })
  assert.equal(settings.get().playbackSpeed, 4)
  await settings.save({ playbackSpeed: 0 })
  assert.equal(settings.get().playbackSpeed, 0.25)
  await settings.save({ playbackSpeed: 1.25 })
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().playbackSpeed))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout), 1.25, 'the speed survives a restart')
})

test('volume level is remembered within range (AV-193)', async () => {
  assert.equal(settings.get().volume, 1)
  await settings.save({ volume: 0.35 })
  assert.equal(settings.get().volume, 0.35)
  // out-of-range values clamp to 0–1 at the boundary
  await settings.save({ volume: 5 })
  assert.equal(settings.get().volume, 1)
  await settings.save({ volume: -2 })
  assert.equal(settings.get().volume, 0)
  await settings.save({ volume: 0.8 })
  const script = `import * as s from ${JSON.stringify(new URL('../server/settings.mjs', import.meta.url).href)}; await s.init(); console.log(JSON.stringify(s.get().volume))`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout), 0.8, 'the volume survives a restart')
})
