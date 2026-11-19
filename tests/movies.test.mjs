import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVidsrcEmbedUrl, getMovieOrSeriesDetails } from '../server/movies.mjs'

test('buildVidsrcEmbedUrl builds movie embed URL', () => {
  const res = buildVidsrcEmbedUrl({ imdbId: 'tt1375666', kind: 'movie' })
  assert.equal(res.provider, 'vidsrc')
  assert.equal(res.kind, 'movie')
  assert.equal(res.imdbId, 'tt1375666')
  assert.equal(res.embedUrl, 'https://vidsrc.sh/embed/movie?imdb=tt1375666')
})

test('buildVidsrcEmbedUrl builds TV series embed URL with season and episode', () => {
  const res = buildVidsrcEmbedUrl({
    imdbId: 'tt0903747',
    kind: 'series',
    season: 3,
    episode: 7,
  })
  assert.equal(res.provider, 'vidsrc')
  assert.equal(res.kind, 'series')
  assert.equal(res.season, 3)
  assert.equal(res.episode, 7)
  assert.equal(res.embedUrl, 'https://vidsrc.sh/embed/tv?imdb=tt0903747&season=3&episode=7')
})

test('buildVidsrcEmbedUrl rejects invalid IMDb ID', () => {
  assert.throws(() => buildVidsrcEmbedUrl({ imdbId: 'invalid', kind: 'movie' }), /Valid IMDb ID/)
})

test('getMovieOrSeriesDetails rejects invalid IMDb ID', async () => {
  await assert.rejects(() => getMovieOrSeriesDetails('not-an-id'), /Invalid IMDb ID/)
})
