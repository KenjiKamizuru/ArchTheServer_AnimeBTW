// Single-use expiring account tokens (AV-103): a shared primitive — AV-104's
// password-reset tokens reuse it. Tokens are random 32-byte values and only
// their sha256 is stored (a leaked kv store cannot redeem tokens); the raw
// value travels only in the verification link.

import { randomBytes, createHash } from 'node:crypto'

export function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex')
}

export function createToken() {
  const raw = randomBytes(32).toString('hex')
  return { raw, hash: hashToken(raw) }
}

/** Issue a token: `raw` goes to the user, `record` goes to storage. */
export function issueToken(purpose, subject, { now = Date.now(), ttlMs } = {}) {
  if (!purpose || !subject) throw new Error('issueToken requires purpose and subject')
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('issueToken requires a positive ttlMs')
  const { raw, hash } = createToken()
  return {
    raw,
    record: { hash, purpose, subject, createdAt: now, expiresAt: now + ttlMs, usedAt: null },
  }
}

/** Valid until used or expired; optionally assert purpose/subject. */
export function isTokenValid(record, { now = Date.now(), purpose, subject } = {}) {
  if (!record || record.usedAt) return false
  if (purpose && record.purpose !== purpose) return false
  if (subject !== undefined && record.subject !== subject) return false
  return Number(record.expiresAt) > now
}
