// Regression tests for verified relationship detection (server/relations.mjs).
// Fixture evidence is REAL metadata gathered from online databases (see
// comments): AniList relation vocabulary, MAL ids, official entry titles.
// Title similarity must NEVER decide a relationship — the tests pin that.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyEdge,
  relativeKind,
  stripPartMarkers,
  isSplitCourPair,
  normalizeTitleKey,
  titleAliasKeys,
  relationshipCacheKey,
  verifyRelationship,
  sameFranchise,
} from '../server/relations.mjs'

// --- Verified franchise fixture (sources: anilist.co, myanimelist.net,
// livechart.me, animeschedule.net, tensura.fandom.com — collected 2026-11) ---
// AniList 116742 = "Tensei Shitara Slime Datta Ken 2nd Season Part 2"
// MAL 37430 = TenSura S1; MAL 51309 = Sukuwareru Ramiris (ONA, "Other" on MAL)
// Clayman REVENGE = "Spin Off" edge on anilist.co/manga/86355 relations
// The Slime Diaries = comedy manga spin-off (MAL/official announcements)
// Genjitsu no Rimuru: SUNSHINE in the SLIME = 2-ep crossover ONA short ("Other")
const franchiseKey = 'tensura'

const slimeS1 = {
  key: 'anilist:98459',
  sourceIds: { anilist: '98459', mal: '37430' },
  title: 'That Time I Got Reincarnated as a Slime',
  romaji: 'Tensei Shitara Slime Datta Ken',
  format: 'TV',
  franchiseKey,
  role: 'main',
  relations: [
    { source: 'anilist', sourceId: '114745', title: 'Tensei Shitara Slime Datta Ken 2nd Season', relationType: 'SEQUEL', format: 'TV' },
    { source: 'anilist', sourceId: '128705', title: 'Tensura Nikki: Tensei Shitara Slime Datta Ken', relationType: 'SPIN_OFF', format: 'TV' },
    { source: 'mal', sourceId: '51309', title: 'Tensei Shitara Slime Datta Ken: Sukuwareru Ramiris', relationType: 'OTHER', format: 'ONA', bonus: true },
    { source: 'anilist', sourceId: '155847', title: 'Genjitsu no Rimuru: SUNSHINE in the SLIME', relationType: 'OTHER', format: 'ONA', bonus: true },
    { source: 'anilist', sourceId: '131093', title: 'Tensei Shitara Slime Datta Ken Movie: Guren no Kizuna-hen', relationType: 'SIDE_STORY', format: 'MOVIE' },
  ],
}

const slimeS2 = {
  key: 'anilist:114745',
  sourceIds: { anilist: '114745' },
  title: 'Tensei Shitara Slime Datta Ken 2nd Season',
  english: 'That Time I Got Reincarnated as a Slime Season 2',
  format: 'TV',
  franchiseKey,
  role: 'season',
  relations: [
    { source: 'anilist', sourceId: '98459', title: 'Tensei Shitara Slime Datta Ken', relationType: 'PREQUEL', format: 'TV' },
    { source: 'anilist', sourceId: '116742', title: 'Tensei Shitara Slime Datta Ken 2nd Season Part 2', relationType: 'SEQUEL', format: 'TV' },
  ],
}

const slimeS2Part2 = {
  key: 'anilist:116742',
  sourceIds: { anilist: '116742' },
  title: 'Tensei Shitara Slime Datta Ken 2nd Season Part 2',
  english: 'That Time I Got Reincarnated as a Slime Season 2 Part 2',
  format: 'TV',
  franchiseKey,
  role: 'season',
  relations: [
    { source: 'anilist', sourceId: '114745', title: 'Tensei Shitara Slime Datta Ken 2nd Season', relationType: 'PREQUEL', format: 'TV' },
    { source: 'anilist', sourceId: '159883', title: 'Tensei Shitara Slime Datta Ken 3rd Season', relationType: 'SEQUEL', format: 'TV' },
    { source: 'anilist', sourceId: '155847', title: 'Genjitsu no Rimuru: SUNSHINE in the SLIME', relationType: 'OTHER', format: 'ONA', bonus: true },
  ],
}

