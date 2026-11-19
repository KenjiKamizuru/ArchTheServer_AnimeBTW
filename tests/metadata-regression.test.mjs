// End-to-end offline regression (AV-117e, Phase 9): the FULL pipeline —
// AniList adapter evidence → verifyPairOnline → relationship store — over the
// user's example franchises with real, online-verified metadata
// (docs/ANIME_METADATA_SOURCES.md, tests/relations.test.mjs sources).
import test from 'node:test'
import assert from 'node:assert/strict'
import { lookupEvidence } from '../server/metadata/providers/anilist.mjs'
import { verifyPairOnline } from '../server/relationsOnline.mjs'
import { createRelationshipStore } from '../server/metadata/relationshipStore.mjs'

/** AniList GraphQL Media fixtures (evidence verified 2026-11). */
const MEDIA = {
  slimeS1: {
    id: 98459,
    format: 'TV',
    title: { romaji: 'Tensei Shitara Slime Datta Ken', english: 'That Time I Got Reincarnated as a Slime' },
    synonyms: ['TenSura'],
    relations: {
      edges: [
        { relationType: 'SEQUEL', format: 'TV', nodes: [{ id: 114745, format: 'TV', title: { romaji: 'Tensei Shitara Slime Datta Ken 2nd Season' } }] },
        { relationType: 'SPIN_OFF', format: 'TV', nodes: [{ id: 128705, format: 'TV', title: { romaji: 'Tensura Nikki: Tensei Shitara Slime Datta Ken' } }] },
        { relationType: 'OTHER', format: 'ONA', nodes: [{ id: 51309, format: 'ONA', title: { romaji: 'Tensei Shitara Slime Datta Ken: Sukuwareru Ramiris' } }] },
      ],
    },
  },
  slimeS2P2: {
    id: 116742,
    format: 'TV',
    title: { romaji: 'Tensei Shitara Slime Datta Ken 2nd Season Part 2', english: 'That Time I Got Reincarnated as a Slime Season 2 Part 2' },
    relations: {
      edges: [
        { relationType: 'PREQUEL', format: 'TV', nodes: [{ id: 114745, format: 'TV', title: { romaji: 'Tensei Shitara Slime Datta Ken 2nd Season' } }] },
      ],
    },
  },
  clayman: {
    id: 40001,
    format: 'TV',
    title: { romaji: 'Tensei Shitara Slime Datta Ken: Clayman REVENGE' },
    // anilist.co/manga/86355 relations list Clayman REVENGE with a Spin Off edge.
    relations: {
      edges: [
        { relationType: 'SPIN_OFF', format: 'MANGA', nodes: [{ id: 86355, format: 'MANGA', title: { romaji: 'Tensei Shitara Slime Datta Ken' } }] },
      ],
    },
  },
  ramiris: {
    id: 51309,
    format: 'ONA',
    title: { romaji: 'Tensei Shitara Slime Datta Ken: Sukuwareru Ramiris' },
    relations: {
      edges: [
        { relationType: 'OTHER', format: 'TV', nodes: [{ id: 98459, format: 'TV', title: { romaji: 'Tensei Shitara Slime Datta Ken' } }] },
      ],
    },
  },
  rezero: {
    id: 21355,
    format: 'TV',
    title: { romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu', english: 'Re:ZERO -Starting Life in Another World-' },
    synonyms: ['Re:ZERO -Starting Life in Another World'],
    relations: { edges: [] },
  },
  killingSlimes: {
    id: 128547,
    format: 'TV',
    title: { romaji: 'Slime Taoshite 300-nen, Shiranai Uchi ni Level Max ni Nattemashita', english: "I've Been Killing Slimes for 300 Years" },
    relations: { edges: [] },
  },
}

function makeLookup() {
  return async (input) => {
    const id = input?.sourceIds?.anilist
    const media = Object.values(MEDIA).find((item) => String(item.id) === String(id ?? '')) ?? null
    if (!media) return null
    return lookupEvidence({ sourceIds: { anilist: String(media.id) } }, {
      gql: async () => ({ Media: media }),
    })
  }
}

test('pipeline regression: Slime franchise typing end to end', async () => {
  const cache = new Map()
  const lookup = makeLookup()
  const a = { sourceIds: { anilist: '98459' }, title: 'That Time I Got Reincarnated as a Slime' }
  const b = { sourceIds: { anilist: '116742' }, title: 'That Time I Got Reincarnated as a Slime Season 2 Part 2' }

  const s1s2p2 = await verifyPairOnline(a, b, { lookup, cache, now: 1_000 })
  assert.equal(s1s2p2.type, 'next-season', 'S1 ↔ S2 Part 2 is a season continuation')
  assert.ok(['verified', 'indirect'].includes(s1s2p2.verification))
  assert.equal(s1s2p2.uncertain, false)

  const claymanPair = await verifyPairOnline(
    { sourceIds: { anilist: '98459' }, title: 'That Time I Got Reincarnated as a Slime' },
    { sourceIds: { anilist: '40001' }, title: 'Tensei Shitara Slime Datta Ken: Clayman REVENGE' },
    { lookup, cache, now: 2_000 },
  )
  assert.equal(claymanPair.type, 'spin-off', 'Clayman REVENGE is a spin-off, never a season')

  const ramirisPair = await verifyPairOnline(
    { sourceIds: { anilist: '98459' }, title: 'That Time I Got Reincarnated as a Slime' },
    { sourceIds: { anilist: '51309' }, title: 'Tensei Shitara Slime Datta Ken: Sukuwareru Ramiris' },
    { lookup, cache, now: 3_000 },
  )
  // AniList-only evidence (OTHER edge to the ONA) types this 'ona'; MAL's
  // "Other"+bonus cross-check refines it to 'special' (tests/relations.test.mjs).
  // Both are correct taxonomy answers — more evidence refines the type.
  assert.equal(ramirisPair.type, 'ona', 'a bonus ONA of the series — never a season')
  assert.equal(ramirisPair.uncertain, false)
})

test('pipeline regression: Re:ZERO duplicates and similar-name non-merge', async () => {
  const cache = new Map()
  const lookup = makeLookup()
  const dup = await verifyPairOnline(
    { sourceIds: { anilist: '21355' }, title: 'Re:ZERO -Starting Life in Another World' },
    { sourceIds: { anilist: '21355' }, title: 'Re:ZERO -Starting Life in Another World-' },
    { lookup, cache, now: 1_000 },
  )
  assert.equal(dup.type, 'same-entry', 'dash variant resolves to one record')

  const unrelated = await verifyPairOnline(
    { sourceIds: { anilist: '98459' }, title: 'That Time I Got Reincarnated as a Slime' },
    { sourceIds: { anilist: '128547' }, title: 'Slime Taoshite 300-nen, Shiranai Uchi ni Level Max ni Nattemashita' },
    { lookup, cache, now: 2_000 },
  )
  assert.equal(unrelated.type, 'unrelated', '"Slime" in both titles must not connect them')
  assert.equal(unrelated.uncertain, false, 'evidence-based negative, not a guess')
})

test('pipeline regression: verdicts persist through the verified store', async () => {
  const data = new Map()
  const kv = {
    get: async (key, fallback = null) => (data.has(key) ? data.get(key) : fallback),
    set: async (key, value) => {
      data.set(key, value)
    },
  }
  const store = createRelationshipStore(kv)
  const cache = new Map()
  const lookup = makeLookup()
  const verdict = await verifyPairOnline(
    { sourceIds: { anilist: '98459' }, title: 'That Time I Got Reincarnated as a Slime' },
    { sourceIds: { anilist: '40001' }, title: 'Tensei Shitara Slime Datta Ken: Clayman REVENGE' },
    { lookup, cache, now: 1_000 },
  )
  await store.save('anilist:98459', 'anilist:40001', verdict)
  const stored = await store.get('anilist:40001', 'anilist:98459')
  assert.equal(stored.type, 'spin-off')
  const again = await store.save('anilist:40001', 'anilist:98459', { ...verdict, type: 'next-season', verification: 'unverified', uncertain: true })
  assert.equal(again.outcome, 'kept-verified')
  assert.equal((await store.get('anilist:98459', 'anilist:40001')).type, 'spin-off', 'verified verdict survives')
})
