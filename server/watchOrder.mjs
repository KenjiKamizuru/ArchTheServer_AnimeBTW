// Watch-order recommendations with editable ordering notes (AV-084).
// The recommendation logic is pure over the two timeline orderings (release
// vs chronological, as produced by buildTimeline in server/detail.mjs); the
// editable note itself is persisted through the settings kv store by the
// /api/anime/:id/watch-order routes.

/**
 * Recommends which timeline order to watch in. `agree` is true when both
 * orders produce the same sequence (or there is nothing to order).
 */
export function recommendWatchOrder(releaseOrder = [], chronologicalOrder = []) {
  const sequence = (entries) => (Array.isArray(entries) ? entries.map((e) => e?.id).join(',') : '')
  if (!Array.isArray(releaseOrder) || releaseOrder.length === 0) {
    return {
      recommended: 'release',
      label: 'Release order',
      rationale: 'No franchise timeline available yet — release order is the default.',
      agree: true,
      alternative: 'chronological',
    }
  }
  if (sequence(releaseOrder) === sequence(chronologicalOrder)) {
    return {
      recommended: 'release',
      label: 'Release order',
      rationale: 'Release and chronological orders agree for this franchise.',
      agree: true,
      alternative: 'chronological',
    }
  }
  const chronoComplete = Array.isArray(chronologicalOrder) && chronologicalOrder.length > 0 && chronologicalOrder.every((e) => !e?.uncertain)
  if (chronoComplete) {
    return {
      recommended: 'chronological',
      label: 'Chronological order',
      rationale: 'Story events run in a different sequence than release — chronological order tells the story as it unfolds.',
      agree: false,
      alternative: 'release',
    }
  }
  return {
    recommended: 'release',
    label: 'Release order',
    rationale: 'Chronological order is incomplete (some entries are undated) — release order is the safer watch.',
    agree: false,
    alternative: 'chronological',
  }
}

/** Trims and caps user-written ordering notes before storage. */
export function sanitizeOrderingNote(text, { maxLength = 2000 } = {}) {
  return String(text ?? '')
    .trim()
    .slice(0, maxLength)
}
