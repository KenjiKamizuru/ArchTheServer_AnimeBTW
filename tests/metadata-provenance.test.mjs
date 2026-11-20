import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Isolate the provider-ID registry and set its data path before importing either
// adapter so this test exercises the real AniList -> catalog -> registry flow.
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'animevault-metadata-'))
process.env.ANIMEVAULT_DATA = dataDir
const identifiers = await import('../server/identifiers.mjs')
const anilist = await import('../server/anilist.mjs')
const { CATALOG_METADATA_FIELDS } = await import('../server/catalog.mjs')
await identifiers.init()
after(async () => {
  await identifiers.flush()
  await rm(dataDir, { recursive: true, force: true })
})

function gqlResponse(data) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('AniList metadata records per-field source and refresh time without embedding provider IDs', async () => {
  const before = Date.now()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => gqlResponse({
    Page: {
      pageInfo: { total: 1, hasNextPage: false },
      media: [{
        id: 654321,
        idMal: 12345,
        title: { romaji: 'Metadata Sample', english: 'Metadata Sample', native: 'メタデータ' },
        externalLinks: [
          { site: 'AniDB', url: 'https://anidb.net/anime/34567', type: 'INFO' },
          { site: 'IMDb', url: 'https://www.imdb.com/title/tt0234144/', type: 'INFO' },
        ],
        episodes: 12,
        duration: 24,
        status: 'FINISHED',
        format: 'TV',
        season: 'WINTER',
        seasonYear: 2025,
        averageScore: 86,
        popularity: 1000,
        favourites: 25,
        genres: ['Drama'],
        tags: [],
        source: 'MANGA',
        countryOfOrigin: 'JP',
        nextAiringEpisode: null,
        studios: { nodes: [{ name: 'Sample Studio' }] },
        coverImage: { extraLarge: null, large: null, color: null },
        bannerImage: null,
        description: 'A sample description.',
        siteUrl: 'https://anilist.co/anime/654321',
      }],
    },
  })

  try {
    const result = await anilist.getSeason({ season: 'WINTER', year: 2025, page: 1, perPage: 1 })
    const afterFetch = Date.now()
    assert.equal(result.media.length, 1)
    const record = result.media[0]
    assert.equal(Object.hasOwn(record, 'externalIds'), false)
    assert.equal(record.score, 86)
    assert.deepEqual(record.providerScores, [{ source: 'anilist', value: 86, scale: 100, normalized: 86 }])
    assert.deepEqual(Object.keys(record.fieldMetadata).sort(), [...CATALOG_METADATA_FIELDS].sort())
    for (const field of CATALOG_METADATA_FIELDS) {
      assert.equal(record.fieldMetadata[field].source, 'anilist', field)
      const refreshed = Date.parse(record.fieldMetadata[field].lastRefreshedAt)
      assert.ok(refreshed >= before && refreshed <= afterFetch, `${field} timestamp is within the fetch window`)
      assert.deepEqual(record.fieldMetadata[field].observations, [])
      assert.equal(record.fieldMetadata[field].conflict, false)
    }
    assert.deepEqual(await identifiers.get(654321), {
      anilist: '654321',
      mal: '12345',
      anidb: '34567',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
