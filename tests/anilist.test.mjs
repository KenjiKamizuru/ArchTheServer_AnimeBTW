import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBrowseQuery, parseBrowseFilters } from '../server/browse.mjs'
import { extractMediaArgs, validateGraphql } from '../server/graphqlCheck.mjs'
import { flush } from '../server/metadataCache.mjs'

const jsonResponse = (data) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })

async function withMockFetch(mock, run) {
  const original = globalThis.fetch
  globalThis.fetch = mock
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

test('browse year ranges use AniList FuzzyDateInt start-date arguments', () => {
  const filters = parseBrowseFilters({ yearMin: '2000', yearMax: '2009' })
  const { query, variables } = buildBrowseQuery(filters)
  assert.match(query, /startDate_greater: \$yearMin/)
  assert.match(query, /startDate_lesser: \$yearMax/)
  assert.doesNotMatch(query, /seasonYear_(?:greater|lesser)/)
  assert.match(query, /startDate\s*\{\s*year month day\s*\}/)
  assert.match(query, /endDate\s*\{\s*year month day\s*\}/)
  assert.match(query, /studios\(isMain: true\)\s*\{\s*nodes\s*\{\s*id name isAnimationStudio siteUrl\s*\}\s*\}/)
  assert.deepEqual(extractMediaArgs(query).filter((arg) => arg.includes('Date') || arg.includes('Year')), [
    'startDate_greater',
    'startDate_lesser',
  ])
  assert.equal(variables.yearMin, 20000101)
  assert.equal(variables.yearMax, 20091231)
  assert.equal(validateGraphql(query).ok, true)
})

test('detail requests score distribution from Media.stats and maps relations', async () => {
  const calls = []
  await withMockFetch(async (_url, init) => {
    calls.push(JSON.parse(init.body).query)
    return jsonResponse({
      Media: {
        id: 983421,
        title: { english: 'Regression Title', romaji: 'Regression Title', native: null },
        coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/example.jpg' },
        startDate: { year: 2024, month: 2, day: 29 },
        endDate: { year: 2024, month: 4, day: null },
        nextAiringEpisode: { episode: 4, airingAt: 1_735_689_600 },
        stats: { scoreDistribution: [{ score: 80, amount: 17 }] },
        relations: {
          edges: [
            {
              relationType: 'SEQUEL',
              node: {
                id: 983422,
                type: 'ANIME',
                format: 'TV',
                status: 'FINISHED',
                episodes: 12,
                season: 'SPRING',
                seasonYear: 2026,
                title: { english: 'Regression Sequel', romaji: 'Regression Sequel' },
                coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/sequel.jpg' },
              },
            },
          ],
        },
        characters: { edges: [] },
        staff: { edges: [] },
        streamingEpisodes: [],
      },
    })
  }, async () => {
    const { getDetail } = await import('../server/anilist.mjs')
    const detail = await getDetail(983421)
    assert.deepEqual(detail.startDate, { year: 2024, month: 2, day: 29 })
    assert.deepEqual(detail.endDate, { year: 2024, month: 4, day: null })
    assert.deepEqual(detail.nextEpisode, { episode: 4, airingAt: 1_735_689_600 })
    assert.deepEqual(detail.scoreBuckets, [{ score: 80, amount: 17 }])
    assert.equal(detail.relatedSeasons[0].relationType, 'SEQUEL')
    assert.equal(detail.relatedSeasons[0].title, 'Regression Sequel')
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0], /startDate\s*\{\s*year month day\s*\}/)
  assert.match(calls[0], /endDate\s*\{\s*year month day\s*\}/)
  assert.match(calls[0], /nextAiringEpisode\s*\{\s*episode airingAt\s*\}/)
  assert.match(calls[0], /stats\s*\{\s*scoreDistribution\s*\{\s*score amount\s*\}\s*\}/)
  assert.doesNotMatch(calls[0], /Media\([^)]*\)\s*\{[^}]*scoreDistribution/)
  assert.equal(validateGraphql(calls[0]).ok, true)
})

