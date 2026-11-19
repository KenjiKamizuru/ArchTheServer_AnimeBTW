// Local-catalog full-text wiring (AV-075b): assembles documents from every
// local source — library files, bookmarks, custom/status list entries — and
// searches them through the AV-075a inverted index.
//
// `createCatalogIndexer()` keeps one index per content signature (source
// counts, ids and latest `addedAt`) and rebuilds lazily when it changes.
// Wholesale rebuild is deliberate at this scale; the fullText core's
// incremental `indexDocument`/`removeDocument` remain available if the
// catalog outgrows it. Titles are immutable in the stores, so the signature
// never has to watch for in-place text edits.

import { buildTextIndex, searchTextIndex } from './fullText.mjs'

/**
 * Pure: turns raw sources into indexable documents.
 * sources = { libraryItems, bookmarks, listEntries } where listEntries carry
 * their list/status names for subtitles. Returns `{ id, text, source, title,
 * subtitle, mediaId }`.
 */
export function localDocuments({ libraryItems = [], bookmarks = [], listEntries = [] } = {}) {
  const docs = []
  for (const item of libraryItems) {
    if (!item) continue
    const title = item.animeTitle || item.seriesTitle || item.fileName || 'Untitled file'
    const parts = [item.animeTitle, item.seriesTitle, item.fileName, item.folder, item.quality].filter(Boolean)
    docs.push({
      id: `lib:${item.id}`,
      text: parts.join(' '),
      source: 'library',
      title,
      subtitle: [item.quality, item.episode !== null && item.episode !== undefined ? `episode ${item.episode}` : null]
        .filter(Boolean)
        .join(' · '),
      mediaId: item.animeId ?? item.mediaId ?? null,
    })
  }
  const mediaDoc = (prefix, source, media, subtitle) => {
    if (!media?.id) return null
    const titles = [media.title, media.romaji, media.english, media.native, ...(media.synonyms ?? [])].filter(Boolean)
    return {
      id: `${prefix}:${media.id}`,
      text: [...titles, ...(media.genres ?? [])].join(' '),
      source,
      title: media.title || `Anime #${media.id}`,
      subtitle,
      mediaId: media.id,
    }
  }
  for (const bookmark of bookmarks) {
    const doc = mediaDoc('bm', 'bookmarks', bookmark?.media, 'Bookmarks')
    if (doc) docs.push(doc)
  }
  for (const entry of listEntries) {
    const names = (entry?.listNames ?? []).filter(Boolean)
    const doc = mediaDoc('lst', 'lists', entry?.media, names.join(' · '))
    if (doc) docs.push(doc)
  }
  return docs
}

/** Pure: extracts a sortable content signature from raw sources. */
export function indexSignature({ libraryItems = [], bookmarks = [], listEntries = [] } = {}) {
  const maxAddedAt = Math.max(0, ...bookmarks.map((b) => Number(b?.addedAt) || 0), ...listEntries.map((e) => Number(e?.addedAt) || 0))
  return `${libraryItems.length}|${bookmarks.length}|${listEntries.length}|${maxAddedAt}|${libraryItems.map((i) => i?.id ?? '').join(',')}`
}

/**
 * A cached indexer over local sources. `search(sources, query, { limit })` →
 * ranked hits `{ id, source, title, subtitle, mediaId, score, highlight? }`,
 * rebuilt only when the source signature changes. Hits are deduped by media
 * id across sources (library files keep their own ids).
 */
export function createCatalogIndexer() {
  let cached = null
  return {
    search(sources, query, { limit = 50 } = {}) {
      const signature = indexSignature(sources)
      if (!cached || cached.signature !== signature) {
        const docs = localDocuments(sources)
        cached = {
          signature,
          docs,
          index: buildTextIndex(docs),
        }
      }
      const byId = new Map(cached.docs.map((doc) => [doc.id, doc]))
      const hits = searchTextIndex(cached.index, query, { limit })
      const seen = new Set()
      const out = []
      for (const hit of hits) {
        const doc = byId.get(hit.id)
        const key = doc.mediaId ?? doc.id
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ id: doc.id, source: doc.source, title: doc.title, subtitle: doc.subtitle, mediaId: doc.mediaId, score: hit.score })
        if (out.length >= limit) break
      }
      return out
    },
  }
}
