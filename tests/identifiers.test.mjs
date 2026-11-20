// AV-002: dedicated, persistent provider-identifier collection.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-identifiers-'))
process.env.ANIMEVAULT_DATA = dir
const registry = await import('../server/identifiers.mjs')
await registry.init()
after(async () => {
  await registry.flush()
  await rm(dir, { recursive: true, force: true })
})

const moduleUrl = new URL('../server/identifiers.mjs', import.meta.url).href
function run(script, dataDir = dir) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, ANIMEVAULT_DATA: dataDir },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test('registry starts empty', () => {
  assert.deepEqual(registry.snapshot().byMedia, {})
})

test('set normalizes numeric and IMDb identifiers', async () => {
  assert.deepEqual(await registry.set(123, 'anilist', '123'), { anilist: '123' })
  assert.deepEqual(await registry.set(123, 'MAL', 456), { anilist: '123', mal: '456' })
  assert.deepEqual(await registry.set(123, 'imdb', 'TT0234144'), {
    anilist: '123', mal: '456', imdb: 'tt0234144',
  })
})

test('merge ignores blank values and keeps existing identifiers', async () => {
  const merged = await registry.merge(123, { anidb: 789, mal: null, imdb: '' })
  assert.deepEqual(merged, { anilist: '123', mal: '456', imdb: 'tt0234144', anidb: '789' })
})

test('get returns a copy that cannot mutate the registry', async () => {
  const ids = await registry.get(123)
  ids.anilist = 'tampered'
  assert.equal((await registry.get(123)).anilist, '123')
  assert.equal(await registry.get(999), null)
})

test('reverse lookup is provider-scoped and case-insensitive for IMDb', async () => {
  assert.equal(await registry.find('mal', 456), 123)
  assert.equal(await registry.find('imdb', 'tt0234144'), 123)
  assert.equal(await registry.find('imdb', 'TT0234144'), 123)
  assert.equal(await registry.find('anidb', '999'), null)
})

test('one external id cannot be attached to two different titles', async () => {
  await assert.rejects(registry.set(124, 'anilist', 123), { status: 409 })
  await assert.rejects(registry.merge(124, { imdb: 'tt0234144' }), { status: 409 })
  assert.equal(await registry.get(124), null)
})

test('malformed media ids, providers and values are rejected', async () => {
  await assert.rejects(registry.get(0), { status: 400 })
  await assert.rejects(registry.get('1.5'), { status: 400 })
  await assert.rejects(registry.get(Number.MAX_SAFE_INTEGER + 1), { status: 400 })
  await assert.rejects(registry.set(125, '__proto__', '1'), { status: 400 })
  await assert.rejects(registry.set(125, 'anidb', -1), { status: 400 })
  await assert.rejects(registry.set(125, 'imdb', 'not-an-id'), { status: 400 })
  await assert.rejects(registry.merge(125, null), { status: 400 })
  await assert.rejects(registry.merge(125, { unknown: 'x' }), { status: 400 })
})

test('remember ignores invalid provider data without throwing', () => {
  assert.equal(registry.remember(null), null)
  assert.equal(registry.remember({ id: 126, externalIds: { imdb: 'bad' } }), null)
  assert.deepEqual(registry.remember({ id: 126, externalIds: { anidb: '55' } }), { anidb: '55' })
})

test('remove clears one provider or the whole record', async () => {
  assert.deepEqual(await registry.remove(126, 'anidb'), {})
  assert.equal(await registry.get(126), null)
  await registry.set(127, 'mal', '10')
  await registry.set(127, 'anidb', '11')
  assert.deepEqual(await registry.remove(127, 'mal'), { anidb: '11' })
  assert.deepEqual(await registry.remove(127), {})
})

test('identifiers survive a restart', async () => {
  await registry.flush()
  const output = run(`import * as m from ${JSON.stringify(moduleUrl)}; await m.init(); console.log(JSON.stringify(await m.get(123)))`)
  assert.deepEqual(JSON.parse(output), { anilist: '123', mal: '456', imdb: 'tt0234144', anidb: '789' })
})

test('corrupt registry is quarantined instead of overwriting user data', async () => {
  const badDir = await mkdtemp(path.join(os.tmpdir(), 'animevault-ident-corrupt-'))
  try {
    await writeFile(path.join(badDir, 'external-identifiers.json'), '{not json')
    const output = run(`import * as m from ${JSON.stringify(moduleUrl)}; await m.init(); console.log(JSON.stringify(m.snapshot()))`, badDir)
    const snapshot = JSON.parse(output)
    assert.deepEqual(snapshot.byMedia, {})
    assert.ok(snapshot.lastError)
    assert.ok((await readdir(badDir)).some((name) => name.includes('.corrupt-')))
  } finally {
    await rm(badDir, { recursive: true, force: true })
  }
})
