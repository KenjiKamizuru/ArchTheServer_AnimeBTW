import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBrowseQuery, parseBrowseFilters } from '../server/browse.mjs'
import { extractMediaArgs, validateGraphql } from '../server/graphqlCheck.mjs'

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