const slime4thSeasonPart3 = {
  key: 'anilist:4th-p3',
  sourceIds: { anilist: '4th-p3' },
  title: 'Tensei Shitara Slime Datta Ken 4th Season Part 3',
  format: 'TV',
  franchiseKey,
  role: 'season',
  relations: [
    { source: 'anilist', sourceId: '159883', title: 'Tensei Shitara Slime Datta Ken 3rd Season', relationType: 'PREQUEL', format: 'TV' },
  ],
}

const claymanRevenge = {
  key: 'anilist:clayman',
  sourceIds: { anilist: 'clayman' },
  title: 'Tensei Shitara Slime Datta Ken: Clayman REVENGE',
  format: 'TV',
  franchiseKey,
  role: 'branch:spin-off',
  relations: [
    // AniList manga/86355 lists Clayman REVENGE with a "Spin Off" edge.
    { source: 'anilist', sourceId: '86355', title: 'Tensei Shitara Slime Datta Ken', relationType: 'SPIN_OFF', format: 'MANGA' },
  ],
}

const slimeDiaries = {
  key: 'anilist:128705',
  sourceIds: { anilist: '128705' },
  title: 'The Slime Diaries',
  romaji: 'Tensura Nikki: Tensei Shitara Slime Datta Ken',
  format: 'TV',
  franchiseKey,
  role: 'branch:spin-off',
  relations: [
    { source: 'anilist', sourceId: '98459', title: 'Tensei Shitara Slime Datta Ken', relationType: 'SPIN_OFF', format: 'TV' },
  ],
}

const ramiris = {
  key: 'mal:51309',
  sourceIds: { mal: '51309' },
  title: 'Tensei Shitara Slime Datta Ken: Sukuwareru Ramiris',
  format: 'ONA',
  franchiseKey,
  role: 'branch:special',
  relations: [
    // MAL 51309 lists the main series under "Other" (bonus web short).
    { source: 'mal', sourceId: '37430', title: 'Tensei shitara Slime Datta Ken', relationType: 'OTHER', format: 'TV', bonus: true },
  ],
}

const sunshine = {
  key: 'anilist:155847',
  sourceIds: { anilist: '155847' },
  title: 'Genjitsu no Rimuru: SUNSHINE in the SLIME',
  format: 'ONA',
  franchiseKey,
  role: 'branch:special',
  relations: [
    { source: 'anilist', sourceId: '98459', title: 'Tensei Shitara Slime Datta Ken', relationType: 'OTHER', format: 'TV', bonus: true },
    // Crossover: also related to the Yohane franchise (dual membership).
    { source: 'anilist', sourceId: '130590', title: 'Genjitsu no Yohane: SUNSHINE in the MIRROR', relationType: 'SPIN_OFF', format: 'TV' },
  ],
}

const killingSlimes300Years = {
  key: 'anilist:128547',
  sourceIds: { anilist: '128547' },
  title: 'Slime Taoshite 300-nen, Shiranai Uchi ni Level Max ni Nattemashita',
  english: "I've Been Killing Slimes for 300 Years",
  format: 'TV',
  franchiseKey: 'slime300',
  role: 'main',
  relations: [],
}

