import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAnimeRecord,
  CATALOG_METADATA_FIELDS,
  METADATA_SCHEMA_VERSION,
  migrateMetadataSchema,
  applyManualCorrection,
  recordRefreshStatus,
  fieldFreshness,
  isFieldStale,
  refreshPolicy,
  computeCompletenessScore,
} from '../server/catalog.mjs'
const basic = () => createAnimeRecord({ id: 1 })
test('id retained', () => assert.equal(basic().id, 1))
test('fallback title', () => assert.equal(basic().title, 'Anime #1'))
test('provided title', () => assert.equal(createAnimeRecord({ id: 2, title: 'Title' }).title, 'Title'))
test('null input rejected', () => assert.throws(() => createAnimeRecord(null), TypeError))
test('zero id rejected', () => assert.throws(() => createAnimeRecord({ id: 0 }), TypeError))
test('negative id rejected', () => assert.throws(() => createAnimeRecord({ id: -1 }), TypeError))
test('fractional id rejected', () => assert.throws(() => createAnimeRecord({ id: 1.2 }), TypeError))
test('string id rejected', () => assert.throws(() => createAnimeRecord({ id: '1' }), TypeError))
test('unsafe id rejected', () => assert.throws(() => createAnimeRecord({ id: Number.MAX_SAFE_INTEGER + 1 }), TypeError))
test('unknown status default', () => assert.equal(basic().status, 'UNKNOWN'))
test('title variants default null', () => assert.deepEqual([basic().romaji, basic().english, basic().native], [null, null, null]))
test('numeric zero is preserved', () => assert.equal(createAnimeRecord({ id: 1, score: 0 }).score, 0))
test('provider scores default to an empty collection', () => assert.deepEqual(basic().providerScores, []))
test('scores normalize to percentages and retain source values and scales', () => {
  const record = createAnimeRecord({
    id: 21,
    metadataSource: 'MAL',
    score: '8.5',
    scoreScale: 10,
    providerScores: [
      { source: 'AniList', value: 84.25, scale: 100, normalized: 0 },
      { source: 'MAL', value: 8.5, scale: 10 },
      { source: 'Unscaled', value: 8.5 },
      { source: 'Invalid', value: 11, scale: 10 },
    ],
  })

  assert.equal(record.score, 85)
  assert.deepEqual(record.providerScores, [
    { source: 'anilist', value: 84.25, scale: 100, normalized: 84.25 },
    { source: 'mal', value: 8.5, scale: 10, normalized: 85 },
  ])
})
test('score normalization rejects invalid values and scales without guessing', () => {
  for (const input of [
    { score: -1, scoreScale: 100 },
    { score: 101, scoreScale: 100 },
    { score: 5, scoreScale: 0 },
    { score: 'not a score', scoreScale: 10 },
    { score: 5, scoreScale: Number.POSITIVE_INFINITY },
  ]) {
    const record = createAnimeRecord({ id: 22, metadataSource: 'example', ...input })
    assert.equal(record.score, null)
    assert.deepEqual(record.providerScores, [])
  }
  assert.equal(createAnimeRecord({ id: 23, score: '4.25', scoreScale: 5 }).score, 85)
  assert.equal(createAnimeRecord({ id: 24, score: 8.475, scoreScale: 10 }).score, 84.75)
})
test('episode count unknown distinct from zero', () => { assert.equal(basic().episodes, null); assert.equal(createAnimeRecord({ id: 1, episodes: 0 }).episodes, 0) })
test('default description', () => assert.equal(basic().description, ''))
test('default duration unknown', () => assert.equal(basic().duration, null))
test('duration values normalize to whole minutes while retaining the legacy unit', () => {
  assert.equal(createAnimeRecord({ id: 10, duration: 24 }).duration, 24)
  assert.equal(createAnimeRecord({ id: 11, duration: '24', durationUnit: 'minutes' }).duration, 24)
  assert.equal(createAnimeRecord({ id: 12, duration: 1_440, durationUnit: 'seconds' }).duration, 24)
  assert.equal(createAnimeRecord({ id: 13, duration: { value: 1.5, unit: 'hours' } }).duration, 90)
  assert.equal(createAnimeRecord({ id: 14, duration: 23.6 }).duration, 24)
})
test('invalid or unsupported runtime values remain unknown', () => {
  for (const input of [
    { duration: 0 },
    { duration: -1 },
    { duration: Number.POSITIVE_INFINITY },
    { duration: '0x10' },
    { duration: 'not a runtime' },
    { duration: 20, durationUnit: 'days' },
    { duration: 10_001 },
  ]) {
    assert.equal(createAnimeRecord({ id: 15, ...input }).duration, null)
  }
})
test('default aired count', () => assert.equal(basic().airedEpisodes, 0))
test('default genre array', () => assert.deepEqual(basic().genres, []))
test('default tags array', () => assert.deepEqual(basic().tags, []))
test('default country and original language are unknown', () => {
  assert.equal(basic().countryOfOrigin, null)
  assert.equal(basic().originalLanguage, null)
})
test('country and original language normalize to stable codes', () => {
  const record = createAnimeRecord({
    id: 3,
    countryOfOrigin: ' jp ',
    originalLanguage: 'JPN',
  })
  const localized = createAnimeRecord({
    id: 4,
    countryOfOrigin: 'cn',
    originalLanguage: 'ZH_hant_TW',
  })

  assert.equal(record.countryOfOrigin, 'JP')
  assert.equal(record.originalLanguage, 'ja')
  assert.equal(localized.countryOfOrigin, 'CN')
  assert.equal(localized.originalLanguage, 'zh-Hant-TW')
})
test('malformed country and unknown original-language codes normalize to null', () => {
  const record = createAnimeRecord({ id: 5, countryOfOrigin: 'Japan', originalLanguage: 'und' })
  const malformed = createAnimeRecord({ id: 6, countryOfOrigin: 81, originalLanguage: 'ja--JP' })

  assert.equal(record.countryOfOrigin, null)
  assert.equal(record.originalLanguage, null)
  assert.equal(malformed.countryOfOrigin, null)
  assert.equal(malformed.originalLanguage, null)
})
test('default age ratings are an empty region-aware collection', () => {
  assert.deepEqual(basic().ageRatings, [])
})
test('age ratings normalize regions, systems, age values, sources, and duplicates', () => {
  const record = createAnimeRecord({
    id: 18,
    metadataSource: 'MAL',
    ageRatings: [
      { region: ' us ', system: 'TV Parental Guidelines', rating: ' tv-14 ', minimumAge: 14, source: 'MAL' },
      { region: 'US', ratingSystem: 'tv parental guidelines', rating: 'TV-14', minAge: '14', provider: 'mal' },
      { region: 'EU', system: 'PEGI', rating: '12', minimumAge: 12, source: 'AniList' },
      { region: 'global', system: 'General', value: 'Teen' },
      { region: 'US', system: 'MPAA', rating: 'R', minimumAge: 17, source: 'AniDB' },
      { region: 'US', system: 'MPAA', rating: 'R', minimumAge: 17, source: 'MAL' },
      { region: 'USA', system: 'MPAA', rating: 'G' },
    ],
  })

  assert.deepEqual(record.ageRatings, [
    { region: 'EU', system: 'PEGI', rating: '12', minimumAge: 12, source: 'anilist' },
    { region: 'GLOBAL', system: 'GENERAL', rating: 'Teen', minimumAge: null, source: 'mal' },
    { region: 'US', system: 'MPAA', rating: 'R', minimumAge: 17, source: 'anidb' },
    { region: 'US', system: 'MPAA', rating: 'R', minimumAge: 17, source: 'mal' },
    { region: 'US', system: 'TV PARENTAL GUIDELINES', rating: 'TV-14', minimumAge: 14, source: 'mal' },
  ])
})
test('age ratings reject unusable labels and regions but keep unknown numeric age nullable', () => {
  const record = createAnimeRecord({
    id: 19,
    metadataSource: 'AniList',
    ageRatings: [
      { region: 'USA', system: 'MPAA', rating: 'PG-13' },
      { region: 'US', system: 'MPAA', rating: '  ' },
      { region: null, rating: 'Not Rated', minimumAge: 999 },
    ],
  })

  assert.deepEqual(record.ageRatings, [
    { region: null, system: null, rating: 'Not Rated', minimumAge: null, source: 'anilist' },
  ])
})
test('default studios array', () => assert.deepEqual(basic().studios, []))
test('default organizations array', () => assert.deepEqual(basic().organizations, []))
test('default links array', () => assert.deepEqual(basic().links, []))
test('default streaming array', () => assert.deepEqual(basic().streams, []))
test('default artwork is an empty array when no cover or banner is supplied', () => {
  assert.deepEqual(basic().artwork, [])
})
test('artwork derives poster and banner variants from cover and banner', () => {
  const record = createAnimeRecord({
    id: 3,
    cover: 'https://example.com/cover.jpg',
    banner: 'https://example.com/banner.jpg',
    metadataSource: 'anilist',
  })
  assert.deepEqual(record.artwork, [
    { source: 'anilist', url: 'https://example.com/cover.jpg', kind: 'poster', width: null, height: null, attribution: null },
    { source: 'anilist', url: 'https://example.com/banner.jpg', kind: 'banner', width: null, height: null, attribution: null },
  ])
})
test('provider-supplied artwork variants keep source, dimensions and attribution', () => {
  const record = createAnimeRecord({
    id: 4,
    metadataSource: 'anilist',
    artwork: [
      { source: 'imdb', url: 'https://example.com/poster.jpg', kind: 'poster', width: 1000, height: 1500, attribution: 'IMDb' },
      { source: 'local', url: 'https://example.com/banner.jpg', kind: 'banner', width: 2000, height: 600, attribution: 'Local scan' },
    ],
  })
  assert.deepEqual(record.artwork, [
    { source: 'imdb', url: 'https://example.com/poster.jpg', kind: 'poster', width: 1000, height: 1500, attribution: 'IMDb' },
    { source: 'local', url: 'https://example.com/banner.jpg', kind: 'banner', width: 2000, height: 600, attribution: 'Local scan' },
  ])
})
test('artwork rejects unsafe URLs and non-object variants', () => {
  const record = createAnimeRecord({
    id: 5,
    metadataSource: 'anilist',
    artwork: [
      { source: 'imdb', url: 'javascript:alert(1)', kind: 'poster' },
      { source: 'imdb', url: 'http://example.com/cover.jpg', kind: 'poster' },
      'not-an-object',
      null,
      { source: 'imdb', url: 'https://example.com/valid.jpg', kind: 'poster', width: -10, height: null },
    ],
  })
  assert.deepEqual(record.artwork, [
    { source: 'imdb', url: 'https://example.com/valid.jpg', kind: 'poster', width: null, height: null, attribution: null },
  ])
})
test('artwork caps the number of retained variants', () => {
  const variants = Array.from({ length: 25 }, (_, i) => ({
    source: 'imdb',
    url: `https://example.com/v${i}.jpg`,
    kind: 'poster',
  }))
  const record = createAnimeRecord({ id: 6, metadataSource: 'anilist', artwork: variants })
  assert.equal(record.artwork.length, 16)
})
test('completeness score of a bare record is zero', () => {
  assert.equal(computeCompletenessScore(basic()), 0)
})
test('completeness score rejects non-record input', () => {
  assert.equal(computeCompletenessScore(null), 0)
  assert.equal(computeCompletenessScore(undefined), 0)
  assert.equal(computeCompletenessScore('not a record'), 0)
  assert.equal(computeCompletenessScore([1, 2]), 0)
})
test('completeness score grows as more fields are known', () => {
  const sparse = computeCompletenessScore(createAnimeRecord({
    id: 7,
    title: 'Cowboy Bebop',
    cover: 'https://example.com/cover.jpg',
    description: 'A space western.',
  }))
  const richer = computeCompletenessScore(createAnimeRecord({
    id: 8,
    title: 'Cowboy Bebop',
    romaji: 'Kowboy Bebop',
    english: 'Cowboy Bebop',
    cover: 'https://example.com/cover.jpg',
    banner: 'https://example.com/banner.jpg',
    description: 'A space western.',
    episodes: 26,
    status: 'FINISHED',
    format: 'TV',
    score: 87,
    genres: ['Sci-Fi', 'Action'],
    studios: ['Sunrise'],
    source: 'manga',
  }))
  assert.ok(sparse > 0)
  assert.ok(richer > sparse)
  assert.ok(richer < 100)
})
test('completeness score reaches 100 for a fully populated record', () => {
  const record = createAnimeRecord({
    id: 9,
    title: 'Fullmetal Alchemist: Brotherhood',
    romaji: 'Hagane no Renkinjutsushi: Brotherhood',
    english: 'Fullmetal Alchemist: Brotherhood',
    native: '鋼の錬金術師 FULLMETAL ALCHEMIST',
    cover: 'https://example.com/cover.jpg',
    banner: 'https://example.com/banner.jpg',
    artwork: [{ source: 'anilist', url: 'https://example.com/poster.jpg', kind: 'poster' }],
    color: '#ffffff',
    description: 'Two brothers search for the Philosopher\'s Stone.',
    episodes: 64,
    airedEpisodes: 64,
    duration: 24,
    status: 'FINISHED',
    format: 'TV',
    season: 'SPRING',
    seasonYear: 2009,
    startDate: { year: 2009, month: 4, day: 5 },
    endDate: { year: 2010, month: 7, day: 3 },
    score: 91,
    providerScores: [{ source: 'anilist', value: 91, scale: 100, normalized: 91 }],
    popularity: 95,
    favourites: 120_000,
    genres: ['Action', 'Adventure'],
    genreEntities: [],
    tags: [{ name: 'action', rank: 10, isMediaSpoiler: false }],
    source: 'manga',
    countryOfOrigin: 'JP',
    originalLanguage: 'jpn',
    ageRatings: [{ region: 'US', system: 'MPAA', rating: 'TV-14' }],
    nextEpisode: { episode: 65, airingAt: 0 },
    studios: ['Bones'],
    organizations: [{ kind: 'studio', name: 'Bones', source: 'anilist' }],
    links: [{ site: 'Official Site', url: 'https://example.com' }],
    streams: [{ site: 'Crunchyroll', url: 'https://crunchyroll.com' }],
    anidb: '1234',
    siteUrl: 'https://anilist.co/anime/9',
    metadataSource: 'anilist',
  })
  assert.equal(computeCompletenessScore(record), 100)
})
test('completeness score respects fieldMetadata valueState', () => {
  const record = createAnimeRecord({
    id: 10,
    title: 'Known Title',
    description: 'A synopsis.',
    cover: null,
  })
  const base = computeCompletenessScore(record)
  assert.equal(base, 12) // title + description -> 6/50 * 100 = 12
  // Mark description explicitly unknown: it no longer counts even though the
  // text is present.
  const withUnknown = {
    ...record,
    fieldMetadata: {
      ...record.fieldMetadata,
      description: { ...record.fieldMetadata.description, valueState: 'unknown' },
    },
  }
  assert.equal(computeCompletenessScore(withUnknown), 6) // title only -> 3/50 * 100 = 6
})
test('default start and end dates are unknown', () => {
  assert.equal(basic().startDate, null)
  assert.equal(basic().endDate, null)
})
test('default next episode', () => assert.equal(basic().nextEpisode, null))
test('FuzzyDates preserve provider precision without filling missing parts', () => {
  const record = createAnimeRecord({
    id: 25,
    startDate: { year: 2024, month: 2, day: 29 },
    endDate: { year: '2025', month: 3, day: null },
  })
  assert.deepEqual(record.startDate, { year: 2024, month: 2, day: 29 })
  assert.deepEqual(record.endDate, { year: 2025, month: 3, day: null })
})
test('invalid or impossible FuzzyDates normalize to unknown', () => {
  for (const date of [
    '2024-02-29',
    [],
    { year: 0, month: 1, day: 1 },
    { year: 2024, month: 13, day: 1 },
    { year: 2023, month: 2, day: 29 },
    { year: 2024, month: 4, day: 31 },
    { year: 2024, month: null, day: 1 },
    { year: null, month: null, day: null },
  ]) {
    assert.equal(createAnimeRecord({ id: 26, startDate: date }).startDate, null)
  }
})
test('airing timestamps remain validated Unix seconds, not milliseconds', () => {
  assert.deepEqual(createAnimeRecord({
    id: 27,
    nextEpisode: { episode: '3', airingAt: '1735689600' },
  }).nextEpisode, { episode: 3, airingAt: 1_735_689_600 })
  assert.deepEqual(createAnimeRecord({ id: 28, nextEpisode: { episode: 1, airingAt: 0 } }).nextEpisode, {
    episode: 1,
    airingAt: 0,
  })
  for (const nextEpisode of [
    { episode: 0, airingAt: 1_735_689_600 },
    { episode: 2.5, airingAt: 1_735_689_600 },
    { episode: 2, airingAt: -1 },
    { episode: 2, airingAt: 1_735_689_600_000 },
    { episode: 2, airingAt: Number.MAX_SAFE_INTEGER },
    { episode: 2 },
  ]) {
    assert.equal(createAnimeRecord({ id: 29, nextEpisode }).nextEpisode, null)
  }
})
test('default provider search flag', () => assert.equal(basic().anidbSearch, false))
test('copies genres and studios', () => { const input = { id: 1, genres: ['Action'], studios: ['Studio'] }; const record = createAnimeRecord(input); input.genres.push('Drama'); input.studios.push('Other'); assert.deepEqual(record.genres, ['Action']); assert.deepEqual(record.studios, ['Studio']) })
test('legacy studio labels stay string arrays and create deduplicated linked studio entities', () => {
  const names = ['Studio Ghibli', ' studio  ghibli ', 'Kyoto Animation']
  const record = createAnimeRecord({ id: 4, metadataSource: 'AniList', studios: names })

  assert.deepEqual(record.studios, names)
  assert.equal(record.studios.every((name) => typeof name === 'string'), true)
  assert.equal(record.organizations.length, 2)
  const ghibli = record.organizations.find((organization) => organization.name.toLowerCase() === 'studio ghibli')
  assert.ok(ghibli)
  assert.equal(ghibli.kind, 'studio')
  assert.equal(ghibli.source, 'anilist')
  assert.equal(ghibli.providerId, null)
  assert.match(ghibli.id, /^studio:name:studio-ghibli:[a-f0-9]{64}$/)
})
test('organization kinds use stable provider IDs and retain source-attributed aliases', () => {
  const record = createAnimeRecord({
    id: 5,
    metadataSource: 'AniList',
    organizations: [
      {
        kind: ' STUDIO ',
        name: 'Sample Studio',
        id: 42,
        siteUrl: 'https://studio.example/about',
        isAnimationStudio: true,
        aliases: [
          { name: 'Sample Works', source: 'MAL' },
          { name: 'Studio Alias' },
          { name: 'studio alias', source: 'AniList' },
        ],
      },
      { kind: 'studio', name: 'Sample Studio International', providerId: 42, source: 'anilist' },
      { kind: 'producer', name: 'Producer Co', providerId: 'p-1', source: 'MAL' },
      { kind: 'licensor', name: 'Licensor Co', siteUrl: 'javascript:alert(1)' },
      { kind: 'distributor', name: 'Distributor Co' },
      { kind: 'publisher', name: 'Ignored kind' },
    ],
  })

  assert.deepEqual(record.studios, ['Sample Studio'])
  assert.deepEqual(record.organizations.map((organization) => organization.kind).sort(), [
    'distributor', 'licensor', 'producer', 'studio',
  ])
  const studio = record.organizations.find((organization) => organization.kind === 'studio')
  assert.equal(studio.source, 'anilist')
  assert.equal(studio.providerId, '42')
  assert.match(studio.id, /^studio:anilist:[a-f0-9]{64}$/)
  assert.equal(studio.siteUrl, 'https://studio.example/about')
  assert.equal(studio.isAnimationStudio, true)
  assert.deepEqual(studio.aliases, [
    { name: 'Sample Studio International', source: 'anilist' },
    { name: 'Studio Alias', source: 'anilist' },
    { name: 'Sample Works', source: 'mal' },
  ])
  assert.equal(record.organizations.find((organization) => organization.kind === 'producer').providerId, 'p-1')
  const licensor = record.organizations.find((organization) => organization.kind === 'licensor')
  assert.equal(licensor.source, 'anilist')
  assert.equal(licensor.siteUrl, null)
})
test('organization names normalize Unicode equivalence without slug-collision identity loss', () => {
  const first = createAnimeRecord({
    id: 6,
    organizations: [
      { kind: 'studio', name: 'Ａｎｉｍｅ　Works' },
      { kind: 'studio', name: 'Anime Works' },
      { kind: 'producer', name: 'Sao Paulo' },
      { kind: 'producer', name: 'São Paulo' },
    ],
  })
  const second = createAnimeRecord({
    id: 7,
    organizations: [
      { kind: 'producer', name: 'São Paulo' },
      { kind: 'studio', name: 'Anime Works' },
      { kind: 'producer', name: 'Sao Paulo' },
    ],
  })
  const studios = first.organizations.filter((organization) => organization.kind === 'studio')
  const producers = first.organizations.filter((organization) => organization.kind === 'producer')

  assert.equal(studios.length, 1)
  assert.equal(studios[0].id, second.organizations.find((organization) => organization.kind === 'studio').id)
  assert.deepEqual(producers.map((organization) => organization.name).sort(), ['Sao Paulo', 'São Paulo'])
  assert.equal(new Set(producers.map((organization) => organization.id)).size, 2)
  assert.equal(producers.every((organization) => organization.id.startsWith('producer:name:sao-paulo:')), true)
})
test('copies link objects', () => { const input = { id: 1, links: [{ site: 'Example', url: 'https://example.com' }] }; const record = createAnimeRecord(input); input.links[0].site = 'changed'; assert.equal(record.links[0].site, 'Example') })
test('copies tag objects', () => { const input = { id: 1, tags: [{ name: 'Tag', rank: 80, isMediaSpoiler: false }] }; const record = createAnimeRecord(input); input.tags[0].name = 'changed'; assert.equal(record.tags[0].name, 'Tag') })
test('copies next episode', () => { const input = { id: 1, nextEpisode: { episode: 2, airingAt: 123 } }; const record = createAnimeRecord(input); input.nextEpisode.episode = 3; assert.equal(record.nextEpisode.episode, 2) })
test('does not leak provider fields or external identifiers', () => {
  const record = createAnimeRecord({ id: 1, coverImage: { large: 'x' }, averageScore: 42, externalIds: { mal: '22' } })
  assert.equal(record.averageScore, undefined)
  assert.equal(record.externalIds, undefined)
})
test('preserves independent source fields', () => { const r = createAnimeRecord({ id: 1, title: 'From another adapter', duration: 24, score: 88, countryOfOrigin: 'JP' }); assert.equal(r.title, 'From another adapter'); assert.equal(r.duration, 24); assert.equal(r.score, 88); assert.equal(r.countryOfOrigin, 'JP') })
test('AniList adapter emits canonical linked studios through the season API', async () => {
  const original = globalThis.fetch
  let requestQuery = ''
  globalThis.fetch = async (_url, init) => {
    requestQuery = JSON.parse(init.body).query
    return new Response(JSON.stringify({ data: { Page: { pageInfo: { total: 1, hasNextPage: false }, media: [{ id: 42, title: { english: 'Example', romaji: 'Rei', native: '例' }, coverImage: {}, episodes: 12, duration: 24, status: 'RELEASING', startDate: { year: 2025, month: 1, day: 2 }, endDate: { year: 2025, month: 3, day: null }, nextAiringEpisode: { episode: 13, airingAt: 1_735_689_600 }, averageScore: 80, genres: ['Drama'], countryOfOrigin: 'jp', studios: { nodes: [{ id: 1337, name: 'Studio', isAnimationStudio: true, siteUrl: 'https://studio.example/' }] }, externalLinks: [] }] } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const { getSeason } = await import('../server/anilist.mjs')
    const result = await getSeason({ season: 'WINTER', year: 2097, sort: 'popular', page: 1, perPage: 30 })
    const record = result.media[0]
    assert.equal(record.id, 42); assert.equal(record.title, 'Example'); assert.equal(record.romaji, 'Rei')
    assert.equal(record.score, 80); assert.deepEqual(record.providerScores, [{ source: 'anilist', value: 80, scale: 100, normalized: 80 }])
    assert.equal(record.duration, 24); assert.deepEqual(record.studios, ['Studio'])
    assert.deepEqual(record.startDate, { year: 2025, month: 1, day: 2 })
    assert.deepEqual(record.endDate, { year: 2025, month: 3, day: null })
    assert.deepEqual(record.nextEpisode, { episode: 13, airingAt: 1_735_689_600 })
    assert.equal(record.countryOfOrigin, 'JP')
    assert.equal(record.originalLanguage, null)
    assert.match(record.organizations[0].id, /^studio:anilist:[a-f0-9]{64}$/)
    assert.deepEqual(record.organizations, [{
      id: record.organizations[0].id,
      kind: 'studio',
      name: 'Studio',
      source: 'anilist',
      providerId: '1337',
      aliases: [],
      siteUrl: 'https://studio.example/',
      isAnimationStudio: true,
    }])
    assert.match(requestQuery, /startDate\s*\{\s*year month day\s*\}/)
    assert.match(requestQuery, /endDate\s*\{\s*year month day\s*\}/)
    assert.match(requestQuery, /nextAiringEpisode\s*\{\s*episode airingAt\s*\}/)
    assert.match(requestQuery, /studios\(isMain: true\)\s*\{\s*nodes\s*\{\s*id name isAnimationStudio siteUrl\s*\}\s*\}/)
    assert.match(requestQuery, /\baverageScore\b/)
    assert.equal(record.averageScore, undefined); assert.equal(record.coverImage, undefined)
    assert.deepEqual(Object.keys(record), Object.keys(createAnimeRecord({ id: 42 })))
  } finally { globalThis.fetch = original }
})
test('every catalog metadata field has normalized source and refresh metadata', () => {
  const bare = basic()
  const canonicalFields = Object.keys(bare).filter(
    (field) => field !== 'id' && field !== 'fieldMetadata' && field !== 'metadataSchemaVersion'
  )
  assert.deepEqual(canonicalFields.sort(), [...CATALOG_METADATA_FIELDS].sort())
  assert.deepEqual(Object.keys(bare.fieldMetadata).sort(), [...CATALOG_METADATA_FIELDS].sort())
  for (const field of CATALOG_METADATA_FIELDS) {
    const canonicalValue = bare[field]
    const expectedState =
      canonicalValue === null || canonicalValue === undefined
        ? 'unknown'
        : typeof canonicalValue === 'string' && (!canonicalValue.trim() || canonicalValue.trim().toUpperCase() === 'UNKNOWN')
          ? 'unknown'
          : field === 'title' && canonicalValue === `Anime #${bare.id}`
            ? 'unknown'
            : 'known'
    assert.deepEqual(bare.fieldMetadata[field], {
      valueState: expectedState,
      source: null,
      lastRefreshedAt: null,
      observations: [],
      conflict: false,
    })
  }

  const record = createAnimeRecord({
    id: 9,
    metadataSource: 'AniList',
    lastRefreshedAt: '2026-11-19T12:34:56+00:00',
    fieldMetadata: {
      title: { source: 'manual-editor', lastRefreshedAt: '2026-11-18T00:00:00Z' },
      description: { source: null, lastRefreshedAt: 'not-a-date' },
    },
  })
  assert.deepEqual(record.fieldMetadata.title, {
    valueState: 'unknown',
    source: 'manual-editor',
    lastRefreshedAt: '2026-11-18T00:00:00.000Z',
    observations: [],
    conflict: false,
  })
  assert.deepEqual(record.fieldMetadata.cover, {
    valueState: 'unknown',
    source: 'anilist',
    lastRefreshedAt: '2026-11-19T12:34:56.000Z',
    observations: [],
    conflict: false,
  })
  assert.deepEqual(record.fieldMetadata.description, {
    valueState: 'unknown',
    source: null,
    lastRefreshedAt: null,
    observations: [],
    conflict: false,
  })
})
test('provider disagreements retain observations without replacing the chosen canonical value', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const record = createAnimeRecord({
    id: 70,
    title: 'Selected title',
    metadataSource: 'anilist',
    lastRefreshedAt: refreshed,
    fieldMetadata: {
      title: {
        source: 'AniList',
        lastRefreshedAt: refreshed,
        observations: [
          { source: 'MAL', value: 'Alternate title', lastRefreshedAt: '2026-11-18T00:00:00Z' },
          { source: 'AniList', value: 'Selected title', lastRefreshedAt: refreshed },
        ],
      },
      unknownField: {
        source: 'unknown-provider',
        observations: [{ source: 'mal', value: 'ignored' }],
      },
    },
  })

  assert.equal(record.title, 'Selected title')
  assert.deepEqual(record.fieldMetadata.title, {
    valueState: 'known',
    source: 'anilist',
    lastRefreshedAt: refreshed,
    observations: [
      { valueState: 'known', source: 'anilist', value: 'Selected title', lastRefreshedAt: refreshed },
      { valueState: 'known', source: 'mal', value: 'Alternate title', lastRefreshedAt: '2026-11-18T00:00:00.000Z' },
    ],
    conflict: true,
  })
  assert.equal(record.fieldMetadata.unknownField, undefined)
})

test('equivalent structured values do not conflict and null observations are unknown', () => {
  const rawTags = [{ name: 'Drama', rank: 80, isMediaSpoiler: false }]
  const normalizedTags = createAnimeRecord({ id: 71, tags: rawTags }).tags
  const record = createAnimeRecord({
    id: 71,
    tags: rawTags,
    metadataSource: 'anilist',
    lastRefreshedAt: '2026-11-19T00:00:00Z',
    fieldMetadata: {
      tags: {
        source: 'anilist',
        observations: [
          { source: 'anilist', value: normalizedTags, lastRefreshedAt: '2026-11-19T00:00:00Z' },
          { source: 'mal', value: [{ ...normalizedTags[0] }], lastRefreshedAt: '2026-11-19T00:00:00Z' },
        ],
      },
      description: {
        source: null,
        observations: [
          { source: 'anilist', value: null },
          { source: 'mal', value: 'Known description' },
        ],
      },
    },
  })
  assert.equal(record.fieldMetadata.tags.conflict, false)
  assert.equal(record.fieldMetadata.description.conflict, false)
  assert.equal(record.fieldMetadata.description.source, null)
  assert.deepEqual(record.fieldMetadata.description.observations.map((item) => item.source), ['anilist', 'mal'])
})

test('same-provider timestamp ties and unknown providers resolve deterministically', () => {
  const tieTime = '2026-11-19T00:00:00Z'
  const observations = [
    { source: 'MAL', value: 'Older value', lastRefreshedAt: '2025-11-19T00:00:00Z' },
    { source: 'MAL', value: 'Zulu', lastRefreshedAt: tieTime },
    { source: 'mal', value: 'Alpha', lastRefreshedAt: tieTime },
    { source: '__proto__', value: 'unsafe', lastRefreshedAt: tieTime },
    { source: 'AniList', value: 'Provider title', lastRefreshedAt: tieTime },
  ]
  const record = createAnimeRecord({
    id: 72,
    title: 'Explicit canonical title',
    metadataSource: 'manual-editor',
    lastRefreshedAt: tieTime,
    fieldMetadata: { title: { source: 'manual-editor', observations } },
  })
  assert.equal(record.title, 'Explicit canonical title')
  assert.equal(record.fieldMetadata.title.source, 'manual-editor')
  assert.deepEqual(record.fieldMetadata.title.observations, [
    { valueState: 'known', source: 'anilist', value: 'Provider title', lastRefreshedAt: '2026-11-19T00:00:00.000Z' },
    { valueState: 'known', source: 'mal', value: 'Alpha', lastRefreshedAt: '2026-11-19T00:00:00.000Z' },
  ])
  assert.equal(record.fieldMetadata.title.conflict, true)
})
test('value state defaults to unknown for missing or placeholder canonical values', () => {
  const record = createAnimeRecord({
    id: 75,
    title: '',
    description: 'UNKNOWN',
    romaji: null,
    episodes: null,
  })
  assert.equal(record.fieldMetadata.title.valueState, 'unknown')
  assert.equal(record.fieldMetadata.description.valueState, 'unknown')
  assert.equal(record.fieldMetadata.romaji.valueState, 'unknown')
  assert.equal(record.fieldMetadata.episodes.valueState, 'unknown')
  assert.equal(record.fieldMetadata.airedEpisodes.valueState, 'known')
})

test('value state defaults to known for real values and empty collections', () => {
  const record = createAnimeRecord({
    id: 76,
    title: 'Real title',
    episodes: 12,
    duration: 24,
    genres: [],
    tags: [],
  })
  assert.equal(record.fieldMetadata.title.valueState, 'known')
  assert.equal(record.fieldMetadata.episodes.valueState, 'known')
  assert.equal(record.fieldMetadata.duration.valueState, 'known')
  assert.equal(record.fieldMetadata.genres.valueState, 'known')
  assert.equal(record.fieldMetadata.tags.valueState, 'known')
})

test('explicit unannounced and not_applicable states are authoritative', () => {
  const titleFallback = createAnimeRecord({
    id: 77,
    fieldMetadata: { title: { valueState: 'unannounced' } },
  })
  // The canonical title is the 'Anime #77' fallback, but the explicit state wins.
  assert.equal(titleFallback.fieldMetadata.title.valueState, 'unannounced')

  const notApplicable = createAnimeRecord({
    id: 78,
    duration: 24,
    fieldMetadata: { duration: { valueState: 'not_applicable' } },
  })
  assert.equal(notApplicable.fieldMetadata.duration.valueState, 'not_applicable')

  // Explicit 'known' cannot manufacture a known state for a missing value.
  const missing = createAnimeRecord({
    id: 79,
    description: null,
    fieldMetadata: { description: { valueState: 'known' } },
  })
  assert.equal(missing.fieldMetadata.description.valueState, 'unknown')

  // Garbage state strings fall back to inference.
  const garbage = createAnimeRecord({
    id: 80,
    description: null,
    fieldMetadata: { description: { valueState: 'not-a-state' } },
  })
  assert.equal(garbage.fieldMetadata.description.valueState, 'unknown')
})

test('observation value state is inferred and persisted per observation', () => {
  const record = createAnimeRecord({
    id: 81,
    title: 'Canonical title',
    metadataSource: 'anilist',
    fieldMetadata: {
      title: {
        observations: [
          { source: 'mal', value: null },
          { source: 'anidb', value: '' },
          { source: 'kitsu', value: 'UNKNOWN' },
          { source: 'anime-planet', value: 'Real alternate title' },
        ],
      },
    },
  })
  assert.deepEqual(record.fieldMetadata.title.observations.map((item) => [item.source, item.valueState]), [
    ['anidb', 'unknown'],
    ['anime-planet', 'known'],
    ['kitsu', 'unknown'],
    ['mal', 'unknown'],
  ])
})

test('unknown observations never create a conflict', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const record = createAnimeRecord({
    id: 82,
    title: 'Known title',
    metadataSource: 'anilist',
    lastRefreshedAt: refreshed,
    fieldMetadata: {
      title: {
        source: 'anilist',
        lastRefreshedAt: refreshed,
        observations: [
          { source: 'mal', value: null },
          { source: 'anidb', value: 'UNKNOWN' },
          { source: 'kitsu', value: 'A different known title' },
        ],
      },
    },
  })
  // mal and anidb are unknown and excluded; only kitsu disagrees with the canonical value.
  assert.equal(record.fieldMetadata.title.conflict, true)
})

test('not_applicable and unannounced are distinct comparable states', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const bothNotApplicable = createAnimeRecord({
    id: 83,
    duration: 24,
    fieldMetadata: {
      duration: {
        valueState: 'not_applicable',
        observations: [{ source: 'mal', value: 24, valueState: 'not_applicable' }],
      },
    },
  })
  // Identical state and value: no conflict.
  assert.equal(bothNotApplicable.fieldMetadata.duration.conflict, false)

  const stateDisagreement = createAnimeRecord({
    id: 84,
    duration: 24,
    fieldMetadata: {
      duration: {
        valueState: 'not_applicable',
        observations: [{ source: 'mal', value: 30, valueState: 'known' }],
      },
    },
  })
  // not_applicable versus a known value disagrees on the state itself.
  assert.equal(stateDisagreement.fieldMetadata.duration.conflict, true)

  const twoKnownDifferentValues = createAnimeRecord({
    id: 85,
    duration: 24,
    fieldMetadata: {
      duration: { observations: [{ source: 'mal', value: 24 }, { source: 'anidb', value: 30 }] },
    },
  })
  assert.equal(twoKnownDifferentValues.fieldMetadata.duration.conflict, true)

  // Unknown observations are excluded entirely.
  const onlyUnknown = createAnimeRecord({
    id: 86,
    duration: 24,
    fieldMetadata: {
      duration: { observations: [{ source: 'mal', value: null }, { source: 'anidb', value: 'UNKNOWN' }] },
    },
  })
  assert.equal(onlyUnknown.fieldMetadata.duration.conflict, false)
})

test('new records carry the current metadata schema version', () => {
  const record = createAnimeRecord({ id: 90 })
  assert.equal(record.metadataSchemaVersion, METADATA_SCHEMA_VERSION)
  assert.equal(METADATA_SCHEMA_VERSION, 1)
})

test('migrateMetadataSchema copies current-version records unchanged', () => {
  const record = createAnimeRecord({ id: 91, title: 'Keep' })
  const migrated = migrateMetadataSchema(record)
  assert.notStrictEqual(migrated, record)
  assert.deepEqual(migrated, record)
  assert.equal(migrated.metadataSchemaVersion, METADATA_SCHEMA_VERSION)
})

test('migrateMetadataSchema adds fieldMetadata and infers valueState for schemaless records', () => {
  const legacy = { id: 92, title: 'Legacy', description: null, episodes: 5, status: 'UNKNOWN' }
  const migrated = migrateMetadataSchema(legacy)
  assert.equal(migrated.metadataSchemaVersion, METADATA_SCHEMA_VERSION)
  assert.deepEqual(Object.keys(migrated.fieldMetadata).sort(), [...CATALOG_METADATA_FIELDS].sort())
  assert.equal(migrated.fieldMetadata.title.valueState, 'known')
  assert.equal(migrated.fieldMetadata.description.valueState, 'unknown')
  assert.equal(migrated.fieldMetadata.episodes.valueState, 'known')
  assert.deepEqual(migrated.fieldMetadata.title.observations, [])
  assert.equal(migrated.fieldMetadata.title.conflict, false)
  // Input is not mutated.
  assert.equal(legacy.metadataSchemaVersion, undefined)
  assert.equal(legacy.fieldMetadata, undefined)
})

test('migrateMetadataSchema backfills missing valueState on fields and observations', () => {
  const record = {
    id: 93,
    metadataSchemaVersion: 0,
    title: 'Backfilled',
    description: 'UNKNOWN',
    fieldMetadata: {
      title: { source: 'anilist', lastRefreshedAt: null, observations: [{ source: 'mal', value: null }], conflict: false },
      description: { valueState: 'unknown', observations: [] },
    },
  }
  const migrated = migrateMetadataSchema(record)
  assert.equal(migrated.metadataSchemaVersion, METADATA_SCHEMA_VERSION)
  assert.equal(migrated.fieldMetadata.title.valueState, 'known')
  assert.deepEqual(migrated.fieldMetadata.title.observations, [
    { valueState: 'unknown', source: 'mal', value: null },
  ])
  assert.equal(migrated.fieldMetadata.description.valueState, 'unknown')
  // Explicit existing state is preserved.
  assert.equal(migrated.fieldMetadata.title.source, 'anilist')
  // Input is not mutated.
  assert.equal(record.metadataSchemaVersion, 0)
  assert.equal(record.fieldMetadata.title.observations[0].valueState, undefined)
})

test('migrateMetadataSchema treats missing, null, and garbage versions as migratable', () => {
  const base = { id: 94, title: 'X' }
  for (const version of [undefined, null, 0, 'not-a-version', -1]) {
    const migrated = migrateMetadataSchema({ ...base, metadataSchemaVersion: version })
    assert.equal(migrated.metadataSchemaVersion, METADATA_SCHEMA_VERSION)
    assert.ok(Object.keys(migrated.fieldMetadata).length > 0)
  }
})

test('manual correction overrides canonical value while preserving provider observations', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const record = createAnimeRecord({
    id: 100,
    title: 'Wrong Title',
    metadataSource: 'anilist',
    lastRefreshedAt: refreshed,
    fieldMetadata: {
      title: {
        source: 'anilist',
        lastRefreshedAt: refreshed,
        observations: [
          { source: 'anilist', value: 'Wrong Title', lastRefreshedAt: refreshed },
          { source: 'mal', value: 'Wrong Title', lastRefreshedAt: refreshed },
        ],
      },
    },
  })

  const corrected = applyManualCorrection(record, 'title', {
    value: 'Right Title',
    correctedBy: 'user-42',
    correctedAt: '2026-11-19T13:00:00.000Z',
    reason: 'Provider title was misspelled',
  })

  // Canonical value is the correction.
  assert.equal(corrected.title, 'Right Title')
  assert.equal(record.title, 'Wrong Title') // input not mutated

  // Manual correction recorded on the field metadata.
  assert.equal(corrected.fieldMetadata.title.manualCorrection.value, 'Right Title')
  assert.equal(corrected.fieldMetadata.title.manualCorrection.correctedBy, 'user-42')
  assert.equal(corrected.fieldMetadata.title.manualCorrection.correctedAt, '2026-11-19T13:00:00.000Z')
  assert.equal(corrected.fieldMetadata.title.manualCorrection.reason, 'Provider title was misspelled')

  // Provider observations are preserved untouched.
  assert.deepEqual(corrected.fieldMetadata.title.observations, [
    { source: 'anilist', value: 'Wrong Title', lastRefreshedAt: refreshed, valueState: 'known' },
    { source: 'mal', value: 'Wrong Title', lastRefreshedAt: refreshed, valueState: 'known' },
  ])
})

