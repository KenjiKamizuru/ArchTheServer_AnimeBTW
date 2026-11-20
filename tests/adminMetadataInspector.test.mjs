// AV-025: admin metadata inspector — raw vs normalized records.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCompletenessScore,
  recordRefreshStatus,
} from '../server/catalog.mjs'

const jsonResponse = (data) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

async function withMockFetch(mock, run) {
  const original = globalThis.fetch
  globalThis.fetch = mock
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

const mediaNode = {
  id: 983421,
  idMal: 12345,
  title: { romaji: 'Kids on the Slope', english: 'Kids on the Slope', native: '坂道のアポロン' },
  coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg', large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg', color: '#b22222' },
  bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/x.jpg',
  description: 'A coming-of-age story about jazz and friendship.',
  episodes: 12,
  duration: 23,
  status: 'FINISHED',
  format: 'TV',
  season: 'SPRING',
  seasonYear: 2012,
  startDate: { year: 2012, month: 4, day: 12 },
  endDate: { year: 2012, month: 6, day: 28 },
  averageScore: 86,
  popularity: 70_000,
  favourites: 40_000,
  genres: ['Music', 'Drama'],
  tags: [{ name: 'music', rank: 10, isMediaSpoiler: false }],
  source: 'manga',
  countryOfOrigin: 'JP',
  siteUrl: 'https://anilist.co/anime/983421',
  nextAiringEpisode: null,
  studios: { nodes: [{ id: 55, name: 'MAPPA', isAnimationStudio: true, siteUrl: null }] },
  externalLinks: [{ site: 'Official Site', url: 'https://example.com', type: 'OFFICIAL' }],
  streamingEpisodes: [],
  stats: { scoreDistribution: [{ score: 86, amount: 10 }] },
  rankings: [],
  characters: { edges: [] },
  staff: { edges: [] },
  relations: { edges: [] },
}

test('getMediaInspection returns raw provider payload and normalized record', async () => {
  let capturedQuery
  await withMockFetch(
    async (_url, init) => {
      capturedQuery = JSON.parse(init.body).query
      return jsonResponse({ Media: mediaNode })
    },
    async () => {
      const { getMediaInspection, DETAIL_QUERY } = await import('../server/anilist.mjs')
      const inspection = await getMediaInspection(983421)

      assert.equal(inspection.id, 983421)
      // Raw payload is the untouched AniList Media node.
      assert.deepEqual(inspection.raw, mediaNode)
      // Normalized record is a canonical catalog record.
      const normalized = inspection.normalized
      assert.equal(normalized.id, 983421)
      assert.equal(normalized.title, 'Kids on the Slope')
      assert.equal(normalized.romaji, 'Kids on the Slope')
      assert.equal(normalized.english, 'Kids on the Slope')
      assert.equal(normalized.native, '坂道のアポロン')
      assert.equal(normalized.fieldMetadata.title.source, 'anilist')
      assert.equal(normalized.metadataSchemaVersion, 1)
      assert.deepEqual(normalized.genres, ['Music', 'Drama'])
      assert.equal(normalized.score, 86)
      assert.equal(normalized.status, 'FINISHED')
      assert.equal(normalized.format, 'TV')
      // The inspector request uses the shared detail query.
      assert.equal(capturedQuery, DETAIL_QUERY)
      // Completeness score is computed on the normalized record.
      assert.equal(inspection.completenessScore, computeCompletenessScore(normalized))
      assert.ok(inspection.completenessScore > 0)
      assert.ok(inspection.completenessScore <= 100)
      // Refresh status is present and equivalent to a direct assessment.
      assert.deepEqual(inspection.refreshStatus, recordRefreshStatus(normalized))
      assert.ok(Array.isArray(inspection.refreshStatus.staleFields))
    },
  )
})

test('getMediaInspection rejects invalid ids', async () => {
  await withMockFetch(
    async () => jsonResponse({ Media: mediaNode }),
    async () => {
      const { getMediaInspection } = await import('../server/anilist.mjs')
      await assert.rejects(getMediaInspection(0), (error) => error.status === 400)
      await assert.rejects(getMediaInspection(-5), (error) => error.status === 400)
      await assert.rejects(getMediaInspection('abc'), (error) => error.status === 400)
      await assert.rejects(getMediaInspection(1.5), (error) => error.status === 400)
    },
  )
})

test('getMediaInspection handles a missing Media node gracefully', async () => {
  await withMockFetch(
    async () => jsonResponse({ Media: null }),
    async () => {
      const { getMediaInspection } = await import('../server/anilist.mjs')
      const inspection = await getMediaInspection(999999)
      assert.equal(inspection.id, 999999)
      assert.equal(inspection.raw, null)
      assert.equal(inspection.normalized, null)
      assert.equal(inspection.completenessScore, null)
      assert.equal(inspection.refreshStatus, null)
    },
  )
})

test('normalize export transforms a raw Media node into a catalog record', async () => {
  await withMockFetch(
    async () => jsonResponse({ Media: null }),
    async () => {
      const { normalize } = await import('../server/anilist.mjs')
      const record = normalize(mediaNode)
      assert.equal(record.id, 983421)
      assert.equal(record.title, 'Kids on the Slope')
      assert.equal(record.color, '#b22222')
      assert.equal(record.banner, 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/x.jpg')
      assert.ok(Array.isArray(record.artwork))
      assert.equal(record.artwork[0].source, 'anilist')
      assert.equal(record.artwork[0].kind, 'poster')
      assert.equal(record.fieldMetadata.title.source, 'anilist')
    },
  )
})
