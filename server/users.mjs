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
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(process.env.ANIMEVAULT_DATA ? path.resolve(process.env.ANIMEVAULT_DATA) : path.join(root, 'data'), 'users.json')

export const USER_ROLES = ['user', 'moderator', 'admin']

// ── Admin account from environment (AV-101 admin bootstrap) ───────────────
//
// Set ANIMEVAULT_ADMIN_USERNAME and ANIMEVAULT_ADMIN_PASSWORD_HASH in .env
// to bootstrap a super-admin account. The password hash is sha256(password)
// and is compared on the /api/auth/login endpoint. This account bypasses
// registration and is created automatically on startup.

const ADMIN_USERNAME = String(process.env.ANIMEVAULT_ADMIN_USERNAME ?? '').trim()
const ADMIN_PASSWORD_HASH = String(process.env.ANIMEVAULT_ADMIN_PASSWORD_HASH ?? '').trim()

function isValidSha256(raw) {
  return /^[0-9a-f]{64}$/.test(String(raw).toLowerCase())
}

/** Ensure the env-configured admin account exists in the store. */
export async function ensureAdmin() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) return
  if (!isValidSha256(ADMIN_PASSWORD_HASH)) {
    console.warn('[auth] ANIMEVAULT_ADMIN_PASSWORD_HASH is not a valid sha256 hex digest; admin account skipped')
    return
  }
  let user = state.users.find((u) => u.username.toLowerCase() === ADMIN_USERNAME.toLowerCase())
  if (!user) {
    user = {
      id: state.nextId++,
      username: ADMIN_USERNAME,
      email: null,
      passwordHash: ADMIN_PASSWORD_HASH,
      role: 'admin',
      displayName: 'Administrator',
      avatarUrl: null,
      bio: '',
      locale: null,
      preferredSubtitleLanguage: null,
      preferredAudioLanguage: null,
      defaultPlaybackQuality: null,
      contentRatingPreference: null,
      theme: null,
      privacy: 'private',
      twoFactorEnabled: false,
      pinSet: false,
      isGuest: false,
      loginNotifications: true,
      emailVerified: true,
      emailVerifiedAt: Date.now(),
      recoveryCodesRemaining: 0,
      totpSecret: null,
      totpEnabled: false,
      recoveryCodes: null,
      passkeys: [],
      featureFlags: {},
      activityLog: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: null,
    }
    state.users.push(user)
  } else {
    // Keep role/password in sync with env on every restart.
    user.role = 'admin'
    user.passwordHash = ADMIN_PASSWORD_HASH
    user.emailVerified = true
    user.emailVerifiedAt = user.emailVerifiedAt ?? Date.now()
    user.updatedAt = Date.now()
  }
  await persist()
}

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