test('manual correction keeps provider source metadata intact for comparison', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const record = createAnimeRecord({
    id: 101,
    title: 'Provider Title',
    description: 'Provider description',
    fieldMetadata: {
      title: {
        source: 'anilist',
        observations: [{ source: 'anilist', value: 'Provider Title', lastRefreshedAt: refreshed }],
      },
      description: {
        source: 'anilist',
        observations: [{ source: 'anilist', value: 'Provider description', lastRefreshedAt: refreshed }],
      },
    },
  })

  const corrected = applyManualCorrection(record, 'title', {
    value: 'Manual Title',
    correctedBy: 'editor',
    correctedAt: refreshed,
  })

  assert.equal(corrected.title, 'Manual Title')
  // Other fields untouched.
  assert.equal(corrected.description, 'Provider description')
  assert.equal(corrected.fieldMetadata.description.source, 'anilist')
  // Corrected field still carries the provider observation alongside.
  assert.deepEqual(corrected.fieldMetadata.title.observations.map((o) => [o.source, o.value]), [
    ['anilist', 'Provider Title'],
  ])
  // Correction conflicts with the provider value, as expected.
  assert.equal(corrected.fieldMetadata.title.conflict, true)
})

test('applyManualCorrection rejects malformed corrections and unknown fields', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const record = createAnimeRecord({ id: 102, title: 'T' })
  assert.throws(() => applyManualCorrection(record, 'title', { value: 'X' }), TypeError) // no correctedBy
  assert.throws(() => applyManualCorrection(record, 'title', { correctedBy: 'u', correctedAt: 'not-a-date' }), TypeError)
  assert.throws(() => applyManualCorrection(record, 'notAField', { value: 'X', correctedBy: 'u', correctedAt: refreshed }), TypeError)
})

