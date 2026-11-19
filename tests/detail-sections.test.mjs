// Tests for the detail-page related-content grouping (AV-081/082) and the
// franchise timeline modes (AV-083) — server/detail.mjs pure logic.
import test from 'node:test'
import assert from 'node:assert/strict'
import { groupRelations, relationGroupKey, buildTimeline, buildSeasonOptions, groupCompanies, synopsisClip, spoilerFreeOverview, buildStatusTimeline, scoreDistribution, distributionMean, distributionMode, buildDetailResponse } from '../server/detail.mjs'

const node = (id, title, extra = {}) => ({ id, title: { romaji: title }, type: 'ANIME', ...extra })

test('groupRelations groups canonical relationship types in display order', () => {
  const groups = groupRelations([
    { relationType: 'SPIN_OFF', node: node(4, 'Spin') },
    { relationType: 'SEQUEL', node: node(2, 'Second', { seasonYear: 2012 }) },
    { relationType: 'PREQUEL', node: node(1, 'First') },
    { relationType: 'SIDE_STORY', node: node(3, 'Side') },
    { relationType: 'TV_SOURCE', node: node(5, 'Manga', { type: 'MANGA' }) },
  ])
  assert.deepEqual(
    groups.map((g) => g.key),
    ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'OTHER'],
    'sequel/prequel/side-story/spin-off are first-class groups; unknown maps to OTHER',
  )
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Sequel', 'Prequel', 'Side story', 'Spin-off', 'Other'],
  )
  assert.equal(relationGroupKey('side_story'), 'SIDE_STORY', 'types are case-insensitive')
  assert.equal(relationGroupKey('nonsense'), 'OTHER')
})

test('groupRelations keeps one card per media and sorts by year', () => {
  const groups = groupRelations([
    { relationType: 'SEQUEL', node: node(2, 'Later', { seasonYear: 2015 }) },
    { relationType: 'SPIN_OFF', node: node(2, 'Later again') },
    { relationType: 'SEQUEL', node: node(3, 'Earlier', { seasonYear: 2012 }) },
    { relationType: 'SEQUEL', node: { id: 9, type: 'CHARACTER' } },
  ])
  assert.equal(groups.length, 1, 'the duplicate keeps only its first (most specific) group')
  assert.deepEqual(groups[0].items.map((i) => i.id), [3, 2], 'sorted by season year')
  assert.equal(groups[0].items[0].relationType, 'SEQUEL')
  assert.deepEqual(groupRelations(), [], 'empty input yields no groups')
})

test('buildTimeline orders by release vs chronological keys with positions', () => {
  // Reality: chronologicalKey prefers seasonYear and resolves the month from
  // the season when startDate is absent, so the modes diverge for same-year
  // seasons (release ties fall back to id order).
  const nodes = [
    node(1, 'Fall show', { seasonYear: 2015, season: 'FALL' }),
    node(2, 'Winter show', { seasonYear: 2015, season: 'WINTER' }),
  ]
  const release = buildTimeline(nodes, 'release')
  assert.deepEqual(release.map((e) => e.id), [1, 2], 'release ties fall back to id order')
  assert.deepEqual(release.map((e) => e.position), [1, 2])
  const chrono = buildTimeline(nodes, 'chronological')
  assert.deepEqual(chrono.map((e) => e.id), [2, 1], 'chronological mode orders same-year entries by season')
  const undated = buildTimeline([...nodes, node(12, 'Unknown')], 'chronological')
  assert.equal(undated.at(-1).id, 12, 'undated entries sort last')
  assert.equal(undated.at(-1).uncertain, true)
  assert.equal(undated[0].uncertain, false)
  assert.deepEqual(buildTimeline(), [])
})

test('groupCompanies surfaces committee and distributor details where available', () => {
  const companies = [
    { id: 'a', name: 'Studio A', roles: ['MAIN_STUDIO', 'PRODUCER'] },
    { id: 'b', name: 'Committee B', roles: ['PRODUCER'] },
    { id: 'c', name: 'Home Video C', roles: ['DISTRIBUTOR'] },
    { id: 'd', name: 'No Roles', roles: [] },
    { id: 'e', name: '', roles: ['LICENSOR'] },
  ]
  const groups = groupCompanies(companies)
  assert.deepEqual(
    groups.map((g) => [g.role, g.label, g.names]),
    [
      ['MAIN_STUDIO', 'Production studios', ['Studio A']],
      ['PRODUCER', 'Producers', ['Studio A', 'Committee B']],
      ['DISTRIBUTOR', 'Distributors', ['Home Video C']],
    ],
    'one group per populated role, in canonical order; role-less and unnamed companies dropped',
  )
  assert.deepEqual(groupCompanies(), [], 'missing data yields no groups')
  assert.deepEqual(groupCompanies([{ name: 'X', roles: ['UNKNOWN'] }]), [])
  const res = buildDetailResponse({ title: 'T', companies })
  assert.deepEqual(res.companyGroups.map((g) => g.role), ['MAIN_STUDIO', 'PRODUCER', 'DISTRIBUTOR'], 'the detail payload ships companyGroups')
})

