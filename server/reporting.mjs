// Metadata correction suggestion workflow (AV-096): pure construction and
// validation of metadata reports. A correction suggestion carries the field,
// the reviewer's free-text note, and an optional structured `suggestedValue`
// (the proposed corrected value) so fixes are machine-readable.

export const REPORT_FIELDS = new Set([
  'title', 'episodes', 'season', 'year', 'format', 'status', 'score',
  'synopsis', 'studio', 'relations', 'episode-order', 'other',
])

/**
 * Builds a validated report: `{ ok: true, report }` or `{ ok: false, error }`.
 * `id`/`now` are injectable for deterministic use and tests.
 */
export function buildMetadataReport(input = {}, { now = Date.now(), id = null } = {}) {
  const mediaId = Number(input.mediaId)
  if (!Number.isInteger(mediaId) || mediaId <= 0) return { ok: false, error: 'Invalid anime id' }
  const message = String(input.message ?? '').trim().slice(0, 1000)
  if (!message) return { ok: false, error: 'Please describe the problem' }
  const suggestedValue = String(input.suggestedValue ?? '').trim().slice(0, 400) || null
  const field = String(input.field ?? '').slice(0, 40)
  return {
    ok: true,
    report: {
      id: typeof id === 'string' && id ? id : `r_${Math.random().toString(36).slice(2, 12)}`,
      mediaId,
      kind: input.kind === 'episode-order' ? 'episode-order' : 'metadata',
      field: REPORT_FIELDS.has(field) ? field : 'other',
      message,
      suggestedValue,
      createdAt: now,
      status: 'open',
    },
  }
}
