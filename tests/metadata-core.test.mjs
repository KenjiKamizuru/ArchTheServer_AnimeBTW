// Tests for the unified model + identity matching (AV-117a/b).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUnifiedAnime,
  normalizeUnifiedAnime,
  mergeField,
  flagEpisodeDiscrepancy,
} from '../server/metadata/model.mjs'
import { matchIdentity, isDuplicateEntry, franchiseOf } from '../server/metadata/identity.mjs'

test('mergeField never overwrites a verified value with an unverified one', () => {
  let record = normalizeUnifiedAnime({ internalId: 'anilist:98459' })
  const first = mergeField(record, 'episodes', {
    source: 'anilist', sourceId: '98459', value: 24, verification: 'verified', updatedAt: 100,
  })
  record = first.record
  assert.equal(first.outcome, 'accepted')
  assert.equal(record.episodes, 24)

  const second = mergeField(record, 'episodes', {
    source: 'kitsu', sourceId: '5178', value: 26, verification: 'unverified', updatedAt: 200,
  })
  record = second.record
  assert.equal(second.outcome, 'kept-verified')
  assert.equal(record.episodes, 24, 'verified value survives')
  const trail = record.provenance.episodes
  assert.equal(trail.length, 2)
  assert.equal(trail[1].verification, 'conflicting', 'the disagreement is retained, not hidden')
  assert.equal(trail[1].value, 26)

  // An agreeing verified value is accepted normally.
  const third = mergeField(record, 'episodes', {
    source: 'mal', sourceId: '37430', value: 24, verification: 'verified', updatedAt: 300,
  })
  assert.equal(third.outcome, 'accepted')
  assert.equal(third.record.episodes, 24)
})

test('episode discrepancies across providers are flagged', () => {
  let record = normalizeUnifiedAnime({})
  record = mergeField(record, 'episodes', { source: 'anilist', value: 24, verification: 'verified' }).record
  record = mergeField(record, 'episodes', { source: 'mal', value: 24, verification: 'unverified' }).record
  assert.equal(flagEpisodeDiscrepancy(record).discrepancy, false)
  record = mergeField(record, 'episodes', { source: 'kitsu', value: 25, verification: 'unverified' }).record
  const flagged = flagEpisodeDiscrepancy(record)
  assert.equal(flagged.discrepancy, true)
  assert.deepEqual(flagged.values, [24, 25])
})

test('identity rung 1-2: exact IDs and verified mappings', () => {
  const a = { externalIds: { anilist: '98459', mal: '37430' }, titles: { canonical: 'A' } }
  const b = { externalIds: { mal: '37430' }, titles: { canonical: 'B' } }
  const byId = matchIdentity(a, b)
  assert.equal(byId.same, true)
  assert.equal(byId.kind, 'same-record')
  assert.equal(byId.rung, 'external-id')
  assert.equal(byId.confidence, 'high')

  const c = { externalIds: { kitsu: '5178' }, titles: { canonical: 'C' } }
  const mapped = matchIdentity(a, c, { mappings: { 'mal:37430': 'kitsu:5178' } })
  assert.equal(mapped.same, true)
  assert.equal(mapped.rung, 'verified-mapping')
})

test('identity rung 3-4: metadata agreement, never bare title similarity', () => {
  const a = {
    externalIds: {},
    titles: { canonical: 'Tensei Shitara Slime Datta Ken', romaji: 'Tensura' },
    release: { year: 2018 }, format: 'TV', studios: ['Eightbit'],
  }
  const sameShow = {
    externalIds: {},
    titles: { canonical: 'That Time I Got Reincarnated as a Slime', alternatives: ['Tensura'] },
    release: { year: 2018 }, format: 'TV', studios: ['Eightbit'],
  }
  const rung3 = matchIdentity(a, sameShow)
  assert.equal(rung3.same, true)
  assert.equal(rung3.rung, 'titles+year+format')

  // Similar titles, different shows — the ladder must NOT conclude identity.
  const slimeKiller = {
    externalIds: {},
    titles: { canonical: 'Slime Taoshite 300-nen, Shiranai Uchi ni Level Max ni Nattemashita' },
    release: { year: 2021 }, format: 'TV', studios: ['Revoroot'],
  }
  const notSame = matchIdentity(a, slimeKiller)
  assert.equal(notSame.same, null, 'similar names alone never merge records')
  assert.ok(notSame.reasons.length > 0)

  // Same titles, different year/format → not established either.
  const remake = { ...sameShow, release: { year: 2024 }, format: 'MOVIE' }
  assert.equal(matchIdentity(a, remake).same, null)
})

test('duplicate-entry detection keeps identity and duplicates distinct', () => {
  const a = { externalIds: { anilist: '21355' }, titles: { canonical: 'Re:ZERO -Starting Life in Another World-' } }
  const b = { externalIds: { anilist: '21355' }, titles: { canonical: 'Re:ZERO -Starting Life in Another World' } }
  const match = matchIdentity(a, b)
  assert.equal(match.same, true)
  assert.equal(isDuplicateEntry(match, a, b), true, 'dash variant = duplicate row of one record')
  assert.equal(isDuplicateEntry(match, a, a), false, 'identical rows are not duplicates')

  const franchise = { externalIds: { anilist: '128705' }, titles: { canonical: 'The Slime Diaries' }, franchise: { key: 'tensura', role: 'branch:spin-off' } }
  const main = { externalIds: { anilist: '98459' }, titles: { canonical: 'That Time I Got Reincarnated as a Slime' }, franchise: { key: 'tensura', role: 'main' } }
  assert.equal(matchIdentity(main, franchise).same, null, 'franchise membership is not identity')
  assert.equal(franchiseOf(franchise), franchiseOf(main), 'but both share the franchise key')
})

test('unknown metadata stays unknown — nothing invented', () => {
  const record = normalizeUnifiedAnime({ titles: { canonical: 'X' } })
  assert.deepEqual(record, { ...emptyUnifiedAnime(), titles: { ...emptyUnifiedAnime().titles, canonical: 'X' } })
  assert.equal(record.episodes, null)
  assert.equal(record.format, null)
  assert.deepEqual(record.externalIds, {})
})
