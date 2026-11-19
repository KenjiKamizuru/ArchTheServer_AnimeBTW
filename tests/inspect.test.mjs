// Tests for the admin inspector comparison rows (server/inspect.mjs, AV-025b).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInspectionRows } from '../server/inspect.mjs'

test('inspection rows expose raw and normalized values with change flags', () => {
  const raw = {
    title: { romaji: 'Rei', english: 'Base Title' },
    status: 'RELEASING',
    episodes: 12,
    averageScore: 81,
    genres: ['Drama'],
    startDate: { year: 2026, month: 4 },
  }
  const record = {
    title: 'Base Title',
    romaji: 'Rei',
    english: 'Base Title',
    status: 'RELEASING',
    episodes: 12,
    score: 81,
    genres: ['Drama'],
    startDate: { year: 2026, month: 4, day: null },
  }
  const rows = buildInspectionRows(raw, record)
  const byField = Object.fromEntries(rows.map((row) => [row.field, row]))
  assert.equal(byField.title.changed, true, 'title object becomes a display string')
  assert.equal(byField.title.normalized, 'Base Title')
  assert.equal(byField.romaji.changed, false, 'equal values stay unflagged')
  assert.equal(byField.score.raw, 81, 'raw shows the provider value')
  assert.equal(byField.score.normalized, 81, 'normalized shows the record value')
  assert.equal(byField.episodes.changed, false)
  assert.equal(byField.startDate.changed, true, 'fuzzy date gains an explicit day slot')
  assert.equal(byField.status.changed, false)
})

test('inspection rows tolerate missing inputs', () => {
  const rows = buildInspectionRows(null, undefined)
  assert.equal(rows.length, 21)
  for (const row of rows) {
    assert.equal(row.raw, null)
    assert.equal(row.normalized, null)
    assert.equal(row.changed, false)
  }
})
