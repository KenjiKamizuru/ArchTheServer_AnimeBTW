// Session store (AV-101 through AV-125).
//
// Persists sessions in `data/sessions.json`. Each session binds a session
// token to a user id with an expiry. Used for sign-in / sign-out and
// per-request authentication on protected API routes.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile, generateToken } from './security.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(process.env.ANIMEVAULT_DATA ? path.resolve(process.env.ANIMEVAULT_DATA) : path.join(root, 'data'), 'sessions.json')

// Default session TTL: 30 days.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

let state = { version: 1, sessions: [] }
let writes = Promise.resolve()

function error(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export async function init() {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sessions)) {
      state = {
        version: Number.isInteger(parsed.version) ? parsed.version : 1,
        sessions: parsed.sessions.map((s) => ({
          ...s,
          createdAt: Number(s.createdAt) || Date.now(),
          expiresAt: Number(s.expiresAt) || 0,
          lastUsedAt: Number(s.lastUsedAt) || 0,
        })),
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

function findSessionIndex(token) {
  return state.sessions.findIndex((s) => s.token === token)
}

/** Create a new session for a user. Returns { token, userId, expiresAt }. */
export async function createSession(userId, ttlMs = DEFAULT_TTL_MS) {
  const token = generateToken(32)
  const now = Date.now()
  const session = {
    token,
    userId: Number(userId),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + ttlMs,
  }
  state.sessions.push(session)
  await persist()
  return { token, userId: session.userId, expiresAt: session.expiresAt }
}

/**
 * Validate a session token. Returns { userId } if valid, null if not found
 * or expired. Updates lastUsedAt on success.
 */
export async function getSession(token) {
  const idx = findSessionIndex(token)
  if (idx === -1) return null
  const session = state.sessions[idx]
  const now = Date.now()
  if (now >= session.expiresAt) {
    state.sessions.splice(idx, 1)
    await persist()
    return null
  }
  session.lastUsedAt = now
  await persist()
  return { userId: session.userId }
}

/** Destroy a single session. Returns true if a session was removed. */
export async function destroySession(token) {
  const idx = findSessionIndex(token)
  if (idx === -1) return false
  state.sessions.splice(idx, 1)
  await persist()
  return true
}

/** Destroy all sessions for a user (remote sign-out / password change). */
export async function destroyUserSessions(userId) {
  const before = state.sessions.length
  state.sessions = state.sessions.filter((s) => s.userId !== Number(userId))
  if (state.sessions.length !== before) await persist()
  return before - state.sessions.length
}

/** Remove expired sessions (housekeeping). Returns count removed. */
export async function cleanupExpired() {
  const now = Date.now()
  const before = state.sessions.length
  state.sessions = state.sessions.filter((s) => s.expiresAt > now)
  if (state.sessions.length !== before) await persist()
  return before - state.sessions.length
}

/** Get all active sessions for a user (without tokens for safety). */
export async function listUserSessions(userId) {
  const now = Date.now()
  return state.sessions
    .filter((s) => s.userId === Number(userId) && s.expiresAt > now)
    .map((s) => ({ id: s.token.slice(0, 8), createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, expiresAt: s.expiresAt }))
}

/** Flush pending writes (for tests). */
export async function flush() {
  await writes
}

/** Reset state (for tests). */
export async function reset() {
  state = { version: 1, sessions: [] }
  await persist()
}
