// Optional account registration (AV-101a): pure registration validation,
// password hashing and public user shaping for multi-user installations.
// Passwords are scrypt-hashed with a per-user salt and NEVER leave the server —
// `publicUser` is the only shape routes may return (pinned by tests).

import { scryptSync, timingSafeEqual } from 'node:crypto'

/** Email contract (AV-103): optional unless the installation enables email accounts. */
export function normalizeEmail(input) {
  const email = String(input ?? '').trim().toLowerCase()
  if (!email) return { ok: true, value: null }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address' }
  }
  return { ok: true, value: email }
}

/** Registration contract: username 3-32 chars of [A-Za-z0-9_-], password 8-200. */
export function normalizeRegistration(input = {}, { requireEmail = false } = {}) {
  const username = String(input.username ?? '').trim()
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
    return { ok: false, error: 'Username must be 3-32 letters, numbers, underscores or hyphens' }
  }
  const password = String(input.password ?? '')
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters' }
  if (password.length > 200) return { ok: false, error: 'Password must be at most 200 characters' }
  const displayName = String(input.displayName ?? '').trim().slice(0, 48) || null
  const emailResult = normalizeEmail(input.email)
  if (!emailResult.ok) return emailResult
  if (requireEmail && !emailResult.value) {
    return { ok: false, error: 'Email is required on this installation' }
  }
  return { ok: true, value: { username, password, displayName, email: emailResult.value } }
}

/** Deterministic scrypt hash (hex) for a password + salt. */
export function hashPassword(password, saltHex, { keyLength = 64 } = {}) {
  return scryptSync(String(password), String(saltHex), keyLength).toString('hex')
}

/** Constant-time password verification against a stored hash + salt. */
export function verifyPassword(password, saltHex, expectedHex) {
  const expected = Buffer.from(String(expectedHex ?? ''), 'hex')
  if (!expected.length) return false
  const actual = scryptSync(String(password), String(saltHex), expected.length)
  return timingSafeEqual(actual, expected)
}

/** The only user shape routes may return: never the hash or salt. */
export function publicUser(user) {
  return {
    id: user?.id ?? null,
    username: user?.username ?? null,
    displayName: user?.displayName ?? null,
    emailVerified: user?.emailVerified === true,
    bio: user?.bio ?? null,
    createdAt: user?.createdAt ?? null,
  }
}

/** Bio contract (AV-110): ≤500 chars (truncated), no control characters,
 * empty → null. Tabs and newlines are allowed. */
export function normalizeBio(input) {
  const raw = String(input ?? '')
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
    return { ok: false, error: 'Bios cannot contain control characters' }
  }
  const bio = raw.trim().slice(0, 500)
  return { ok: true, value: bio || null }
}

/** Reset lookup (AV-104): match by username or email, case-insensitively. */
export function findUserByIdentifier(users, identifier) {
  const key = String(identifier ?? '').trim().toLowerCase()
  if (!key) return null
  return users.find((u) => u?.username?.toLowerCase() === key || u?.email?.toLowerCase() === key) ?? null
}

/** Replace a user's credentials (AV-104): new salt + hash, never plaintext. */
export function setPassword(user, password, { saltHex }) {
  return { passwordHash: hashPassword(password, saltHex), passwordSalt: String(saltHex) }
}
