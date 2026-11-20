// Dedicated external-identifier registry (AV-002).
//
// The catalog's numeric `id` is an AniList identity, not a universal key. This
// module keeps provider IDs in their own collection so other adapters can map a
// title across AniList, MyAnimeList, AniDB and IMDb without leaking those
// identifiers into the public catalog shape.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile, isSafeObjectKey } from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.ANIMEVAULT_DATA
  ? path.resolve(process.env.ANIMEVAULT_DATA)
  : path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'external-identifiers.json')

export const PROVIDERS = new Set(['anilist', 'anidb', 'mal', 'imdb'])
const NUMERIC_PROVIDERS = new Set(['anilist', 'anidb', 'mal'])
const MAX_RECORDS = 10_000
const MAX_IDS_PER_RECORD = 16
const SAVE_DELAY_MS = 150

let state = { version: 1, byMedia: {} }
let ready = false
let lastError = null
let saveTimer = null
let saveChain = Promise.resolve()

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export function normalizeMediaId(raw) {
  const value = String(raw ?? '').trim()
  if (!/^\d{1,12}$/.test(value)) throw httpError('Invalid media id')
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError('Invalid media id')
  return String(id)
}

/** Validates and canonicalizes one provider identifier (numeric or `tt…`). */
export function normalizeExternalId(provider, raw) {
  const name = String(provider ?? '').trim().toLowerCase()
  if (!isSafeObjectKey(name) || !PROVIDERS.has(name)) throw httpError('Unsupported provider')
  const value = String(raw ?? '').trim()
  if (!value || value.length > 32) throw httpError('Invalid external id')

  if (NUMERIC_PROVIDERS.has(name)) {
    if (!/^\d{1,12}$/.test(value)) throw httpError('Invalid external id')
    const numeric = Number(value)
    if (!Number.isSafeInteger(numeric) || numeric <= 0) throw httpError('Invalid external id')
    return String(numeric)
  }
  const imdb = value.toLowerCase()
  if (!/^tt\d{7,10}$/.test(imdb)) throw httpError('Invalid external id')
  return imdb
}

function validateState(parsed) {
  if (!parsed || parsed.version !== 1 || !parsed.byMedia || typeof parsed.byMedia !== 'object' || Array.isArray(parsed.byMedia)) {
    throw new Error('Invalid identifier registry')
  }
  const records = Object.keys(parsed.byMedia)
  if (records.length > MAX_RECORDS) throw new Error('Identifier registry exceeds limits')
  for (const mediaId of records) {
    normalizeMediaId(mediaId)
    const ids = parsed.byMedia[mediaId]
    if (!ids || typeof ids !== 'object' || Array.isArray(ids) || Object.keys(ids).length > MAX_IDS_PER_RECORD) {
      throw new Error('Invalid identifier record')
    }
    for (const [provider, value] of Object.entries(ids)) normalizeExternalId(provider, value)
  }
  return { version: 1, byMedia: parsed.byMedia }
}

export async function init() {
  if (ready) return
  try {
    state = validateState(JSON.parse(await fsp.readFile(FILE, 'utf8')))
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      // Never silently discard unreadable user data: quarantine and start clean.
      lastError = err.message
      await fsp.rename(FILE, `${FILE}.corrupt-${Date.now()}`).catch(() => {})
    }
    state = { version: 1, byMedia: {} }
  }
  ready = true
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveChain = saveChain
      .then(async () => {
        await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
        await atomicWriteFile(FILE, JSON.stringify(state))
      })
      .catch((err) => { lastError = err.message })
  }, SAVE_DELAY_MS)
  saveTimer.unref?.()
}

function assertUnique(mediaId, provider, value) {
  for (const [otherId, ids] of Object.entries(state.byMedia)) {
    if (otherId !== mediaId && ids?.[provider] === value) {
      throw httpError(`${provider} id already belongs to another title`, 409)
    }
  }
}

function mergeInternal(rawMediaId, rawIds) {
  if (!rawIds || typeof rawIds !== 'object' || Array.isArray(rawIds)) throw httpError('Identifiers must be an object')
  const mediaId = normalizeMediaId(rawMediaId)
  const existing = state.byMedia[mediaId] ?? {}
  const next = { ...existing }
  for (const [rawProvider, rawValue] of Object.entries(rawIds)) {
    if (rawValue === null || rawValue === undefined || rawValue === '') continue
    const provider = String(rawProvider).trim().toLowerCase()
    const value = normalizeExternalId(provider, rawValue)
    assertUnique(mediaId, provider, value)
    next[provider] = value
  }
  if (Object.keys(next).length > MAX_IDS_PER_RECORD) throw httpError('Too many identifiers for one title', 413)
  state.byMedia[mediaId] = next
  return { ...next }
}

/** Reads a copy of the identifier map for one canonical media id. */
export async function get(mediaId) {
  await init()
  const ids = state.byMedia[normalizeMediaId(mediaId)]
  return ids ? { ...ids } : null
}

/** Sets/merges identifiers, returning the full record for the title. */
export async function merge(mediaId, ids) {
  await init()
  const result = mergeInternal(mediaId, ids)
  scheduleSave()
  return result
}

export async function set(mediaId, provider, externalId) {
  return merge(mediaId, { [provider]: externalId })
}

/** Reverse lookup: canonical media id for a provider identifier, or null. */
export async function find(provider, externalId) {
  await init()
  const name = String(provider ?? '').trim().toLowerCase()
  const value = normalizeExternalId(name, externalId)
  for (const [mediaId, ids] of Object.entries(state.byMedia)) {
    if (ids?.[name] === value) return Number(mediaId)
  }
  return null
}

/**
 * Fire-and-forget registration used by the metadata adapter. It deliberately
 * ignores bad provider data so a malformed external id cannot break browsing.
 */
export function remember(record) {
  if (!ready || !record || !Number.isSafeInteger(record.id)) return null
  try {
    const result = mergeInternal(record.id, record.externalIds)
    scheduleSave()
    return result
  } catch {
    return null
  }
}

export async function remove(mediaId, provider) {
  await init()
  const id = normalizeMediaId(mediaId)
  if (!state.byMedia[id]) return null
  if (provider === undefined) {
    delete state.byMedia[id]
    scheduleSave()
    return {}
  }
  const name = String(provider).trim().toLowerCase()
  if (!PROVIDERS.has(name)) throw httpError('Unsupported provider')
  const next = { ...state.byMedia[id] }
  delete next[name]
  if (Object.keys(next).length === 0) delete state.byMedia[id]
  else state.byMedia[id] = next
  scheduleSave()
  return next
}

/** Copy-safe snapshot for diagnostics (never exposes internal references). */
export function snapshot() {
  const byMedia = {}
  for (const [mediaId, ids] of Object.entries(state.byMedia)) byMedia[mediaId] = { ...ids }
  return { version: 1, byMedia, ready, lastError }
}

export async function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveChain
  if (!ready) return
  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  await atomicWriteFile(FILE, JSON.stringify(state))
}