test('groupRelations carries sanitized source links and chapter counts', () => {
  const groups = groupRelations([
    { relationType: 'SOURCE', node: node(9, 'Manga', { type: 'MANGA', format: 'MANGA', chapters: 130, siteUrl: 'https://anilist.co/manga/9' }) },
    { relationType: 'SOURCE', node: node(10, 'Evil', { type: 'MANGA', siteUrl: 'javascript:alert(1)' }) },
  ])
  assert.equal(groups[0].key, 'SOURCE')
  assert.equal(groups[0].label, 'Source material')
  assert.equal(groups[0].items[0].siteUrl, 'https://anilist.co/manga/9')
  assert.equal(groups[0].items[0].chapters, 130)
  assert.equal(groups[0].items[1].siteUrl, null, 'dangerous urls are dropped')
})

test('scoreDistribution shapes community ratings beyond a single average (AV-094)', () => {
  const result = scoreDistribution([
    { score: 80, amount: 3 },
    { score: 90, amount: 1 },
    { score: 101, amount: 5 },
    { score: 80, amount: -2 },
    { score: 'x', amount: 1 },
    null,
  ])
  assert.deepEqual(result.buckets.map((b) => b.score), [90, 80], 'invalid entries dropped, sorted score-desc')
  assert.equal(result.total, 4)
  assert.deepEqual(result.buckets.map((b) => b.percent), [25, 75], 'percent of total, one decimal')
  assert.equal(scoreDistribution([]), null)
  assert.equal(scoreDistribution([{ score: 10, amount: 0 }]), null, 'zero votes never produce a histogram')
})

test('distributionMean and distributionMode summarize the histogram', () => {
  const distribution = [
    { score: 100, amount: 1 },
    { score: 70, amount: 3 },
    { score: 60, amount: 2 },
  ]
  assert.equal(distributionMean(distribution), 72, 'weighted mean rounded')
  assert.deepEqual(distributionMode(distribution), { score: 70, amount: 3, percent: 50 })
  assert.equal(
    distributionMode([
      { score: 80, amount: 2 },
      { score: 70, amount: 2 },
    ]).score,
    80,
    'ties resolve to the higher score (first bucket in score-desc order)',
  )
  assert.equal(distributionMean([]), null)
  assert.equal(distributionMode(null), null)
})

test('buildStatusTimeline lists dated production milestones in order (AV-093)', () => {
  const events = buildStatusTimeline({
    status: 'FINISHED',
    season: 'SPRING',
    seasonYear: 2024,
    startDate: { year: 2024, month: 6, day: 1 },
    endDate: { year: 2024, month: 3, day: 2 },
  })
  assert.deepEqual(events.map((e) => e.label), ['Finished airing', 'Premiered'], 'sorted by real dates, not insert order')
  assert.deepEqual(events.map((e) => e.display), ['2024-03-02', '2024-06-01'])
  assert.equal(events[1].detail, 'SPRING 2024')
})

test('buildStatusTimeline interleaves the next broadcast and announces unreleased titles', () => {
  const events = buildStatusTimeline({
    status: 'RELEASING',
    startDate: { year: 2024, month: 6, day: 1 },
    nextEpisode: { episode: 12, airingAt: Date.UTC(2024, 4, 20) / 1000 },
  })
  assert.deepEqual(events.map((e) => e.label), ['Episode 12', 'Premiered'], 'an already-aired broadcast sorts before the premiere date')
  assert.equal(events[0].detail, 'next broadcast')
  const later = buildStatusTimeline({
    status: 'RELEASING',
    startDate: { year: 2024, month: 6, day: 1 },
    nextEpisode: { episode: 12, airingAt: Date.UTC(2024, 6, 15) / 1000 },
  })
  assert.deepEqual(
    later.map((e) => e.label),
    ['Premiered', 'Episode 12'],
    'a future broadcast lands AFTER the premiere — the real regression pin (the old 9_999_999 sentinel sorted it first)',
  )
  const announced = buildStatusTimeline({ status: 'NOT_YET_RELEASED', startDate: { year: 2025 } })
  assert.deepEqual(announced.map((e) => e.label), ['Announced', 'Premiered'])
  assert.equal(announced[0].display, 'TBA')
  assert.deepEqual(buildStatusTimeline({}), [], 'undated events are dropped')
  assert.equal(buildStatusTimeline({ startDate: { year: 2024 } })[0].display, '2024', 'partial dates render year-only')
})

