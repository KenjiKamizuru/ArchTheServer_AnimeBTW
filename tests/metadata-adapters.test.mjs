// Tests for the Kitsu and Wikidata adapters (AV-117c2a) — pure mappings over
// canned JSON:API / SPARQL payloads; network is injected and faked.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toUnified as kitsuToUnified,
  mappingsToExternalIds,
  toEvidence,
  buildSearchUrl,
  buildMappingsUrl,
  lookupEvidence as kitsuLookup,
} from '../server/metadata/providers/kitsu.mjs'
import {
  KNOWN_PROPERTIES,
  buildCrossIdQuery,
  bindingsToResult,
  lookupEvidence as wikidataLookup,
} from '../server/metadata/providers/wikidata.mjs'

const kitsuMedia = {
  id: '5178',
  type: 'anime',
  attributes: {
    canonicalTitle: 'Tensei Shitara Slime Datta Ken',
    titles: { en: 'That Time I Got Reincarnated as a Slime', en_jp: 'Tensei Shitara Slime Datta Ken', ja_jp: '転生したらスライムだった件' },
    abbreviatedTitles: ['TenSura'],
    startDate: '2018-10-02',
    endDate: '2019-03-26',
    episodeCount: 24,
    subtype: 'TV',
    status: 'finished',
  },
}

test('kitsu: JSON:API shapes map to the unified model without invention', () => {
  const unified = kitsuToUnified(kitsuMedia)
  assert.equal(unified.internalId, 'kitsu:5178')
  assert.equal(unified.titles.canonical, 'Tensei Shitara Slime Datta Ken')
  assert.equal(unified.titles.english, 'That Time I Got Reincarnated as a Slime')
  assert.equal(unified.release.year, 2018)
  assert.equal(unified.episodes, 24)
  assert.equal(unified.format, 'TV')
  assert.deepEqual(unified.externalIds, { kitsu: '5178' }, 'no cross-ids invented')
  assert.deepEqual(unified.studios, [], 'kitsu adapter does not claim studios')
  assert.equal(kitsuToUnified({}), null)
})

test('kitsu: mappings become verified cross-ids for identity rung 2', () => {
  const mappings = [
    { attributes: { externalSite: 'myanimelist', externalId: '37430' } },
    { attributes: { externalSite: 'anilist', externalId: '98459' } },
    { attributes: { externalSite: 'anidb', externalId: '13047' } },
    { attributes: { externalSite: 'official website', externalId: 'https://ten-sura.com' } },
  ]
  const ids = mappingsToExternalIds(mappings)
  assert.deepEqual(ids, { mal: '37430', anilist: '98459', anidb: '13047' }, 'websites are never identity evidence')
  const evidence = toEvidence(kitsuMedia, { mappings })
  assert.equal(evidence.key, 'kitsu:5178')
  assert.equal(evidence.sourceIds.mal, '37430')
  const searchUrl = buildSearchUrl('slime')
  assert.ok(searchUrl.includes('filter%5Btext%5D=slime'))
  assert.ok(buildMappingsUrl('myanimelist', '37430').includes('filter%5BexternalSite%5D=myanimelist'))

  // Transport-backed lookup resolves via a MAL id through the mappings table.
  const transport = {
    request: async (url) => {
      if (url.includes('/mappings')) {
        return {
          data: [
            { attributes: { externalSite: 'myanimelist', externalId: '37430' }, relationships: { item: { data: { id: '5178', type: 'anime' } } } },
          ],
        }
      }
      throw new Error(`unexpected url ${url}`)
    },
  }
  return kitsuLookup({ sourceIds: { mal: '37430' }, title: 'T' }, { transport }).then((result) => {
    assert.equal(result.key, 'kitsu:5178')
    assert.equal(result.sourceIds.kitsu, '5178')
    assert.equal(result.sourceIds.mal, '37430')
  })
})

test('wikidata: only verified property ids are used; unknown stay omitted', () => {
  assert.equal(KNOWN_PROPERTIES.imdb, 'P345')
  assert.equal(KNOWN_PROPERTIES.mal, 'P4086')
  assert.equal(KNOWN_PROPERTIES.anilist, null, 'unverified property ids are not invented')
  assert.equal(buildCrossIdQuery({ source: 'anilist', id: '98459' }), null, 'no query without a verified property')

  const query = buildCrossIdQuery({ source: 'mal', id: '37430' })
  assert.ok(query.includes('wdt:P4086 "37430"'))
  assert.ok(query.includes('OPTIONAL { ?item wdt:P345 ?imdb . }'))
  assert.ok(!query.includes('anilist'), 'unverified properties omitted')

  const result = bindingsToResult([
    {
      item: { value: 'http://www.wikidata.org/entity/Q5463276' },
      itemLabel: { value: 'Tensei Shitara Slime Datta Ken' },
      P345: { value: 'tt8287468' },
      P4086: { value: '37430' },
    },
  ])
  assert.deepEqual(result.externalIds, { imdb: 'tt8287468', mal: '37430', wikidata: 'Q5463276' })
  assert.equal(bindingsToResult([]), null)
})

test('wikidata: lookup iterates known ids and returns cross-id evidence', async () => {
  const transport = {
    request: async (url) => {
      assert.ok(url.startsWith('https://query.wikidata.org/sparql?'))
      return {
        results: {
          bindings: [
            {
              item: { value: 'http://www.wikidata.org/entity/Q5463276' },
              P345: { value: 'tt8287468' },
              P4086: { value: '37430' },
            },
          ],
        },
      }
    },
  }
  const evidence = await wikidataLookup({ sourceIds: { mal: '37430', anilist: '98459' }, title: 'T' }, { transport })
  assert.equal(evidence.key, 'wikidata:Q5463276')
  assert.equal(evidence.sourceIds.imdb, 'tt8287468')
  await assert.rejects(() => wikidataLookup({ sourceIds: { mal: '1' } }), /requires a transport/)
})
