// MyAnimeList list-export import (AV-142a). Pure parsing + mapping; the
// idMal → media resolution is INJECTED (AV-142b wires it to AniList GraphQL).
//
// Format pinned from a real source, not invented: the official MAL list
// export ("Export List" on myanimelist.net/backup.php) is a bare JSON array
// of objects shaped like
//   { anime_id, title, media_type, episodes, watched_episodes, status,
//     score, tags, comments, ... }
// (documented in practice by github.com/seanbreckenridge/malezport).
// Statuses: 'Watching', 'Completed', 'On-Hold', 'Dropped', 'Plan to Watch'
// (matched case/spacing-insensitively). `score` is 0–10 where 0 = unrated.
//
// Mapping to AnimeVault lists: On-Hold → paused, Plan to Watch → planned;
// score 1–10 → list rating (exact 1–10 range); tags + comments → the
// per-list note. `watched_episodes` is deliberately NOT imported — watched
// progress import is AV-173, a different task.
//
// Strict document validation (parseListImport family): one malformed entry
// rejects the whole file before anything is stored. Matching to catalog
// media happens ONLY by anime_id through the injected resolver — title
// similarity is never used.

const MAL_STATUS_MAP = {
  watching: 'watching',
  completed: 'completed',
  'on-hold': 'paused',
  'on hold': 'paused',
  dropped: 'dropped',
  'plan to watch': 'planned',
  planning: 'planned',
}
export const MAX_MAL_ENTRIES = 2000

const invalid = (message) => ({ ok: false, error: message })

function normalizeMalNote(tags, comments) {
  const parts = []
  if (String(tags ?? '').trim()) parts.push(String(tags).trim())
  if (String(comments ?? '').trim()) parts.push(String(comments).trim())
  return parts.join('\n').slice(0, 1000)
}

/** Parse an official MAL list export document into normalized entries. */
export function parseMalExport(document) {
  if (!Array.isArray(document)) return invalid('Expected a MyAnimeList list export (a JSON array)')
  if (document.length > MAX_MAL_ENTRIES) return invalid(`A MyAnimeList import holds at most ${MAX_MAL_ENTRIES} entries`)
  const entries = []
  for (const raw of document) {
    const malId = Number(raw?.anime_id)
    if (!Number.isSafeInteger(malId) || malId <= 0) return invalid('Every entry needs a positive integer anime_id')
    const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 300) : ''
    if (!title) return invalid('Every entry needs a title')
    const statusKey = String(raw?.status ?? '').trim().toLowerCase()
    const status = MAL_STATUS_MAP[statusKey]
    if (!status) return invalid(`Unknown status: ${JSON.stringify(raw?.status ?? null)}`)
    const rawScore = raw?.score ?? 0
    const score = Number(rawScore)
    if (!Number.isInteger(score) || score < 0 || score > 10) return invalid('score must be an integer from 0 to 10')
    const note = normalizeMalNote(raw?.tags, raw?.comments)
    if (typeof raw?.tags === 'string' && raw.tags.length > 1000) return invalid('tags must be at most 1000 characters')
    if (typeof raw?.comments === 'string' && raw.comments.length > 1000) return invalid('comments must be at most 1000 characters')
    entries.push({ malId, title, status, rating: score === 0 ? null : score, note })
  }
  return { ok: true, value: { entries } }
}

/**
 * Pair parsed entries with resolver output (AV-142b injects the idMal →
 * media lookup). Unmatched entries are REPORTED, never guessed — a title
 * that merely resembles a catalog entry stays unmatched.
 */
export function matchResolved(entries, mediaByMalId) {
  const matched = []
  const unmatched = []
  for (const entry of entries) {
    const media = mediaByMalId instanceof Map ? mediaByMalId.get(entry.malId) : mediaByMalId?.[entry.malId]
    if (media && Number.isSafeInteger(Number(media.id)) && Number(media.id) > 0) matched.push({ ...entry, media })
    else unmatched.push(entry)
  }
  return { matched, unmatched }
}

/** Turn matched entries into an animevault-list document (for listStore.importList). */
export function toImportDocument(matched, { name = 'MyAnimeList import', description = '', now = Date.now() } = {}) {
  return {
    format: 'animevault-list',
    version: 1,
    list: {
      name: String(name).trim().slice(0, 80) || 'MyAnimeList import',
      description: String(description ?? '').trim().slice(0, 500),
      entries: matched.map((entry, index) => ({
        mediaId: entry.media.id,
        media: entry.media,
        status: entry.status,
        addedAt: now + index,
        note: entry.note ?? '',
        priority: null,
        rating: entry.rating ?? null,
      })),
    },
  }
}
