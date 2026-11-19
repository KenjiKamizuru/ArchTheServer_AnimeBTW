// Playback-session records (AV-166, slice 1): append-only per-profile
// records of watched sessions — start time, end time, and watched duration
// (actual playback seconds, not wall time). Pure data + fs persistence,
// mirroring progressStore's conventions:
// - profileId is the ROUTE-RESOLVED profile key; the store treats it as an
//   opaque bounded string and isolates between keys.
// - season is an opaque bounded season key; episode is a positive integer
//   (specials/absolute numbering are AV-171/172's scope).
// - watchedSeconds counts REAL playback seconds and may not exceed the
//   session's wall time (plus small scheduling slack) — pause time is not
//   watched time.
// - Bounded: MAX_SESSIONS_PER_PROFILE with FIFO trim (oldest dropped), and
//   MAX_PROFILES distinct profiles; the file is data/sessions.json.
// - Slice 2 (pending): the Player's writer effect creates these; the store
//   and routes are complete and tested on their own.

import { atomicWriteFile } from './security.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(process.env.ANIMEVAULT_DATA ? path.resolve(process.env.ANIMEVAULT_DATA) : path.join(root, 'data'), 'sessions.json')

export const MAX_SESSIONS_PER_PROFILE = 500
export const MAX_PROFILES = 200
export const MAX_SESSION_WALL_MS = 24 * 60 * 60 * 1000
const PROFILE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/
const SEASON_PATTERN = /^.{1,40}$/
const WATCHED_SLACK_SECONDS = 5

let state = { version: 1, sessions: [] }
let writes = Promise.resolve()
const error = (message, status = 400) => Object.assign(new Error(message), { status })

export async function init() {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error('Invalid session data')
    for (const session of parsed.sessions) validateSession(session)
    state = parsed
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

function persist() {
  const snapshot = JSON.stringify(state)
  const operation = writes.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    await atomicWriteFile(file, snapshot)
  })
  writes = operation
  return operation
}

/** Drain pending writes (test shutdown). */
export async function flush() { await writes }

function validateSession(session) {
  if (typeof session.id !== 'string' || !/^s_[0-9a-f]{16}$/.test(session.id)) throw error('Invalid session id')
  if (typeof session.profileId !== 'string' || !PROFILE_PATTERN.test(session.profileId)) throw error('Invalid profile')
  if (!Number.isInteger(session.mediaId) || session.mediaId <= 0) throw error('Invalid mediaId')
  if (typeof session.season !== 'string' || !SEASON_PATTERN.test(session.season)) throw error('Invalid season')
  if (!Number.isInteger(session.episode) || session.episode <= 0) throw error('Invalid episode')
  if (!Number.isInteger(session.startedAt) || !Number.isInteger(session.endedAt)) throw error('Invalid session times')
  if (session.endedAt < session.startedAt) throw error('endedAt must not precede startedAt')
  if (session.endedAt - session.startedAt > MAX_SESSION_WALL_MS) throw error('Session wall time is out of range')
  const wallSeconds = Math.ceil((session.endedAt - session.startedAt) / 1000)
  if (!Number.isInteger(session.watchedSeconds) || session.watchedSeconds < 0
    || session.watchedSeconds > wallSeconds + WATCHED_SLACK_SECONDS) {
    throw error('watchedSeconds must fit inside the session wall time')
  }
}

const view = (session) => ({ ...session })

/**
 * Append one session record. Per-profile FIFO: exceeding
 * MAX_SESSIONS_PER_PROFILE drops the OLDEST sessions of that profile.
 * Grows the profile count only up to MAX_PROFILES (then rejects).
 */
export async function saveSession(profileId, record, { now = Date.now() } = {}) {
  const session = {
    id: `s_${crypto.randomBytes(8).toString('hex')}`,
    profileId: String(profileId ?? ''),
    mediaId: Number(record?.mediaId),
    season: String(record?.season ?? ''),
    episode: Number(record?.episode),
    startedAt: Number(record?.startedAt),
    endedAt: Number(record?.endedAt ?? now),
    watchedSeconds: Number(record?.watchedSeconds),
  }
  validateSession(session)
  const profiles = new Set(state.sessions.map((entry) => entry.profileId))
  if (!profiles.has(session.profileId) && profiles.size >= MAX_PROFILES) {
    throw error('Too many profiles', 429)
  }
  state.sessions.push(session)
  const own = state.sessions.filter((entry) => entry.profileId === session.profileId)
  if (own.length > MAX_SESSIONS_PER_PROFILE) {
    const drop = new Set(
      own
        .slice()
        .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
        .slice(0, own.length - MAX_SESSIONS_PER_PROFILE)
        .map((entry) => entry.id),
    )
    state.sessions = state.sessions.filter((entry) => !drop.has(entry.id))
  }
  await persist()
  return view(session)
}

/** One profile's sessions, newest first (startedAt desc, id tiebreak). */
export function listSessions(profileId) {
  return state.sessions
    .filter((entry) => entry.profileId === profileId)
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
    .map(view)
}

/**
 * Scoped clear (same semantics as progressStore.clearProgress): exact
 * session target (mediaId+season+episode), per anime (mediaId only), or the
 * whole profile. Used by the session routes and by the watch-history
 * deletion paths so sessions never outlive their progress entries.
 */
export async function clearSessions(profileId, scope = {}) {
  const before = state.sessions.length
  state.sessions = state.sessions.filter((entry) => {
    if (entry.profileId !== profileId) return true
    if (scope.mediaId !== undefined && entry.mediaId !== Number(scope.mediaId)) return true
    if (scope.season !== undefined && entry.season !== String(scope.season)) return true
    if (scope.episode !== undefined && entry.episode !== Number(scope.episode)) return true
    return false
  })
  const removed = before - state.sessions.length
  if (removed) await persist()
  return { removed }
}

/** Batch scoped clear: removes exactly the listed targets (dupes once). */
export async function clearSessionsEntries(profileId, items) {
  const keys = new Set(
    items.map((item) => `${Number(item.mediaId)}\u0000${String(item.season ?? '')}\u0000${Number(item.episode)}`),
  )
  const before = state.sessions.length
  state.sessions = state.sessions.filter(
    (entry) => !(entry.profileId === profileId && keys.has(`${entry.mediaId}\u0000${entry.season}\u0000${entry.episode}`)),
  )
  const removed = before - state.sessions.length
  if (removed) await persist()
  return { removed }
}
