import { sanitizeBookmarkMedia } from './store.mjs'

const invalid = (message) => Object.assign(new Error(message), { status: 400 })
const statuses = new Set(['watching', 'planned', 'completed', 'paused', 'dropped'])

// Strictly validate the entire document before mutating any stored data.
export function parseListImport(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.format !== 'animevault-list' || document.version !== 1) throw invalid('Expected an AnimeVault list JSON export (version 1)')
  const list = document.list
  if (!list || typeof list !== 'object' || Array.isArray(list) || typeof list.name !== 'string' || !list.name.trim() || list.name.trim().length > 80 || typeof list.description !== 'string' || list.description.trim().length > 500 || !Array.isArray(list.entries) || list.entries.length > 2000) throw invalid('Invalid list metadata or entry count')
  const seen = new Set()
  const entries = list.entries.map((raw) => {
    const media = sanitizeBookmarkMedia(raw?.media)
    if (!media || raw.mediaId !== media.id || seen.has(media.id)) throw invalid('Invalid or duplicate media id')
    seen.add(media.id)
    if (raw.status !== null && !statuses.has(raw.status)) throw invalid('Invalid status')
    if (typeof raw.addedAt !== 'number' || !Number.isFinite(raw.addedAt) || raw.addedAt < 0 || raw.addedAt > 8.64e15) throw invalid('Invalid added date')
    const note = raw.note ?? ''
    if (typeof note !== 'string' || note.length > 1000) throw invalid('Invalid note')
    const priority = raw.priority ?? null, rating = raw.rating ?? null
    if (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) throw invalid('Invalid priority')
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 10)) throw invalid('Invalid rating')
    return { mediaId: media.id, media, status: raw.status, addedAt: raw.addedAt, note, priority, rating }
  })
  return { name: list.name.trim(), description: list.description.trim(), entries }
}
