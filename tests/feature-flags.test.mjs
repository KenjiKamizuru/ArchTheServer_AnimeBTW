// Tests for account-level feature flags / beta opt-ins (AV-125a).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeBetaCode,
  normalizeBetaOptIns,
  normalizeBetaOptInsUpdate,
  setBetaOptIns,
  betaOptInsView,
  hasBetaOptIn,
  MAX_BETAS,
} from '../server/featureFlags.mjs'

test('beta codes: lowercase slugs, trimmed, bounded (AV-125a)', () => {
  assert.equal(normalizeBetaCode('  New-Lists 2 ').ok, false, 'inner spaces rejected')
  assert.deepEqual(normalizeBetaCode('  New-Lists2 '), { ok: true, value: 'new-lists2' }, 'trimmed + lowercased')
  assert.deepEqual(normalizeBetaCode('x'), { ok: true, value: 'x' })
  assert.deepEqual(normalizeBetaCode('a'.repeat(32)), { ok: true, value: 'a'.repeat(32) })
  for (const bad of ['', '   ', null, undefined, '1abc', '-lead', 'has space', 'has_under', 'has.dot', 'a'.repeat(33), 'Ünicode']) {
    assert.equal(normalizeBetaCode(bad).ok, false, `rejects ${JSON.stringify(bad)}`)
  }
})

test('opt-in lists: dedupe, cap, strict updates (AV-125a)', () => {
  // Dedupe is case-insensitive; order-preserving on input.
  const parsed = normalizeBetaOptIns(['Beta-A', 'beta-a', 'beta-b'])
  assert.deepEqual(parsed, { ok: true, value: ['beta-a', 'beta-b'] })

  assert.equal(normalizeBetaOptIns('beta-a').ok, false, 'non-arrays rejected')
  assert.equal(normalizeBetaOptIns(['ok', '1bad']).ok, false, 'one malformed entry rejects the list')
  const over = normalizeBetaOptIns(Array.from({ length: MAX_BETAS + 1 }, (_, i) => `code-${i}`))
  assert.equal(over.ok, false)
  assert.match(over.error, new RegExp(String(MAX_BETAS)))
  assert.equal(normalizeBetaOptIns(Array.from({ length: MAX_BETAS }, (_, i) => `code-${i}`)).ok, true)

  // Strict update: betas required, replaces the list, [] clears, unknown keys ignored.
  assert.equal(normalizeBetaOptInsUpdate({}).ok, false, 'betas is required')
  assert.deepEqual(normalizeBetaOptInsUpdate({ betas: [], extra: 1 }), { ok: true, value: [] }, 'empty clears; unknown keys ignored')
  assert.equal(normalizeBetaOptInsUpdate({ betas: 'x' }).ok, false)
  assert.equal(normalizeBetaOptInsUpdate(null).ok, false)
})

test('storage view + consumption helper (AV-125a)', () => {
  const user = { username: 'kenji' }
  assert.deepEqual(betaOptInsView(user), { betas: [] }, 'no opt-ins before any are set')

  setBetaOptIns(user, ['beta-b', 'beta-a'])
  assert.deepEqual(user.betaOptIns, ['beta-b', 'beta-a'], 'stored as replaced')
  assert.deepEqual(betaOptInsView(user), { betas: ['beta-a', 'beta-b'] }, 'view is sorted for stable output')

  assert.equal(hasBetaOptIn(user, ' BETA-A '), true, 'lookup normalizes the code')
  assert.equal(hasBetaOptIn(user, 'beta-z'), false)
  assert.equal(hasBetaOptIn(user, 'not a code'), false, 'malformed lookups never match')
  assert.equal(hasBetaOptIn({}, 'beta-a'), false, 'accounts without opt-ins never match')

  setBetaOptIns(user, [])
  assert.deepEqual(betaOptInsView(user), { betas: [] }, 'empty list clears')
})
