// Tests for the pure search intelligence module (server/search.mjs).
// Covers AV-053 (alternate-title matching), AV-054 (fuzzy/typo tolerance),
// AV-055 (romanization-aware matching), AV-065 (field query syntax),
// AV-068/069 (corrections + alternatives), AV-070/071/072 (grouping,
// highlighting, explanations) and AV-074 (result caps).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEARCH_FIELDS,
  parseSearchQuery,
  hasStructuredFilters,
  normalizeForSearch,
  foldRomaji,
  similarity,
  editDistance,
  typoTolerance,
  rankTitles,
  suggestCorrection,
  highlightSegments,
  groupResults,
  alternativeQueries,
  RESULT_CAP,
  clampResultCap,
} from '../server/search.mjs'

// ── AV-065: structured query syntax ──────────────────────────────────────────

test('parseSearchQuery separates free text from field filters', () => {
  const { text, filters } = parseSearchQuery('monogatari studio:shaft genre:comedy year:2009-2015 score:>80')
  assert.equal(text, 'monogatari')
  assert.deepEqual(filters.studio, ['shaft'])
  assert.deepEqual(filters.genre, ['comedy'])
  assert.deepEqual(filters.year, { min: 2009, max: 2015 })
  assert.deepEqual(filters.score, { min: 81 })
})

test('unknown field tokens stay in the free text', () => {
  const { text } = parseSearchQuery('Fate: Zero')
  assert.equal(text, 'Fate: Zero')
})

test('title: is an alias for free text', () => {
  assert.equal(parseSearchQuery('title:"Fate Zero"').text, 'Fate Zero')
})

test('status and format filters validate their vocabularies', () => {
  const ok = parseSearchQuery('status:airing format:tv-short')
  assert.deepEqual(ok.filters.status, ['airing'])
  assert.deepEqual(ok.filters.format, ['tv_short'])
  const bad = parseSearchQuery('status:bogus')
  assert.deepEqual(bad.filters.status, [])
  assert.equal(bad.text, 'status:bogus')
})

test('year accepts a single year and a bounded range', () => {
  assert.deepEqual(parseSearchQuery('year:2009').filters.year, { min: 2009, max: 2009 })
  assert.equal(parseSearchQuery('year:3000').filters.year, null)
})

test('score and episode operators map to ranges', () => {
  assert.deepEqual(parseSearchQuery('score:<=80').filters.score, { max: 80 })
  assert.deepEqual(parseSearchQuery('score:<80').filters.score, { max: 79 })
  assert.deepEqual(parseSearchQuery('episodes:>=12').filters.episodes, { min: 12 })
  assert.deepEqual(parseSearchQuery('episodes:>12').filters.episodes, { min: 13 })
  assert.deepEqual(parseSearchQuery('episodes:<24').filters.episodes, { max: 23 })
  assert.deepEqual(parseSearchQuery('episodes:12').filters.episodes, { min: 12, max: 12 })
})

test('hasStructuredFilters reflects any supplied filter', () => {
  assert.equal(hasStructuredFilters(parseSearchQuery('naruto').filters), false)
  assert.equal(hasStructuredFilters(parseSearchQuery('genre:action').filters), true)
})

test('SEARCH_FIELDS exposes the documented field tokens', () => {
  assert.equal(SEARCH_FIELDS.title, 't')
  assert.ok(SEARCH_FIELDS.studio && SEARCH_FIELDS.genre && SEARCH_FIELDS.episodes)
})

// ── normalization and romanization folding ──────────────────────────────────

test('normalizeForSearch strips accents and punctuation', () => {
  assert.equal(normalizeForSearch('Café, Mx.'), 'cafe mx')
  assert.equal(normalizeForSearch('Fate/Stay Night'), 'fate stay night')
})

test('foldRomaji equalizes Hepburn and Kunrei spellings', () => {
  assert.equal(foldRomaji('Shingeki'), foldRomaji('Singeki'))
  assert.equal(foldRomaji('Jiraiya'), foldRomaji('Ziraiya'))
  assert.equal(foldRomaji('Shippuuden'), foldRomaji('Shippuden'))
  assert.equal(foldRomaji('Toukyou'), foldRomaji('Tookyoo'))
  assert.equal(foldRomaji('Toukyou'), foldRomaji('Tokyo'))
})

test('foldRomaji leaves native script untouched', () => {
  assert.equal(foldRomaji('鬼滅の刃'), '鬼滅の刃')
  assert.equal(foldRomaji(''), '')
})

// ── AV-054: fuzzy matching ──────────────────────────────────────────────────

test('similarity is 1 for identical text and 0 for disjoint text', () => {
  assert.equal(similarity('Naruto', 'naruto'), 1)
  assert.equal(similarity('abc', 'xyz'), 0)
})

test('similarity survives transposed characters', () => {
  assert.ok(similarity('nartuo', 'naruto') >= 0.6)
})

test('editDistance counts adjacent transposition as one mistake', () => {
  assert.equal(editDistance('ab', 'ba'), 1)
  assert.equal(editDistance('kitten', 'sitting'), 3)
  assert.equal(editDistance('', 'abc'), 3)
})

test('typoTolerance scales with query length', () => {
  assert.equal(typoTolerance('abc'), 0)
  assert.equal(typoTolerance('abcd'), 1)
  assert.equal(typoTolerance('abcdefg'), 2)
})

// ── AV-053 + AV-055: ranking with explanations (AV-072) ─────────────────────

