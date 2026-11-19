// Tests for the exportable anime information sheet (server/sheet.mjs, AV-100).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInfoSheet } from '../server/sheet.mjs'
import { buildDetailResponse } from '../server/detail.mjs'

test('buildInfoSheet renders the markdown information sheet', () => {
  const sheet = buildInfoSheet({
    title: 'Frieren',
    format: 'TV',
    season: 'SPRING',
    seasonYear: 2023,
    status: 'FINISHED',
    episodes: 28,
    duration: 24,
    score: 92,
    studios: ['Studio A'],
    genres: ['Adventure', 'Drama'],
    synopsis: { text: 'An elven mage travels.', hiddenCount: 0 },
    relatedSeasons: [
      { title: 'Prequel', relationType: 'PREQUEL' },
      { title: 'Movie', relationType: 'SIDE_STORY' },
    ],
    links: [{ site: 'AniList', url: 'https://anilist.co/x' }],
  })
  assert.ok(sheet.startsWith('# Frieren\n\nFormat: TV\nSeason: SPRING 2023'))
  assert.ok(sheet.includes('Status: FINISHED'))
  assert.ok(sheet.includes('Episodes: 28'))
  assert.ok(sheet.includes('Runtime: 24 min'))
  assert.ok(sheet.includes('Score: 92/100'))
  assert.ok(sheet.includes('Studios: Studio A'))
  assert.ok(sheet.includes('Genres: Adventure, Drama'))
  assert.ok(sheet.includes('An elven mage travels.'))
  assert.ok(sheet.includes('## Watch order'))
  assert.ok(sheet.includes('2. Prequel (prequel)'))
  assert.ok(sheet.includes('3. Movie (side_story)'))
  assert.ok(sheet.includes('## Links'))
  assert.ok(sheet.includes('- AniList: https://anilist.co/x'))
  assert.equal(buildInfoSheet({}), '')
})

test('the sheet is spoiler-safe and note-free', () => {
  const res = buildDetailResponse({ title: 'T', description: 'Intro. ~!the hero dies!~ end.' })
  const sheet = buildInfoSheet(res)
  assert.ok(!sheet.includes('the hero dies'), 'hidden spoilers never reach the sheet')
  assert.ok(sheet.includes('[spoiler hidden]'))
  assert.ok(!buildInfoSheet({ title: 'T', note: 'PRIVATE NOTE', notes: 'PRIVATE' }).includes('PRIVATE'), 'private notes are never exported')
  assert.equal(res.infoSheet, sheet, 'the detail payload ships the pre-computed sheet')
})
