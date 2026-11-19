// Tests for verified franchise grouping (AV-117d1): explore.buildFranchiseGroups
// partitioning + relations.continuationKind annotations.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFranchiseGroups } from '../server/explore.mjs'
import { continuationKind } from '../server/relations.mjs'

const slimeS1 = {
  id: 98459,
  title: 'That Time I Got Reincarnated as a Slime',
  seasonYear: 2018,
  relations: [
    { relationType: 'SEQUEL', node: { id: 114745 } },
    { relationType: 'SPIN_OFF', node: { id: 128705 } },
  ],
}
const slimeS2 = {
  id: 114745,
  title: 'Tensei Shitara Slime Datta Ken 2nd Season',
  seasonYear: 2021,
  relations: [
    { relationType: 'PREQUEL', node: { id: 98459 } },
    { relationType: 'SEQUEL', node: { id: 116742 } },
  ],
}
const slimeS2Part2 = {
  id: 116742,
  title: 'Tensei Shitara Slime Datta Ken 2nd Season Part 2',
  seasonYear: 2021,
  relations: [{ relationType: 'PREQUEL', node: { id: 114745 } }],
}
const diaries = {
  id: 128705,
  title: 'The Slime Diaries',
  seasonYear: 2021,
  relations: [{ relationType: 'SPIN_OFF', node: { id: 98459 } }],
}
const yohaneCrossover = {
  id: 155847,
  title: 'Genjitsu no Rimuru: SUNSHINE in the SLIME',
  seasonYear: 2023,
  // Crossover OTHER edges must not union franchises (Tensura × Yohane).
  relations: [
    { relationType: 'OTHER', node: { id: 98459 } },
    { relationType: 'OTHER', node: { id: 999999 } },
  ],
}
const unrelated = {
  id: 128547,
  title: 'Killing Slimes for 300 Years',
  seasonYear: 2021,
  relations: [],
}

test('franchise groups partition seasons from branches (never one season list)', () => {
  const groups = buildFranchiseGroups([slimeS1, slimeS2, slimeS2Part2, diaries, yohaneCrossover, unrelated])
  const main = groups.find((group) => group.media.some((member) => member.id === 98459))
  assert.ok(main, 'the franchise forms one group')
  assert.ok(main.media.some((member) => member.id === 128705), 'spin-offs join the franchise (not "unrelated")')
  assert.ok(!main.media.some((member) => member.id === 155847), 'OTHER crossover edges do not union franchises')

  const seasonIds = main.seasons.map((member) => member.id).sort((a, b) => a - b)
  const branchIds = main.branches.map((member) => member.id).sort((a, b) => a - b)
  assert.deepEqual(seasonIds, [98459, 114745, 116742], 'main line = S1 + S2 + S2 Part 2')
  assert.deepEqual(branchIds, [128705], 'The Slime Diaries is a branch, not a season')
  const diariesMember = main.media.find((member) => member.id === 128705)
  assert.equal(diariesMember.relationKind, 'spin-off')
  const s2Member = main.media.find((member) => member.id === 114745)
  assert.equal(s2Member.relationKind, 'prequel', 'kind as seen from its own edge')
  assert.equal(main.media.find((member) => member.id === 98459).relationKind, 'main', 'the anchor is main')
  assert.equal(main.seasons.length + main.branches.length, main.count)
})

test('continuationKind annotates related seasons (split-cour from official titles)', () => {
  assert.equal(
    continuationKind({ relationType: 'SEQUEL' }, { titleA: 'Show 2nd Season', titleB: 'Show 2nd Season Part 2' }),
    'split-cour',
  )
  assert.equal(
    continuationKind({ relationType: 'SEQUEL' }, { titleA: 'Show', titleB: 'Show 2nd Season' }),
    'next-season',
  )
  assert.equal(continuationKind({ relationType: 'PREQUEL' }), 'prequel')
  assert.equal(continuationKind({ relationType: 'SPIN_OFF' }), 'spin-off')
})
