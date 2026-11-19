// Tiny JSON key-value store for small, user-owned side data (per-anime notes,
// correction reports, saved section orders).
//
// Deliberately simple: one file, debounced atomic writes, a hard key/value cap
// so a stuck client cannot grow the file without bound. Anything needing real
// querying belongs in a database, not here.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile } from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.ANIMEVAULT_DATA
  ? path.resolve(process.env.ANIMEVAULT_DATA)
  : path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'kv.json')

const MAX_VALUE_BYTES = 64 * 1024
const MAX_KEYS = 2_000
const SAVE_DELAY_MS = 150

let store = {}
let ready = false
let saveTimer = null
let saveChain = Promise.resolve()
let lastError = null

export async function init() {
  if (ready) return
  try {
    const raw = await fsp.readFile(FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      store = parsed
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      // A corrupt file should not take the server down; start clean and keep a
      // copy so nothing is silently destroyed.
      lastError = err.message
      try {
        await fsp.rename(FILE, `${FILE}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
    }
    store = {}
  }
  ready = true
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveChain = saveChain
      .then(async () => {
        await fsp.mkdir(DATA_DIR, { recursive: true })
        await atomicWriteFile(FILE, JSON.stringify(store))
      })
      .catch((err) => {
        lastError = err.message
      })
  }, SAVE_DELAY_MS)
  // Do not hold the process open just to flush a debounce.
  saveTimer.unref?.()
}

/** Reads a key, returning `fallback` when absent. Never throws. */
export async function get(key, fallback = null) {
  await init()
  if (typeof key !== 'string' || !key) return fallback
  return Object.hasOwn(store, key) ? store[key] : fallback
}

export async function set(key, value) {
  await init()
  if (typeof key !== 'string' || !key || key.length > 200) {
    throw Object.assign(new Error('Invalid storage key'), { status: 400 })
  }
  const serialised = JSON.stringify(value)
  if (serialised === undefined) throw Object.assign(new Error('Value is not serialisable'), { status: 400 })
  if (Buffer.byteLength(serialised, 'utf8') > MAX_VALUE_BYTES) {
    throw Object.assign(new Error('Stored value is too large'), { status: 413 })
  }
  if (!Object.hasOwn(store, key) && Object.keys(store).length >= MAX_KEYS) {
    throw Object.assign(new Error('Storage is full'), { status: 507 })
  }
  store[key] = value
  scheduleSave()
  return value
}

export async function remove(key) {
  await init()
  if (!Object.hasOwn(store, key)) return false
  delete store[key]
  scheduleSave()
  return true
}

/** Shallow listing of keys (optionally filtered by prefix) for diagnostics. */
export async function keys(prefix = '') {
  await init()
  return Object.keys(store).filter((key) => key.startsWith(prefix))
}

export async function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveChain
  if (!ready) return
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await atomicWriteFile(FILE, JSON.stringify(store))
}

export function state() {
  return { ready, keys: Object.keys(store).length, file: FILE, lastError }
}

/** Test/seeding hook: replaces the in-memory store. */
export function __setStoreForTests(next) {
  store = next && typeof next === 'object' ? next : {}
  ready = true
}
