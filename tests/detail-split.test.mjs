// Tests for AV-021b: detail pages cache immutable metadata separately from
// rapidly changing airing data. The mock dispatches on the volatile query's
// `# volatile-overlay` marker comment.
import test from 'node:test'
import assert from 'node:assert/strict'

const baseMedia = {
  id: 901,
  title: { english: 'Base Title', romaji: 'Base Romaji' },
  status: 'RELEASING',
  episodes: 12,
  nextAiringEpisode: { episode: 5, airingAt: 1_700_000_000 },
  coverImage: {},
  genres: ['Drama'],
}

function installFetch(handler) {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url, init) => {
    calls += 1
    return handler(JSON.parse(init.body), calls)
  }
  return { restore: () => { globalThis.fetch = original }, calls: () => calls }
}

test('composes the volatile overlay over the immutable detail base', async () => {
  const { getDetail } = await import('../server/anilist.mjs')
  const mock = installFetch((body) => {
    const isVolatile = body.query.includes('# volatile-overlay')
    return new Response(
      JSON.stringify({
        data: {
          Media: isVolatile
            ? { id: 901, status: 'RELEASING', episodes: 13, nextAiringEpisode: { episode: 6, airingAt: 1_700_100_000 }, averageScore: 81, meanScore: 81, popularity: 999, favourites: 5 }
            : baseMedia,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
  try {
    const result = await getDetail(901)
    assert.equal(mock.calls(), 2, 'one fetch per cached half')
    assert.equal(result.episodes, 13, 'volatile episode count wins')
    assert.equal(result.title, 'Base Title', 'immutable fields survive the overlay')
    assert.equal(result.status, 'RELEASING')
    assert.equal(result.freshness.state, 'fresh')
    assert.ok(result.freshness.nextRefreshAt < 2e10, 'freshness timestamps are Unix seconds, not ms')
  } finally {
    mock.restore()
  }
})

test('the volatile overlay is best-effort and never breaks the page', async () => {
  const { getDetail } = await import('../server/anilist.mjs')
  const mock = installFetch((body) => {
    const isVolatile = body.query.includes('# volatile-overlay')
    return isVolatile
      ? new Response(JSON.stringify({ errors: [{ message: 'overlay down' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ data: { Media: { ...baseMedia, id: 902 } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  try {
    const result = await getDetail(902)
    assert.equal(result.episodes, 12, 'base values answer when the overlay fails')
    assert.equal(result.title, 'Base Title')
    assert.ok(result.meta.fetchFailure.at > 0, 'the failure is recorded without erasing values')
    assert.ok(result.meta.fetchFailure.message.length > 0, 'sanitized upstream message recorded')
  } finally {
    mock.restore()
  }
})

test('both halves are cached independently of each other', async () => {
  const { getDetail } = await import('../server/anilist.mjs')
  const mock = installFetch((body) =>
    new Response(
      JSON.stringify({
        data: {
          Media: body.query.includes('# volatile-overlay')
            ? { id: 903, episodes: 14 }
            : { ...baseMedia, id: 903, episodes: 12 },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
  try {
    const first = await getDetail(903)
    const afterFirst = mock.calls()
    const second = await getDetail(903)
    assert.equal(afterFirst, 2)
    assert.equal(mock.calls(), 2, 'warm cache serves both halves without refetching')
    assert.equal(first.episodes, 14)
    assert.equal(second.episodes, 14)
  } finally {
    mock.restore()
  }
})

test('inspectDetail shows the raw provider payload beside the normalized record', async () => {
  const { inspectDetail } = await import('../server/anilist.mjs')
  const mock = installFetch((body) => {
    const isVolatile = body.query.includes('# volatile-overlay')
    return new Response(
      JSON.stringify({
        data: {
          Media: isVolatile
            ? { id: 904, status: 'RELEASING', episodes: 13 }
            : { ...baseMedia, id: 904, averageScore: 81 },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
  try {
    const { raw, record } = await inspectDetail(904)
    assert.deepEqual(raw.title, { english: 'Base Title', romaji: 'Base Romaji' }, 'raw keeps the provider shape')
    assert.equal(raw.episodes, 13, 'raw includes the volatile overlay')
    assert.equal(record.title, 'Base Title', 'record is normalized')
    assert.equal(record.episodes, 13)
    assert.equal(record.schemaVersion, 1)
    assert.ok(record.completeness >= 0)
    assert.ok(record.meta.refreshedAt > 0)
  } finally {
    mock.restore()
  }
})

test('inspectDetail rejects invalid ids', async () => {
  const { inspectDetail } = await import('../server/anilist.mjs')
  await assert.rejects(() => inspectDetail('nope'), (err) => err.status === 400)
})
