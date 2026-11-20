// User account store (AV-101 through AV-125).
//
// Persists users in `data/users.json`. Each user has a unique username,
// optional email, salted password hash, role, profile fields, and audit
// timestamps. Passwords are never stored plaintext; use hashPassword() /
// verifyPassword() from security.mjs.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile, sanitizeErrorMessage, hashPassword, verifyPassword, generateToken, sha256Hex } from './security.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(process.env.ANIMEVAULT_DATA ? path.resolve(process.env.ANIMEVAULT_DATA) : path.join(root, 'data'), 'users.json')

export const USER_ROLES = ['user', 'moderator', 'admin']

const MIN_USERNAME_LEN = 3
const MAX_USERNAME_LEN = 32
const MAX_DISPLAY_NAME_LEN = 64
const MAX_BIO_LEN = 500
const MAX_PASSWORD_LEN = 128

let state = { version: 1, users: [], nextId: 1 }
let writes = Promise.resolve()

function error(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export async function init() {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
      state = {
        version: Number.isInteger(parsed.version) ? parsed.version : 1,
        users: parsed.users.map((u) => ({
          ...u,
          createdAt: Number(u.createdAt) || Date.now(),
          updatedAt: Number(u.updatedAt) || Date.now(),
          lastLoginAt: u.lastLoginAt ? Number(u.lastLoginAt) : null,
          emailVerifiedAt: u.emailVerifiedAt ? Number(u.emailVerifiedAt) : null,
        })),
        nextId: Number.isInteger(parsed.nextId) ? parsed.nextId : state.users.length + 1,
      }
    }
  } catch {
    // First run: empty state.
  }
}

async function persist() {
  const serialized = JSON.stringify(state, null, 2)
  writes = writes.catch(() => {}).then(() => atomicWriteFile(file, serialized))
  await writes
}

function findUserIndex(id) {
  return state.users.findIndex((u) => u.id === id)
}

function findUserIndexByUsername(username) {
  return state.users.findIndex((u) => u.username.toLowerCase() === String(username).toLowerCase())
}

function findUserIndexByEmail(email) {
  if (!email) return -1
  return state.users.findIndex((u) => u.email && u.email.toLowerCase() === String(email).toLowerCase())
}

function sanitizeUser(user, includeSensitive = false) {
  const { passwordHash, emailVerificationToken, passwordResetToken, ...rest } = user
  const clean = {
    id: rest.id,
    username: rest.username,
    displayName: rest.displayName ?? null,
    email: rest.email ?? null,
    avatarUrl: rest.avatarUrl ?? null,
    bio: rest.bio ?? '',
    role: rest.role,
    locale: rest.locale ?? null,
    preferredSubtitleLanguage: rest.preferredSubtitleLanguage ?? null,
    preferredAudioLanguage: rest.preferredAudioLanguage ?? null,
    defaultPlaybackQuality: rest.defaultPlaybackQuality ?? null,
    contentRatingPreference: rest.contentRatingPreference ?? null,
    theme: rest.theme ?? null,
    privacy: rest.privacy ?? 'private',
    emailVerified: Boolean(rest.emailVerifiedAt),
    emailVerifiedAt: rest.emailVerifiedAt ?? null,
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    lastLoginAt: rest.lastLoginAt ?? null,
  }
  if (includeSensitive) {
    clean.passwordHash = rest.passwordHash
    clean.emailVerificationToken = rest.emailVerificationToken ?? null
    clean.passwordResetToken = rest.passwordResetToken ?? null
    clean.passwordResetExpiresAt = rest.passwordResetExpiresAt ?? null
  }
  return clean
}

/**
 * Register a new user. Returns the sanitized user record (without password hash).
 * Throws if username/email already taken or input is invalid.
 */