test('slime: different titles, one franchise — seasons vs branches (verified)', () => {
  // Seasons / continuations.
  const s1s2 = verifyRelationship(slimeS1, slimeS2)
  assert.equal(s1s2.type, 'next-season', 'S2 is the next season of S1')
  assert.equal(s1s2.confidence, 'high')
  assert.equal(s1s2.verification, 'verified')
  assert.equal(s1s2.uncertain, false)
  assert.ok(sameFranchise(s1s2))

  // S2 cour 2: split-cour of the SAME season (official titles share base).
  const parts = verifyRelationship(slimeS2, slimeS2Part2)
  assert.equal(parts.type, 'split-cour')
  assert.equal(parts.confidence, 'high')
  assert.ok(sameFranchise(parts))

  // S1 ↔ S2 Part 2: no direct edge — connected through the S2 anchor.
  const s1p2 = verifyRelationship(slimeS1, slimeS2Part2)
  assert.equal(s1p2.type, 'next-season')
  assert.equal(s1p2.verification, 'indirect')
  assert.ok(sameFranchise(s1p2), 'part 2 of season 2 is NOT unrelated to season 1')

  // "4th Season Part 3" is a main-series season, not a spin-off.
  const s1s4p3 = verifyRelationship(slimeS1, slime4thSeasonPart3)
  assert.equal(s1s4p3.type, 'next-season')
  assert.ok(sameFranchise(s1s4p3))
  const s2p2s4p3 = verifyRelationship(slimeS2Part2, slime4thSeasonPart3)
  assert.equal(s2p2s4p3.type, 'next-season')
})

test('slime: spin-offs, specials and movies are typed apart from seasons (verified)', () => {
  const diaries = verifyRelationship(slimeS1, slimeDiaries)
  assert.equal(diaries.type, 'spin-off', 'The Slime Diaries is a spin-off, never "another season"')
  assert.equal(diaries.confidence, 'high')
  assert.ok(sameFranchise(diaries))

  const clayman = verifyRelationship(slimeS1, claymanRevenge)
  assert.equal(clayman.type, 'spin-off', 'Clayman REVENGE is a spin-off (AniList "Spin Off" edge)')
  assert.ok(sameFranchise(clayman))

  const ramirisPair = verifyRelationship(slimeS1, ramiris)
  assert.equal(ramirisPair.type, 'special', 'Sukuwareru Ramiris is a bonus short, not a season')
  assert.ok(sameFranchise(ramirisPair))

  const sunshinePair = verifyRelationship(slimeS1, sunshine)
  assert.equal(sunshinePair.type, 'special', 'SUNSHINE in the SLIME is a crossover bonus short')
  assert.ok(sameFranchise(sunshinePair))

  const gurenMovie = {
    key: 'anilist:131093',
    sourceIds: { anilist: '131093' },
    title: 'Tensei Shitara Slime Datta Ken Movie: Guren no Kizuna-hen',
    format: 'MOVIE',
    franchiseKey,
    role: 'branch:movie',
    relations: [
      { source: 'anilist', sourceId: '98459', title: 'Tensei Shitara Slime Datta Ken', relationType: 'PARENT', format: 'TV' },
    ],
  }
  const movie = verifyRelationship(slimeS1, gurenMovie)
  assert.equal(movie.type, 'movie', 'Guren no Kizuna-hen is a franchise movie')
})

test('slime: similar titles that are actually unrelated stay unrelated', () => {
  const pair = verifyRelationship(slimeS1, killingSlimes300Years)
  assert.equal(pair.type, 'unrelated')
  assert.equal(sameFranchise(pair), false, '"Slime" in both titles must not connect them')
  assert.equal(pair.uncertain, false, 'both sides were looked up — a negative verdict is evidence-based')
  assert.equal(pair.verification, 'verified')
})

test('re:zero: differently punctuated titles of one entry are duplicates', () => {
  // "Re:ZERO -Starting Life in Another World-" and the trailing-dash-less
  // "Re:ZERO -Starting Life in Another World" resolve to the same AniList id.
  const a = {
    key: 'anilist:21355',
    sourceIds: { anilist: '21355', mal: '31240' },
    title: 'Re:ZERO -Starting Life in Another World-',
    format: 'TV',
    relations: [],
  }
  const b = {
    key: 'lookup:rezero-alias',
    sourceIds: { anilist: '21355' },
    title: 'Re:ZERO -Starting Life in Another World',
    format: 'TV',
    relations: [],
  }
  const pair = verifyRelationship(a, b)
  assert.equal(pair.type, 'same-entry')
  assert.equal(pair.confidence, 'high')
  assert.equal(pair.verification, 'verified')
  assert.ok(sameFranchise(pair))

  // Duplicate WITHOUT any online ids: insufficient evidence → uncertain,
  // never a confident "unrelated".
  const noIds = verifyRelationship(
    { title: 'Re:ZERO -Starting Life in Another World-' },
    { title: 'Re:ZERO -Starting Life in Another World' },
  )
  assert.equal(noIds.uncertain, true)
  assert.ok(['unknown', 'same-entry'].includes(noIds.type))
})

