// Tests for character detail normalization (server/character.mjs, AV-085).
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCharacter } from '../server/character.mjs'

test('normalizeCharacter maps names, description and media appearances', () => {
  const raw = {
    Character: {
      id: 5,
      name: { full: 'Frieren', native: 'フリーレン', alternative: ['Frieren the Slayer', null] },
      image: { large: 'https://img/5.jpg' },
      description: 'An elven mage.',
      siteUrl: 'https://anilist.co/character/5',
      media: {
        edges: [
          { characterRole: 'MAIN', node: { id: 200, type: 'ANIME', format: 'TV', title: { romaji: 'Sousou no Frieren' }, startDate: { year: 2023 } } },
          { characterRole: 'SUPPORTING', node: { id: 201, type: 'MANGA', title: { english: 'Frieren Manga' }, startDate: {} } },
          { node: { id: 999 } },
          { node: null },
        ],
      },
    },
  }
  const c = normalizeCharacter(raw)
  assert.equal(c.id, 5)
  assert.equal(c.name, 'Frieren')
  assert.equal(c.nativeName, 'フリーレン')
  assert.deepEqual(c.alternativeNames, ['Frieren the Slayer'], 'empty alternatives dropped')
  assert.equal(c.description, 'An elven mage.')
  assert.deepEqual(c.media.map((m) => m.id), [200, 201, 999], 'appearance rows without nodes dropped')
  assert.equal(c.media[0].characterRole, 'MAIN')
  assert.equal(c.media[0].year, 2023)
  assert.equal(c.media[1].title, 'Frieren Manga')
  assert.equal(c.media[1].year, null)
  assert.equal(c.media[2].title, '#999', 'untitled appearances fall back to the id')
})

test('normalizeCharacter sanitizes urls and tolerates missing fields', () => {
  assert.equal(normalizeCharacter(null), null)
  assert.equal(normalizeCharacter({ Character: {} }), null)
  assert.equal(normalizeCharacter({ id: 'nope' }), null)
  const c = normalizeCharacter({ id: 7, name: {}, image: {}, siteUrl: 'javascript:alert(1)', media: null })
  assert.equal(c.name, 'Character #7', 'name falls back to the id')
  assert.equal(c.image, null)
  assert.equal(c.siteUrl, null, 'dangerous urls are dropped')
  assert.deepEqual(c.media, [])
  assert.equal(c.description, '')
})
