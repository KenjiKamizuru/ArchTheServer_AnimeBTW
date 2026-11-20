// Installation-wide lists; not a substitute for account-level privacy.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile, sanitizeCoverUrl } from './security.mjs'
import { sanitizeBookmarkMedia } from './store.mjs'
import { parseListImport } from './listImport.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(process.env.ANIMEVAULT_DATA ? path.resolve(process.env.ANIMEVAULT_DATA) : path.join(root, 'data'), 'lists.json')
export const STATUSES = ['watching', 'planned', 'completed', 'paused', 'dropped']
const MAX_LISTS = 50
const MAX_ITEMS = 2000
let state = { version: 1, lists: [], entries: [] }
let writes = Promise.resolve()
const error = (message, status = 400) => Object.assign(new Error(message), { status })

export async function init() {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    if (parsed?.version !== 1 || !Array.isArray(parsed.lists) || !Array.isArray(parsed.entries)) throw new Error('Invalid list data')
    // Fail closed rather than overwriting unreadable data on the next mutation.
    if (parsed.lists.length > MAX_LISTS || parsed.entries.length > MAX_ITEMS) throw new Error('List data exceeds limits')
    const ids = new Set()
    for (const list of parsed.lists) {
      if (typeof list?.id !== 'string' || !/^l_[0-9a-f]{24}$/.test(list.id) || ids.has(list.id) || typeof list.name !== 'string' || !list.name.trim() || list.name.length > 80 || typeof list.description !== 'string' || list.description.length > 500 || (list.cover !== undefined && list.cover !== null && typeof list.cover !== 'string')) throw new Error('Invalid list metadata')
      ids.add(list.id)
    }
    const mediaIds = new Set()
    for (const entry of parsed.entries) {
      const media = sanitizeBookmarkMedia(entry?.media)
      if (!media || media.id !== entry.mediaId || mediaIds.has(media.id) || (entry.status !== null && !STATUSES.includes(entry.status)) || !Array.isArray(entry.listIds) || entry.listIds.some((id) => !ids.has(id)) || new Set(entry.listIds).size !== entry.listIds.length || !Number.isFinite(entry.addedAt)) throw new Error('Invalid list entry')
      if (entry.notes !== undefined && (!Array.isArray(entry.notes) || entry.notes.length > MAX_LISTS + 1 || entry.notes.some((note) => !note || typeof note.listId !== 'string' || typeof note.text !== 'string' || note.text.length > 1000 || !((note.listId === `status:${entry.status}`) || entry.listIds.includes(note.listId))) || new Set(entry.notes.map((note) => note.listId)).size !== entry.notes.length)) throw new Error('Invalid entry notes')
      if (entry.ratings !== undefined && (!Array.isArray(entry.ratings) || entry.ratings.length > MAX_LISTS + 1 || entry.ratings.some((r) => !r || !((r.listId === `status:${entry.status}`) || entry.listIds.includes(r.listId)) || (r.priority !== null && (!Number.isInteger(r.priority) || r.priority < 1 || r.priority > 5)) || (r.rating !== null && (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 10))) || new Set(entry.ratings.map((r) => r.listId)).size !== entry.ratings.length)) throw new Error('Invalid entry ratings')
      if (entry.positions !== undefined && (!Array.isArray(entry.positions) || entry.positions.length > MAX_LISTS + 1 || entry.positions.some((p) => !p || typeof p.listId !== 'string' || typeof p.position !== 'number' || !entry.listIds.includes(p.listId)) || new Set(entry.positions.map((p) => p.listId)).size !== entry.positions.length)) throw new Error('Invalid entry positions')
      mediaIds.add(media.id)
      entry.media = media
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
function info(id) {
  if (id.startsWith('status:')) {
    const status = id.slice(7)
    if (!STATUSES.includes(status)) throw error('List not found', 404)
    return { id, name: status[0].toUpperCase() + status.slice(1), custom: false }
  }
  const list = state.lists.find((item) => item.id === id)
  if (!list) throw error('List not found', 404)
  return { ...list, custom: true }
}
function includes(entry, id) {
  return id.startsWith('status:') ? entry.status === id.slice(7) : entry.listIds.includes(id)
}
export function readList(id, { order = 'added' } = {}) {
  const meta = info(id)
  const entries = state.entries.filter((item) => includes(item, id)).map(({ notes, ratings, positions, ...item }) => ({ ...item, note: notes?.find((n) => n.listId === id)?.text ?? '', priority: ratings?.find((r) => r.listId === id)?.priority ?? null, rating: ratings?.find((r) => r.listId === id)?.rating ?? null, position: positions?.find((p) => p.listId === id)?.position ?? null }))
  const ordered = order === 'manual'
    ? [...entries].sort((a, b) => {
        const pa = a.position ?? Number.MAX_SAFE_INTEGER
        const pb = b.position ?? Number.MAX_SAFE_INTEGER
        return pa - pb || a.mediaId - b.mediaId
      })
    : [...entries].sort((a, b) => b.addedAt - a.addedAt)
  return { ...meta, count: ordered.length, entries: ordered }
}
export function summary() {
  return {
    statuses: STATUSES.map((status) => { const list = readList(`status:${status}`); return { id: list.id, name: list.name, count: list.count } }),
    lists: state.lists.map((list) => ({ ...list, count: readList(list.id).count })),
    totalEntries: state.entries.length,
  }
}
export async function createList(body = {}) {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const cover = typeof body?.cover === 'string' ? sanitizeCoverUrl(body.cover) : null
  if (!name || name.length > 80 || description.length > 500) throw error('Name must be 1–80 characters and description at most 500 characters')
  if (state.lists.length >= MAX_LISTS) throw error('List limit reached', 429)
  const list = { id: `l_${crypto.randomBytes(12).toString('hex')}`, name, description, cover, createdAt: Date.now() }
  state.lists.push(list)
  await persist()
  return list
}
export async function deleteList(id) {
  if (!info(id).custom) throw error('Built-in lists cannot be deleted')
  state.lists = state.lists.filter((item) => item.id !== id)
  for (const entry of state.entries) {
    entry.listIds = entry.listIds.filter((item) => item !== id)
    if (entry.notes) entry.notes = entry.notes.filter((note) => note.listId !== id)
    if (entry.ratings) entry.ratings = entry.ratings.filter((r) => r.listId !== id)
  }
  state.entries = state.entries.filter((entry) => entry.status || entry.listIds.length)
  await persist()
  return { deleted: true }
}
export async function add(id, rawMedia, addedAt = Date.now()) {
  const list = info(id)
  const media = sanitizeBookmarkMedia(rawMedia)
  if (!media) throw error('A valid media object is required')
  let entry = state.entries.find((item) => item.mediaId === media.id)
  if (!entry) {
    if (state.entries.length >= MAX_ITEMS) throw error('Entry limit reached', 429)
    entry = { mediaId: media.id, media, status: 'planned', listIds: [], addedAt }
    state.entries.push(entry)
  } else entry.media = media
  if (list.custom) {
    if (!entry.listIds.includes(id)) entry.listIds.push(id)
  } else {
    if (entry.status !== id.slice(7)) {
      if (entry.notes) entry.notes = entry.notes.filter((note) => note.listId !== `status:${entry.status}`)
      if (entry.ratings) entry.ratings = entry.ratings.filter((r) => r.listId !== `status:${entry.status}`)
    }
    entry.status = id.slice(7)
  }
  await persist()
  return readList(id).entries.find((item) => item.mediaId === media.id)
}
export async function remove(id, rawId) {
  const list = info(id)
  const mediaId = Number(rawId)
  if (!Number.isInteger(mediaId) || mediaId <= 0) throw error('Invalid media id')
  const entry = state.entries.find((item) => item.mediaId === mediaId)
  if (!entry || !includes(entry, id)) return { removed: false }
  if (entry.notes) entry.notes = entry.notes.filter((note) => note.listId !== id)
  if (entry.ratings) entry.ratings = entry.ratings.filter((r) => r.listId !== id)
  if (list.custom) entry.listIds = entry.listIds.filter((item) => item !== id)
  else {
    // Removing a status removes that status; custom memberships remain intact.
    entry.status = null
    if (!entry.listIds.length) state.entries = state.entries.filter((item) => item !== entry)
  }
  if (list.custom && !entry.status && !entry.listIds.length) state.entries = state.entries.filter((item) => item !== entry)
  await persist()
  return { removed: true }
}
export async function setNote(id, rawId, text) {
  info(id)
  const mediaId = Number(rawId)
  if (!Number.isInteger(mediaId) || mediaId <= 0) throw error('Invalid media id')
  if (typeof text !== 'string' || text.length > 1000) throw error('Note must be text of at most 1000 characters')
  const entry = state.entries.find((item) => item.mediaId === mediaId)
  if (!entry || !includes(entry, id)) throw error('Entry not found in list', 404)
  entry.notes = (entry.notes ?? []).filter((note) => note.listId !== id)
  if (text.trim()) entry.notes.push({ listId: id, text })
  await persist()
  return { mediaId, note: text.trim() ? text : '' }
}
export async function setRating(id, rawId, patch) {
  info(id)
  const mediaId = Number(rawId)
  if (!Number.isInteger(mediaId) || mediaId <= 0) throw error('Invalid media id')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some((key) => !['priority', 'rating'].includes(key))) throw error('Expected priority and/or rating')
  for (const [key, max] of [['priority', 5], ['rating', 10]]) {
    if (key in patch && patch[key] !== null && (!Number.isInteger(patch[key]) || patch[key] < 1 || patch[key] > max)) throw error(`${key} must be null or an integer from 1 to ${max}`)
  }
  const entry = state.entries.find((item) => item.mediaId === mediaId)
  if (!entry || !includes(entry, id)) throw error('Entry not found in list', 404)
  const previous = entry.ratings?.find((r) => r.listId === id)
  const next = { listId: id, priority: patch.priority === undefined ? previous?.priority ?? null : patch.priority, rating: patch.rating === undefined ? previous?.rating ?? null : patch.rating }
  entry.ratings = (entry.ratings ?? []).filter((r) => r.listId !== id)
  if (next.priority !== null || next.rating !== null) entry.ratings.push(next)
  await persist()
  return { mediaId, priority: next.priority, rating: next.rating }
}

/**
 * Sets a manual ordering for entries in a custom list. `mediaIds` is the
 * desired order (all entries currently in the list). Returns the number of
 * entries that received a position. Built-in status lists are not orderable.
 */
export async function setOrder(id, mediaIds) {
  const list = info(id)
  if (!list.custom) throw error('Built-in lists cannot be manually ordered', 400)
  if (!Array.isArray(mediaIds) || !mediaIds.every((m) => Number.isInteger(m) && m > 0)) throw error('mediaIds must be an array of positive integers', 400)

  const entries = state.entries.filter((item) => includes(item, id))
  const entryIds = new Set(entries.map((item) => item.mediaId))
  const providedIds = new Set(mediaIds)
  if (entryIds.size !== providedIds.size || [...entryIds].some((id) => !providedIds.has(id))) throw error('mediaIds must match the entries currently in the list', 400)

  // Assign positions 1..N in the requested order.
  const positionById = new Map(mediaIds.map((mediaId, index) => [mediaId, index + 1]))
  for (const entry of entries) {
    entry.positions = (entry.positions ?? []).filter((p) => p.listId !== id)
    entry.positions.push({ listId: id, position: positionById.get(entry.mediaId) })
  }
  await persist()
  return { ordered: entries.length }
}

/**
 * Sets the cover artwork URL for a custom list. Built-in lists cannot have a cover.
 * Returns the sanitized cover URL (or null if cleared).
 */
export async function setCover(id, coverUrl) {
  const list = info(id)
  if (!list.custom) throw error('Built-in lists cannot have a cover', 400)
  const sanitized = coverUrl == null ? null : sanitizeCoverUrl(coverUrl)
  if (coverUrl !== null && coverUrl !== undefined && sanitized === null) throw error('Invalid cover URL', 400)
  list.cover = sanitized
  await persist()
  return { cover: list.cover }
}
// Import into a new custom list. Existing titles keep their metadata and status;
// imported notes/ratings belong only to the newly-created list.
export async function importList(document) {
  const parsed = parseListImport(document)
  if (state.lists.length >= MAX_LISTS) throw error('List limit reached', 429)
  const existing = new Map(state.entries.map((entry) => [entry.mediaId, entry]))
  const newCount = parsed.entries.filter((entry) => !existing.has(entry.mediaId)).length
  if (state.entries.length + newCount > MAX_ITEMS) throw error('Entry limit reached', 429)
  const list = { id: `l_${crypto.randomBytes(12).toString('hex')}`, name: parsed.name, description: parsed.description, createdAt: Date.now() }
  state.lists.push(list)
  for (const item of parsed.entries) {
    let entry = existing.get(item.mediaId)
    if (!entry) {
      entry = { mediaId: item.mediaId, media: item.media, status: item.status, listIds: [], addedAt: item.addedAt }
      state.entries.push(entry)
    }
    entry.listIds.push(list.id)
    if (item.note.trim()) (entry.notes ??= []).push({ listId: list.id, text: item.note })
    if (item.priority !== null || item.rating !== null) (entry.ratings ??= []).push({ listId: list.id, priority: item.priority, rating: item.rating })
  }
  await persist()
  return { list, imported: parsed.entries.length, newEntries: newCount }
}
export async function migrateBookmarks(bookmarks) {
  let migrated = 0, skipped = 0
  for (const bookmark of bookmarks) {
    const media = sanitizeBookmarkMedia(bookmark.media)
    if (!media || state.entries.some((entry) => entry.mediaId === media.id) || state.entries.length >= MAX_ITEMS) { skipped++; continue }
    state.entries.push({ mediaId: media.id, media, status: 'planned', listIds: [], addedAt: Number(bookmark.addedAt) || Date.now() })
    migrated++
  }
  if (migrated) await persist()
  return { migrated, skipped }
}