test('spoilerFreeOverview builds the new-visitor spoiler-free summary (AV-092)', () => {
  assert.equal(spoilerFreeOverview(''), '')
  assert.equal(spoilerFreeOverview(null), '')
  assert.equal(spoilerFreeOverview('~!entirely secret!~'), '', 'spoiler-only descriptions yield no overview')
  assert.equal(
    spoilerFreeOverview('The brave hero ventures across distant lands and faces many trials. The hero dies.'),
    'The brave hero ventures across distant lands and faces many trials.',
    'a long first sentence stands alone',
  )
  assert.equal(
    spoilerFreeOverview('Short intro. ~!The hero dies.!~ More text.'),
    'Short intro. More text.',
    'short openings keep the following spoiler-free text; spoiler regions removed entirely',
  )
  const capped = spoilerFreeOverview(`${'word '.repeat(80)}end.`)
  assert.ok(capped.length <= 240, 'capped at maxLength')
  assert.ok(capped.endsWith('…'))
  assert.ok(!capped.includes('end.'), 'the cut lands on a word boundary')
})

test('synopsisClip previews long synopses without leaking spoilers', () => {
  assert.deepEqual(synopsisClip('short'), { text: 'short', tooLong: false })
  assert.deepEqual(synopsisClip(null), { text: '', tooLong: false })
  const long = 'word '.repeat(200)
  const clipped = synopsisClip(long)
  assert.equal(clipped.tooLong, true)
  assert.ok(clipped.text.length <= 420)
  assert.ok(clipped.text.endsWith('…'))
  // Spoiler safety: the clip runs on redacted text (AV-091 contract).
  const redacted = buildDetailResponse({ description: 'Intro. ~!the hero dies!~ tail.' })
  assert.equal(redacted.synopsis.hiddenCount, 1)
  assert.ok(!redacted.synopsisClip.text.includes('the hero dies'), 'the preview never contains hidden spoilers')
  assert.ok(redacted.synopsisClip.text.includes('[spoiler hidden]') || redacted.synopsisClip.text.includes('Intro'))
})

test('buildDetailResponse timeline follows the requested order', () => {
  const media = {
    title: 'Franchise',
    timelineNodes: [
      node(1, 'Fall show', { seasonYear: 2015, season: 'FALL' }),
      node(2, 'Winter show', { seasonYear: 2015, season: 'WINTER' }),
    ],
  }
  assert.deepEqual(buildDetailResponse(media).timeline.map((e) => e.id), [1, 2])
  assert.deepEqual(buildDetailResponse(media, { order: 'chronological' }).timeline.map((e) => e.id), [2, 1])
})

test('buildSeasonOptions merges current and related seasons in air order', () => {
  const detail = {
    id: 10,
    title: 'Second Season',
    seasonYear: 2012,
    season: 'SPRING',
    relatedSeasons: [
      { id: 20, title: 'First Season', seasonYear: 2010, season: 'SPRING' },
      { id: 30, title: 'Movie', seasonYear: null, season: null },
      { id: 40, title: 'Winter Special', seasonYear: 2012, season: 'WINTER' },
    ],
  }
  const options = buildSeasonOptions(detail)
  assert.deepEqual(options.map((o) => o.id), [20, 40, 10, 30], 'year → season → id, undated last')
  assert.deepEqual(options.map((o) => o.current), [false, false, true, false])
  assert.equal(options[0].title, 'First Season')
  assert.deepEqual(buildSeasonOptions({ id: 1, title: 'Solo' }).map((o) => o.id), [1], 'single entry, no related seasons')
  assert.deepEqual(buildSeasonOptions(null), [])
  const res = buildDetailResponse(detail)
  assert.deepEqual(res.seasonOptions.map((o) => o.id), [20, 40, 10, 30], 'the detail payload ships seasonOptions')
})