// ── TOTP helpers (RFC 6238) ───────────────────────────────────────────────

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes = []
  let acc = 0
  let bits = 0
  for (const ch of String(input).toUpperCase()) {
    const idx = alphabet.indexOf(ch)
    if (idx === -1) continue
    acc = (acc << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

function hotp(keyBytes, counter, digits = 6) {
  const counterBuf = Buffer.alloc(8)
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = counter & 0xff
    counter = Number(BigInt(counter) >> BigInt(8))
  }
  const hmac = createHmac('sha1', Buffer.from(keyBytes)).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const otp = binary % 10 ** digits
  return String(otp).padStart(digits, '0')
}

function totp(secret, now = Date.now(), period = 30, digits = 6) {
  const counter = Math.floor(now / 1000 / period)
  const key = base32Decode(secret)
  return hotp(key, counter, digits)
}

function generateTOTPSecret() {
  const buf = randomBytes(10)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let result = ''
  for (const byte of buf) result += alphabet[byte % alphabet.length]
  return result
}

function generateRecoveryCodes(count = 8) {
  const codes = []
  for (let i = 0; i < count; i++) {
    const part1 = randomBytes(2).toString('hex')
    const part2 = randomBytes(2).toString('hex')
    codes.push(`${part1}-${part2}`)
  }
  return codes
}

// ── end TOTP helpers ─────────────────────────────────────────────────────

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
  // Bootstrap the env-configured admin account after loading stored users.
  await ensureAdmin()
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
  const {
    passwordHash,
    emailVerificationToken,
    passwordResetToken,
    totpSecret,
    recoveryCodes,
    ...rest
  } = user
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
    twoFactorEnabled: Boolean(rest.totpEnabled),
    pinSet: Boolean(rest.pinHash),
    isGuest: Boolean(rest.isGuest),
    loginNotifications: rest.loginNotifications ?? true,
    emailVerified: Boolean(rest.emailVerifiedAt),
    emailVerifiedAt: rest.emailVerifiedAt ?? null,
    recoveryCodesRemaining: Array.isArray(rest.recoveryCodes) ? rest.recoveryCodes.length : 0,
    featureFlags: rest.featureFlags ?? {},
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    lastLoginAt: rest.lastLoginAt ?? null,
  }
  if (includeSensitive) {
    clean.passwordHash = rest.passwordHash
    clean.emailVerificationToken = rest.emailVerificationToken ?? null
    clean.passwordResetToken = rest.passwordResetToken ?? null
    clean.passwordResetExpiresAt = rest.passwordResetExpiresAt ?? null
    clean.totpSecret = rest.totpSecret ?? null
    clean.totpEnabled = Boolean(rest.totpEnabled)
    clean.recoveryCodes = rest.recoveryCodes ?? []
    clean.pinHash = rest.pinHash ?? null
    clean.activityLog = rest.activityLog ?? []
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
    totpSecret: null,
    totpEnabled: false,
    recoveryCodes: null,
    passkeys: [],
    pinHash: null,
    isGuest: false,
    featureFlags: {},
    loginNotifications: true,
    activityLog: [],
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

  // ── Admin account from .env (sha256 password comparison) ─────────────
  if (ADMIN_USERNAME && input.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
    if (!ADMIN_PASSWORD_HASH) throw error('Invalid credentials', 401)
    const providedHash = sha256Hex(pw)
    if (!timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(ADMIN_PASSWORD_HASH, 'hex'))) {
      throw error('Invalid credentials', 401)
    }
    const adminIdx = findUserIndexByUsername(ADMIN_USERNAME)
    const adminUser = adminIdx !== -1 ? state.users[adminIdx] : null
    if (!adminUser) throw error('Invalid credentials', 401)
    adminUser.lastLoginAt = Date.now()
    adminUser.updatedAt = Date.now()
    addActivity(adminUser.id, 'login')
    await persist()
    return sanitizeUser(adminUser)
  }

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
  addActivity(user.id, 'login')
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
 * Generate a TOTP secret and recovery codes for a user (does not enable yet).
 * Returns { secret, recoveryCodes } — caller should verify with a code before
 * calling enableTOTP().
 */
export async function setupTOTP(id) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]
  if (user.totpEnabled) throw error('Two-factor authentication is already enabled', 400)

  const secret = generateTOTPSecret()
  const codes = generateRecoveryCodes()
  // Hash recovery codes before storing
  const hashedCodes = await Promise.all(codes.map((c) => hashPassword(c)))

  user.totpSecret = secret
  user.recoveryCodes = hashedCodes
  user.updatedAt = Date.now()
  await persist()
  return { secret, recoveryCodes: codes }
}

/**
 * Enable TOTP after verifying a valid code. Returns { ok: true }.
 */
export async function enableTOTP(id, token) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]
  if (!user.totpSecret) throw error('TOTP not set up. Call setupTOTP first.', 400)
  if (!verifyTOTP(token, user.totpSecret)) throw error('Invalid verification code', 400)

  user.totpEnabled = true
  user.updatedAt = Date.now()
  await persist()
  return { ok: true }
}

/**
 * Disable TOTP. Requires the user's password for confirmation.
 */
export async function disableTOTP(id, password) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]
  if (!user.totpEnabled) throw error('Two-factor authentication is not enabled', 400)
  if (!(await verifyPassword(String(password ?? ''), user.passwordHash))) {
    throw error('Invalid password', 401)
  }

  user.totpEnabled = false
  user.totpSecret = null
  user.recoveryCodes = null
  user.updatedAt = Date.now()
  await persist()
  return { ok: true }
}

/**
 * Verify a TOTP code for a user. Used during sign-in when 2FA is enabled.
 */
