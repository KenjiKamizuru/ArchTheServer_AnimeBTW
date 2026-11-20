// AV-016: duplicate anime record detection and safe merge planning.
//
// The identifier registry binds its storage file at import time from
// ANIMEVAULT_DATA, so the temp data dir is set *before* any server module is
// imported (dynamic imports after env assignment, mirroring
// tests/identifiers.test.mjs).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-duplicates-'))
process.env.ANIMEVAULT_DATA = dir

const dd = await import('../server/duplicateDetection.mjs')
const { createAnimeRecord } = await import('../server/catalog.mjs')
const registry = await import('../server/identifiers.mjs')
await registry.init()
after(async () => {
  await registry.flush()
  await rm(dir, { recursive: true, force: true })
})

const {
  normalizeTitle,
  titleTokens,
  titleSimilarity,
  bestTitleSimilarity,
  findDuplicates,
  mergeRecords,
  mergeIdentifiers,
} = dd

// ── Title normalization ───────────────────────────────────────────────

test('normalizeTitle folds case, whitespace, and punctuation', () => {
  assert.equal(normalizeTitle('  Cowboy Bebop  '), 'cowboy bebop')
  assert.equal(normalizeTitle('Shingeki no Kyojin!'), 'shingeki no kyojin')
  assert.equal(normalizeTitle('Ojamajo Doremi #'), 'ojamajo doremi')
  assert.equal(normalizeTitle(null), '')
  assert.equal(normalizeTitle(undefined), '')
  assert.equal(normalizeTitle(42), '')
})

test('titleTokens deduplicates and orders tokens', () => {
  assert.deepEqual(titleTokens('Cowboy Bebop Cowboy'), ['cowboy', 'bebop'])
  assert.deepEqual(titleTokens('   '), [])
  assert.deepEqual(titleTokens(''), [])
})

test('titleSimilarity is bounded and symmetric', () => {
  assert.equal(titleSimilarity('Cowboy Bebop', 'Cowboy Bebop'), 1)
  assert.equal(titleSimilarity('Cowboy Bebop', 'Bebop Cowboy'), 1)
  assert.equal(titleSimilarity('Cowboy Bebop', 'Samurai Champloo'), 0)
  assert.equal(titleSimilarity('Cowboy Bebop', ''), 0)
  assert.equal(titleSimilarity('A', 'A'), 1)
  assert.equal(titleSimilarity('Cowboy Bebop', 'cowboy bebop'), 1)
  assert.equal(titleSimilarity('Cowboy Bebop', 'Cowboy Bebop: The Movie'), 0.5)
})

test('bestTitleSimilarity compares all title variants', () => {
  const a = createAnimeRecord({ id: 1, title: 'Cowboy Bebop', english: "Cowboy's Bebop" })
  const b = createAnimeRecord({ id: 2, title: 'Cowboy Bebop', romaji: 'Kauboi Bibopu' })
  assert.equal(bestTitleSimilarity(a, b), 1)
  const c = createAnimeRecord({ id: 3, title: 'Unrelated Show' })
  assert.equal(bestTitleSimilarity(a, c), 0)
})

// ── Merge records ─────────────────────────────────────────────────────

test('mergeRecords keeps primary canonical values and does not mutate inputs', () => {
  const primary = createAnimeRecord({
    id: 1,
    title: 'Primary Title',
    description: 'Primary description',
    episodes: 12,
    status: 'RELEASING',
  })
  const duplicate = createAnimeRecord({
    id: 2,
    title: 'Duplicate Title',
    description: '',
    episodes: null,
    status: 'UNKNOWN',
  })
  const beforePrimary = JSON.parse(JSON.stringify(primary))
  const beforeDuplicate = JSON.parse(JSON.stringify(duplicate))

  const { merged, repoint } = mergeRecords(primary, duplicate)

  assert.equal(merged.id, 1)
  assert.equal(merged.title, 'Primary Title')
  assert.equal(merged.description, 'Primary description')
  assert.equal(merged.episodes, 12)
  assert.equal(merged.status, 'RELEASING')
  assert.deepEqual(repoint, { 2: 1 })
  assert.deepEqual(primary, beforePrimary)
  assert.deepEqual(duplicate, beforeDuplicate)
})

test('mergeRecords fills empty primary fields from the duplicate', () => {
  const primary = createAnimeRecord({
    id: 1,
    title: '',
    description: null,
    episodes: null,
    duration: null,
  })
  const duplicate = createAnimeRecord({
    id: 2,
    title: 'Duplicate Title',
    description: 'Duplicate description',
    episodes: 24,
    duration: 24,
  })

  const { merged } = mergeRecords(primary, duplicate)

  assert.equal(merged.title, 'Duplicate Title')
  assert.equal(merged.description, 'Duplicate description')
  assert.equal(merged.episodes, 24)
  assert.equal(merged.duration, 24)
})

test('mergeRecords treats title fallback and UNKNOWN as empty', () => {
  const primary = createAnimeRecord({
    id: 1,
    title: 'Anime #1',
    description: 'UNKNOWN',
  })
  const duplicate = createAnimeRecord({
    id: 2,
    title: 'Real Title',
    description: 'Real description',
  })

  const { merged } = mergeRecords(primary, duplicate)
  assert.equal(merged.title, 'Real Title')
  assert.equal(merged.description, 'Real description')
})

