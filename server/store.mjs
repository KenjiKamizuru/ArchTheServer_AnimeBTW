import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'bookmarks.json')

/** mediaId -> { mediaId, addedAt, media } */
const items = new Map()
let saveTimer = null
let ready = false

async function persist() {
  if (saveTimer) return
  saveTimer = setTimeout(async () => {
    saveTimer = null
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true })
      await fsp.writeFile(FILE, JSON.stringify([...items.values()], null, 2))
    } catch (err) {
      console.error('[bookmarks] save failed:', err.message)
    }
  }, 250)
}

export async function init() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true })
    const raw = await fsp.readFile(FILE, 'utf8')
    for (const entry of JSON.parse(raw)) {
      if (entry?.mediaId && entry?.media) items.set(entry.mediaId, entry)
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
  if (!media?.id) throw new Error('A bookmark needs a media object')
  const entry = { mediaId: media.id, addedAt: items.get(media.id)?.addedAt ?? Date.now(), media }
  items.set(media.id, entry)
  persist()
  return entry
}

export function remove(mediaId) {
  const deleted = items.delete(Number(mediaId))
  if (deleted) persist()
  return deleted
}

export function toggle(media) {
  if (items.has(media?.id)) {
    remove(media.id)
    return { bookmarked: false }
  }
  add(media)
  return { bookmarked: true }
}

export function isReady() {
  return ready
}

export function stateFile() {
  return fs.existsSync(FILE) ? FILE : null
}