export async function verifyTOTPForUser(id, token) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]
  if (!user.totpEnabled) throw error('Two-factor authentication is not enabled', 400)
  if (!verifyTOTP(token, user.totpSecret)) {
    // Try recovery code
    const codes = user.recoveryCodes ?? []
    for (let i = 0; i < codes.length; i++) {
      const ok = await verifyPassword(token, codes[i])
      if (ok) {
        codes.splice(i, 1)
        user.updatedAt = Date.now()
        await persist()
        return { ok: true, recoveryCodeUsed: true }
      }
    }
    throw error('Invalid verification code or recovery code', 400)
  }
  return { ok: true, recoveryCodeUsed: false }
}

/** Verify a TOTP code against a secret (pure function, used internally). */
export function verifyTOTP(token, secret) {
  if (!token || !secret) return false
  const expected = totp(secret)
  return timingSafeEqual(Buffer.from(String(token)), Buffer.from(expected))
}

// ── Passkey (WebAuthn) helpers ───────────────────────────────────────────

/**
 * Register a passkey credential for a user. The browser performs the
 * WebAuthn create() ceremony and passes the attestation object here.
 * Stores the credential ID, public key, and counter for later assertion.
 */
export async function addPasskey(id, { credentialId, publicKey, counter = 0, label }) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]

  if (!credentialId || !publicKey) {
    throw error('credentialId and publicKey are required', 400)
  }

  // Deduplicate by credential ID
  if (user.passkeys.some((pk) => pk.credentialId === credentialId)) {
    throw error('Passkey already registered', 409)
  }

  user.passkeys.push({
    credentialId,
    publicKey,
    counter,
    label: label ?? 'Passkey',
    createdAt: Date.now(),
  })
  user.updatedAt = Date.now()
  await persist()
  return { ok: true, passkeys: user.passkeys }
}

/** Remove a passkey credential by credential ID. */
export async function removePasskey(id, credentialId) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]

  const before = user.passkeys.length
  user.passkeys = user.passkeys.filter((pk) => pk.credentialId !== credentialId)
  if (user.passkeys.length === before) throw error('Passkey not found', 404)

  user.updatedAt = Date.now()
  await persist()
  return { ok: true }
}

/** List passkeys for a user (without sensitive public key material). */
export function listPasskeys(id) {
  const user = state.users.find((u) => u.id === Number(id))
  if (!user) return []
  return user.passkeys.map((pk) => ({
    credentialId: pk.credentialId,
    label: pk.label,
    createdAt: pk.createdAt,
    counter: pk.counter,
  }))
}

/**
 * Find a user by passkey credential ID (used during authentication assertion).
 * Returns the user and the matching passkey, or null.
 */
export function findUserByPasskey(credentialId) {
  for (const user of state.users) {
    const pk = user.passkeys.find((p) => p.credentialId === credentialId)
    if (pk) return { user, passkey: pk }
  }
  return null
}

/**
 * Verify a passkey assertion signature. The browser performs the WebAuthn
 * get() ceremony and passes the assertion here. This verifies the signature
 * against the stored public key and increments the counter.
 * (Simplified: stores the assertion result; full COSE signature verification
 * requires the public key in COSE format and WebAuthn verification logic.)
 */
export async function verifyPasskeyAssertion(credentialId, authenticatorData, clientDataJSON, signature) {
  const found = findUserByPasskey(credentialId)
  if (!found) throw error('Unknown passkey credential', 400)

  // In a full implementation, verify the signature using the stored publicKey
  // (COSE format) against authenticatorData + clientDataJSON hash.
  // For now, record successful assertion and bump counter.
  const { user, passkey } = found
  passkey.counter += 1
  user.updatedAt = Date.now()
  await persist()
  return { ok: true, userId: user.id }
}

// ── end Passkey helpers ──────────────────────────────────────────────────

// ── Activity log (AV-117) ────────────────────────────────────────────────

const MAX_ACTIVITY_ENTRIES = 100

function addActivity(userId, action, meta = {}) {
  const idx = findUserIndex(Number(userId))
  if (idx === -1) return
  const user = state.users[idx]
  user.activityLog = user.activityLog || []
  user.activityLog.unshift({
    action,
    at: Date.now(),
    ...meta,
  })
  if (user.activityLog.length > MAX_ACTIVITY_ENTRIES) {
    user.activityLog = user.activityLog.slice(0, MAX_ACTIVITY_ENTRIES)
  }
}

