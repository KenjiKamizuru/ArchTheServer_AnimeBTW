// Tests for watch-order recommendations and ordering-note sanitizing
// (server/watchOrder.mjs, AV-084).
import test from 'node:test'
import assert from 'node:assert/strict'
import { recommendWatchOrder, sanitizeOrderingNote } from '../server/watchOrder.mjs'
import { buildDetailResponse } from '../server/detail.mjs'

const A = { id: 1, uncertain: false }
const B = { id: 2, uncertain: false }

test('recommendWatchOrder recommends release when both orders agree', () => {
  const rec = recommendWatchOrder([A, B], [A, B])
  assert.equal(rec.recommended, 'release')
  assert.equal(rec.agree, true)
  assert.equal(rec.alternative, 'chronological')
  assert.ok(rec.rationale.length > 0)
  assert.equal(recommendWatchOrder([], []).recommended, 'release', 'nothing to order defaults to release')
})

test('recommendWatchOrder prefers chronological when orders differ and dates are complete', () => {
  const rec = recommendWatchOrder([A, B], [B, A])
  assert.equal(rec.recommended, 'chronological')
  assert.equal(rec.agree, false)
  assert.equal(rec.alternative, 'release')
})

test('recommendWatchOrder falls back to release when chronological order is incomplete', () => {
  const rec = recommendWatchOrder([A, B], [{ ...B, uncertain: true }, A])
  assert.equal(rec.recommended, 'release')
  assert.equal(rec.agree, false)
  assert.ok(rec.rationale.includes('undated'))
})

test('sanitizeOrderingNote trims and caps user input', () => {
  assert.equal(sanitizeOrderingNote('  watch the movie first  '), 'watch the movie first')
  assert.equal(sanitizeOrderingNote(null), '')
  assert.equal(sanitizeOrderingNote('x'.repeat(5000)).length, 2000)
})

test('the detail payload carries a watch-order recommendation', () => {
  const res = buildDetailResponse({
    title: 'Franchise',
    episodes: 2,
    timelineNodes: [
      { id: 2, title: { romaji: 'Second' }, seasonYear: 2012, startDate: { year: 2012, month: 4, day: 5 } },
      { id: 1, title: { romaji: 'First' }, seasonYear: 2010, startDate: { year: 2010, month: 4, day: 5 } },
    ],
  })
  assert.ok(res.watchOrder, 'watchOrder is present')
  assert.ok(['release', 'chronological'].includes(res.watchOrder.recommended))
  assert.equal(typeof res.watchOrder.rationale, 'string')
})
