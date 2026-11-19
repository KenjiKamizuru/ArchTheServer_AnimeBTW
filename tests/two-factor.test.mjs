// Tests for TOTP + optional 2FA policy (AV-106a). TOTP correctness is pinned
// against the REAL RFC 6238 test vectors (SHA-1, secret "12345678901234567890").
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  otpauthUrl,
} from '../server/totp.mjs'
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  verifyTwoFactor,
} from '../server/twoFactor.mjs'

const RFC_SECRET_ASCII = '12345678901234567890'
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

test('TOTP matches the RFC 6238 test vectors (SHA-1)', () => {
  assert.equal(base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii')), RFC_SECRET_BASE32)
  assert.equal(base32Decode(RFC_SECRET_BASE32).toString('ascii'), RFC_SECRET_ASCII)
  // RFC 6238 Appendix B: 8-digit codes at fixed times.
  for (const [time, code] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]) {
    assert.equal(totpCode(RFC_SECRET_BASE32, { time, digits: 8 }), code, `RFC vector at T=${time}`)
  }
  // The 6-digit app default is the same code truncated.
  assert.equal(totpCode(RFC_SECRET_BASE32, { time: 59 }), '287082')
  assert.equal(totpCode('not base32!', { time: 59 }), null, 'invalid secrets yield null')
})

test('verifyTotp accepts drift within the window and rejects beyond it', () => {
  const time = 1_000_000_000 // counter boundary behaviour is deterministic
  const code = totpCode(RFC_SECRET_BASE32, { time })
  assert.equal(verifyTotp(RFC_SECRET_BASE32, code, { time }), true)
  assert.equal(verifyTotp(RFC_SECRET_BASE32, code, { time: time + 29 }), true, 'same step')
  assert.equal(verifyTotp(RFC_SECRET_BASE32, code, { time: time + 30 }), true, 'next step within window')
  assert.equal(verifyTotp(RFC_SECRET_BASE32, code, { time: time + 90 }), false, 'beyond ±1 step')
  assert.equal(verifyTotp(RFC_SECRET_BASE32, code, { time: time - 90 }), false)
  assert.equal(verifyTotp(RFC_SECRET_BASE32, '28708', { time }), false, 'wrong length')
  assert.equal(verifyTotp(RFC_SECRET_BASE32, 'abcdef', { time }), false, 'non-digits')
  assert.equal(verifyTotp('INVALID!', code, { time }), false)
  assert.equal(verifyTotp(RFC_SECRET_BASE32, ' 287082 ', { time: 59 }), true, 'spaces tolerated')
})

test('2FA enrollment state machine: setup → confirm → enforce → disable', () => {
  const user = { username: 'kenji', twoFactorEnabled: false, twoFactorSecret: null }

  // Login is unaffected before enrollment.
  assert.equal(verifyTwoFactor(user, null).ok, true)

  const setup = beginTwoFactorSetup(user, { secret: RFC_SECRET_BASE32 })
  assert.equal(setup.secret, RFC_SECRET_BASE32)
  assert.ok(setup.otpauthUrl.startsWith('otpauth://totp/AnimeVault'))
  assert.ok(setup.otpauthUrl.includes('kenji'))
  assert.ok(setup.otpauthUrl.includes(RFC_SECRET_BASE32))
  assert.equal(user.twoFactorEnabled, false, 'not enabled until a code is confirmed')
  assert.equal(verifyTwoFactor(user, null).ok, true, 'setup alone does not enforce 2FA')

  // Wrong codes do not enable; correct code at RFC T=59 (8-digit vector's
  // 6-digit truncation) enables.
  assert.throws(() => confirmTwoFactorSetup(user, '000000', { now: 59_000 }), /Invalid two-factor code/)
  confirmTwoFactorSetup(user, '287082', { now: 59_000 })
  assert.equal(user.twoFactorEnabled, true)
  assert.equal(user.twoFactorConfirmedAt, 59_000)

  // Enforced at login.
  assert.equal(verifyTwoFactor(user, '287082', { now: 59_000 }).ok, true)
  assert.throws(() => verifyTwoFactor(user, '000000', { now: 59_000 }), /Invalid two-factor code/)

  // Disabling requires possession; wrong code leaves it on.
  assert.throws(() => disableTwoFactor(user, '000000', { now: 59_000 }), /Invalid two-factor code/)
  assert.equal(user.twoFactorEnabled, true)
  disableTwoFactor(user, '287082', { now: 59_000 })
  assert.equal(user.twoFactorEnabled, false)
  assert.equal(user.twoFactorSecret, null, 'the shared secret is discarded')
  assert.equal(verifyTwoFactor(user, null).ok, true)
})

test('otpauthUrl encodes the issuer, account, and secret', () => {
  const url = otpauthUrl({ secretBase32: RFC_SECRET_BASE32, account: 'kenji', issuer: 'AnimeVault' })
  const parsed = new URL(url)
  assert.equal(parsed.protocol, 'otpauth:')
  assert.equal(parsed.host, 'totp')
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), 'AnimeVault:kenji')
  assert.equal(parsed.searchParams.get('secret'), RFC_SECRET_BASE32)
  assert.equal(parsed.searchParams.get('issuer'), 'AnimeVault')
  assert.equal(generateTotpSecret().length, 32, '160-bit secrets base32 to 32 chars')
})
