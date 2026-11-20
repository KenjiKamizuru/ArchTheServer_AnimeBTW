import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile, sanitizeCoverUrl, sanitizePublicHttpUrl } from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'bookmarks.json')
const MAX_BOOKMARKS = 2_000

/** mediaId -> { mediaId, addedAt, media } */
const items = new Map()
let saveTimer = null
let saveChain = Promise.resolve()
let ready = false

function optStr(v, maxLen) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed ? trimmed.slice(0, maxLen) : null
}

function optInt(v, lo, hi) {
  const n = Number(v)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

function sanitizeLinks(rawLinks) {
  if (!Array.isArray(rawLinks)) return []
  const out = []
  for (const l of rawLinks.slice(0, 30)) {
    if (!l || typeof l !== 'object') continue
    const site = optStr(l.site, 80)
    const url = sanitizePublicHttpUrl(l.url, { httpsOnly: false, maxLen: 512 })
    if (site && url) out.push({ site, url })
  }
  return out
}

/**
 * Normalizes and validates a bookmarked Media object so stored bookmarks cannot
 * inject `javascript:`/`data:` URLs, LAN `http://` beacons, or megabyte blobs.
 */
export function sanitizeBookmarkMedia(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = optInt(raw.id, 1, 2_000_000_000)
  if (!id) return null
  const title = optStr(raw.title, 240) || optStr(raw.english, 240) || optStr(raw.romaji, 240) || `Anime #${id}`
  const rawColor = typeof raw.color === 'string' ? raw.color.trim() : ''
  const color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : null

  let nextEpisode = null
  if (raw.nextEpisode && typeof raw.nextEpisode === 'object') {
    const ep = optInt(raw.nextEpisode.episode, 1, 99_999)
    const airingAt = optInt(raw.nextEpisode.airingAt, 0, 99_999_999_999)
    if (ep != null && airingAt != null) nextEpisode = { episode: ep, airingAt }
  }

  return {
    id,
    title,
    romaji: optStr(raw.romaji, 240),
    english: optStr(raw.english, 240),
    native: optStr(raw.native, 240),
    cover: sanitizeCoverUrl(raw.cover),
    banner: sanitizeCoverUrl(raw.banner),
    color,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 4_000) : '',
    episodes: optInt(raw.episodes, 0, 99_999),
    airedEpisodes: optInt(raw.airedEpisodes, 0, 99_999) ?? 0,
    duration: optInt(raw.duration, 0, 10_000),
    status: optStr(raw.status, 32) ?? 'UNKNOWN',
    format: optStr(raw.format, 32),
    season: optStr(raw.season, 16),
    seasonYear: optInt(raw.seasonYear, 1900, 2200),
    score: optInt(raw.score, 0, 100),
    popularity: optInt(raw.popularity, 0, 2_000_000_000) ?? 0,
    genres: Array.isArray(raw.genres)
      ? raw.genres.slice(0, 20).map((g) => optStr(g, 48)).filter(Boolean)
      : [],
    nextEpisode,
    studios: Array.isArray(raw.studios)
      ? raw.studios.slice(0, 12).map((s) => optStr(s, 80)).filter(Boolean)
      : [],
    links: sanitizeLinks(raw.links),
    streams: sanitizeLinks(raw.streams),
    anidb: sanitizePublicHttpUrl(raw.anidb, { httpsOnly: false, maxLen: 512 }),
    anidbSearch: Boolean(raw.anidbSearch),
    siteUrl: sanitizePublicHttpUrl(raw.siteUrl, { httpsOnly: false, maxLen: 512 }),
  }
}

function flushWrite() {
  const payload = JSON.stringify([...items.values()], null, 2)
  saveChain = saveChain
    .catch(() => {})
    .then(() => atomicWriteFile(FILE, payload))
    .catch((err) => {
      console.error('[bookmarks] save failed:', err?.message || err)
    })
  return saveChain
}

function persist() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushWrite()
  }, 250)
  saveTimer.unref?.()
}

export async function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    await flushWrite()
    return
  }
  await saveChain
}

export async function init() {
  items.clear()
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
    const raw = await fsp.readFile(FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      for (const entry of parsed.slice(0, MAX_BOOKMARKS)) {
        const cleanMedia = sanitizeBookmarkMedia(entry?.media)
        if (!cleanMedia) continue
        items.set(cleanMedia.id, {
          mediaId: cleanMedia.id,
          addedAt: Number(entry.addedAt) || Date.now(),
          media: cleanMedia,
        })
      }
    }
  } catch {
    // First run: nothing stored yet.
  }
  ready = true
}

export function list() {
  return [...items.values()].sort((a, b) => b.addedAt - a.addedAt)
}

export function has(mediaId) {
  return items.has(Number(mediaId))
}

export function add(media) {
  const clean = sanitizeBookmarkMedia(media)
  if (!clean) {
    throw Object.assign(new Error('A valid media object with a positive integer id is required'), { status: 400 })
  }
  if (!items.has(clean.id) && items.size >= MAX_BOOKMARKS) {
    throw Object.assign(new Error(`Bookmark limit (${MAX_BOOKMARKS}) reached`), { status: 429 })
  }
  const entry = { mediaId: clean.id, addedAt: items.get(clean.id)?.addedAt ?? Date.now(), media: clean }
  items.set(clean.id, entry)
  persist()
  return entry
}

export function remove(mediaId) {
  const id = Number(mediaId)
  if (!Number.isInteger(id) || id <= 0) return false
  const deleted = items.delete(id)
  if (deleted) persist()
  return deleted
}

export function toggle(media) {
  const clean = sanitizeBookmarkMedia(media)
  if (!clean) {
    throw Object.assign(new Error('A valid media object is required'), { status: 400 })
  }
  if (items.has(clean.id)) {
    remove(clean.id)
    return { bookmarked: false }
  }
  add(clean)
  return { bookmarked: true }
}

export function isReady() {
  return ready
}

export function stateFile() {
  return fs.existsSync(FILE) ? FILE : null
}