test('franchise requests select relationType from edges and preserve normalized relations', async () => {
  let captured
  await withMockFetch(async (_url, init) => {
    captured = JSON.parse(init.body).query
    return jsonResponse({
      Page: {
        media: [
          {
            id: 983431,
            title: { english: 'Franchise First', romaji: 'Franchise First' },
            relations: {
              edges: [
                {
                  relationType: 'SEQUEL',
                  node: { id: 983432, title: { english: 'Franchise Next', romaji: 'Franchise Next' }, seasonYear: 2027 },
                },
              ],
            },
          },
        ],
      },
    })
  }, async () => {
    const { seasonFranchises } = await import('../server/anilist.mjs')
    const result = await seasonFranchises({ season: 'FALL', year: 2096 })
    assert.equal(result.media[0].relations[0].relationType, 'SEQUEL')
    assert.equal(result.media[0].relations[0].node.id, 983432)
  })

  assert.match(captured, /relations\s*\{\s*edges\s*\{\s*relationType\s+node\s*\{/)
  assert.doesNotMatch(captured, /relations\s*\{\s*relationType\s+nodes/)
  assert.equal(validateGraphql(captured).ok, true)
})

test('AniList requests identify the client with a descriptive User-Agent', async () => {
  let headers
  await withMockFetch(async (_url, init) => {
    headers = new Headers(init.headers)
    return jsonResponse({ Page: { pageInfo: { total: 0, hasNextPage: false }, media: [] } })
  }, async () => {
    const { getSeason } = await import('../server/anilist.mjs')
    await getSeason({ season: 'WINTER', year: 2095, sort: 'popular', page: 1, perPage: 10 })
  })
  assert.match(headers.get('user-agent'), /^AnimeVault\/1\.0 \(\+/)
})

test('AniList GraphQL validation errors are not pointlessly retried', async () => {
  let attempts = 0
  await withMockFetch(async () => {
    attempts += 1
    return new Response(JSON.stringify({ errors: [{ message: 'Cannot query field "invalid" on type "Media".' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }, async () => {
    const { getSeason } = await import('../server/anilist.mjs')
    await assert.rejects(
      getSeason({ season: 'SUMMER', year: 2094, sort: 'popular', page: 1, perPage: 10 }),
      (error) => error.status === 502 && error.code === 'UPSTREAM_UNAVAILABLE' && /unreachable/.test(error.message),
    )
  })
  assert.equal(attempts, 1)
})

test('studios lists animation studios and producers with type filter', async () => {
  await flush()
  const studios = [
    { id: 1, name: 'Studio Ghibli', isAnimationStudio: true, favourites: 50000, siteUrl: 'https://ghibli.jp' },
    { id: 2, name: 'MAPPA', isAnimationStudio: true, favourites: 40000, siteUrl: 'https://mappa.co.jp' },
    { id: 3, name: 'Some Producer', isAnimationStudio: false, favourites: 10000, siteUrl: null },
    { id: 4, name: 'Another Producer', isAnimationStudio: false, favourites: 5000, siteUrl: null },
  ]
  await withMockFetch(
    async (_url, init) => {
      const variables = JSON.parse(init.body).variables
      assert.equal(variables.sort?.[0], 'FAVOURITES_DESC')
      return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false, total: 4 }, studios } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    async () => {
      const { studios: listStudios } = await import('../server/anilist.mjs')

      // All (default): returns everything
      const all = await listStudios({ page: 1 })
      assert.equal(all.studios.length, 4)

      // Animation only
      const animation = await listStudios({ page: 1, type: 'animation' })
      assert.equal(animation.studios.length, 2)
      assert.ok(animation.studios.every((s) => s.isAnimationStudio))
      assert.ok(animation.studios.some((s) => s.name === 'Studio Ghibli'))
      assert.ok(animation.studios.some((s) => s.name === 'MAPPA'))

      // Producer only
      const producer = await listStudios({ page: 1, type: 'producer' })
      assert.equal(producer.studios.length, 2)
      assert.ok(producer.studios.every((s) => !s.isAnimationStudio))
      assert.ok(producer.studios.some((s) => s.name === 'Some Producer'))

      // Invalid type falls back to all
      const fallback = await listStudios({ page: 1, type: 'bogus' })
      assert.equal(fallback.studios.length, 4)
    },
  )
})

test('studios search and sort are passed through to AniList', async () => {
  await flush()
  let captured
  await withMockFetch(
    async (_url, init) => {
      captured = { variables: JSON.parse(init.body).variables }
      return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false, total: 0 }, studios: [] } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    async () => {
      const { studios: listStudios } = await import('../server/anilist.mjs')
      await listStudios({ page: 2, search: 'ghibli', sort: 'name', type: 'animation' })
      assert.equal(captured.variables.page, 2)
      assert.equal(captured.variables.search, 'ghibli')
      assert.equal(captured.variables.sort?.[0], 'NAME')
    },
  )
})

test('studios buckets and metadata are preserved', async () => {
  await flush()
  await withMockFetch(
    async () =>
      new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false, total: 1 }, studios: [{ id: 7, name: 'Test Studio', isAnimationStudio: true, favourites: 100, siteUrl: null }] } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    async () => {
      const { studios: listStudios } = await import('../server/anilist.mjs')
      const result = await listStudios({ page: 1, type: 'animation' })
      assert.equal(result.studios[0].bucket, 'T')
      assert.equal(result.studios[0].isAnimationStudio, true)
      assert.equal(result.studios[0].favourites, 100)
      assert.equal(result.page, 1)
      assert.equal(result.hasNextPage, false)
      assert.equal(result.total, 1)
    },
  )
})
