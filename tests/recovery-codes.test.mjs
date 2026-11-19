// Tests for one-time recovery codes (AV-107a): generation shape, hashed
// storage, single-use consumption, and the login-gate backup path.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateRecoveryCodes,
  formatRecoveryCode,
  normalizeRecoveryCode,
  hashRecoveryCode,
  issueRecoveryCodes,
  consumeRecoveryCode,
  recoveryCodesStatus,
} from '../server/recoveryCodes.mjs'
import { verifyTwoFactor, beginTwoFactorSetup, confirmTwoFactorSetup } from '../server/twoFactor.mjs'
import { totpCode } from '../server/totp.mjs'

test('recovery codes: shape, uniqueness, hashed storage', () => {
  const { codes, records } = generateRecoveryCodes()
  assert.equal(codes.length, 10)
  assert.equal(records.length, 10)
  assert.equal(new Set(codes).size, 10, 'codes are unique')
  for (const code of codes) assert.match(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/)
  for (const record of records) {
    assert.match(record.hash, /^[0-9a-f]{64}$/, 'stored as sha256, never plaintext')
    assert.equal(record.usedAt, null)
  }
  assert.equal(formatRecoveryCode('ABCD2345EFGH6789'), 'ABCD-2345-EFGH-6789')
  assert.equal(normalizeRecoveryCode(' abcd-2345 efgh 6789 '), 'ABCD2345EFGH6789')
  assert.equal(hashRecoveryCode('abcd-2345-efgh-6789'), hashRecoveryCode('ABCD2345EFGH6789'), 'hash is normalization-stable')
})

test('recovery codes: single-use consumption and regeneration', () => {
  const user = { username: 'kenji' }
  const codes = issueRecoveryCodes(user)
  assert.equal(user.recoveryCodes.length, 10)
  assert.deepEqual(recoveryCodesStatus(user), { total: 10, remaining: 10 })

  const first = consumeRecoveryCode(user, codes[0])
  assert.equal(first.remaining, 9)
  assert.deepEqual(recoveryCodesStatus(user), { total: 10, remaining: 9 })
  assert.throws(() => consumeRecoveryCode(user, codes[0]), /Invalid recovery code/, 'codes are single-use')
  assert.throws(() => consumeRecoveryCode(user, 'AAAA-AAAA-AAAA-AAAA'), /Invalid recovery code/)
  assert.throws(() => consumeRecoveryCode(user, ''), /Invalid recovery code/)
  // Input with separators/spaces still matches.
  assert.equal(consumeRecoveryCode(user, ` ${codes[1].toLowerCase()} `).remaining, 8)

  // Regeneration invalidates every previous code.
  const fresh = issueRecoveryCodes(user)
  assert.throws(() => consumeRecoveryCode(user, codes[2]), /Invalid recovery code/)
  assert.equal(consumeRecoveryCode(user, fresh[9]).remaining, 9)
})

test('login gate accepts a recovery code as the 2FA backup factor', () => {
  const user = { username: 'kenji', twoFactorEnabled: false, twoFactorSecret: null }
  beginTwoFactorSetup(user, { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' })
  confirmTwoFactorSetup(user, totpCode(user.twoFactorSecret), { now: Date.now() })
  const codes = issueRecoveryCodes(user)

  // TOTP still works…
  assert.equal(verifyTwoFactor(user, totpCode(user.twoFactorSecret)).ok, true)
  // …and so does an unused recovery code when the authenticator is lost.
  const result = verifyTwoFactor(user, codes[4])
  assert.equal(result.ok, true)
  assert.equal(result.remaining, 9)
  assert.throws(() => verifyTwoFactor(user, codes[4]), /Invalid recovery code/, 'single-use at the gate too')
  assert.throws(() => verifyTwoFactor(user, '0000000000000000'), /Invalid (two-factor|recovery)/)
  // A 6-digit-looking wrong code is still the plain 2FA failure.
  assert.throws(() => verifyTwoFactor(user, '000000'), /Invalid two-factor code/)

  // Without 2FA the gate is a no-op even with no codes.
  const plain = { username: 'plain', twoFactorEnabled: false }
  assert.equal(verifyTwoFactor(plain, 'anything').ok, true)
})