export async function createUser({ username, email, password, role = 'user' }) {
  const un = String(username ?? '').trim()
  const em = typeof email === 'string' ? String(email).trim().toLowerCase() : null
  const pw = String(password ?? '')

  if (!un || un.length < MIN_USERNAME_LEN || un.length > MAX_USERNAME_LEN) {
    throw error(`Username must be ${MIN_USERNAME_LEN}–${MAX_USERNAME_LEN} characters`)
  }
  if (!/^[a-z0-9_-]+$/i.test(un)) {
    throw error('Username may only contain letters, numbers, underscores, and hyphens')
  }
  if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    throw error('Invalid email address')
  }
  if (!pw || pw.length < 8 || pw.length > MAX_PASSWORD_LEN) {
    throw error('Password must be 8–128 characters')
  }
  if (!USER_ROLES.includes(role)) {
    throw error('Invalid role')
  }
  if (findUserIndexByUsername(un) !== -1) {
    throw error('Username already taken', 409)
  }
  if (em && findUserIndexByEmail(em) !== -1) {
    throw error('Email already registered', 409)
  }

  const passwordHash = await hashPassword(pw)
  const user = {
    id: state.nextId++,
    username: un,
    email: em ?? null,
    passwordHash,
    role,
    displayName: null,
    avatarUrl: null,
    bio: '',
    locale: null,
    preferredSubtitleLanguage: null,
    preferredAudioLanguage: null,
    defaultPlaybackQuality: null,
    contentRatingPreference: null,
    theme: null,
    privacy: 'private',
    emailVerificationToken: generateToken(),
    emailVerificationExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    emailVerifiedAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastLoginAt: null,
  }

  state.users.push(user)
  await persist()
  return sanitizeUser(user)
}

/**
 * Verify credentials and return the sanitized user record.
 * Throws if user not found or password invalid.
 */
export async function authenticateUser(usernameOrEmail, password) {
  const input = String(usernameOrEmail ?? '').trim()
  const pw = String(password ?? '')
  if (!input || !pw) throw error('Username/email and password are required', 401)

  let user = null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
    const idx = findUserIndexByEmail(input)
    user = idx !== -1 ? state.users[idx] : null
  } else {
    const idx = findUserIndexByUsername(input)
    user = idx !== -1 ? state.users[idx] : null
  }
  if (!user) throw error('Invalid credentials', 401)

  const ok = await verifyPassword(pw, user.passwordHash)
  if (!ok) throw error('Invalid credentials', 401)

  user.lastLoginAt = Date.now()
  user.updatedAt = Date.now()
  await persist()
  return sanitizeUser(user)
}

/** Get a user by id (sanitized). Returns null if not found. */
export function getUser(id) {
  const idx = findUserIndex(Number(id))
  return idx !== -1 ? sanitizeUser(state.users[idx]) : null
}

/** Get a user by id including sensitive fields (internal use). */
export function getUserSensitive(id) {
  const idx = findUserIndex(Number(id))
  return idx !== -1 ? sanitizeUser(state.users[idx], true) : null
}

/** Get all users (sanitized, without password hashes). */
export function listUsers() {
  return state.users.map((u) => sanitizeUser(u))
}

/**
 * Update a user's profile fields. Returns the sanitized updated user.
 * Only allowed fields may be changed; passwordHash/email/etc. handled separately.
 */
export async function updateUser(id, patch = {}) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)

  const user = state.users[idx]
  const next = { ...user }

  if (patch.displayName !== undefined) {
    const dn = String(patch.displayName).trim()
    if (dn.length > MAX_DISPLAY_NAME_LEN) throw error('Display name too long', 400)
    next.displayName = dn || null
  }

  if (patch.bio !== undefined) {
    const bio = String(patch.bio).trim()
    if (bio.length > MAX_BIO_LEN) throw error('Bio too long', 400)
    next.bio = bio
  }

  if (patch.locale !== undefined) {
    const loc = String(patch.locale).trim()
    if (!/^[a-z]{2}(-[A-Z]{2})?$/i.test(loc)) throw error('Invalid locale', 400)
    next.locale = loc
  }

  if (patch.preferredSubtitleLanguage !== undefined) {
    next.preferredSubtitleLanguage = typeof patch.preferredSubtitleLanguage === 'string' ? patch.preferredSubtitleLanguage.trim() || null : null
  }

  if (patch.preferredAudioLanguage !== undefined) {
    next.preferredAudioLanguage = typeof patch.preferredAudioLanguage === 'string' ? patch.preferredAudioLanguage.trim() || null : null
  }

  if (patch.defaultPlaybackQuality !== undefined) {
    next.defaultPlaybackQuality = typeof patch.defaultPlaybackQuality === 'string' ? patch.defaultPlaybackQuality.trim() || null : null
  }

  if (patch.contentRatingPreference !== undefined) {
    next.contentRatingPreference = typeof patch.contentRatingPreference === 'string' ? patch.contentRatingPreference.trim() || null : null
  }

  if (patch.theme !== undefined) {
    next.theme = typeof patch.theme === 'string' ? patch.theme.trim() || null : null
  }

  if (patch.privacy !== undefined) {
    if (!['private', 'shared-link', 'public'].includes(patch.privacy)) throw error('Invalid privacy setting', 400)
    next.privacy = patch.privacy
  }

  if (patch.avatarUrl !== undefined) {
    next.avatarUrl = typeof patch.avatarUrl === 'string' && patch.avatarUrl.trim() ? patch.avatarUrl.trim() : null
  }

  next.updatedAt = Date.now()
  state.users[idx] = next
  await persist()
  return sanitizeUser(next)
}

