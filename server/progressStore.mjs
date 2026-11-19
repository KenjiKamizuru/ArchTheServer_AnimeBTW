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
// - `positionSeconds` is the playback position (finite, ≥ 0, capped); each
//   record also stores its episode `state` (AV-154): 'started', 'completed',
//   or 'manual' (manually marked) — default 'started', preserved across
//   positional-only upserts, replaced when a save passes a new state. The
//   completion threshold (AV-155) is deliberately NOT modeled yet.
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
/** Episode states (AV-154): in progress, finished, or manually marked. */
export const PROGRESS_STATES = ['started', 'completed', 'manual']
/** Auto-completion threshold (AV-155): percent of KNOWN runtime, 50–100. */
export const DEFAULT_COMPLETION_THRESHOLD_PERCENT = 90
const MAX_RUNTIME_SECONDS = 100_000
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
    for (const entry of parsed.entries) {
      // AV-154/155: pre-state files stay valid — a missing state means
      // 'started' and a missing runtime means unknown.
      entry.state ??= 'started'
      entry.runtimeSeconds ??= null
      validateRecord(entry)
    }
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
    && (entry.runtimeSeconds === null || (Number.isInteger(entry.runtimeSeconds) && entry.runtimeSeconds >= 1 && entry.runtimeSeconds <= MAX_RUNTIME_SECONDS))
    && PROGRESS_STATES.includes(entry.state)
    && Number.isFinite(entry.updatedAt)
  if (!valid) throw new Error('Invalid progress entry')
  return entry
}

/** Pure derivation (AV-155): an episode auto-completes when its position
 * crosses `thresholdPercent` of its KNOWN runtime. Rules (pinned): an
 * existing 'completed' or 'manual' mark is never downgraded, and an unknown
 * runtime means uncertain — no auto-derivation, ever. */
export function deriveEpisodeState(positionSeconds, runtimeSeconds, previousState, thresholdPercent) {
  if (PROGRESS_STATES.includes(previousState) && previousState !== 'started') return previousState
  const percent = Number.isInteger(thresholdPercent) && thresholdPercent >= 50 && thresholdPercent <= 100
    ? thresholdPercent
    : DEFAULT_COMPLETION_THRESHOLD_PERCENT
  const runtime = Number(runtimeSeconds)
  if (!Number.isFinite(runtime) || runtime <= 0) return previousState ?? 'started'
  return positionSeconds >= (runtime * percent) / 100 ? 'completed' : (previousState ?? 'started')
}

function view(entry) {
  return {
    profileId: entry.profileId,
    mediaId: entry.mediaId,
    season: entry.season,
    episode: entry.episode,
    positionSeconds: entry.positionSeconds,
    runtimeSeconds: entry.runtimeSeconds ?? null,
    state: entry.state,
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
export async function saveProgress(profileId, record, { now = Date.now(), completionThresholdPercent } = {}) {
  if (typeof profileId !== 'string' || !PROFILE_PATTERN.test(profileId)) throw error('Invalid profile id')
  const requestedState = record?.state === undefined ? undefined : String(record.state)
  if (requestedState !== undefined && !PROGRESS_STATES.includes(requestedState)) {
    throw error("Progress state must be 'started', 'completed', or 'manual'")
  }
  const runtimeSeconds = record?.runtimeSeconds === undefined || record?.runtimeSeconds === null ? null : Number(record.runtimeSeconds)
  if (runtimeSeconds !== null && (!Number.isInteger(runtimeSeconds) || runtimeSeconds < 1 || runtimeSeconds > MAX_RUNTIME_SECONDS)) {
    throw error('runtimeSeconds must be a positive integer from 1 to ' + MAX_RUNTIME_SECONDS)
  }
  const built = {
    profileId,
    mediaId: Number(record?.mediaId),
    season: String(record?.season ?? ''),
    episode: Number(record?.episode),
    positionSeconds: Number(record?.positionSeconds),
    runtimeSeconds,
    state: requestedState ?? 'started',
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
    // AV-155: without an explicit state, a passed completion threshold
    // derives one (an unknown runtime simply stays 'started'). No threshold
    // option = no derivation (AV-154 behavior).
    state.entries.push({
      ...built,
      state: requestedState ?? (completionThresholdPercent !== undefined
        ? deriveEpisodeState(built.positionSeconds, built.runtimeSeconds, undefined, completionThresholdPercent)
        : built.state),
    })
  } else {
    existing.positionSeconds = built.positionSeconds
    // An omitted runtime never wipes a known one; an omitted state follows
    // AV-154 (preserve) and, with a threshold, AV-155 derivation instead.
    if (runtimeSeconds !== null) existing.runtimeSeconds = runtimeSeconds
    existing.updatedAt = built.updatedAt
    if (requestedState !== undefined) {
      existing.state = built.state
    } else if (completionThresholdPercent !== undefined) {
      existing.state = deriveEpisodeState(existing.positionSeconds, existing.runtimeSeconds ?? null, existing.state, completionThresholdPercent)
    }
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
