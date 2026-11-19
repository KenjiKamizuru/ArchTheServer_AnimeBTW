// Tests for MAL, AniDB, ANN, and TMDB adapters (AV-117c2b) — canned payloads,
// injected transport, offline suite.
import test from 'node:test'
import assert from 'node:assert/strict'
import { toUnified as malToUnified, toRelationEdges as malEdges, buildAnimeUrl, lookupEvidence as malLookup } from '../server/metadata/providers/mal.mjs'
import { parseAnimeXml, parseRelatedAnime, buildAnimeUrl as anidbUrl, lookupEvidence as anidbLookup } from '../server/metadata/providers/anidb.mjs'
import { parseAnnXml, annToUnifiedParts, ATTRIBUTION as ANN_ATTR } from '../server/metadata/providers/ann.mjs'
import { toUnified as tmdbToUnified, externalIdsFrom, buildExternalIdsUrl, lookupEvidence as tmdbLookup, ATTRIBUTION as TMDB_ATTR } from '../server/metadata/providers/tmdb.mjs'

test('mal: REST v2 shapes map cleanly; relation vocab is translated, raw kept', () => {
  const anime = {
    id: 37430,
    title: 'Tensei shitara Slime Datta Ken',
    alternative_titles: { en: 'That Time I Got Reincarnated as a Slime', japanese: '転生したらスライムだった件', synonyms: ['TenSura'] },
    media_type: 'tv',
    num_episodes: 24,
    status: 'finished_airing',
    start_season: { year: 2018, season: 'fall' },
    studios: [{ id: 1, name: 'Eightbit' }],
    related_anime: [
      { node: { id: 39663, title: 'Tensura Nikki' }, relation_type: 'spin_off' },
      { node: { id: 37430, title: 'self' }, relation_type: 'other' },
    ],
  }
  const unified = malToUnified(anime)
  assert.equal(unified.internalId, 'mal:37430')
  assert.equal(unified.titles.english, 'That Time I Got Reincarnated as a Slime')
  assert.equal(unified.titles.romaji, null, 'MAL has no romaji field — stays unknown')
  assert.equal(unified.format, 'TV')
  assert.equal(unified.release.year, 2018)
  assert.deepEqual(unified.studios, ['Eightbit'])

  const edges = malEdges(anime)
  assert.equal(edges[0].providerType, 'spin_off', 'raw MAL vocab preserved')
  assert.equal(edges[0].normalizedType, 'spin-off')
  assert.equal(edges[1].targetKey, 'mal:37430')
  assert.ok(buildAnimeUrl(37430, { clientId: 'x' }).startsWith('https://api.myanimelist.net/v2/anime/37430'))

  return malLookup({ sourceIds: { mal: '37430' } }, {
    clientId: 'cid',
    transport: {
      request: async (url, options) => {
        assert.equal(options.headers['X-MAL-Client-ID'], 'cid')
        assert.equal(options.ttlMs, 24 * 60 * 60 * 1000)
        return anime
      },
    },
  }).then((evidence) => {
    assert.equal(evidence.key, 'mal:37430')
    assert.equal(evidence.relations[0].relationType, 'spin_off')
  })
})

