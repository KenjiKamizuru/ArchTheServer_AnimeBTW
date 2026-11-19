// Tests for single-use expiring account tokens (server/tokens.mjs, AV-103).
// AV-104's password-reset tokens reuse this contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createToken, hashToken, issueToken, isTokenValid } from '../server/tokens.mjs'

test('tokens are random and hash-only in storage', () => {
  const { raw, hash } = createToken()
  assert.match(raw, /^[0-9a-f]{64}$/)
  assert.equal(hash, hashToken(raw))
  assert.notEqual(hash, raw, 'the stored form never contains the raw token')
  assert.notEqual(createToken().raw, raw)
})

test('issueToken records purpose, subject and expiry', () => {
  const { raw, record } = issueToken('email-verify', 'u_1', { now: 1_000, ttlMs: 500 })
  assert.equal(record.hash, hashToken(raw))
  assert.deepEqual(record, {
    hash: record.hash,
    purpose: 'email-verify',
    subject: 'u_1',
    createdAt: 1_000,
    expiresAt: 1_500,
    usedAt: null,
  })
  assert.throws(() => issueToken('', 'u_1', { ttlMs: 500 }), /purpose and subject/)
  assert.throws(() => issueToken('p', 'u_1', { ttlMs: 0 }), /positive ttlMs/)
})

test('tokens are single-use, expiring, and purpose-bound', () => {
  const { record } = issueToken('email-verify', 'u_1', { now: 1_000, ttlMs: 500 })
  assert.ok(isTokenValid(record, { now: 1_499 }))
  assert.ok(!isTokenValid(record, { now: 1_500 }), 'expired at the boundary')
  assert.ok(!isTokenValid(record, { now: 1_000, purpose: 'password-reset' }), 'wrong purpose rejected')
  assert.ok(!isTokenValid(record, { now: 1_000, subject: 'u_2' }), 'wrong subject rejected')
  assert.ok(isTokenValid(record, { now: 1_000, purpose: 'email-verify', subject: 'u_1' }))
  const used = { ...record, usedAt: 1_200 }
  assert.ok(!isTokenValid(used, { now: 1_100 }), 'single-use even before expiry')
  assert.ok(!isTokenValid(null, { now: 1_000 }))
})
