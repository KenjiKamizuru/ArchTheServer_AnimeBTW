// Watch-progress persistence (AV-151a): progress is stored INDEPENDENTLY for
// every user profile. Pure data + fs persistence; no I/O policy of its own.
//
// Scope decisions (recorded per task rules):
// - The unit of progress is keyed by the full tuple (profileId, mediaId,
//   season, episode): per-profile independence (AV-151) AND per anime /
//   season / episode independence (AV-152 groundwork) in the same key shape,
//   since a record without episode granularity could not express either.
// - `profileId` is the ROUTE-RESOLVED profile key (owner account id, or
//   `<userId>:g:<guestId>` for a guest selection — derived from the AV-123
//   device profile, whose fallback semantics apply). The store itself treats
//   it as an opaque bounded string and enforces isolation between keys.
// - `season` is an opaque bounded season key (e.g. 'winter-2024', 's1') —
//   callers pass the canonical key they already use; open vocabulary (like
//   beta codes), bounded length. `episode` is a positive integer for now;
//   specials/absolute numbering (AV-171/172) extend this later.
// - `positionSeconds` is the playback position (finite, ≥ 0, capped); the
//   started/completed state machine (AV-154) and completion threshold
//   (AV-155) are deliberately NOT modeled yet.
// - Storage is a shared installation file (data/progress.json) but every
//   operation is scoped by profileId — profiles never see each other's
//   entries (the AV-151 acceptance, pinned by tests).
// - Bounded: at most MAX_ENTRIES_PER_PROFILE per profile and MAX_PROFILES
//   distinct profiles per installation; beyond that, saves are rejected
//   (429-style error) rather than growing without limit.

import { atomicWriteFile } from './security.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(process.env.ANIMEVAULT_DATA ? path.resolve(process.env.ANIMEVAULT_DATA) : path.join(root, 'data'), 'progress.json')

export const MAX_ENTRIES_PER_PROFILE = 5000
export const MAX_PROFILES = 200
const PROFILE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/
const SEASON_PATTERN = /^.{1,40}$/
const MAX_POSITION_SECONDS = 10_000_000

let state = { version: 1, entries: [] }
let writes = Promise.resolve()
const error = (message, status = 400) => Object.assign(new Error(message), { status })

export async function init() {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('Invalid progress data')
    for (const entry of parsed.entries) validateRecord(entry)
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

export async function flush() { await writes }

function validateRecord(entry) {
  const valid = entry
    && typeof entry.profileId === 'string' && PROFILE_PATTERN.test(entry.profileId)
    && Number.isInteger(entry.mediaId) && entry.mediaId > 0
    && typeof entry.season === 'string' && SEASON_PATTERN.test(entry.season)
    && Number.isInteger(entry.episode) && entry.episode > 0 && entry.episode <= 100_000
    && Number.isFinite(entry.positionSeconds) && entry.positionSeconds >= 0 && entry.positionSeconds <= MAX_POSITION_SECONDS
    && Number.isFinite(entry.updatedAt)
  if (!valid) throw new Error('Invalid progress entry')
  return entry
}

function view(entry) {
  return {
    profileId: entry.profileId,
    mediaId: entry.mediaId,
    season: entry.season,
    episode: entry.episode,
    positionSeconds: entry.positionSeconds,
    updatedAt: entry.updatedAt,
  }
}

function matches(entry, profileId, scope = {}) {
  if (entry.profileId !== profileId) return false
  if (scope.mediaId !== undefined && entry.mediaId !== scope.mediaId) return false
  if (scope.season !== undefined && entry.season !== scope.season) return false
  if (scope.episode !== undefined && entry.episode !== scope.episode) return false
  return true
}

/** Upsert one progress record for a profile (AV-151: profiles are isolated). */
export async function saveProgress(profileId, record, { now = Date.now() } = {}) {
  if (typeof profileId !== 'string' || !PROFILE_PATTERN.test(profileId)) throw error('Invalid profile id')
  const built = {
    profileId,
    mediaId: Number(record?.mediaId),
    season: String(record?.season ?? ''),
    episode: Number(record?.episode),
    positionSeconds: Number(record?.positionSeconds),
    updatedAt: now,
  }
  try {
    validateRecord(built)
  } catch {
    throw error('Progress requires a positive integer mediaId and episode, a season key (1–40 characters), and positionSeconds from 0 to ' + MAX_POSITION_SECONDS)
  }
  const existing = state.entries.find((entry) => matches(entry, profileId, built))
  if (!existing) {
    const profiles = new Set(state.entries.map((entry) => entry.profileId))
    if (!profiles.has(profileId) && profiles.size >= MAX_PROFILES) throw error('Progress profile limit reached', 429)
    const mine = state.entries.filter((entry) => entry.profileId === profileId)
    if (mine.length >= MAX_ENTRIES_PER_PROFILE) throw error('Progress entry limit reached', 429)
    state.entries.push(built)
  } else {
    existing.positionSeconds = built.positionSeconds
    existing.updatedAt = built.updatedAt
  }
  await persist()
  return view(state.entries.find((entry) => matches(entry, profileId, built)))
}

/** All progress for one profile, most recently updated first. */
export function listProgress(profileId) {
  return state.entries
    .filter((entry) => entry.profileId === profileId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(view)
}

/** One record by full key, or null. */
export function getProgress(profileId, mediaId, season, episode) {
  const found = state.entries.find((entry) => entry.profileId === profileId
    && entry.mediaId === Number(mediaId) && entry.season === String(season ?? '') && entry.episode === Number(episode))
  return found ? view(found) : null
}

/** Scoped clear: exact record (full key), per anime, or the whole profile. */
export async function clearProgress(profileId, scope = {}) {
  const before = state.entries.length
  state.entries = state.entries.filter((entry) => !matches(entry, profileId, {
    mediaId: scope.mediaId === undefined ? undefined : Number(scope.mediaId),
    season: scope.season === undefined ? undefined : String(scope.season),
    episode: scope.episode === undefined ? undefined : Number(scope.episode),
  }))
  const removed = before - state.entries.length
  if (removed) await persist()
  return { removed }
}
