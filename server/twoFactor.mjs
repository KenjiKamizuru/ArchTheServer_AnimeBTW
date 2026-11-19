// Optional two-factor authentication policy (AV-106a).
//
// State machine on the user record:
//   twoFactorSecret  — base32 shared secret, set by `beginTwoFactorSetup`
//   twoFactorEnabled — false until `confirmTwoFactorSetup` verifies a code
// Scope decisions:
// - TOTP only (authenticator apps); email/SMS 2FA is not implemented (no SMS
//   provider, and email is used only for verification/reset).
// - Passkey sign-in is NOT additionally challenged: a passkey is already a
//   phishing-resistant second factor (possession + user verification).
// - Login must present a valid code when twoFactorEnabled (see index.mjs).

import { generateTotpSecret, verifyTotp, otpauthUrl } from './totp.mjs'

const invalid = () => Object.assign(new Error('Invalid two-factor code'), { status: 401 })

/** Start (or restart) enrollment: returns the secret + provisioning URI. */
export function beginTwoFactorSetup(user, { secret = generateTotpSecret() } = {}) {
  user.twoFactorSecret = secret
  user.twoFactorEnabled = false
  return {
    secret,
    otpauthUrl: otpauthUrl({ secretBase32: secret, account: user.username }),
  }
}

/** Confirm enrollment with a live code → enabled. */
export function confirmTwoFactorSetup(user, code, { now = Date.now() } = {}) {
  if (!user.twoFactorSecret) throw Object.assign(new Error('Two-factor setup has not been started'), { status: 400 })
  if (!verifyTotp(user.twoFactorSecret, code, { time: Math.floor(now / 1000) })) throw invalid()
  user.twoFactorEnabled = true
  user.twoFactorConfirmedAt = now
  return { enabled: true }
}

/** Disable with a valid code (possession proof required to turn it off). */
export function disableTwoFactor(user, code, { now = Date.now() } = {}) {
  if (!user.twoFactorEnabled) return { enabled: false }
  if (!verifyTotp(user.twoFactorSecret, code, { time: Math.floor(now / 1000) })) throw invalid()
  user.twoFactorEnabled = false
  user.twoFactorSecret = null
  user.twoFactorConfirmedAt = null
  return { enabled: false }
}

/** Login gate: when enabled, the code must verify. */
export function verifyTwoFactor(user, code, { now = Date.now() } = {}) {
  if (!user.twoFactorEnabled) return { ok: true }
  if (!verifyTotp(user.twoFactorSecret, code, { time: Math.floor(now / 1000) })) throw invalid()
  return { ok: true }
}
