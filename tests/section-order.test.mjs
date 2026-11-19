// Tests for user-saved detail-section ordering (AV-098a): the order the user
// arranges is sanitized, pinned `always` sections stay first, and the detail
// payload ships the arranged section list.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSectionOrder, applySectionOrder, buildDetailResponse } from '../server/detail.mjs'

test('normalizeSectionOrder cleans a saved order', () => {
  assert.deepEqual(normalizeSectionOrder(['scores', ' scores ', '', null, 'episodes']), ['scores', 'episodes'])
  assert.deepEqual(normalizeSectionOrder('nope'), [])
  assert.deepEqual(normalizeSectionOrder(undefined), [])
  assert.equal(normalizeSectionOrder(Array.from({ length: 40 }, (_, i) => `s${i}`)).length, 24, 'capped')
})

test('applySectionOrder pins always-sections and drops unknowns', () => {
  const arranged = applySectionOrder(['scores', 'notes', 'bogus', 'scores', 'episodes'])
  const ids = arranged.map((s) => s.id)
  assert.equal(ids[0], 'overview', 'the always section stays first')
  assert.deepEqual(ids.slice(1, 4), ['scores', 'notes', 'episodes'], 'user order honored, duplicates/bogus dropped')
  assert.ok(ids.includes('characters') && ids.includes('links'), 'unsaved sections are appended in default order')
  assert.equal(ids.length, new Set(ids).size, 'no duplicates')
  const fallback = applySectionOrder(undefined)
  assert.deepEqual(fallback.map((s) => s.id)[0], 'overview')
  assert.equal(fallback.length, applySectionOrder([]).length, 'no saved order keeps the default arrangement')
})

test('buildDetailResponse ships the arranged sections', () => {
  const res = buildDetailResponse({ title: 'T' }, { sectionOrder: ['links', 'episodes'] })
  assert.deepEqual(res.sections.map((s) => s.id).slice(0, 3), ['overview', 'links', 'episodes'])
  assert.equal(res.sections.some((s) => s.id === 'notes'), true, 'unsaved sections are appended')
})
