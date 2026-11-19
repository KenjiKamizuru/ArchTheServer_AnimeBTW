// Secure sign-in / sign-out sessions (AV-102a): pure session primitives.
// Session tokens are random 32-byte values; only their sha256 is stored
// server-side (a leaked kv store cannot grant sessions) and the raw token
// lives solely in an httpOnly cookie (see server/index.mjs login route).

import { randomBytes, createHash } from 'node:crypto'

export const SESSION_COOKIE = 'av_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function createSessionToken() {
  return randomBytes(32).toString('hex')
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function sessionRecord(userId, { now = Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  return { userId, createdAt: now, expiresAt: now + ttlMs }
}

export function isSessionValid(record, { now = Date.now() } = {}) {
  return Boolean(record && typeof record.userId === 'string' && record.userId && Number(record.expiresAt) > now)
}

export function readCookie(req, name) {
  const header = req?.headers?.cookie
  if (typeof header !== 'string') return null
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}