test('correction passed through createFieldMetadata is stored per field', () => {
  const refreshed = '2026-11-19T12:34:56.000Z'
  const record = createAnimeRecord({
    id: 103,
    title: 'Corrected Title',
    description: 'Corrected description',
    metadataSource: 'anilist',
    lastRefreshedAt: refreshed,
    fieldMetadata: {
      title: {
        source: 'manual-editor',
        lastRefreshedAt: refreshed,
        manualCorrection: {
          value: 'Corrected Title',
          correctedBy: 'manual-editor',
          correctedAt: refreshed,
        },
        observations: [{ source: 'anilist', value: 'Provider Title', lastRefreshedAt: refreshed }],
      },
    },
  })

  assert.equal(record.fieldMetadata.title.manualCorrection.value, 'Corrected Title')
  assert.equal(record.fieldMetadata.title.source, 'manual-editor')
  // Provider observation retained so the original can be compared/restored.
  assert.deepEqual(record.fieldMetadata.title.observations.map((o) => [o.source, o.value]), [
    ['anilist', 'Provider Title'],
  ])
  // Fields without a correction have no manualCorrection block.
  assert.equal(record.fieldMetadata.description.manualCorrection, undefined)
})

test('corrected blank value is treated as unknown', () => {
  const record = createAnimeRecord({ id: 104, title: 'T' })
  const corrected = applyManualCorrection(record, 'title', {
    value: '',
    correctedBy: 'user',
    correctedAt: '2026-11-19T12:34:56.000Z',
  })
  assert.equal(corrected.title, '')
  assert.equal(corrected.fieldMetadata.title.valueState, 'unknown')
  assert.equal(corrected.fieldMetadata.title.manualCorrection.value, '')
})