test('mergeRecords keeps primary provenance and merges observations', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const primary = createAnimeRecord({
    id: 1,
    title: 'Primary',
    fieldMetadata: {
      title: {
        source: 'anilist',
        observations: [
          { source: 'mal', value: 'Alt', lastRefreshedAt: refreshed },
        ],
      },
    },
  })
  const duplicate = createAnimeRecord({
    id: 2,
    title: 'Duplicate',
    fieldMetadata: {
      title: {
        source: 'anidb',
        observations: [
          { source: 'mal', value: 'Alt', lastRefreshedAt: refreshed },
          { source: 'kitsu', value: 'Kitsu title', lastRefreshedAt: refreshed },
        ],
      },
    },
  })

  const { merged } = mergeRecords(primary, duplicate)
  assert.equal(merged.fieldMetadata.title.source, 'anilist') // primary provenance wins
  const obs = merged.fieldMetadata.title.observations
  const sources = obs.map((o) => o.source).sort()
  assert.deepEqual(sources, ['kitsu', 'mal']) // observation sources, deduped
  assert.equal(obs.filter((o) => o.source === 'mal' && o.value === 'Alt').length, 1)
})

// ── findDuplicates ────────────────────────────────────────────────────

test('findDuplicates returns nothing for a unique record', async () => {
  const target = createAnimeRecord({ id: 10, title: 'Unique Show' })
  const candidates = [
    createAnimeRecord({ id: 11, title: 'Completely Different' }),
    createAnimeRecord({ id: 12, title: 'Other Thing' }),
  ]
  const duplicates = await findDuplicates(target, candidates, { findId: async () => null })
  assert.deepEqual(duplicates, [])
})

test('findDuplicates matches by title similarity above threshold', async () => {
  const target = createAnimeRecord({ id: 20, title: 'Cowboy Bebop' })
  const candidates = [
    createAnimeRecord({ id: 21, title: 'Cowboy Bebop' }),
    createAnimeRecord({ id: 22, title: 'Samurai Champloo' }),
  ]
  const duplicates = await findDuplicates(target, candidates, { findId: async () => null })
  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].id, 21)
  assert.equal(duplicates[0].reason, 'title')
})

test('findDuplicates excludes below-threshold matches and the target itself', async () => {
  const target = createAnimeRecord({ id: 30, title: 'Cowboy Bebop' })
  const candidates = [
    createAnimeRecord({ id: 30, title: 'Cowboy Bebop' }),
    createAnimeRecord({ id: 31, title: 'Cowboy Bop' }),
  ]
  const duplicates = await findDuplicates(target, candidates, { findId: async () => null })
  assert.deepEqual(duplicates, [])
})

test('findDuplicates rejects an invalid target id', async () => {
  await assert.rejects(findDuplicates({ id: 0, title: 'X' }, []), { message: 'Invalid target media id' })
})

test('findDuplicates matches shared external identifiers via the registry', async () => {
  // mal id 999 is registered to media 40 only (the registry enforces uniqueness).
  await registry.set(40, 'anilist', '40')
  await registry.set(40, 'mal', '999')

  // Incoming record 41 carries mal 999: that id is already claimed by 40.
  const target = { id: 41, title: 'Show A' }
  const candidates = [createAnimeRecord({ id: 40, title: 'Completely Different Show' })]
  const duplicates = await findDuplicates(target, candidates, {
    externalIds: { mal: '999' },
  })
  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].id, 40)
  assert.equal(duplicates[0].reason, 'external-identifier')
})

test('findDuplicates combines identifier and title matches without duplication', async () => {
  await registry.set(50, 'anilist', '50')
  await registry.set(50, 'mal', '777')

  const target = { id: 51, title: 'Cowboy Bebop' }
  const candidates = [createAnimeRecord({ id: 50, title: 'Cowboy Bebop' })]
  const duplicates = await findDuplicates(target, candidates, {
    externalIds: { mal: '777' },
  })
  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].id, 50)
  assert.equal(duplicates[0].reason, 'external-identifier')
})

// ── mergeIdentifiers ──────────────────────────────────────────────────

test('mergeIdentifiers merges duplicate ids into primary and removes duplicate', async () => {
  await registry.set(60, 'anilist', '60')
  await registry.set(60, 'mal', '600')
  await registry.set(61, 'anilist', '61')
  await registry.set(61, 'imdb', 'tt0234144')

  await mergeIdentifiers(60, 61)
  assert.deepEqual(await registry.get(60), {
    anilist: '61',
    mal: '600',
    imdb: 'tt0234144',
  })
  assert.equal(await registry.get(61), null)
})

test('mergeIdentifiers is a no-op for an unknown duplicate', async () => {
  await assert.doesNotReject(mergeIdentifiers(90, 999999))
  assert.equal(await registry.get(90), null)
})

// ── Persistence across restart ────────────────────────────────────────

test('merged identifiers survive a restart', async () => {
  await registry.set(80, 'anilist', '80')
  await registry.set(80, 'mal', '800')
  await registry.set(81, 'anilist', '81')
  await registry.set(81, 'imdb', 'tt0111111')
  await mergeIdentifiers(80, 81)
  await registry.flush()

  // Use a child process so ANIMEVAULT_DATA applies at module load time.
  const { spawnSync } = await import('node:child_process')
  const moduleUrl = new URL('../server/identifiers.mjs', import.meta.url).href
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import * as m from ${JSON.stringify(moduleUrl)}; await m.init(); console.log(JSON.stringify(await m.get(80)))`],
    { env: { ...process.env, ANIMEVAULT_DATA: dir }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim()), { anilist: '81', mal: '800', imdb: 'tt0111111' })
})