test('missing or conflicting metadata is marked uncertain, never guessed', () => {
  // Conflicting edges (one side spin-off, the other side sequel).
  const conflicting = verifyRelationship(
    {
      sourceIds: { anilist: 'a' },
      title: 'Entry A',
      relations: [{ source: 'anilist', sourceId: 'b', title: 'Entry B', relationType: 'SPIN_OFF', format: 'TV' }],
    },
    {
      sourceIds: { anilist: 'b' },
      title: 'Entry B',
      relations: [{ source: 'anilist', sourceId: 'a', title: 'Entry A', relationType: 'SEQUEL', format: 'TV' }],
    },
  )
  assert.equal(conflicting.verification, 'conflicting')
  assert.equal(conflicting.uncertain, true)
  assert.equal(conflicting.type, 'unknown')

  // No metadata at all.
  const bare = verifyRelationship({ title: 'Something' }, { title: 'Something Else' })
  assert.equal(bare.uncertain, true)
  assert.equal(bare.type, 'unknown')

  // Title overlap alone is a hint, not evidence.
  const titleOnly = verifyRelationship({ title: 'Shared Title' }, { title: 'Shared Title' })
  assert.ok(titleOnly.reasons.some((reason) => reason.includes('hint only')))
  assert.ok(titleOnly.uncertain || titleOnly.confidence === 'none')
})

test('edge classification and split-cour helpers', () => {
  assert.equal(classifyEdge({ relationType: 'SEQUEL' }), 'sequel')
  assert.equal(classifyEdge({ relationType: 'SPIN_OFF' }), 'spin-off')
  assert.equal(classifyEdge({ relationType: 'SIDE_STORY', format: 'MOVIE' }), 'movie')
  assert.equal(classifyEdge({ relationType: 'SIDE_STORY', format: 'OVA' }), 'ova')
  assert.equal(classifyEdge({ relationType: 'SIDE_STORY', format: 'ONA' }), 'ona')
  assert.equal(classifyEdge({ relationType: 'ALTERNATIVE' }), 'alternative-version')
  assert.equal(classifyEdge({ relationType: 'ALTERNATIVE', remake: true }), 'remake')
  assert.equal(classifyEdge({ relationType: 'OTHER', format: 'ONA', bonus: true }), 'special')
  assert.equal(relativeKind({ relationType: 'SEQUEL' }), 'sequel')
  assert.equal(relativeKind({ relationType: 'SEQUEL' }, { fromB: true }), 'prequel', 'mirrored edges invert')

  assert.equal(stripPartMarkers('Tensei Shitara Slime Datta Ken 2nd Season Part 2'), 'Tensei Shitara Slime Datta Ken 2nd Season')
  assert.equal(stripPartMarkers('Title 第2クール'), 'Title')
  assert.equal(isSplitCourPair('Show Season 2', 'Show Season 2 Part 2'), true)
  assert.equal(isSplitCourPair('Show Season 2', 'Show Season 3'), false)
  assert.equal(isSplitCourPair('Show', 'Show'), false, 'identical titles are duplicates, not split-cour')

  assert.equal(normalizeTitleKey('Re:ZERO -Starting Life in Another World-'), normalizeTitleKey('Re:ZERO -Starting Life in Another World'))
  assert.ok(titleAliasKeys({ title: 'X', native: '外伝', synonyms: ['Y'] }).size >= 3)
  assert.equal(relationshipCacheKey('a', 'b'), relationshipCacheKey('b', 'a'))
})
