// Per-anime private notes (AV-099): pure note-payload construction and
// response shaping. Notes are owner-private — they live in the server-local kv
// store keyed by media id and are only ever served from /api/anime/:id/notes,
// never embedded in shared/public payloads (pinned by tests).

/** Storage contract: blank notes delete (null), text is stored verbatim ≤4000. */
export function buildNotePayload(input, { now = Date.now() } = {}) {
  const note = String(input ?? '').slice(0, 4000)
  return note.trim() ? { note, updatedAt: now } : null
}

/** The owner-only response shape shared by GET and PUT. */
export function noteView(mediaId, payload) {
  return {
    mediaId,
    note: typeof payload?.note === 'string' ? payload.note : '',
    updatedAt: payload?.updatedAt ?? null,
  }
}
