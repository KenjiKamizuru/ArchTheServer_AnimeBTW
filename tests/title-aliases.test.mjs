// Tests for the provider-tagged title alias index (server/search.mjs, AV-057).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTitleAliasIndex } from '../server/search.mjs'

test('buildTitleAliasIndex aggregates aliases across providers', () => {
  const record = {
    title: 'Frieren',
    romaji: 'Sousou no Frieren',
    english: "Frieren: Beyond Journey's End",
    native: '葬送のフリーレン',
    synonyms: ['Frieren', 'Sousou no Frieren'],
    meta: {
      source: 'anilist',
      refreshedAt: 5,
      fields: {
        title: { source: 'manual', refreshedAt: 6, alternates: ['Frieren at the Funeral'] },
        english: { source: 'anidb', refreshedAt: 7, alternates: ["Frieren's Journey"] },
      },
      states: {},
    },
  }
  const index = buildTitleAliasIndex(record)
  assert.deepEqual(
    index.map((entry) => entry.label),
    ['Frieren', 'Sousou no Frieren', "Frieren: Beyond Journey's End", '葬送のフリーレン', 'Frieren at the Funeral', "Frieren's Journey"],
    'canonical variants first, synonyms and alternates deduped by normalized form',
  )
  assert.equal(index[0].source, 'anilist')
  assert.equal(index[3].source, 'anilist')
  assert.equal(index[4].source, 'manual', 'correction alternates carry their provider')
  assert.equal(index[5].source, 'anidb', 'provider alternates carry their provider')
})

test('buildTitleAliasIndex tolerates sparse records', () => {
  assert.deepEqual(buildTitleAliasIndex(null), [])
  assert.deepEqual(buildTitleAliasIndex({ title: 'Solo' }), [{ label: 'Solo', source: 'unknown' }])
  assert.deepEqual(
    buildTitleAliasIndex({ title: 'A', synonyms: ['A', 'B'] }),
    [{ label: 'A', source: 'unknown' }, { label: 'B', source: 'unknown' }],
  )
})
