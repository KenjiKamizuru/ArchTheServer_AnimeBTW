// Tests for profile activity summaries (AV-117a): opt-in visibility matrix,
// attributable-only fields, strict toggle.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeShowActivity, buildActivitySummary } from '../server/profileActivity.mjs'

test('showActivity toggle is a strict boolean', () => {
  assert.deepEqual(normalizeShowActivity(true), { ok: true, value: true })
  assert.deepEqual(normalizeShowActivity(false), { ok: true, value: false })
  for (const bad of ['true', 'yes', 1, 0, null, undefined, '']) {
    assert.equal(normalizeShowActivity(bad).ok, false, `should reject ${JSON.stringify(bad)}`)
  }
})

test('activity summary: owner always, others opt-in + viewable only', () => {
  const base = { id: 'u1', createdAt: 1_000, showActivity: false, profileVisibility: 'public' }

  // Owner sees the summary even without opting in.
  const owner = buildActivitySummary(base, { activeSessions: 2, viewerIsOwner: true })
  assert.deepEqual(owner, { ok: true, activity: { memberSince: 1_000, activeSessions: 2 } })

  // Non-owner: hidden until the owner opts in.
  assert.equal(buildActivitySummary(base, { activeSessions: 2 }).activity, null)
  const opted = { ...base, showActivity: true }
  assert.deepEqual(buildActivitySummary(opted, { activeSessions: 3 }).activity, {
    memberSince: 1_000,
    activeSessions: 3,
  })

  // Opted-in but private → never for non-owners.
  const priv = { ...opted, profileVisibility: 'private' }
  assert.equal(buildActivitySummary(priv, { activeSessions: 1 }).activity, null)
  assert.ok(buildActivitySummary(priv, { activeSessions: 1, viewerIsOwner: true }).activity, 'the owner still sees it')

  // Link-only + opted-in works like public for viewers.
  const link = { ...opted, profileVisibility: 'link-only' }
  assert.ok(buildActivitySummary(link, { activeSessions: 1 }).activity)

  // Edge inputs: missing counters/createdAt stay honest (null/0, never invented).
  const sparse = buildActivitySummary({ id: 'u2', showActivity: true }, {})
  assert.deepEqual(sparse.activity, { memberSince: null, activeSessions: 0 })
  const negative = buildActivitySummary(opted, { activeSessions: -5, viewerIsOwner: true })
  assert.equal(negative.activity.activeSessions, 0, 'counters are clamped, never negative')
})
