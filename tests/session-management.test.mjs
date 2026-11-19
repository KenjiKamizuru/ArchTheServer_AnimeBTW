// Tests for device/session management (AV-119): listing, current-first
// ordering, owner-only remote sign-out semantics.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSessionHash,
  describeSession,
  listUserSessions,
  shouldRevoke,
} from '../server/sessionManagement.mjs'

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const H3 = 'c'.repeat(64)

test('session listing: valid, owner-only, current first, no token material', () => {
  const now = 10_000
  const entries = [
    [H1, { userId: 'u1', createdAt: 1_000, expiresAt: now + 5_000 }],
    [H2, { userId: 'u1', createdAt: 2_000, expiresAt: now + 5_000 }],
    [H3, { userId: 'u2', createdAt: 3_000, expiresAt: now + 5_000 }], // someone else's
    ['d'.repeat(64), { userId: 'u1', createdAt: 4_000, expiresAt: now - 1 }], // expired
  ]
  const rows = listUserSessions(entries, { userId: 'u1', currentHash: H1, now })
  assert.deepEqual(rows.map((row) => row.hash), [H1, H2], 'current first; other users and expired excluded')
  assert.deepEqual(rows[0], { hash: H1, createdAt: 1_000, expiresAt: 15_000, current: true })
  assert.equal(rows[1].current, false)
  assert.deepEqual(Object.keys(rows[0]).sort(), ['createdAt', 'current', 'expiresAt', 'hash'], 'descriptor shape is fixed')
  assert.ok(!JSON.stringify(rows).includes('token'), 'descriptors never carry token material')
  // Newest first among the non-current rows.
  const ordered = listUserSessions(
    [
      [H1, { userId: 'u1', createdAt: 1_000, expiresAt: now + 1 }],
      [H2, { userId: 'u1', createdAt: 9_000, expiresAt: now + 1 }],
    ],
    { userId: 'u1', currentHash: null, now },
  )
  assert.deepEqual(ordered.map((row) => row.createdAt), [9_000, 1_000])
  assert.deepEqual(listUserSessions(null, { userId: 'u1' }), [], 'sparse input is safe')
})

test('hash validation and remote sign-out predicate', () => {
  assert.equal(isSessionHash(H1), true)
  for (const bad of ['', 'xyz', 'A'.repeat(64), 'a'.repeat(63), `${H1}00`, null, undefined, '../etc']) {
    assert.equal(isSessionHash(bad), false, `should reject ${JSON.stringify(bad)}`)
  }
  const record = { userId: 'u1', createdAt: 1, expiresAt: 2 }
  assert.equal(shouldRevoke(H2, record, { userId: 'u1', currentHash: H1 }), true, 'others are revoked')
  assert.equal(shouldRevoke(H1, record, { userId: 'u1', currentHash: H1 }), false, 'the current session survives')
  assert.equal(shouldRevoke(H2, record, { userId: 'u2', currentHash: H1 }), false, 'never touches other users')
  assert.equal(shouldRevoke(H2, null, { userId: 'u1', currentHash: H1 }), false)
  assert.equal(describeSession(H1, { createdAt: 'x' }, {}).createdAt, null, 'malformed timestamps become null')
})
