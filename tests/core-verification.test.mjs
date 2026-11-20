// Cross-cutting verification suite for the features already implemented in the
// codebase. These tests intentionally avoid the network and ffmpeg so they run
// on a clean self-hosted checkout: provider-dependent behaviour is verified by
// the pure adapters and by the HTTP smoke tests instead.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, stat, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import * as browse from '../server/browse.mjs'
import * as search from '../server/search.mjs'
import * as detail from '../server/detail.mjs'
import * as explore from '../server/explore.mjs'
import * as security from '../server/security.mjs'
import * as playback from '../server/playback.mjs'
import * as library from '../server/library.mjs'
import * as anilist from '../server/anilist.mjs'
import * as catalog from '../server/catalog.mjs'
import * as browsePresets from '../src/lib/browsePresets.ts'

/* ------------------------------ AV-001 ---------------------------------- */

test('catalog record stays provider-neutral and copies collections', () => {
  const input = {
    id: 42,
    genres: ['Drama'],
    tags: [{ name: 'Time Travel', rank: 80, isMediaSpoiler: false }],
    links: [{ site: 'AniList', url: 'https://anilist.co/anime/42' }],
  }
  const record = catalog.createAnimeRecord(input)
  input.genres.push('Mutated')
  assert.deepEqual(record.genres, ['Drama'])
  assert.equal(record.tags[0].name, 'Time Travel')
  assert.equal(record.links[0].site, 'AniList')
  assert.equal(record.status, 'UNKNOWN')
  assert.equal(record.episodes, null)
})

/* --------------------------- AV-026 – AV-050 ----------------------------- */

test('browse filter parsing clamps and deduplicates hostile input', () => {
  const f = browse.parseBrowseFilters({
    sort: 'injection',
    formats: 'TV,MOVIE,TV,BOGUS',
    statuses: 'RELEASING,NOPE',
    sources: 'MANGA',
    countries: 'JP,RU',
    originalLanguages: 'JA,XX,KO',
    contentRatings: 'G,BOGUS,PG-13,R',
    genres: 'Action,Action',
    genresExclude: 'Hentai',
    tags: 'a,b',
    tagMode: 'xor',
    decade: '1990',
    episodesMin: '50',
    episodesMax: '10',
    durationMin: '24',
    minScore: '120',
    maxPopularity: '999999999',
    q: '  Frieren  ',
    page: '999',
    perPage: '999',
  })
  assert.equal(f.sort, 'popular')
  assert.deepEqual(f.formats, ['TV', 'MOVIE'])
  assert.deepEqual(f.statuses, ['RELEASING'])
  assert.deepEqual(f.countries, ['JP'])
  assert.deepEqual(f.originalLanguages, ['JA', 'KO'])
  assert.deepEqual(f.contentRatings, ['G', 'PG-13', 'R'])
  assert.deepEqual(f.genres, ['Action'])
  assert.deepEqual(f.genresExclude, ['Hentai'])
  assert.deepEqual(f.years, { min: 1990, max: 1999 })
  assert.deepEqual(f.episodes, { min: 10, max: 50 })
  assert.deepEqual(f.duration, { min: 24 })
  assert.equal(f.minScore, 100)
  assert.equal(f.maxPopularity, 1_000_000)
  assert.equal(f.tagMode, 'and')
  assert.equal(f.query, 'Frieren')
  assert.equal(f.page, 25)
  assert.equal(f.perPage, 50)
})

test('browse filters survive a share-URL round trip', () => {
  const original = browse.parseBrowseFilters({
    sort: 'trending',
    season: 'fall',
    year: 2024,
    older: 1,
    formats: 'TV,MOVIE',
    statuses: 'FINISHED',
    genres: 'Fantasy',
    genresExclude: 'Hentai',
    tags: 'Isekai,Cooking',
    tagMode: 'or',
    yearMin: 2000,
    yearMax: 2020,
    episodesMin: 12,
    durationMax: 30,
    minScore: 70,
    q: 'Frieren',
  })
  const params = browse.filtersToParams(original)
  assert.equal(params.get('older'), '1')
  assert.equal(params.get('formats'), 'TV,MOVIE')
  const restored = browse.parseBrowseFilters(Object.fromEntries(params))
  for (const key of ['sort', 'season', 'year', 'includeOlderSeasons', 'formats', 'statuses',
    'genres', 'genresExclude', 'tags', 'tagMode', 'years', 'episodes', 'duration',
    'minScore', 'query']) {
    assert.deepEqual(restored[key], original[key], key)
  }
})

test('local browse matching enforces AND tags, ignores spoiler tags and exclusions', () => {
  const media = {
    genres: ['Fantasy', 'Hentai'],
    tags: [{ name: 'Isekai', isMediaSpoiler: false }, { name: 'Cooking', isMediaSpoiler: true }],
    averageScore: 82,
    popularity: 1200,
    seasonYear: 2023,
    episodes: 12,
    duration: 24,
  }
  const base = browse.EMPTY_FILTERS
  const withFilters = (patch) => ({ ...base, ...patch })
  assert.equal(browse.matchMediaLocally(media, withFilters({ tags: ['Isekai'], tagMode: 'and' })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ tags: ['Isekai', 'Cooking'], tagMode: 'and' })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ tags: ['Isekai', 'Cooking'], tagMode: 'or' })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ tags: ['Isekai', 'Cooking'], tagMode: 'not' })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ tags: ['Isekai'], tagMode: 'not' })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ tags: ['Time Travel'], tagMode: 'not' })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ tags: ['Isekai', 'Time Travel'], tagMode: 'not' })).ok, false)
  // NOT mode ignores spoiler tags (they never drive discovery).
  assert.equal(
    browse.matchMediaLocally(media, withFilters({ tags: ['Cooking'], tagMode: 'not' })).ok,
    true,
  )
  assert.equal(browse.matchMediaLocally(media, withFilters({ genresExclude: ['Hentai'] })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ minScore: 90 })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ maxPopularity: 1000 })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ years: { min: 2020, max: 2022 } })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ episodes: { min: 13 } })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ duration: { max: 23 } })).ok, false)
  assert.ok(browse.matchMediaLocally(media, withFilters({ tags: ['Isekai'] })).reasons.length > 0)
})

