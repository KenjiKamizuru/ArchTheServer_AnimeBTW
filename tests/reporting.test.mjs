// Tests for the metadata correction suggestion workflow (server/reporting.mjs, AV-096).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMetadataReport, REPORT_FIELDS } from '../server/reporting.mjs'

test('buildMetadataReport builds a structured correction suggestion', () => {
  const { ok, report } = buildMetadataReport(
    { mediaId: 200, field: 'title', message: 'Should be the full title', kind: 'metadata', suggestedValue: 'Sousou no Frieren' },
    { now: 123, id: 'r_test' },
  )
  assert.equal(ok, true)
  assert.deepEqual(report, {
    id: 'r_test',
    mediaId: 200,
    kind: 'metadata',
    field: 'title',
    message: 'Should be the full title',
    suggestedValue: 'Sousou no Frieren',
    createdAt: 123,
    status: 'open',
  })
})

test('buildMetadataReport enforces the workflow contract', () => {
  assert.deepEqual(buildMetadataReport({ mediaId: 1, message: '' }), { ok: false, error: 'Please describe the problem' })
  assert.deepEqual(buildMetadataReport({ mediaId: 1, message: '   ' }), { ok: false, error: 'Please describe the problem' })
  assert.deepEqual(buildMetadataReport({ mediaId: 0, message: 'x' }), { ok: false, error: 'Invalid anime id' })
  const coerced = buildMetadataReport({ mediaId: 5, message: 'x', field: 'nonsense', kind: 'weird', suggestedValue: '  ' }, { id: 'r1' })
  assert.equal(coerced.report.field, 'other', 'unknown fields fall back to other')
  assert.equal(coerced.report.kind, 'metadata', 'unknown kinds fall back to metadata')
  assert.equal(coerced.report.suggestedValue, null, 'blank suggestions are stored as null')
  const order = buildMetadataReport({ mediaId: 5, message: 'x', kind: 'episode-order' }, { id: 'r2' })
  assert.equal(order.report.kind, 'episode-order')
  const capped = buildMetadataReport(
    { mediaId: 5, message: 'm'.repeat(2000), suggestedValue: 'v'.repeat(1000) },
    { id: 'r3' },
  )
  assert.equal(capped.report.message.length, 1000)
  assert.equal(capped.report.suggestedValue.length, 400)
  assert.ok(REPORT_FIELDS.has('episode-order'))
})
