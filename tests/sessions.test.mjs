// Tests for secure sign-in / sign-out sessions (server/sessions.mjs, AV-102a).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSessionToken,
  hashToken,
  sessionRecord,
  isSessionValid,
  readCookie,
} from '../server/sessions.mjs'

test('session tokens are unguessable and hashed for storage', () => {
  const a = createSessionToken()
  const b = createSessionToken()
  assert.match(a, /^[0-9a-f]{64}$/, '32 random bytes as hex')
  assert.notEqual(a, b)
  assert.equal(hashToken(a), hashToken(a), 'deterministic')
  assert.notEqual(hashToken(a), hashToken(b))
  assert.notEqual(hashToken(a), a, 'the stored form never contains the raw token')
})

test('session records expire', () => {
  const record = sessionRecord('u_1', { now: 1_000, ttlMs: 500 })
  assert.deepEqual(record, { userId: 'u_1', createdAt: 1_000, expiresAt: 1_500 })
  assert.ok(isSessionValid(record, { now: 1_499 }))
  assert.ok(!isSessionValid(record, { now: 1_500 }), 'expired at the boundary')
  assert.ok(!isSessionValid(null))
  assert.ok(!isSessionValid({ userId: '', expiresAt: 9_999 }), 'empty user never valid')
  assert.ok(!isSessionValid({ userId: 'u_1' }), 'malformed records never valid')
  assert.ok(!isSessionValid({ userId: 'u_1', expiresAt: 'soon' }), 'non-numeric expiry never valid')
})

test('readCookie parses request cookies', () => {
  const req = { headers: { cookie: 'other=1; av_session=tok%20en; last=x' } }
  assert.equal(readCookie(req, 'av_session'), 'tok en')
  assert.equal(readCookie(req, 'other'), '1')
  assert.equal(readCookie(req, 'missing'), null)
  assert.equal(readCookie({ headers: {} }, 'av_session'), null)
  assert.equal(readCookie({}, 'av_session'), null)
})
