// Server-side full-text indexing for the local catalog (AV-075a).
//
// A small inverted index over normalized token → document postings with
// replace/remove semantics for incremental updates and rarity-weighted
// ranking. Pure module — no I/O, no clock; callers own storage and feeds
// (that wiring is AV-075b). Matching is exact-token after normalizeForSearch
// folding (case/punctuation/accents); fuzzy typo tolerance lives in
// search.mjs's rankTitles and is deliberately out of scope here.

import { normalizeForSearch } from './search.mjs'

/** Normalized word tokens for a text blob. */
export function tokenize(text) {
  return normalizeForSearch(text).split(' ').filter(Boolean)
}

/** Creates an empty index; pass documents to seed it. */
export function buildTextIndex(documents = []) {
  const index = { docs: new Map(), tokens: new Map() }
  for (const doc of documents) indexDocument(index, doc)
  return index
}

/**
 * Adds or replaces a document `{ id, text }`. Replacing re-indexes its tokens,
 * so stale terms from the previous text stop matching.
 */
export function indexDocument(index, doc) {
  if (!index || !doc || doc.id === null || doc.id === undefined) return index
  removeDocument(index, doc.id)
  const counts = new Map()
  for (const token of tokenize(String(doc.text ?? ''))) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  index.docs.set(doc.id, { counts })
  for (const [token, tf] of counts) {
    let postings = index.tokens.get(token)
    if (!postings) {
      postings = new Map()
      index.tokens.set(token, postings)
    }
    postings.set(doc.id, tf)
  }
  return index
}

/** Removes a document and prunes its postings (empty tokens are dropped). */
export function removeDocument(index, id) {
  const doc = index?.docs?.get(id)
  if (!doc) return index
  index.docs.delete(id)
  for (const token of doc.counts.keys()) {
    const postings = index.tokens.get(token)
    if (!postings) continue
    postings.delete(id)
    if (postings.size === 0) index.tokens.delete(token)
  }
  return index
}

/**
 * AND-match search: every query token must appear in a document. Ranking is
 * rarity-weighted term frequency — Σ over tokens of idf(token) * (1 + ln tf),
 * so distinctive terms outrank boilerplate ones. Returns `[{ id, score }]`,
 * best first, capped at `limit`.
 */
export function searchTextIndex(index, query, { limit = 50 } = {}) {
  const tokens = [...new Set(tokenize(String(query ?? '')))]
  if (!index || tokens.length === 0) return []
  const total = index.docs.size
  const scores = new Map()
  const matched = new Map()
  for (const token of tokens) {
    const postings = index.tokens.get(token)
    if (!postings || postings.size === 0) return []
    const idf = Math.log(1 + total / postings.size)
    for (const [id, tf] of postings) {
      scores.set(id, (scores.get(id) ?? 0) + idf * (1 + Math.log(tf)))
      matched.set(id, (matched.get(id) ?? 0) + 1)
    }
  }
  const out = []
  for (const [id, score] of scores) {
    if (matched.get(id) === tokens.length) out.push({ id, score })
  }
  out.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
  return out.slice(0, Math.max(0, limit))
}
