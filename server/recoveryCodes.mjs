// One-time recovery codes (AV-107a): the backup factor for TOTP 2FA when the
// authenticator is lost. node:crypto only; no new dependencies.
//
// Scope decisions (recorded per task rules):
// - Recovery codes are a 2FA BACKUP factor: they are consulted by the login
//   gate only when twoFactorEnabled (they do not replace the password).
// - Codes are 80-bit random base32 shown as XXXX-XXXX-XXXX-XXXX and stored
//   HASHED (sha256 of the normalized code) — like session/reset tokens, the
//   server keeps no recoverable copy; the plaintext is returned exactly once.
// - Every code is single-use; regenerating invalidates the whole previous set.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { base32Encode } from './totp.mjs'

export const RECOVERY_CODE_COUNT = 10

/** Normalize user input: strip separators/spaces, uppercase. */
export function normalizeRecoveryCode(code) {
  return String(code ?? '').replace(/[\s-]+/g, '').toUpperCase()
}

export function formatRecoveryCode(raw16) {
  return (raw16.match(/.{1,4}/g) ?? []).join('-')
}

export function hashRecoveryCode(code) {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex')
}

/** Generate a fresh set: plaintext (show once) + hashed records (store). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = []
  const hashes = []
  for (let i = 0; i < count; i += 1) {
    const raw = base32Encode(randomBytes(10)).slice(0, 16) // 80-bit, base32
    codes.push(formatRecoveryCode(raw))
    hashes.push(hashRecoveryCode(raw))
  }
  return { codes, records: hashes.map((hash) => ({ hash, usedAt: null })) }
}

/** (Re)issue a user's codes — invalidates every previous code. */
export function issueRecoveryCodes(user) {
  const { codes, records } = generateRecoveryCodes()
  user.recoveryCodes = records
  return codes
}

function codesEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8')
  const right = Buffer.from(String(b), 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Consume one unused code (single-use). Throws a generic error on failure. */
export function consumeRecoveryCode(user, code) {
  const invalid = () => Object.assign(new Error('Invalid recovery code'), { status: 401 })
  const hash = hashRecoveryCode(code)
  if (!hash) throw invalid()
  const record = (user.recoveryCodes ?? []).find((item) => item?.usedAt == null && codesEqual(item.hash, hash))
  if (!record) throw invalid()
  record.usedAt = Date.now()
  return { ok: true, remaining: (user.recoveryCodes ?? []).filter((item) => item?.usedAt == null).length }
}

/** Status only — never the codes themselves. */
export function recoveryCodesStatus(user) {
  const records = user.recoveryCodes ?? []
  return {
    total: records.length,
    remaining: records.filter((item) => item?.usedAt == null).length,
  }
}