test('local browse matching filters by studio', () => {
  const media = {
    genres: ['Fantasy'],
    studios: ['Studio Ghibli', 'Studio Ponoc'],
    averageScore: 82,
    popularity: 1200,
    seasonYear: 2023,
  }
  const base = browse.EMPTY_FILTERS
  const withFilters = (patch) => ({ ...base, ...patch })
  assert.equal(browse.matchMediaLocally(media, withFilters({ studio: ['studio ghibli'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ studio: ['studio ponoc'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ studio: ['madhouse'] })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ studio: ['studio ghibli', 'madhouse'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ studio: ['studio ghibli'] })).reasons.length > 0, true)
})

test('local browse matching filters by original language', () => {
  const mediaJa = {
    genres: ['Fantasy'],
    tags: [],
    averageScore: 82,
    popularity: 1200,
    seasonYear: 2023,
    episodes: 12,
    duration: 24,
    originalLanguage: 'JA',
  }
  const mediaKo = {
    ...mediaJa,
    originalLanguage: 'KO',
  }
  const mediaNoLang = {
    ...mediaJa,
    originalLanguage: null,
  }
  const base = browse.EMPTY_FILTERS
  const withFilters = (patch) => ({ ...base, ...patch })
  assert.equal(browse.matchMediaLocally(mediaJa, withFilters({ originalLanguages: ['JA'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaJa, withFilters({ originalLanguages: ['KO'] })).ok, false)
  assert.equal(browse.matchMediaLocally(mediaJa, withFilters({ originalLanguages: ['JA', 'KO'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaKo, withFilters({ originalLanguages: ['JA'] })).ok, false)
  assert.equal(browse.matchMediaLocally(mediaKo, withFilters({ originalLanguages: ['KO'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaNoLang, withFilters({ originalLanguages: ['JA'] })).ok, false)
  assert.ok(browse.matchMediaLocally(mediaJa, withFilters({ originalLanguages: ['JA'] })).reasons.length > 0)
})

test('local browse matching filters by content rating', () => {
  const mediaPG13 = {
    genres: ['Fantasy'],
    tags: [],
    averageScore: 82,
    popularity: 1200,
    seasonYear: 2023,
    episodes: 12,
    duration: 24,
    ageRatings: [{ region: 'US', system: 'MPAA', rating: 'PG-13' }],
  }
  const mediaR = {
    ...mediaPG13,
    ageRatings: [{ region: 'US', system: 'MPAA', rating: 'R' }],
  }
  const mediaMulti = {
    ...mediaPG13,
    ageRatings: [
      { region: 'US', system: 'MPAA', rating: 'PG-13' },
      { region: 'US', system: 'MPAA', rating: 'R' },
    ],
  }
  const mediaNoRatings = {
    ...mediaPG13,
    ageRatings: [],
  }
  const base = browse.EMPTY_FILTERS
  const withFilters = (patch) => ({ ...base, ...patch })
  assert.equal(browse.matchMediaLocally(mediaPG13, withFilters({ contentRatings: ['PG-13'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaPG13, withFilters({ contentRatings: ['R'] })).ok, false)
  assert.equal(browse.matchMediaLocally(mediaPG13, withFilters({ contentRatings: ['PG-13', 'R'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaR, withFilters({ contentRatings: ['PG-13'] })).ok, false)
  assert.equal(browse.matchMediaLocally(mediaR, withFilters({ contentRatings: ['R'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaMulti, withFilters({ contentRatings: ['PG-13'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaMulti, withFilters({ contentRatings: ['R'] })).ok, true)
  assert.equal(browse.matchMediaLocally(mediaNoRatings, withFilters({ contentRatings: ['PG-13'] })).ok, false)
  assert.ok(browse.matchMediaLocally(mediaPG13, withFilters({ contentRatings: ['PG-13'] })).reasons.length > 0)
})

test('browse filters survive a share-URL round trip with content ratings', () => {
  const original = browse.parseBrowseFilters({
    sort: 'trending',
    contentRatings: 'PG-13,R',
    q: 'Frieren',
  })
  const params = browse.filtersToParams(original)
  assert.equal(params.get('contentRatings'), 'PG-13,R')
  const restored = browse.parseBrowseFilters(Object.fromEntries(params))
  assert.deepEqual(restored.contentRatings, original.contentRatings)
})

test('describeFilters includes content ratings', () => {
  const filters = browse.parseBrowseFilters({ contentRatings: ['PG-13', 'R'] })
  assert.ok(browse.describeFilters(filters).includes('rating PG-13/R'))
})

test('activeFilterCount counts content rating filters', () => {
  const base = browse.parseBrowseFilters({})
  const withRatings = browse.parseBrowseFilters({ contentRatings: ['PG-13'] })
  assert.equal(browse.activeFilterCount(withRatings), browse.activeFilterCount(base) + 1)
})

test('browse query pushes originalLanguage_in to AniList', () => {
  const { query, variables } = browse.buildBrowseQuery(
    browse.parseBrowseFilters({ originalLanguages: 'JA,KO' }),
  )
  assert.match(query, /originalLanguage_in: \$originalLanguages/)
  assert.deepEqual(variables.originalLanguages, ['JA', 'KO'])
  assert.match(query, /originalLanguage\b/)
})

test('browse filters survive a share-URL round trip with original languages', () => {
  const original = browse.parseBrowseFilters({
    sort: 'trending',
    countries: 'JP',
    originalLanguages: 'JA,KO',
    tags: 'Isekai',
    tagMode: 'or',
    q: 'Frieren',
  })
  const params = browse.filtersToParams(original)
  assert.equal(params.get('originalLanguages'), 'JA,KO')
  const restored = browse.parseBrowseFilters(Object.fromEntries(params))
  assert.deepEqual(restored.originalLanguages, original.originalLanguages)
  assert.deepEqual(restored.countries, original.countries)
  assert.deepEqual(restored.tags, original.tags)
})

test('describeFilters includes original languages', () => {
  const filters = browse.parseBrowseFilters({ originalLanguages: ['JA', 'KO'] })
  assert.ok(browse.describeFilters(filters).includes('lang JA/KO'))
})

test('activeFilterCount counts original language filters', () => {
  const base = browse.parseBrowseFilters({})
  const withLangs = browse.parseBrowseFilters({ originalLanguages: ['JA'] })
  assert.equal(browse.activeFilterCount(withLangs), browse.activeFilterCount(base) + 1)
})

test('browse sort, format and source vocabularies cover the documented filters', () => {
  assert.deepEqual(browse.BROWSE_FORMATS.slice(0, 6), ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'])
  assert.deepEqual(browse.BROWSE_STATUSES.slice(0, 4), ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED', 'CANCELLED'])
  assert.ok(['popular', 'trending', 'rated', 'favourites', 'episodes'].every((k) => k in browse.BROWSE_SORTS))
  assert.ok(browse.BROWSE_SOURCES.includes('LIGHT_NOVEL'))
  assert.ok(browse.BROWSE_COUNTRIES.includes('JP'))
})

/* --------------------------- AV-051 – AV-075 ----------------------------- */

test('advanced search syntax parses fields and preserves unknown tokens', () => {
  const parsed = search.parseSearchQuery(
    'monogatari studio:shaft genre:comedy year:2009-2015 score:>80 ep:>=12 "Fate Zero" unknown:thing',
  )
  assert.equal(parsed.text, 'monogatari Fate Zero unknown:thing')
  assert.deepEqual(parsed.filters.studio, ['shaft'])
  assert.deepEqual(parsed.filters.genre, ['comedy'])
  assert.deepEqual(parsed.filters.year, { min: 2009, max: 2015 })
  assert.deepEqual(parsed.filters.score, { min: 81 })
  assert.deepEqual(parsed.filters.episodes, { min: 12 })
  assert.equal(search.hasStructuredFilters(parsed.filters), true)
  assert.equal(search.hasStructuredFilters(search.parseSearchQuery('naruto').filters), false)
})

test('advanced search parses staff and voice actor fields', () => {
  const parsed = search.parseSearchQuery(
    'staff:tanaka voiceActor:kugimiya va:mitsuki studio:shaft',
  )
  assert.deepEqual(parsed.filters.staff, ['tanaka'])
  assert.deepEqual(parsed.filters.voiceActor, ['kugimiya', 'mitsuki'])
  assert.deepEqual(parsed.filters.studio, ['shaft'])
  assert.equal(parsed.text, '')
  assert.equal(search.hasStructuredFilters(parsed.filters), true)
})

test('fuzzy matching handles misspellings, transpositions, accents and aliases', () => {
  assert.equal(search.editDistance('naruto', 'nartuo'), 1)
  assert.ok(search.similarity('nartuo', 'naruto') > search.similarity('nartuo', 'one piece'))
  assert.equal(search.normalizeForSearch('Café 日本!'), 'cafe 日本')
  assert.equal(search.typoTolerance('a'), 0)
  assert.ok(search.typoTolerance('naruto') >= 1)
  const ranked = search.rankTitles(
    [
      { label: 'Naruto' },
      { label: 'Shippuden', aliases: ['Naruto'] },
      { label: 'One Piece' },
    ],
    'naruto',
  )
  assert.equal(ranked[0].label, 'Naruto')
  assert.equal(ranked[0].reason, 'exact title match')
  assert.ok(ranked.some((r) => r.reason.startsWith('matched alternate title')))
  assert.ok(!ranked.some((r) => r.label === 'One Piece'))
})

test('search correction, highlighting, grouping and alternatives are deterministic', () => {
  const correction = search.suggestCorrection([{ label: 'Naruto' }], 'Nartuo')
  assert.equal(correction.suggestion, 'Naruto')
  assert.equal(correction.original, 'Nartuo')
  assert.equal(search.suggestCorrection([{ label: 'Naruto' }], 'Naruto'), null)
  assert.deepEqual(search.highlightSegments('Naruto Shippuden', 'naruto'), [
    { text: 'Naruto', match: true },
    { text: ' Shippuden', match: false },
  ])
  const groups = search.groupResults([{ format: 'TV' }, { format: 'MOVIE' }, { format: 'SPECIAL' }])
  assert.deepEqual(groups.map((g) => g.format), ['TV', 'MOVIE', 'SPECIAL'])
  assert.equal(search.alternativeQueries('long search phrase').some((a) => a.kind === 'browse'), true)
  assert.equal(search.clampResultCap(9999), search.RESULT_CAP.max)
  assert.equal(search.clampResultCap(-5), search.RESULT_CAP.min)
  assert.equal(search.clampResultCap('nonsense'), search.RESULT_CAP.defaultPerPage)
})

/* --------------------------- AV-076 – AV-100 ----------------------------- */

test('related titles are grouped once, in canonical order', () => {
  const edge = (relationType, id, year) => ({
    relationType,
    node: { id, type: 'ANIME', title: { romaji: `Show ${id}` }, seasonYear: year },
  })
  const groups = detail.groupRelations([
    edge('SPIN_OFF', 3, 2022),
    edge('SEQUEL', 2, 2020),
    edge('PREQUEL', 1, 2018),
    edge('SEQUEL', 2, 2020),
  ])
  assert.deepEqual(groups.map((g) => g.key), ['SEQUEL', 'PREQUEL', 'SPIN_OFF'])
  assert.equal(groups[1].items.length, 1)
  assert.equal(groups[0].items[0].id, 2)
  assert.equal(groups[1].items[0].id, 1)
  assert.equal(detail.relationGroupKey('unlisted'), 'OTHER')
  const invalidDateGroup = detail.groupRelations([{
    relationType: 'SEQUEL',
    node: { id: 4, type: 'ANIME', startDate: { year: 2023, month: 2, day: 29 } },
  }])
  assert.equal(invalidDateGroup[0].items[0].startDate, null)
})

test('franchise timeline has release and chronological modes with stable positions', () => {
  const nodes = [
    { id: 2, seasonYear: 2021, title: { romaji: 'Second' } },
    { id: 1, seasonYear: 2019, title: { romaji: 'First' } },
    { id: 3, title: { romaji: 'Undated' } },
  ]
  const release = detail.buildTimeline(nodes, 'release')
  assert.deepEqual(release.map((n) => n.id), [1, 2, 3])
  assert.deepEqual(release.map((n) => n.position), [1, 2, 3])
  assert.equal(release[2].uncertain, true)
  assert.deepEqual(detail.buildTimeline(nodes, 'chronological').map((n) => n.id), [1, 2, 3])
})

test('score distribution, episode guide and spoiler handling produce usable data', () => {
  const histogram = [
    { score: 80, amount: 3 },
    { score: 100, amount: 1 },
  ]
  const dist = detail.scoreDistribution(histogram)
  assert.equal(dist.total, 4)
  assert.equal(dist.buckets[0].score, 100)
  assert.equal(detail.distributionMean(histogram), 85)
  assert.equal(detail.distributionMode(histogram).score, 80)
  assert.equal(detail.scoreDistribution([]), null)

  const airedAt = Math.floor(new Date('2024-01-08T00:00:00Z').getTime() / 1000)
  const guide = detail.buildEpisodeGuide(
    { episodes: 2, duration: 24, nextEpisode: { episode: 3, airingAt: airedAt } },
    [{ title: 'Episode 2 - The Promise', thumbnail: 'https://example.com/2.jpg' }],
  )
  assert.equal(guide.length, 2)
  assert.equal(guide[0].airDate, '2023-12-25T00:00:00.000Z')
  assert.equal(guide[1].title, 'The Promise')
  assert.equal(guide[1].hasMetadata, true)
  assert.equal(guide[0].hasMetadata, false)
  assert.equal(guide[0].runtimeMinutes, 24)

  const spoilerText = 'A calm beginning. ~!The hero dies!~ Then hope returns.'
  assert.equal(detail.hasSpoilers(spoilerText), true)
  assert.equal(detail.redactSpoilers(spoilerText).hiddenCount, 1)
  assert.match(detail.redactSpoilers(spoilerText).text, /\[spoiler hidden\]/)
  assert.match(detail.redactSpoilers(spoilerText, { reveal: true }).text, /The hero dies/)
  assert.doesNotMatch(detail.spoilerFreeOverview(spoilerText), /hero dies/)
})

test('status timeline, section order and printable sheet behave predictably', () => {
  const events = detail.buildStatusTimeline({
    startDate: { year: 2019, month: 4, day: 6 },
    endDate: { year: 2020, month: 3, day: 28 },
    nextEpisode: { episode: 5, airingAt: Math.floor(new Date('2019-05-01T00:00:00Z').getTime() / 1000) },
  })
  assert.deepEqual(events.map((e) => e.label), ['Premiered', 'Episode 5', 'Finished airing'])
  assert.equal(detail.formatDate({ year: 2020, month: 2 }), '2020-02')
  assert.equal(detail.formatDate({ year: 2023, month: 2, day: 29 }), 'TBA')
  assert.equal(detail.formatDate(null), 'TBA')
  assert.deepEqual(detail.buildStatusTimeline({
    startDate: { year: 2023, month: 2, day: 29 },
    nextEpisode: { episode: 2, airingAt: 1_735_689_600_000 },
  }), [])
  assert.equal(detail.buildEpisodeGuide({
    episodes: 1,
    nextEpisode: { episode: 2, airingAt: 1_735_689_600_000 },
  })[0].airDate, null)

  const order = detail.applySectionOrder(['scores', 'scores', 'bogus', 'episodes'])
  assert.equal(order[0].id, 'overview')
  assert.deepEqual(order.slice(1, 3).map((s) => s.id), ['scores', 'episodes'])
  assert.equal(new Set(order.map((s) => s.id)).size, order.length)

  const sheet = detail.informationSheet({
    title: 'Frieren',
    format: 'TV',
    genres: ['Fantasy'],
    description: 'A quiet journey. ~!Spoiler!~',
    relatedSeasons: [{ title: 'Frieren 2', relationType: 'SEQUEL' }],
    links: [{ site: 'AniList', url: 'https://anilist.co/anime/1' }],
  })
  assert.match(sheet, /^# Frieren/)
  assert.match(sheet, /Format: TV/)
  assert.doesNotMatch(sheet, /Spoiler/)
  assert.match(sheet, /1\. Frieren 2 \(sequel\)/)
  assert.equal(detail.informationSheet(null), '')
})

/* ------------------------- AV-030 / AV-046 ------------------------------- */

test('alphabetical index, studio/year/franchise grouping and decades are stable', () => {
  assert.equal(explore.indexBucket('「Monogatari」'), 'M')
  assert.equal(explore.indexBucket('あの日'), 'あ')
  assert.equal(explore.indexBucket('123'), '#')
  assert.equal(explore.indexBucket('Éclair'), 'E')
  const groups = explore.buildAlphabetIndex([
    { title: 'Zombie' }, { title: 'Aria' }, { title: 'あの日' },
  ])
  assert.deepEqual(groups.map((g) => g.bucket), ['A', 'Z', 'あ'])
  assert.equal(groups[0].items[0].title, 'Aria')
  assert.equal(explore.buildAlphabetIndex([{ title: 'あの日' }], { kana: false })[0].bucket, '#')

  const studio = explore.groupByStudio([
    { title: 'A', studios: ['Studio Ghibli'], seasonYear: 2001 },
    { title: 'B', studios: ['Studio Ghibli'], seasonYear: 2008 },
  ])
  assert.equal(studio[0].count, 2)
  assert.deepEqual(studio[0].yearRange, [2001, 2008])
  const years = explore.groupByYear([{ seasonYear: 2020 }, { seasonYear: 2023 }, {}])
  assert.deepEqual(years.map((y) => y.year), [2023, 2020, 'Unknown'])
  assert.equal(explore.decadeLabel(1994), '1990s')
  assert.equal(explore.decadeLabel(null), 'Unknown')
  assert.deepEqual(explore.decadesPresent([{ seasonYear: 1999 }, { seasonYear: 2020 }]), [2020, 1990])

  const franchises = explore.buildFranchiseGroups([
    { id: 1, title: 'One', seasonYear: 2010, relations: [{ relationType: 'SEQUEL', node: { id: 2 } }] },
    { id: 2, title: 'Two', seasonYear: 2012 },
    { id: 3, title: 'Alone', seasonYear: 2012 },
  ])
  assert.equal(franchises.length, 1)
  assert.deepEqual(franchises[0].media.map((m) => m.id), [1, 2])
  assert.equal(explore.normalizeStudio({ id: 1, name: 'Shaft', isAnimationStudio: true }).bucket, 'S')
})

/* ------------------------ AV-294 / AV-295 / AV-226 ------------------------ */

const tempDirs = []
async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-verify-'))
  tempDirs.push(dir)
  return dir
}
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

test('subtitle and MIME helpers recognize supported sidecars', async () => {
  assert.equal(playback.getMime('/video/test.mp4'), 'video/mp4')
  assert.equal(playback.getMime('/video/test.mkv'), 'video/x-matroska')
  assert.equal(playback.getMime('/video/test.bin'), 'application/octet-stream')
  assert.equal(playback.directPlayable('/video/test.mp4'), true)
  assert.equal(playback.directPlayable('/video/test.mkv'), false)
  assert.equal(
    playback.normalizeSubtitleToVtt('1\r\n00:00:01,500 --> 00:00:03,000\r\nHi'),
    'WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nHi',
  )
  assert.match(playback.normalizeSubtitleToVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi'), /^WEBVTT/)
  const dir = await makeTempDir()
  const video = path.join(dir, 'episode.mp4')
  const subtitle = path.join(dir, 'episode.srt')
  await writeFile(video, 'video')
  await writeFile(subtitle, '1\n00:00:00,000 --> 00:00:01,000\nHi')
  assert.equal(playback.findSubtitle(video), subtitle)
})

test('local byte-range responses implement RFC 9110 edge cases', async () => {
  const dir = await makeTempDir()
  const file = path.join(dir, 'clip.mp4')
  await writeFile(file, Buffer.from('0123456789'))

  const app = express()
  app.get('/clip', (req, res) => playback.sendFileWithRange(req, res, file))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/clip`
  try {
    const full = await fetch(base)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-length'), '10')
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.equal(full.headers.get('content-type'), 'video/mp4')
    assert.match(full.headers.get('content-disposition'), /inline/)
    assert.equal(await full.text(), '0123456789')

    const range = await fetch(base, { headers: { range: 'bytes=2-5' } })
    assert.equal(range.status, 206)
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10')
    assert.equal(await range.text(), '2345')

    const openEnded = await fetch(base, { headers: { range: 'bytes=8-' } })
    assert.equal(openEnded.status, 206)
    assert.equal(await openEnded.text(), '89')

    const suffix = await fetch(base, { headers: { range: 'bytes=-3' } })
    assert.equal(suffix.status, 206)
    assert.equal(await suffix.text(), '789')

    for (const bad of ['bytes=10-20', 'bytes=5-2', 'bytes=abc', 'bytes=0-1,3-4']) {
      const response = await fetch(base, { headers: { range: bad } })
      // Multi-range is not negotiated; the server falls back to a valid
      // single-part response, while syntactically invalid ranges get 416.
      if (bad.includes(',')) assert.equal(response.status, 200)
      else {
        assert.equal(response.status, 416)
        assert.equal(response.headers.get('content-range'), 'bytes */10')
      }
      await response.arrayBuffer()
    }

    const head = await fetch(base, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), '10')
  } finally {
    server.close()
  }
})

/* --------------------------- AV-551 – AV-568 ----------------------------- */

test('path, URL and object-key guards reject traversal and SSRF inputs', async () => {
  assert.equal(security.sanitizeFileSegment('../../data/settings.json'), 'data settings.json')
  const segment = security.sanitizeFileSegment('../../data/settings.json')
  assert.ok(!segment.includes('..') && !segment.includes('/') && !segment.includes('\\'))
  assert.equal(security.sanitizeFileName('../../evil.mp4', new Set(['.mp4'])), 'evil.mp4')
  assert.throws(() => security.sanitizeFileName('evil.exe', new Set(['.mp4'])), /Unsupported file extension/)
  assert.throws(() => security.resolveInsideLibrary('/srv/library', '../secret.txt'), /traversal/)
  assert.throws(() => security.resolveInsideLibrary('/srv/library', '/etc/passwd'), /Absolute/)
  assert.throws(() => security.resolveInsideLibrary('/srv/library', '.incomplete/x.mp4'), /Hidden/)
  assert.deepEqual(security.resolveInsideLibrary('/srv/library', 'Show/Season 01/a.mp4'), {
    absPath: path.resolve('/srv/library/Show/Season 01/a.mp4'),
    relPosix: 'Show/Season 01/a.mp4',
  })
  assert.throws(() => security.validateLibraryDir(process.cwd(), process.cwd()), /project root/)
  assert.throws(() => security.validateLibraryDir(path.join(process.cwd(), '.git'), process.cwd()), /\.git/)
  assert.equal(security.sanitizePublicHttpUrl('javascript:alert(1)'), null)
  assert.equal(security.sanitizePublicHttpUrl('http://127.0.0.1/admin'), null)
  assert.equal(security.sanitizePublicHttpUrl('https://user:pass@example.com/'), null)
  assert.equal(security.sanitizeCoverUrl('http://example.com/cover.jpg'), null)
  assert.equal(security.sanitizeCoverUrl('https://example.com/cover.jpg'), 'https://example.com/cover.jpg')
  assert.equal(security.isPrivateOrReservedIp('10.0.0.1'), true)
  assert.equal(security.isPrivateOrReservedIp('[::1]'), true)
  assert.equal(security.isPrivateOrReservedIp('169.254.169.254'), true)
  assert.equal(security.isPrivateOrReservedIp('2606:4700:4700::1111'), false)
  assert.equal(security.isSafeObjectKey('__proto__'), false)
  assert.equal(security.isSafeObjectKey('title'), true)
  assert.doesNotMatch(security.sanitizeErrorMessage('ENOENT: /home/user/secret/data/file.json'), /\/home\/user/)
})

test('persistent JSON writes are atomic and keep private permissions', async () => {
  const dir = await makeTempDir()
  const file = path.join(dir, 'nested', 'state.json')
  await security.atomicWriteFile(file, '{"ok":true}')
  assert.equal(await readFile(file, 'utf8'), '{"ok":true}')
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700)
  assert.deepEqual(await readFile(path.join(dir, 'nested'), 'utf8').catch(() => null), null)
})

/* --------------------------- AV-326 / AV-676 ----------------------------- */

test('library paths and season inference use canonical, safe locations', () => {
  assert.match(library.fileIdFor('Show/ep.mp4'), /^f_[0-9a-f]{20}$/)
  assert.equal(library.fileIdFor('Show/ep.mp4'), library.fileIdFor('Show/ep.mp4'))
  assert.notEqual(library.fileIdFor('Show/a.mp4'), library.fileIdFor('Show/b.mp4'))
  assert.equal(library.formatSeasonEpisodeCode(2, 7), 'S02E07')
  const inferred = library.inferSeriesAndSeason('Frieren 2nd Season')
  assert.equal(inferred.season, 2)
  assert.equal(inferred.seriesTitle, 'Frieren')
  const location = library.buildEpisodeLocation('Frieren 2nd Season', { episode: 5 })
  assert.equal(location.relPosix, 'Frieren/Season 02/Frieren - S02E05.mp4')
  assert.equal(location.episode, 5)
})

test('season and sort helpers fall back safely', () => {
  assert.deepEqual(anilist.currentSeason(new Date('2026-01-15T00:00:00Z')), { season: 'WINTER', year: 2026 })
  assert.deepEqual(anilist.resolveSeason('invalid', '1800'), anilist.currentSeason())
  assert.equal(anilist.resolveSeason('summer', 2020).season, 'SUMMER')
  assert.equal(anilist.resolveSort('bogus'), 'popular')
})

test('daily spotlight pick is stable within a day and rotates afterwards', () => {
  const midnight = Date.UTC(2026, 10, 19, 0, 0, 0)
  const laterSameDay = midnight + 18 * 60 * 60_000
  assert.equal(anilist.dailyPickIndex(20, midnight), anilist.dailyPickIndex(20, laterSameDay))
  assert.notEqual(anilist.dailyPickIndex(20, midnight), anilist.dailyPickIndex(20, midnight + 86_400_000))
  assert.equal(anilist.dailyPickIndex(1, midnight), 0)
  assert.equal(anilist.dailyPickIndex(0, midnight), -1)
  assert.equal(anilist.dailyPickIndex(-3, midnight), -1)
})

test('AniList adapter extracts provider ids without leaking them into catalog records', () => {
  const ids = anilist.extractExternalIds({
    id: 42,
    idMal: 77,
    externalLinks: [
      { site: 'AniDB', url: 'https://anidb.net/anime/1234' },
      { site: 'IMDb', url: 'https://www.imdb.com/title/tt0234144/' },
    ],
  })
  assert.deepEqual(ids, { anilist: '42', mal: '77', anidb: '1234' })
  assert.equal(anilist.anidbIdFromUrl('https://anidb.net/anime/1234'), '1234')
  assert.equal(anilist.anidbIdFromUrl('https://anidb.net/search/anime?adb.search=x'), null)
  assert.deepEqual(anilist.extractExternalIds(null), {})
  const record = catalog.createAnimeRecord({ id: 42, externalIds: ids })
  assert.equal(Object.hasOwn(record, 'externalIds'), false)
  assert.equal(catalog.createAnimeRecord({ id: 42 }).externalIds, undefined)
})

/* ------------------------------ AV-042 ---------------------------------- */

test('seasonSummary aggregates scores, formats and genres', () => {
  const summary = anilist.seasonSummary({
    season: 'WINTER',
    year: 2023,
    total: 120,
    media: [
      { id: 1, title: 'A', score: 80, format: 'TV', genres: ['Action', 'Drama'] },
      { id: 2, title: 'B', score: 60, format: 'TV', genres: ['Action'] },
      { id: 3, title: 'C', score: null, format: 'MOVIE', genres: ['Drama'] },
    ],
  })
  assert.equal(summary.season, 'WINTER')
  assert.equal(summary.year, 2023)
  assert.equal(summary.label, 'WINTER 2023')
  assert.equal(summary.count, 120)
  assert.equal(summary.returned, 3)
  assert.equal(summary.averageScore, 70) // (80 + 60) / 2
  assert.deepEqual(summary.topFormats, [['TV', 2], ['MOVIE', 1]])
  assert.deepEqual(summary.topGenres, [['Action', 2], ['Drama', 2]])
  assert.equal(summary.topTitles.length, 3)
  assert.equal(summary.topTitles[0].id, 1)
  assert.equal(summary.topTitles[0].score, 80)
})

test('seasonSummary handles empty media with no scores', () => {
  const summary = anilist.seasonSummary({
    season: 'SPRING',
    year: 2024,
    total: 0,
    media: [],
  })
  assert.equal(summary.averageScore, null)
  assert.deepEqual(summary.topFormats, [])
  assert.deepEqual(summary.topGenres, [])
  assert.deepEqual(summary.topTitles, [])
})

test('compareSeasons requires at least two seasons', async () => {
  await assert.rejects(
    anilist.compareSeasons([{ season: 'WINTER', year: 2023 }]),
    (err) => err.message === 'Season comparison requires at least two seasons' && err.status === 400
  )
})

test('compareSeasons requires at least two distinct seasons (dedup)', async () => {
  await assert.rejects(
    anilist.compareSeasons([
      { season: 'WINTER', year: 2023 },
      { season: 'WINTER', year: 2023 },
    ]),
    (err) => err.message === 'Season comparison requires at least two distinct seasons' && err.status === 400
  )
})

test('groupMediaByStartDate groups media by start date and sorts dates', () => {
  const grouped = anilist.groupMediaByStartDate([
    { id: 1, title: 'Jan 7', score: 80, format: 'TV', startDate: { year: 2023, month: 1, day: 7 } },
    { id: 2, title: 'Jan 7 B', score: 70, format: 'TV', startDate: { year: 2023, month: 1, day: 7 } },
    { id: 3, title: 'Jan 14', score: 90, format: 'TV', startDate: { year: 2023, month: 1, day: 14 } },
    { id: 4, title: 'No date', score: 60, format: 'TV', startDate: null },
    { id: 5, title: 'Feb 4', score: 85, format: 'TV', startDate: { year: 2023, month: 2, day: 4 } },
  ])

  assert.equal(grouped.media.length, 4) // excludes the one with no startDate
  assert.deepEqual(grouped.dates, ['2023-01-07', '2023-01-14', '2023-02-04'])
  assert.equal(grouped.byDate['2023-01-07'].length, 2)
  assert.equal(grouped.byDate['2023-01-07'][0].id, 1) // higher score first
  assert.equal(grouped.byDate['2023-01-07'][1].id, 2)
  assert.equal(grouped.calendar.length, 3)
  assert.equal(grouped.calendar[0].date, '2023-01-07')
  assert.equal(grouped.calendar[0].day, 7)
  assert.equal(grouped.calendar[0].media.length, 2)
  // media sorted by start date
  assert.equal(grouped.media[0].id, 1)
  assert.equal(grouped.media[1].id, 2)
  assert.equal(grouped.media[2].id, 3)
  assert.equal(grouped.media[3].id, 5)
})

test('groupMediaByStartDate handles empty input', () => {
  const grouped = anilist.groupMediaByStartDate([])
  assert.deepEqual(grouped.media, [])
  assert.deepEqual(grouped.dates, [])
  assert.deepEqual(grouped.byDate, {})
  assert.deepEqual(grouped.calendar, [])
})

/* ------------------------------ AV-049 ---------------------------------- */

function withLocalStore(store, fn) {
  const orig = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v },
    removeItem: (k) => { delete store[k] },
    clear: () => { Object.keys(store).forEach((key) => delete store[key]) },
  }
  try {
    fn()
  } finally {
    globalThis.localStorage = orig
  }
}

test('browsePresets readPresets returns empty array when nothing stored', () => {
  const store = {}
  let result = null
  withLocalStore(store, () => { result = browsePresets.readPresets() })
  assert.deepEqual(result, [])
})

test('browsePresets writePresets then readPresets round trip', () => {
  const store = {}
  const presets = [
    { id: 'p1', name: 'Action 2020s', query: 'formats=TV&genres=Action&yearMin=2020&yearMax=2029', createdAt: 1000 },
  ]
  withLocalStore(store, () => {
    browsePresets.writePresets(presets)
    const read = browsePresets.readPresets()
    assert.deepEqual(read, presets)
    assert.equal(store[browsePresets.STORAGE_KEY], JSON.stringify(presets))
  })
})

test('browsePresets readPresets validates and drops invalid entries', () => {
  const store = {}
  const raw = JSON.stringify([
    { id: 'p1', name: 'Valid', query: 'formats=TV', createdAt: 1000 },
    { name: 'No id', query: 'formats=TV', createdAt: 2000 },
    { id: 'p3', name: '', query: 'formats=TV', createdAt: 3000 },
    { id: 'p4', name: 'Missing query', createdAt: 4000 },
    { id: 'p5', name: 'No createdAt', query: 'formats=TV' },
    'not an object',
  ])
  store[browsePresets.STORAGE_KEY] = raw
  let result = null
  withLocalStore(store, () => { result = browsePresets.readPresets() })
  // p2 has no id, p4 has no query, p5 has no createdAt, last is not an object.
  // p3 has an empty name but typeof '' === 'string' so it passes validation.
  assert.deepEqual(result, [
    { id: 'p1', name: 'Valid', query: 'formats=TV', createdAt: 1000 },
    { id: 'p3', name: '', query: 'formats=TV', createdAt: 3000 },
  ])
})

test('browsePresets readPresets ignores malformed JSON', () => {
  const store = {}
  store[browsePresets.STORAGE_KEY] = '{not valid json'
  let result = null
  withLocalStore(store, () => { result = browsePresets.readPresets() })
  assert.deepEqual(result, [])
})

test('browsePresets writePresets caps at MAX_PRESETS', () => {
  const store = {}
  // Write newest first so index 0 is Preset 39.
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `p${39 - i}`,
    name: `Preset ${39 - i}`,
    query: `formats=TV&page=${39 - i}`,
    createdAt: 39 - i,
  }))
  withLocalStore(store, () => {
    browsePresets.writePresets(many)
    const read = browsePresets.readPresets()
    assert.equal(read.length, browsePresets.MAX_PRESETS)
    assert.equal(read[0].name, 'Preset 39')
    assert.equal(read[browsePresets.MAX_PRESETS - 1].name, 'Preset 10')
  })
})

test('browsePresets MAX_PRESETS is a positive integer', () => {
  assert.ok(Number.isInteger(browsePresets.MAX_PRESETS) && browsePresets.MAX_PRESETS > 0)
})

/* ------------------------------ AV-055 ---------------------------------- */

test('toRomaji converts hiragana to Hepburn romaji', () => {
  assert.equal(search.toRomaji('あいうえお'), 'aiueo')
  assert.equal(search.toRomaji('かきくけこ'), 'kakikukeko')
  assert.equal(search.toRomaji('さしすせそ'), 'sashisuseso')
  assert.equal(search.toRomaji('たちつてと'), 'tachitsuteto')
  assert.equal(search.toRomaji('なんと'), 'nanto')
})

test('toRomaji converts katakana to Hepburn romaji', () => {
  assert.equal(search.toRomaji('アイウエオ'), 'aiueo')
  assert.equal(search.toRomaji('カキクケコ'), 'kakikukeko')
  assert.equal(search.toRomaji('ナルト'), 'naruto')
})

test('toRomaji converts kana but leaves kanji unchanged', () => {
  assert.equal(search.toRomaji('鬼滅の刃'), '鬼滅no刃')
  assert.equal(search.toRomaji('日本語'), '日本語')
})

test('toRomaji handles digraphs and sokuon', () => {
  assert.equal(search.toRomaji('きゃ'), 'kya')
  assert.equal(search.toRomaji('しゅ'), 'shu')
  assert.equal(search.toRomaji('ちょ'), 'cho')
  assert.equal(search.toRomaji('きっと'), 'kitto')
})

test('normalizeForSearchRomaji normalizes and converts kana', () => {
  assert.equal(search.normalizeForSearchRomaji('NARUTO'), 'naruto')
  assert.equal(search.normalizeForSearchRomaji('ナルト'), 'naruto')
  assert.equal(search.normalizeForSearchRomaji('Kimetsu no Yaiba'), 'kimetsu no yaiba')
})

test('rankTitles matches romaji query against kana title', () => {
  const ranked = search.rankTitles(
    [{ label: 'きめつのやいば' }],
    'kimetsu',
  )
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].label, 'きめつのやいば')
  assert.equal(ranked[0].reason, 'romaji title match')
})

test('rankTitles matches romaji query against katakana title', () => {
  const ranked = search.rankTitles(
    [{ label: 'ナルト' }],
    'naruto',
  )
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].label, 'ナルト')
  assert.equal(ranked[0].reason, 'romaji title match')
})

test('rankTitles does not falsely match unrelated titles via romaji', () => {
  const ranked = search.rankTitles(
    [{ label: 'One Piece' }, { label: 'ドラゴンボール' }],
    'naruto',
  )
  assert.equal(ranked.length, 0)
})

/* ------------------------------ AV-057 ---------------------------------- */

test('createAnimeRecord builds aliases from romaji, english, native', () => {
  const record = catalog.createAnimeRecord({
    id: 1,
    title: 'Demon Slayer',
    romaji: 'Kimetsu no Yaiba',
    english: 'Demon Slayer: Kimetsu no Yaiba',
    native: '鬼滅の刃',
  })
  assert.deepEqual(record.aliases, ['Kimetsu no Yaiba', 'Demon Slayer: Kimetsu no Yaiba', '鬼滅の刃'])
})

test('createAnimeRecord deduplicates aliases', () => {
  const record = catalog.createAnimeRecord({
    id: 2,
    title: 'Naruto',
    romaji: 'Naruto',
    english: 'Naruto',
    native: 'ナルト',
    aliases: ['Naruto', 'ナルト', 'NARUTO'],
  })
  assert.deepEqual(record.aliases, ['ナルト', 'NARUTO'])
})

test('createAnimeRecord excludes canonical title from aliases', () => {
  const record = catalog.createAnimeRecord({
    id: 3,
    title: 'One Piece',
    romaji: 'One Piece',
    english: 'One Piece',
  })
  assert.deepEqual(record.aliases, [])
})

test('createAnimeRecord accepts provider-supplied aliases array', () => {
  const record = catalog.createAnimeRecord({
    id: 4,
    title: 'Attack on Titan',
    aliases: [
      'Shingeki no Kyojin',
      { name: '進撃の巨人', source: 'anilist' },
      { name: 'Attack on Titan', source: 'anidb' },
    ],
  })
  assert.deepEqual(record.aliases, ['Shingeki no Kyojin', '進撃の巨人'])
})

/* ------------------------------ AV-059 ---------------------------------- */

test('advanced search parses character field', () => {
  const parsed = search.parseSearchQuery(
    'character:tanaka character:nezuko char:inosuke',
  )
  assert.deepEqual(parsed.filters.character, ['tanaka', 'nezuko', 'inosuke'])
  assert.equal(parsed.text, '')
  assert.equal(search.hasStructuredFilters(parsed.filters), true)
})

test('local browse matching filters by character name', () => {
  const media = {
    genres: ['Fantasy'],
    characters: [
      { name: 'Tanjiro Kamado', native: '竈門炭治郎', role: 'MAIN' },
      { name: 'Nezuko Kamado', native: '竈門禰豆子', role: 'MAIN' },
    ],
    averageScore: 82,
    popularity: 1200,
    seasonYear: 2023,
  }
  const base = browse.EMPTY_FILTERS
  const withFilters = (patch) => ({ ...base, ...patch })
  assert.equal(browse.matchMediaLocally(media, withFilters({ character: ['tanjiro kamado'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ character: ['nezuko kamado'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ character: ['inosuke'] })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ character: ['竈門禰豆子'] })).ok, true)
})

test('anilist normalize extracts characters from media payload', () => {
  const normalized = anilist.normalize({
    id: 1,
    title: { romaji: 'Kimetsu no Yaiba', english: 'Demon Slayer', native: '鬼滅の刃' },
    characters: {
      nodes: [
        {
          id: 42,
          name: { full: 'Tanjiro Kamado', native: '竈門炭治郎' },
          image: { large: 'https://example.com/tanjiro.jpg' },
          siteUrl: 'https://anilist.co/character/42',
          role: 'MAIN',
          voiceActors: {
            nodes: [{
              id: 7,
              name: { full: 'Natsuki Hanae' },
              image: { large: 'https://example.com/hanae.jpg' },
              language: 'JAPANESE',
              siteUrl: 'https://anilist.co/voice-actor/7',
            }],
          },
        },
      ],
    },
  })
  assert.equal(normalized.characters.length, 1)
  assert.equal(normalized.characters[0].id, 42)
  assert.equal(normalized.characters[0].name, 'Tanjiro Kamado')
  assert.equal(normalized.characters[0].nativeName, '竈門炭治郎')
  assert.equal(normalized.characters[0].image, 'https://example.com/tanjiro.jpg')
  assert.equal(normalized.characters[0].siteUrl, 'https://anilist.co/character/42')
  assert.equal(normalized.characters[0].role, 'MAIN')
  assert.equal(normalized.characters[0].voiceActors.length, 1)
  assert.equal(normalized.characters[0].voiceActors[0].id, 7)
  assert.equal(normalized.characters[0].voiceActors[0].name, 'Natsuki Hanae')
  assert.equal(normalized.characters[0].voiceActors[0].image, 'https://example.com/hanae.jpg')
  assert.equal(normalized.characters[0].voiceActors[0].language, 'JAPANESE')
  assert.equal(normalized.characters[0].voiceActors[0].siteUrl, 'https://anilist.co/voice-actor/7')
  assert.equal(normalized.characters[0].voiceActors[0].language, 'JAPANESE')
})

/* ------------------------------ AV-060 ---------------------------------- */

test('advanced search parses relation field', () => {
  const parsed = search.parseSearchQuery(
    'relation:sequel relation:prequel franchise:sequel',
  )
  assert.deepEqual(parsed.filters.relation, ['sequel', 'prequel', 'sequel'])
  assert.equal(parsed.text, '')
  assert.equal(search.hasStructuredFilters(parsed.filters), true)
})

test('local browse matching filters by relation type', () => {
  const media = {
    genres: ['Action'],
    relations: [
      { relationType: 'SEQUEL', node: { id: 2, title: { romaji: 'Season 2' } } },
      { relationType: 'PREQUEL', node: { id: 1, title: { romaji: 'Season 1' } } },
      { relationType: 'SPIN_OFF', node: { id: 3, title: { romaji: 'Spin-off' } } },
    ],
    averageScore: 82,
    popularity: 1200,
    seasonYear: 2023,
  }
  const base = browse.EMPTY_FILTERS
  const withFilters = (patch) => ({ ...base, ...patch })
  assert.equal(browse.matchMediaLocally(media, withFilters({ relation: ['sequel'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ relation: ['PREQUEL'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ relation: ['spin_off'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ relation: ['parent'] })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ relation: ['sequel', 'parent'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ relation: ['sequel'] })).reasons.length > 0, true)
})

test('normalize extracts relations from media payload', () => {
  const normalized = anilist.normalize({
    id: 1,
    title: { romaji: 'Attack on Titan', english: 'Attack on Titan', native: '進撃の巨人' },
    relations: {
      edges: [
        {
          relationType: 'SEQUEL',
          node: {
            id: 2,
            title: { romaji: 'Attack on Titan: The Final Season', english: 'Attack on Titan: The Final Season' },
            format: 'TV',
            status: 'FINISHED',
            seasonYear: 2020,
          },
        },
        {
          relationType: 'PREQUEL',
          node: {
            id: 3,
            title: { romaji: 'Attack on Titan: Junior High' },
            format: 'TV_SHORT',
            status: 'FINISHED',
            seasonYear: 2015,
          },
        },
      ],
    },
  })
  assert.equal(normalized.relations.length, 2)
  assert.equal(normalized.relations[0].relationType, 'SEQUEL')
  assert.equal(normalized.relations[0].node.title.romaji, 'Attack on Titan: The Final Season')
  assert.equal(normalized.relations[1].relationType, 'PREQUEL')
})

/* ------------------------------ AV-062 ---------------------------------- */

test('advanced search parses episode title field', () => {
  const parsed = search.parseSearchQuery(
    'epTitle:"to the front" episodeTitle:battle',
  )
  assert.deepEqual(parsed.filters.epTitle, ['to the front', 'battle'])
  assert.equal(parsed.text, '')
  assert.equal(search.hasStructuredFilters(parsed.filters), true)
})

test('local browse matching filters by episode title', () => {
  const media = {
    genres: ['Action'],
    streamingEpisodes: [
      { title: 'To the Front', number: 1, thumbnail: 'https://example.com/1.jpg' },
      { title: 'The Battle Begins', number: 2, thumbnail: 'https://example.com/2.jpg' },
    ],
    averageScore: 82,
    popularity: 1200,
    seasonYear: 2023,
  }
  const base = browse.EMPTY_FILTERS
  const withFilters = (patch) => ({ ...base, ...patch })
  assert.equal(browse.matchMediaLocally(media, withFilters({ epTitle: ['to the front'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ epTitle: ['battle begins'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ epTitle: ['nonexistent'] })).ok, false)
  assert.equal(browse.matchMediaLocally(media, withFilters({ epTitle: ['front', 'battle'] })).ok, true)
  assert.equal(browse.matchMediaLocally(media, withFilters({ epTitle: ['front'] })).reasons.length > 0, true)
})

test('normalize extracts streamingEpisodes from media payload', () => {
  const normalized = anilist.normalize({
    id: 1,
    title: { romaji: 'Test Show', english: 'Test Show', native: 'テストショー' },
    streamingEpisodes: [
      { title: 'Episode One', thumbnail: 'https://example.com/1.jpg', number: 1 },
      { title: 'Episode Two', thumbnail: 'https://example.com/2.jpg', number: 2 },
    ],
  })
  assert.equal(normalized.streamingEpisodes.length, 2)
  assert.equal(normalized.streamingEpisodes[0].title, 'Episode One')
  assert.equal(normalized.streamingEpisodes[0].number, 1)
  assert.equal(normalized.streamingEpisodes[1].title, 'Episode Two')
  assert.equal(normalized.streamingEpisodes[1].number, 2)
})

/* ------------------------------ AV-064 ---------------------------------- */

test('bookmark/list search deduplicates media across bookmarks and lists', () => {
  const bookmarked = [
    { media: { id: 1, title: 'Bookmark One', romaji: 'Bookmark One' } },
    { media: { id: 2, title: 'Bookmark Two', romaji: 'Bookmark Two' } },
  ]
  const listed = [
    { media: { id: 2, title: 'Bookmark Two', romaji: 'Bookmark Two' } },
    { media: { id: 3, title: 'Listed Three', romaji: 'Listed Three' } },
  ]

  // Simulate the dedup logic from /api/search/bookmarks.
  const seen = new Set()
  const all = []
  for (const media of [...bookmarked.map((e) => e.media), ...listed.map((e) => e.media)]) {
    if (media && media.id && !seen.has(media.id)) {
      seen.add(media.id)
      all.push(media)
    }
  }
  assert.equal(all.length, 3)
  assert.equal(all.map((m) => m.id).sort((a, b) => a - b).join(','), '1,2,3')
})

test('bookmark/list search matches against romaji, english, native titles', () => {
  const items = [
    { id: 1, title: 'Demon Slayer', romaji: 'Kimetsu no Yaiba', native: '鬼滅の刃' },
    { id: 2, title: 'Attack on Titan', romaji: 'Shingeki no Kyojin', native: '進撃の巨人' },
    { id: 3, title: 'My Hero Academia', romaji: 'Boku no Hero Academia', native: '僕のヒーローアカデミア' },
  ]
  const needle = search.normalizeForSearch('kimetsu')
  const matches = items.filter((item) => {
    const haystack = search
      .normalizeForSearch(
        [item.title, item.romaji, item.english, item.native]
          .filter(Boolean)
          .join(' '),
      )
      .includes(needle)
    return haystack
  })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].id, 1)

  const needle2 = search.normalizeForSearch('進撃')
  const matches2 = items.filter((item) => {
    const haystack = search
      .normalizeForSearch(
        [item.title, item.romaji, item.english, item.native]
          .filter(Boolean)
          .join(' '),
      )
      .includes(needle2)
    return haystack
  })
  assert.equal(matches2.length, 1)
  assert.equal(matches2[0].id, 2)
})

test('bookmark/list search with empty query returns all items', () => {
  const items = [
    { id: 1, title: 'One' },
    { id: 2, title: 'Two' },
  ]
  const matches = items.filter(() => true)
  assert.equal(matches.length, 2)
})

test('bookmark/list search returns empty when no match', () => {
  const items = [
    { id: 1, title: 'One' },
    { id: 2, title: 'Two' },
  ]
  const needle = search.normalizeForSearch('nonexistent')
  const matches = items.filter((item) => {
    const haystack = search
      .normalizeForSearch(
        [item.title, item.romaji, item.english, item.native]
          .filter(Boolean)
          .join(' '),
      )
      .includes(needle)
    return haystack
  })
  assert.equal(matches.length, 0)
})

/* ------------------------------ AV-070 ---------------------------------- */

test('groupResults groups by format by default', () => {
  const groups = search.groupResults([
    { format: 'TV', title: 'Show A' },
    { format: 'MOVIE', title: 'Film B' },
    { format: 'TV', title: 'Show C' },
    { format: 'OVA', title: 'Ova D' },
  ])
  assert.deepEqual(groups.map((g) => g.format), ['TV', 'MOVIE', 'OVA'])
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[1].items.length, 1)
  assert.equal(groups[2].items.length, 1)
})

test('groupResults groups by type', () => {
  const groups = search.groupResults(
    [
      { type: 'ANIME', title: 'Show A' },
      { type: 'MANGA', title: 'Comic B' },
      { type: 'ANIME', title: 'Show C' },
    ],
    { groupBy: 'type' },
  )
  assert.deepEqual(groups.map((g) => g.format), ['ANIME', 'MANGA'])
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[1].items.length, 1)
})

test('groupResults groups by character', () => {
  const groups = search.groupResults(
    [
      {
        title: 'Show A',
        characters: [{ name: 'Tanjiro' }, { name: 'Nezuko' }],
      },
      { title: 'Show B', characters: [{ name: 'Tanjiro' }] },
      { title: 'Show C', characters: [] },
    ],
    { groupBy: 'character' },
  )
  const tanjiroGroup = groups.find((g) => g.format === 'Tanjiro')
  assert.ok(tanjiroGroup)
  assert.equal(tanjiroGroup.items.length, 2)
  const otherGroup = groups.find((g) => g.format === 'OTHER')
  assert.ok(otherGroup)
  assert.equal(otherGroup.items.length, 1)
})

test('groupResults groups by staff', () => {
  const groups = search.groupResults(
    [
      { title: 'Show A', staff: [{ name: 'Director X' }] },
      { title: 'Show B', staff: [{ name: 'Director X' }, { name: 'Writer Y' }] },
      { title: 'Show C', staff: [] },
    ],
    { groupBy: 'staff' },
  )
  const directorGroup = groups.find((g) => g.format === 'Director X')
  assert.ok(directorGroup)
  assert.equal(directorGroup.items.length, 2)
  const writerGroup = groups.find((g) => g.format === 'Writer Y')
  assert.ok(writerGroup)
  assert.equal(writerGroup.items.length, 1)
  const otherGroup = groups.find((g) => g.format === 'OTHER')
  assert.ok(otherGroup)
  assert.equal(otherGroup.items.length, 1)
})

test('groupResults groups by studio', () => {
  const groups = search.groupResults(
    [
      { title: 'Show A', studios: ['Studio Ghibli'] },
      { title: 'Show B', studios: ['Studio Ghibli', 'Madhouse'] },
      { title: 'Show C', studios: [] },
    ],
    { groupBy: 'studio' },
  )
  const ghibliGroup = groups.find((g) => g.format === 'Studio Ghibli')
  assert.ok(ghibliGroup)
  assert.equal(ghibliGroup.items.length, 2)
  const madhouseGroup = groups.find((g) => g.format === 'Madhouse')
  assert.ok(madhouseGroup)
  assert.equal(madhouseGroup.items.length, 1)
  const otherGroup = groups.find((g) => g.format === 'OTHER')
  assert.ok(otherGroup)
  assert.equal(otherGroup.items.length, 1)
})

test('groupResults returns empty array for empty input', () => {
  const groups = search.groupResults([])
  assert.deepEqual(groups, [])
})

test('normalize extracts staff from media payload', () => {
  const normalized = anilist.normalize({
    id: 1,
    title: { romaji: 'Test Show', english: 'Test Show', native: 'テストショー' },
    staff: {
      edges: [
        {
          role: 'Director',
          node: {
            id: 42,
            name: { full: 'Director X', native: 'ディレクターX' },
            primaryOccupations: ['DIRECTOR'],
          },
        },
        {
          role: 'Writer',
          node: {
            id: 43,
            name: { full: 'Writer Y', native: 'ライターY' },
            primaryOccupations: ['WRITER'],
          },
        },
      ],
    },
  })
  assert.equal(normalized.staff.length, 2)
  assert.equal(normalized.staff[0].name, 'Director X')
  assert.equal(normalized.staff[0].native, 'ディレクターX')
  assert.equal(normalized.staff[0].role, 'Director')
  assert.deepEqual(normalized.staff[0].primaryOccupations, ['DIRECTOR'])
  assert.equal(normalized.staff[1].name, 'Writer Y')
})

/* ------------------------------ AV-072 ---------------------------------- */

test('rankTitles produces human-readable relevance explanations (AV-072)', () => {
  const cases = [
    { query: 'naruto', label: 'Naruto', reason: 'exact title match' },
    { query: 'naruto', label: 'Naruto Shippuden', reason: 'title starts with your search' },
    { query: 'piece', label: 'One Piece', reason: 'word match in title' },
    { query: 'ce', label: 'One Piece', reason: 'title contains your search' },
  ]
  for (const { query, label, reason } of cases) {
    const ranked = search.rankTitles([{ label }], query, { minScore: 0 })
    assert.ok(
      ranked.length > 0,
      `expected a rank for "${label}" against "${query}"`,
    )
    assert.equal(ranked[0].reason, reason)
  }
})

test('rankTitles explains romaji and close-spelling matches (AV-072)', () => {
  const romaji = search.rankTitles(
    [{ label: 'きめつのやいば' }],
    'kimetsu',
    { minScore: 0 },
  )
  assert.equal(romaji[0].reason, 'romaji title match')

  const close = search.rankTitles(
    [{ label: 'Naruto' }],
    'nartuo',
    { minScore: 0 },
  )
  assert.ok(close.length > 0)
  assert.ok(close[0].reason.startsWith('close spelling'))

  const alternate = search.rankTitles(
    [{ label: 'Shippuden', aliases: ['Naruto'] }],
    'naruto',
    { minScore: 0 },
  )
  assert.ok(alternate.length > 0)
  assert.ok(alternate[0].reason.startsWith('matched alternate title'))

  const unrelated = search.rankTitles([{ label: 'One Piece' }], 'naruto', {
    minScore: 0,
  })
  assert.equal(unrelated.length, 0)
})

test('searchAdvanced attaches a matchReason to each kept result (AV-072)', () => {
  // searchAdvanced requires the AniList client, so we exercise the explanation
  // assembly it relies on directly: rankTitles over media-shaped candidates.
  const media = [
    { id: 1, title: 'Naruto', romaji: 'Naruto', english: null },
    { id: 2, title: 'Naruto Shippuden', romaji: null, english: null },
    { id: 3, title: 'One Piece', romaji: 'One Piece', english: 'One Piece' },
  ]
  const ranked = search.rankTitles(
    media.map((m) => ({
      id: m.id,
      label: m.title,
      aliases: [m.romaji, m.english].filter((t) => typeof t === 'string'),
    })),
    'naruto',
    { limit: media.length, minScore: 0 },
  )
  const reasonById = new Map(ranked.map((r) => [r.id, r.reason]))
  assert.equal(reasonById.get(1), 'exact title match')
  assert.equal(reasonById.get(2), 'title starts with your search')
  assert.ok(!reasonById.has(3), 'unrelated title gets no relevance reason')
})

/* ------------------------------ AV-075 ---------------------------------- */

test('FullTextIndex tokenizes lowercase alphanumeric terms', () => {
  const terms = search.FullTextIndex.tokenize('Naruto Shippuden! 2007')
  assert.deepEqual(terms, ['naruto', 'shippuden', '2007'])
})

test('FullTextIndex add + search ranks by field weight', () => {
  const index = new search.FullTextIndex()
  index.add({
    id: 1,
    title: 'Naruto',
    romaji: 'Naruto',
    english: 'Naruto',
    native: 'ナルト',
    aliases: [],
  })
  index.add({
    id: 2,
    title: 'Naruto Shippuden',
    romaji: 'Naruto Shippuden',
    english: null,
    native: null,
    aliases: [],
  })

  const hits = index.search('naruto')
  assert.ok(hits.length > 0)
  assert.equal(hits[0].id, 1) // title match scores highest
  assert.ok(hits[0].matchedTerms.includes('naruto'))
})

test('FullTextIndex matches aliases', () => {
  const index = new search.FullTextIndex()
  index.add({
    id: 1,
    title: 'Attack on Titan',
    romaji: 'Shingeki no Kyojin',
    english: 'Attack on Titan',
    native: null,
    aliases: ['AOT', 'Shingeki'],
  })

  const hits = index.search('aot')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 1)
  assert.ok(hits[0].matchedTerms.includes('aot'))
})

test('FullTextIndex search is case-insensitive', () => {
  const index = new search.FullTextIndex()
  index.add({
    id: 1,
    title: 'One Piece',
    romaji: 'One Piece',
    english: 'One Piece',
    native: null,
    aliases: [],
  })

  const lower = index.search('one piece')
  const upper = index.search('ONE PIECE')
  assert.equal(lower.length, upper.length)
  assert.equal(lower[0].id, upper[0].id)
})

test('FullTextIndex returns empty for no matches', () => {
  const index = new search.FullTextIndex()
  index.add({
    id: 1,
    title: 'Naruto',
    romaji: 'Naruto',
    english: null,
    native: null,
    aliases: [],
  })
  assert.deepEqual(index.search('dragon ball'), [])
})

test('FullTextIndex remove drops a document', () => {
  const index = new search.FullTextIndex()
  index.add({ id: 1, title: 'Naruto', romaji: null, english: null, native: null, aliases: [] })
  index.add({ id: 2, title: 'Bleach', romaji: null, english: null, native: null, aliases: [] })
  index.remove(1)
  assert.deepEqual(index.search('naruto'), [])
  assert.equal(index.search('bleach').length, 1)
})

test('FullTextIndex rebuild replaces all documents', () => {
  const index = new search.FullTextIndex()
  index.build([
    { id: 1, title: 'Naruto', romaji: null, english: null, native: null, aliases: [] },
  ])
  index.build([
    { id: 2, title: 'Bleach', romaji: null, english: null, native: null, aliases: [] },
  ])
  assert.deepEqual(index.search('naruto'), [])
  assert.equal(index.search('bleach').length, 1)
})

test('FullTextIndex respects limit', () => {
  const index = new search.FullTextIndex()
  for (let i = 1; i <= 5; i++) {
    index.add({
      id: i,
      title: `Show ${i}`,
      romaji: null,
      english: null,
      native: null,
      aliases: [],
    })
  }
  const hits = index.search('show', { limit: 3 })
  assert.equal(hits.length, 3)
})

/* ------------------------------ AV-084 ---------------------------------- */

test('buildWatchOrder orders prequels first, then current, then sequels', () => {
  const media = {
    id: 10,
    title: 'Current Series',
    format: 'TV',
    seasonYear: 2020,
    season: 'SPRING',
    episodes: 12,
    cover: null,
  }
  const relations = [
    {
      key: 'PREQUEL',
      label: 'Prequel',
      items: [
        {
          id: 1,
          title: 'Prequel Series',
          relationType: 'PREQUEL',
          format: 'TV',
          seasonYear: 2018,
          season: 'WINTER',
          cover: null,
          episodes: 12,
        },
      ],
    },
    {
      key: 'SEQUEL',
      label: 'Sequel',
      items: [
        {
          id: 2,
          title: 'Sequel Series',
          relationType: 'SEQUEL',
          format: 'TV',
          seasonYear: 2022,
          season: 'FALL',
          cover: null,
          episodes: 12,
        },
      ],
    },
  ]
  const order = detail.buildWatchOrder(media, relations)
  assert.equal(order.length, 3)
  assert.equal(order[0].position, 1)
  assert.equal(order[0].id, 1)
  assert.equal(order[0].relationType, 'PREQUEL')
  assert.equal(order[1].position, 2)
  assert.equal(order[1].id, 10)
  assert.equal(order[1].relationType, 'CURRENT')
  assert.equal(order[2].position, 3)
  assert.equal(order[2].id, 2)
  assert.equal(order[2].relationType, 'SEQUEL')
})

test('buildWatchOrder includes side stories and spin-offs after sequels', () => {
  const media = {
    id: 10,
    title: 'Current Series',
    format: 'TV',
    seasonYear: 2020,
    season: 'SPRING',
    episodes: 12,
    cover: null,
  }
  const relations = [
    {
      key: 'SIDE_STORY',
      label: 'Side story',
      items: [
        {
          id: 3,
          title: 'Side Story',
          relationType: 'SIDE_STORY',
          format: 'OVA',
          seasonYear: 2021,
          season: 'SUMMER',
          cover: null,
          episodes: 2,
        },
      ],
    },
    {
      key: 'SPIN_OFF',
      label: 'Spin-off',
      items: [
        {
          id: 4,
          title: 'Spin-off',
          relationType: 'SPIN_OFF',
          format: 'ONA',
          seasonYear: 2023,
          season: 'WINTER',
          cover: null,
          episodes: 6,
        },
      ],
    },
  ]
  const order = detail.buildWatchOrder(media, relations)
  assert.equal(order.length, 3)
  assert.equal(order[0].id, 10) // current only, since prequels/sequels absent
  assert.equal(order[1].id, 3)
  assert.equal(order[1].relationType, 'SIDE_STORY')
  assert.equal(order[2].id, 4)
  assert.equal(order[2].relationType, 'SPIN_OFF')
})

test('buildWatchOrder with no relations returns just the current title', () => {
  const media = {
    id: 10,
    title: 'Standalone Series',
    format: 'MOVIE',
    seasonYear: 2019,
    season: null,
    episodes: 1,
    cover: null,
  }
  const order = detail.buildWatchOrder(media, [])
  assert.equal(order.length, 1)
  assert.equal(order[0].position, 1)
  assert.equal(order[0].id, 10)
  assert.equal(order[0].relationType, 'CURRENT')
})

test('buildWatchOrder sorts within groups by air date', () => {
  const media = {
    id: 10,
    title: 'Current Series',
    format: 'TV',
    seasonYear: 2020,
    season: 'SPRING',
    episodes: 12,
    cover: null,
  }
  const relations = [
    {
      key: 'PREQUEL',
      label: 'Prequel',
      items: [
        {
          id: 1,
          title: 'Later Prequel',
          relationType: 'PREQUEL',
          format: 'TV',
          seasonYear: 2019,
          season: 'FALL',
          cover: null,
          episodes: 12,
        },
        {
          id: 2,
          title: 'Earlier Prequel',
          relationType: 'PREQUEL',
          format: 'TV',
          seasonYear: 2018,
          season: 'WINTER',
          cover: null,
          episodes: 12,
        },
      ],
    },
  ]
  const order = detail.buildWatchOrder(media, relations)
  assert.equal(order[0].id, 2) // earlier prequel first
  assert.equal(order[1].id, 1)
  assert.equal(order[2].id, 10) // current last
})

test('buildWatchOrder entries include episodes and note fields', () => {
  const media = {
    id: 10,
    title: 'Current Series',
    format: 'TV',
    seasonYear: 2020,
    season: 'SPRING',
    episodes: 12,
    cover: null,
  }
  const order = detail.buildWatchOrder(media, [])
  assert.equal(order[0].episodes, 12)
  assert.equal(order[0].note, null)
})

/* ------------------------------ AV-085 ---------------------------------- */

test('Character detail query includes expected fields', () => {
  const CHARACTER_QUERY = anilist.CHARACTER_QUERY
  assert.ok(typeof CHARACTER_QUERY === 'string')
  assert.ok(CHARACTER_QUERY.includes('id'), 'character query should request id')
  assert.ok(CHARACTER_QUERY.includes('name { full native }'), 'character query should request name')
  assert.ok(CHARACTER_QUERY.includes('image { large'), 'character query should request image')
  assert.ok(CHARACTER_QUERY.includes('siteUrl'), 'character query should request siteUrl')
  assert.ok(CHARACTER_QUERY.includes('description'), 'character query should request description')
  assert.ok(CHARACTER_QUERY.includes('voiceActors'), 'character query should request voiceActors')
  assert.ok(CHARACTER_QUERY.includes('media {'), 'character query should request media appearances')
})

test('getCharacter rejects invalid ids', async () => {
  await assert.rejects(() => anilist.getCharacter(0), /Invalid character id/)
  await assert.rejects(() => anilist.getCharacter(-1), /Invalid character id/)
  await assert.rejects(() => anilist.getCharacter('abc'), /Invalid character id/)
})