/**
 * Change a user's password. Verifies the current password first.
 */
export async function changePassword(id, currentPassword, newPassword) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)

  const user = state.users[idx]
  const ok = await verifyPassword(String(currentPassword ?? ''), user.passwordHash)
  if (!ok) throw error('Current password is incorrect', 401)

  const pw = String(newPassword ?? '')
  if (!pw || pw.length < 8 || pw.length > MAX_PASSWORD_LEN) {
    throw error('Password must be 8–128 characters')
  }

  user.passwordHash = await hashPassword(pw)
  user.passwordResetToken = null
  user.passwordResetExpiresAt = null
  user.updatedAt = Date.now()
  await persist()
  return { ok: true }
}

/**
 * Request a password reset. Generates a reset token and stores its expiry.
 * Returns the reset token (caller is responsible for delivering it, e.g. by email).
 */
export async function requestPasswordReset(email) {
  const em = typeof email === 'string' ? String(email).trim().toLowerCase() : null
  if (!em) throw error('Email is required', 400)

  const idx = findUserIndexByEmail(em)
  if (idx === -1) throw error('No account with that email', 404)

  const user = state.users[idx]
  const token = generateToken()
  user.passwordResetToken = token
  user.passwordResetExpiresAt = Date.now() + 60 * 60 * 1000 // 1 hour
  user.updatedAt = Date.now()
  await persist()
  return { token }
}

/**
 * Reset a password using a valid reset token.
 */
export async function resetPassword(token, newPassword) {
  const pw = String(newPassword ?? '')
  if (!pw || pw.length < 8 || pw.length > MAX_PASSWORD_LEN) {
    throw error('Password must be 8–128 characters')
  }

  const user = state.users.find((u) => u.passwordResetToken === token)
  if (!user) throw error('Invalid or expired reset token', 400)
  if (!user.passwordResetExpiresAt || Date.now() > user.passwordResetExpiresAt) {
    throw error('Invalid or expired reset token', 400)
  }

  user.passwordHash = await hashPassword(pw)
  user.passwordResetToken = null
  user.passwordResetExpiresAt = null
  user.updatedAt = Date.now()
  await persist()
  return { ok: true }
}

/**
 * Verify an email using the email verification token.
 */
export async function verifyEmail(token) {
  const user = state.users.find((u) => u.emailVerificationToken === token)
  if (!user) throw error('Invalid or expired verification token', 400)
  if (!user.emailVerificationExpiresAt || Date.now() > user.emailVerificationExpiresAt) {
    throw error('Invalid or expired verification token', 400)
  }

  user.emailVerifiedAt = Date.now()
  user.emailVerificationToken = null
  user.emailVerificationExpiresAt = null
  user.updatedAt = Date.now()
  await persist()
  return { ok: true }
}

/** Delete a user account. Returns the sanitized deleted user. */
export async function deleteUser(id) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)

  const [removed] = state.users.splice(idx, 1)
  await persist()
  return sanitizeUser(removed)
}

/** Flush pending writes (for tests). */
export async function flush() {
  await writes
}

/** Reset state (for tests). */
export async function reset() {
  state = { version: 1, users: [], nextId: 1 }
  await persist()
}