test('rankTitles prefers exact, prefix, word and substring matches', () => {
  const titles = [
    { id: 1, label: 'Naruto' },
    { id: 2, label: 'Naruto Shippuden' },
    { id: 3, label: 'Boruto Naruto Next Generations' },
    { id: 4, label: 'Narutona' },
  ]
  const ranked = rankTitles(titles, 'naruto')
  assert.equal(ranked[0].id, 1)
  assert.equal(ranked[0].reason, 'exact title match')
  const reasons = Object.fromEntries(ranked.map((r) => [r.id, r.reason]))
  assert.equal(reasons[2], 'title starts with your search')
  assert.equal(reasons[3], 'word match in title')
})

test('rankTitles matches alternate titles exactly and partially', () => {
  const titles = [
    { id: 1, label: 'Attack on Titan', aliases: ['Shingeki no Kyojin', '進撃の巨人'] },
    { id: 2, label: 'Demon Slayer', aliases: ['Kimetsu no Yaiba'] },
  ]
  const exact = rankTitles(titles, 'shingeki no kyojin')
  assert.equal(exact[0].id, 1)
  assert.match(exact[0].reason, /exact alternate title/)
  const native = rankTitles(titles, '進撃の巨人')
  assert.equal(native[0].id, 1)
  assert.match(native[0].reason, /exact alternate title/)
  const synonym = rankTitles(titles, 'kimetsu no yaiba')
  assert.equal(synonym[0].id, 2)
  const partial = rankTitles(titles, 'shingeki')
  assert.equal(partial[0].id, 1)
  assert.match(partial[0].reason, /matched alternate title/)
})

test('rankTitles matches romanization variants of the label', () => {
  const titles = [{ id: 1, label: 'Tokyo' }]
  const ranked = rankTitles(titles, 'toukyou')
  assert.equal(ranked[0].id, 1)
  assert.equal(ranked[0].reason, 'romanization variant of the title')
  const kunrei = rankTitles([{ id: 2, label: 'Attack on Titan' }], 'singeki no kyojin', {
    minScore: 0,
  })
  assert.equal(kunrei.length, 0, 'romanization matching needs an alias or label hit')
  const aliased = rankTitles(
    [{ id: 3, label: 'Attack on Titan', aliases: ['Shingeki no Kyojin'] }],
    'singeki no kyojin',
  )
  assert.equal(aliased[0].id, 3)
  assert.match(aliased[0].reason, /alternate title/)
})

test('rankTitles explains close spellings within the typo budget', () => {
  const ranked = rankTitles([{ id: 1, label: 'Naruto' }], 'nartuo')
  assert.equal(ranked[0].reason, 'close spelling (1 character off)')
})

test('rankTitles drops non-matches and respects limit', () => {
  assert.deepEqual(rankTitles([{ id: 1, label: 'Naruto' }], 'zzzzzzzz'), [])
  const many = Array.from({ length: 10 }, (_, i) => ({ id: i, label: `Naruto ${i}` }))
  assert.equal(rankTitles(many, 'naruto', { limit: 2 }).length, 2)
})

// ── AV-068: typo corrections keep the original query ────────────────────────

test('suggestCorrection proposes the best fix and keeps the original', () => {
  const fix = suggestCorrection([{ id: 1, label: 'Naruto' }], 'nartuo')
  assert.equal(fix.suggestion, 'Naruto')
  assert.equal(fix.original, 'nartuo')
  assert.equal(suggestCorrection([{ id: 1, label: 'Naruto' }], 'naruto'), null)
  assert.equal(suggestCorrection([{ id: 1, label: 'Naruto' }], 'zzzzzzzz'), null)
})

// ── AV-071: highlighting ────────────────────────────────────────────────────

test('highlightSegments flags the matched fragment', () => {
  const parts = highlightSegments('Naruto Shippuden', 'Shippuden')
  assert.deepEqual(parts, [
    { text: 'Naruto ', match: false },
    { text: 'Shippuden', match: true },
  ])
  assert.deepEqual(highlightSegments('Naruto', ''), [{ text: 'Naruto', match: false }])
})

// ── AV-070: result grouping ─────────────────────────────────────────────────

test('groupResults buckets by format and folds odd formats into OTHER', () => {
  const groups = groupResults([
    { format: 'TV' },
    { format: 'MOVIE' },
    { format: 'TV_SHORT' },
    { format: null },
  ])
  assert.deepEqual(groups.map((g) => g.format), ['TV', 'MOVIE', 'OTHER'])
  assert.equal(groups[2].items.length, 2)
  assert.deepEqual(groupResults(null), [])
})

// ── AV-069: dead-end alternatives ───────────────────────────────────────────

test('alternativeQueries offers narrowing, field and browse options', () => {
  const alts = alternativeQueries('fullmetal alchemist brotherhood')
  assert.deepEqual(alts.map((a) => a.kind), ['narrow', 'narrow', 'field', 'browse'])
  const single = alternativeQueries('naruto')
  assert.deepEqual(single.map((a) => a.kind), ['field', 'browse'])
  assert.deepEqual(alternativeQueries('  '), [{ label: 'Browse the seasonal catalog', query: '', kind: 'browse' }])
})

// ── AV-074: result caps ─────────────────────────────────────────────────────

test('clampResultCap bounds the page size', () => {
  assert.equal(clampResultCap(undefined), RESULT_CAP.defaultPerPage)
  assert.equal(clampResultCap('5'), RESULT_CAP.min)
  assert.equal(clampResultCap('5000'), RESULT_CAP.max)
  assert.equal(clampResultCap('abc'), RESULT_CAP.defaultPerPage)
  assert.equal(clampResultCap(42.7), 42)
})