test('recordRefreshStatus reports all fields fresh for a fresh record', () => {
  const now = 1_735_689_600_000
  const freshMeta = Object.fromEntries(
    CATALOG_METADATA_FIELDS.map((field) => [field, { lastRefreshedAt: now }])
  )
  const record = createAnimeRecord({ id: 1, format: 'TV', fieldMetadata: freshMeta })
  const status = recordRefreshStatus(record, now)
  assert.equal(status.needsRefresh, false)
  assert.deepEqual(status.staleFields, [])
  assert.equal(status.freshness.title, 'fresh')
  assert.equal(status.freshness.status, 'fresh')
})

test('recordRefreshStatus flags stale and never-refreshed fields', () => {
  const now = 1_735_689_600_000
  const record = createAnimeRecord({
    id: 2,
    format: 'TV',
    fieldMetadata: {
      title: { lastRefreshedAt: null },
      status: { lastRefreshedAt: now - 2 * 60 * 60 * 1000 },
      score: { lastRefreshedAt: now },
    },
  })
  const status = recordRefreshStatus(record, now)
  assert.equal(status.needsRefresh, true)
  assert.ok(status.staleFields.includes('title'))
  assert.ok(status.staleFields.includes('status'))
  assert.equal(status.freshness.title, 'never_refreshed')
  assert.equal(status.freshness.status, 'stale')
  assert.equal(status.freshness.score, 'fresh')
})

