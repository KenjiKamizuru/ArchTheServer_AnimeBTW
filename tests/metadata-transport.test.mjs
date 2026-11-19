// Tests for the provider transport, registry, and AniList adapter (AV-117c1).
// Network is faked: the suite runs offline and pins caching, pacing, retries,
// and pure shape mapping.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransport } from '../server/metadata/transport.mjs'
import { registerProvider, getProvider, providersFor, clearProviders, PROVIDER_LIMITS } from '../server/metadata/registry.mjs'
import { toUnified, toRelationEdges, deriveFranchise, lookupEvidence } from '../server/metadata/providers/anilist.mjs'

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  }
}

test('transport caches responses and skips repeat fetches', async () => {
  let calls = 0
  const transport = createTransport({
    id: 'test',
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({ value: calls })
    },
    sleep: async () => {},
  })
  const first = await transport.request('https://x.test/a')
  const second = await transport.request('https://x.test/a')
  assert.equal(first.value, 1)
  assert.equal(second.value, 1, 'cached')
  assert.equal(calls, 1)
  await transport.request('https://x.test/a', { fresh: true })
  assert.equal(calls, 2, 'fresh bypasses cache')
})

test('transport retries 5xx, respects Retry-After on 429, and fails after retries', async () => {
  const sleeps = []
  const sleep = async (ms) => {
    sleeps.push(ms)
  }
  let calls = 0
  const flaky = createTransport({
    id: 'flaky',
    maxRetries: 2,
    sleep,
    fetchImpl: async () => {
      calls += 1
      return calls < 3 ? jsonResponse({}, { status: 503 }) : jsonResponse({ ok: true })
    },
  })
  assert.deepEqual(await flaky.request('https://x.test/f'), { ok: true })
  assert.equal(calls, 3, 'two retries then success')
  assert.ok(sleeps.length >= 2)

  const limited = createTransport({
    id: 'limited',
    maxRetries: 1,
    sleep,
    fetchImpl: async () => jsonResponse({}, { status: 429, headers: { 'Retry-After': '2' } }),
  })
  await assert.rejects(() => limited.request('https://x.test/l'), /HTTP 429/)
  assert.ok(sleeps.includes(2000), 'Retry-After honored (seconds → ms)')
})

test('transport paces calls per the source limit', async () => {
  const times = []
  const transport = createTransport({
    id: 'paced',
    minIntervalMs: 30,
    fetchImpl: async () => {
      times.push(Date.now())
      return jsonResponse({})
    },
    cacheTtlMs: 0,
  })
  await Promise.all([transport.request('https://x.test/1'), transport.request('https://x.test/2')])
  assert.equal(times.length, 2)
  assert.ok(times[1] - times[0] >= 25, `calls were ${times[1] - times[0]}ms apart`)
})

test('registry lists adapters by capability with researched rate limits', () => {
  clearProviders()
  registerProvider({ id: 'anilist', capabilities: { search: true, relations: true } })
  registerProvider({ id: 'kitsu', capabilities: { externalIds: true } })
  assert.equal(getProvider('anilist').id, 'anilist')
  assert.deepEqual(providersFor('relations').map((p) => p.id), ['anilist'])
  assert.equal(PROVIDER_LIMITS.anidb.minIntervalMs, 2000)
  assert.equal(PROVIDER_LIMITS.ann.minIntervalMs, 1000)
  assert.equal(PROVIDER_LIMITS.anilist.note, '90 req/min')
  assert.throws(() => registerProvider({}), /requires an id/)
  clearProviders()
})

test('anilist adapter maps Media shapes without inventing fields', () => {
  const media = {
    id: 98459,
    format: 'TV',
    status: 'FINISHED',
    episodes: 24,
    season: 'FALL',
    seasonYear: 2018,
    title: { romaji: 'Tensei Shitara Slime Datta Ken', english: 'That Time I Got Reincarnated as a Slime', native: '転生したらスライムだった件' },
    synonyms: ['TenSura'],
    genres: ['Fantasy'],
    startDate: { year: 2018 },
    studios: { nodes: [{ name: 'Eightbit' }] },
    tags: [{ name: 'Isekai' }],
    externalLinks: [
      { site: 'MyAnimeList', url: 'https://myanimelist.net/anime/37430/Tensei_shitara_Slime_Datta_Ken' },
      { site: 'AniDB', url: 'https://anidb.net/anime/13047' },
    ],
    relations: {
      edges: [
        {
          relationType: 'SEQUEL',
          format: 'TV',
          nodes: [{ id: 114745, format: 'TV', title: { romaji: 'Tensei Shitara Slime Datta Ken 2nd Season' } }],
        },
      ],
    },
  }
  const unified = toUnified(media)
  assert.equal(unified.internalId, 'anilist:98459')
  assert.equal(unified.titles.romaji, 'Tensei Shitara Slime Datta Ken')
  assert.deepEqual(unified.externalIds, { anilist: '98459', mal: '37430', anidb: '13047' })
  assert.equal(unified.episodes, 24)
  assert.deepEqual(unified.studios, ['Eightbit'])
  assert.equal(unified.release.year, 2018)
  assert.equal(unified.release.endDate, null, 'unknown stays null')

  const edges = toRelationEdges(media)
  assert.equal(edges.length, 1)
  assert.equal(edges[0].providerType, 'SEQUEL', 'raw provider type preserved')
  assert.equal(edges[0].normalizedType, 'sequel')
  assert.equal(edges[0].targetKey, 'anilist:114745')

  const franchise = deriveFranchise(media, edges)
  assert.equal(franchise.role, 'main', 'no prequel/parent → main')

  const seasonEdges = [{ ...edges[0], normalizedType: 'prequel', providerType: 'PREQUEL' }]
  assert.equal(deriveFranchise(media, seasonEdges).role, 'season')
  const branchEdges = [{ ...edges[0], normalizedType: 'parent-story', providerType: 'PARENT', targetKey: 'anilist:98459' }]
  assert.deepEqual(deriveFranchise(media, branchEdges), { key: 'anilist:98459', role: 'branch:side-story' })
})

test('lookupEvidence uses the injected gql and returns the evidence shape', async () => {
  const media = {
    id: 21355,
    format: 'TV',
    title: { romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu', english: 'Re:ZERO -Starting Life in Another World-' },
    synonyms: ['Re:ZERO -Starting Life in Another World'],
    relations: { edges: [] },
  }
  const calls = []
  const gql = async (query, variables) => {
    calls.push({ query, variables })
    return { Page: { media: [media] } }
  }
  const evidence = await lookupEvidence({ title: 'Re:ZERO -Starting Life in Another World' }, { gql })
  assert.equal(evidence.key, 'anilist:21355')
  assert.equal(evidence.sourceIds.anilist, '21355')
  assert.ok(evidence.synonyms.includes('Re:ZERO -Starting Life in Another World'))
  assert.deepEqual(evidence.relations, [])
  assert.equal(calls.length, 1)
  assert.match(calls[0].query, /search/)
  const byId = await lookupEvidence({ sourceIds: { anilist: '21355' } }, {
    gql: async (query, variables) => {
      assert.match(query, /Media\(id/)
      assert.equal(variables.id, 21355)
      return { Media: media }
    },
  })
  assert.equal(byId.key, 'anilist:21355')
  await assert.rejects(() => lookupEvidence({ title: 'x' }), /injected gql/)
})