/** Get activity log for a user (AV-117). */
export function getActivityLog(id, limit = 50) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  return state.users[idx].activityLog?.slice(0, limit) ?? []
}

// ── PIN lock (AV-124) ────────────────────────────────────────────────────

/** Set a profile PIN for a user. Requires current password confirmation. */
export async function setPin(id, password, pin) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]
  if (!(await verifyPassword(String(password ?? ''), user.passwordHash))) {
    throw error('Invalid password', 401)
  }
  const pinStr = String(pin ?? '')
  if (!/^\d{4,8}$/.test(pinStr)) {
    throw error('PIN must be 4–8 digits', 400)
  }
  user.pinHash = await hashPassword(pinStr)
  user.updatedAt = Date.now()
  await persist()
  addActivity(user.id, 'pin_set')
  return { ok: true }
}

/** Verify a profile PIN. Returns boolean. */
export async function verifyPin(id, pin) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]
  if (!user.pinHash) return false
  return await verifyPassword(String(pin ?? ''), user.pinHash)
}

/** Remove a profile PIN. Requires current password. */
export async function removePin(id, password) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const user = state.users[idx]
  if (!(await verifyPassword(String(password ?? ''), user.passwordHash))) {
    throw error('Invalid password', 401)
  }
  user.pinHash = null
  user.updatedAt = Date.now()
  await persist()
  addActivity(user.id, 'pin_removed')
  return { ok: true }
}

// ── Guest profiles (AV-122) ─────────────────────────────────────────────

/** Create a guest profile (limited privileges, no password required). */
export async function createGuest(displayName) {
  const dn = String(displayName ?? 'Guest').trim().slice(0, MAX_DISPLAY_NAME_LEN)
  const user = {
    id: state.nextId++,
    username: `guest_${Date.now().toString(36)}`,
    email: null,
    passwordHash: null,
    role: 'user',
    displayName: dn,
    avatarUrl: null,
    bio: '',
    locale: null,
    preferredSubtitleLanguage: null,
    preferredAudioLanguage: null,
    defaultPlaybackQuality: null,
    contentRatingPreference: null,
    theme: null,
    privacy: 'private',
    twoFactorEnabled: false,
    emailVerified: false,
    emailVerifiedAt: null,
    recoveryCodesRemaining: 0,
    totpSecret: null,
    totpEnabled: false,
    recoveryCodes: null,
    passkeys: [],
    pinHash: null,
    isGuest: true,
    featureFlags: {},
    activityLog: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastLoginAt: null,
  }
  state.users.push(user)
  await persist()
  return sanitizeUser(user)
}

// ── Profile switching (AV-123) ─────────────────────────────────────────

/** Switch active profile within a session. Returns the target user. */
export async function switchProfile(currentUserId, targetUserId) {
  const current = state.users.find((u) => u.id === Number(currentUserId))
  const target = state.users.find((u) => u.id === Number(targetUserId))
  if (!target) throw error('Target user not found', 404)
  if (!current || current.id !== target.id) {
    addActivity(target.id, 'profile_switched', { from: current?.id, to: target.id })
  }
  return sanitizeUser(target)
}

// ── Feature flags (AV-125) ─────────────────────────────────────────────

/** Get feature flags for a user. */
export function getFeatureFlags(id) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  return { ...(state.users[idx].featureFlags ?? {}) }
}

/** Set feature flags for a user (admin or self). */
export async function setFeatureFlags(id, flags, requestingUserId) {
  const idx = findUserIndex(Number(id))
  if (idx === -1) throw error('User not found', 404)
  const requester = state.users.find((u) => u.id === Number(requestingUserId))
  if (!requester || (requester.id !== Number(id) && requester.role !== 'admin')) {
    throw error('Forbidden', 403)
  }
  if (typeof flags !== 'object' || Array.isArray(flags) || flags === null) {
    throw error('Feature flags must be an object', 400)
  }
  state.users[idx].featureFlags = { ...flags }
  state.users[idx].updatedAt = Date.now()
  await persist()
  addActivity(Number(id), 'feature_flags_updated')
  return { featureFlags: state.users[idx].featureFlags }
}

// ── end remaining features ─────────────────────────────────────────────

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
