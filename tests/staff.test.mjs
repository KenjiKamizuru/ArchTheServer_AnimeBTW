// Tests for staff member normalization (server/staff.mjs, AV-086/AV-087).
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeStaffMember } from '../server/staff.mjs'

test('normalizeStaffMember maps names, occupations and media credits', () => {
  const raw = {
    Staff: {
      id: 42,
      name: { full: 'Yuki Kajiura', native: '梶浦 由記', alternative: [null] },
      image: { large: 'https://img/42.jpg' },
      description: 'Composer.',
      siteUrl: 'https://anilist.co/staff/42',
      primaryOccupations: ['Music', 'Composer'],
      staffMedia: {
        edges: [
          { role: 'Music', node: { id: 200, type: 'ANIME', format: 'TV', title: { romaji: 'Fiction' }, startDate: { year: 2003 } } },
          { role: 'Director', node: { id: 201, type: 'ANIME', title: { english: 'Other Work' }, startDate: {} } },
          { node: { id: 999 } },
          { node: null },
        ],
      },
    },
  }
  const s = normalizeStaffMember(raw)
  assert.equal(s.id, 42)
  assert.equal(s.name, 'Yuki Kajiura')
  assert.equal(s.nativeName, '梶浦 由記')
  assert.deepEqual(s.alternativeNames, [])
  assert.deepEqual(s.primaryOccupations, ['Music', 'Composer'])
  assert.deepEqual(s.media.map((m) => m.id), [200, 201, 999], 'credit rows without nodes dropped')
  assert.equal(s.media[0].role, 'Music')
  assert.equal(s.media[0].year, 2003)
  assert.equal(s.media[1].title, 'Other Work')
  assert.equal(s.media[1].year, null)
  assert.equal(s.media[2].title, '#999')
  assert.equal(s.media[2].role, null)
})

test('normalizeStaffMember flattens voice roles into character credits', () => {
  const raw = {
    Staff: {
      id: 7,
      name: { full: 'Voice Actor' },
      characters: {
        edges: [
          {
            role: 'MAIN',
            node: { id: 5, name: { full: 'Frieren' } },
            media: { nodes: [{ id: 200, title: { romaji: 'Sousou no Frieren' } }, { id: 201, title: {} }, { id: null }] },
          },
          { role: 'SUPPORTING', node: { id: 6, name: {} }, media: { nodes: [{ id: 202, title: { english: 'Other' } }] } },
          { node: null, media: { nodes: [{ id: 300 }] } },
          { role: 'BACKGROUND', node: { id: 8 }, media: { nodes: [] } },
        ],
      },
    },
  }
  const s = normalizeStaffMember(raw)
  assert.deepEqual(s.characterCredits, [
    { characterId: 5, characterName: 'Frieren', role: 'MAIN', mediaId: 200, mediaTitle: 'Sousou no Frieren' },
    { characterId: 5, characterName: 'Frieren', role: 'MAIN', mediaId: 201, mediaTitle: '#201' },
    { characterId: 6, characterName: 'Character #6', role: 'SUPPORTING', mediaId: 202, mediaTitle: 'Other' },
  ], 'one row per (character, media) pair; nodeless edges and empty media dropped')
})

test('normalizeStaffMember sanitizes urls and tolerates missing fields', () => {
  assert.equal(normalizeStaffMember(null), null)
  assert.equal(normalizeStaffMember({ Staff: {} }), null)
  assert.equal(normalizeStaffMember({ id: 'nope' }), null)
  const s = normalizeStaffMember({ id: 7, name: {}, image: {}, siteUrl: 'javascript:alert(1)', staffMedia: null, primaryOccupations: 'bad' })
  assert.equal(s.name, 'Staff #7')
  assert.equal(s.image, null)
  assert.equal(s.siteUrl, null, 'dangerous urls are dropped')
  assert.deepEqual(s.media, [])
  assert.deepEqual(s.characterCredits, [])
  assert.deepEqual(s.primaryOccupations, [])
  assert.equal(s.description, '')
})