test('recordRefreshStatus uses entity-type TTLs', () => {
  const now = 1_735_689_600_000
  const oneDayAgo = now - 24 * 60 * 60 * 1000
  const meta = Object.fromEntries(
    CATALOG_METADATA_FIELDS.map((field) => [field, { lastRefreshedAt: oneDayAgo }])
  )
  const tv = recordRefreshStatus(createAnimeRecord({ id: 3, format: 'TV', fieldMetadata: meta }), now)
  // TV status TTL is 1 hour, so one day ago is stale.
  assert.ok(tv.staleFields.includes('status'))
  const movie = recordRefreshStatus(createAnimeRecord({ id: 4, format: 'Movie', fieldMetadata: meta }), now)
  // Movie status TTL is 7 days, so one day ago is fresh.
  assert.ok(!movie.staleFields.includes('status'))
})

test('recordRefreshStatus does not mutate the record', () => {
  const now = 1_735_689_600_000
  const record = createAnimeRecord({ id: 5, format: 'Movie' })
  const before = JSON.parse(JSON.stringify(record))
  recordRefreshStatus(record, now)
  assert.deepEqual(record, before)
})

test('fieldFreshness and isFieldStale agree', () => {
  const now = 1_735_689_600_000
  assert.equal(isFieldStale('title', null, 'TV'), true)
  assert.equal(isFieldStale('title', now - 1000, 'TV', now), false)
  assert.equal(fieldFreshness('title', 'not-a-date', 'TV', now), 'unknown')
})