test('anidb: XML parsing covers the anime shape; day-cache TTL is used', () => {
  const xml = `<?xml version="1.0"?>
<anime id="13047" restricted="false">
  <type>TV Series</type>
  <episodecount>24</episodecount>
  <year>2018-10-02</year>
  <titles><title xml:lang="x-jat" type="main">Tensei Shitara Slime Datta Ken</title><title xml:lang="en" type="official">That Time I Got Reincarnated as a Slime</title></titles>
  <relatedanime>
    <anime id="14719" type="sequel">Tensei Shitara Slime Datta Ken 2nd Season</anime>
  </relatedanime>
</anime>`
  const parsed = parseAnimeXml(xml)
  assert.equal(parsed.id, '13047')
  assert.equal(parsed.episodes, 24)
  assert.equal(parsed.year, 2018)
  assert.deepEqual(parsed.titles, ['Tensei Shitara Slime Datta Ken', 'That Time I Got Reincarnated as a Slime'])
  const edges = parseRelatedAnime(xml)
  assert.equal(edges[0].providerType, 'sequel')
  assert.equal(edges[0].normalizedType, 'sequel')
  assert.equal(edges[0].targetKey, 'anidb:14719')
  assert.equal(parseAnimeXml('<error>no such anime</error>'), null)
  assert.ok(anidbUrl(13047, { client: 'myclient' }).includes('client=myclient'))

  return anidbLookup({ sourceIds: { anidb: '13047' } }, {
    client: 'myclient',
    transport: {
      request: async (url, options) => {
        assert.equal(options.ttlMs, 24 * 60 * 60 * 1000, 'day cache per AniDB ban policy')
        return xml
      },
    },
  }).then((evidence) => {
    assert.equal(evidence.key, 'anidb:13047')
    assert.equal(evidence.relations[0].relationType, 'sequel')
  })
})

test('ann: encyclopedia XML → vintage/episodes/staff cross-check + attribution', () => {
  const xml = `<ann>
  <anime id="21507" gid="21507" type="TV">
  <info type="Vintage">2018-10-02 to 2019-03-26</info>
  <info type="Number of episodes">24</info>
  <info type="Plot Summary">Satoru is reborn as a slime.</info>
  <staff><person>Takahiro Kishida</person><task>Character Design</task></staff>
  </anime>
</ann>`
  const parsed = parseAnnXml(xml)
  assert.equal(parsed.id, '21507')
  assert.equal(parsed.infos.length, 3)
  const parts = annToUnifiedParts(parsed)
  assert.equal(parts.year, 2018, 'year from vintage')
  assert.equal(parts.episodes, 24)
  assert.equal(parts.staff[0].task, 'Character Design')
  assert.ok(ANN_ATTR.includes('Anime News Network'))
  assert.equal(parseAnnXml('<ann></ann>'), null)
})

test('tmdb: mapping + external ids + collections, key never in shared state', () => {
  const movie = {
    id: 555_775,
    title: 'That Time I Got Reincarnated as a Slime: The Movie – Scarlet Bond',
    original_title: '転生したらスライムだった件 紅蓮の絆編',
    release_date: '2022-11-25',
    status: 'Released',
    belongs_to_collection: { id: 999_999, name: 'Tensura Collection' },
    production_companies: [{ name: 'Eightbit' }],
  }
  const unified = tmdbToUnified(movie)
  assert.equal(unified.internalId, 'tmdb:movie:555775')
  assert.equal(unified.format, 'MOVIE')
  assert.equal(unified.release.year, 2022)
  assert.equal(unified.franchise.key, 'tmdb:collection:999999')
  assert.deepEqual(unified.externalIds, { tmdb: '555775' })
  assert.deepEqual(externalIdsFrom({ id: 555_775, imdb_id: 'tt14564512', tvdb_id: 123 }), { tmdb: '555775', imdb: 'tt14564512', tvdb: '123' })
  const url = buildExternalIdsUrl(555_775, { key: 'k' })
  assert.ok(url.includes('api_key=k'))
  assert.ok(!buildExternalIdsUrl(555_775).includes('api_key'))
  assert.ok(TMDB_ATTR.includes('TMDB'))

  return tmdbLookup({ sourceIds: { tmdb: '555775' } }, {
    key: 'k',
    transport: {
      request: async (url, options) => {
        assert.ok(url.includes('/movie/555775/external_ids'))
        assert.equal(options.ttlMs, 24 * 60 * 60 * 1000)
        return { id: 555_775, imdb_id: 'tt14564512' }
      },
    },
  }).then((evidence) => {
    assert.equal(evidence.key, 'tmdb:movie:555775')
    assert.equal(evidence.sourceIds.imdb, 'tt14564512')
    assert.ok(evidence.attribution.includes('TMDB'))
  })
})