test('refreshPolicy returns category and max age', () => {
  const policy = refreshPolicy('TV', 'nextEpisode')
  assert.equal(policy.category, 'airing')
  assert.equal(policy.maxAgeMs, 60 * 60 * 1000)
})

test('genres preserve provider labels and expose stable unique taxonomy entities', () => {
  const labels = ['Action', ' action ', 'Café', 'Cafe', '東京', 'Action!', 'Action?', '', 42]
  const first = createAnimeRecord({ id: 80, genres: labels })
  const second = createAnimeRecord({ id: 81, genres: [...labels].reverse() })
  const entities = first.genreEntities

  assert.deepEqual(first.genres, labels.slice(0, 7))
  assert.deepEqual(entities, second.genreEntities)
  assert.equal(entities.length, 6)
  assert.equal(new Set(entities.map((entry) => entry.id)).size, entities.length)
  const action = entities.find((entry) => entry.label === 'Action')
  assert.ok(action)
  assert.equal(entities.filter((entry) => entry.id === action.id).length, 1)

  const cafeEntities = entities.filter((entry) => entry.id.startsWith('genre:cafe:'))
  assert.equal(cafeEntities.length, 2)
  assert.notEqual(cafeEntities[0].id, cafeEntities[1].id)
  assert.ok(entities.find((entry) => entry.label === '東京')?.id.startsWith('genre:unicode:'))
  assert.ok(entities.every((entry) => /^genre:[a-z0-9-]+:[a-f0-9]{64}$/.test(entry.id)))
})

test('tags get stable IDs, deduplicate normalized labels, and retain rank/spoiler data', () => {
  const input = [
    { name: 'Time Travel', rank: 80, isMediaSpoiler: false },
    { name: 'time travel', rank: 92, isMediaSpoiler: true },
    { name: '東京', rank: 60, isMediaSpoiler: false },
    { name: '  ', rank: 100, isMediaSpoiler: false },
    null,
  ]
  const first = createAnimeRecord({ id: 82, tags: input })
  const second = createAnimeRecord({ id: 83, tags: [...input].reverse() })
  assert.deepEqual(first.tags, second.tags)
  assert.equal(first.tags.length, 2)
  const timeTravel = first.tags.find((tag) => tag.name === 'Time Travel')
  assert.ok(timeTravel)
  assert.match(timeTravel.id, /^tag:time-travel:[a-f0-9]{64}$/)
  assert.equal(timeTravel.rank, 92)
  assert.equal(timeTravel.isMediaSpoiler, true)
  assert.ok(first.tags.find((tag) => tag.name === '東京')?.id.startsWith('tag:unicode:'))
  assert.equal(new Set(first.tags.map((tag) => tag.id)).size, first.tags.length)
})
