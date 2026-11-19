// Smart lists (AV-139): computed views over list membership + watch progress.
//
// "Stalled shows" = entries that are STARTED but unfinished — the watching and
// paused statuses, deliberately excluding planned (never started) and dropped
// (deliberately abandoned) — whose latest playback progress is older than the
// idle window, or that have no recorded progress at all. Progress is matched
// by mediaId ONLY and takes the MAX updatedAt across a media's season/episode
// records. Pure: no I/O; `now` is injected so staleness is testable (the
// progress API always stamps updatedAt server-side, so it cannot be
// backdated over HTTP).
//
// The view is computed, never stored; the route feeds it the two status
// lists and the caller's per-profile progress (AV-151).

export const DEFAULT_IDLE_DAYS = 14
const DAY_MS = 86_400_000
const UNFINISHED_STATUSES = new Set(['watching', 'paused'])

/** Clamp a requested idle window to 1–365 days (invalid → default). */
export function clampIdleDays(value, fallback = DEFAULT_IDLE_DAYS) {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : fallback
}

/**
 * Rows for the "stalled shows" list:
 * `[{ mediaId, media, status, addedAt, lastProgressAt: number|null }]`
 * sorted most-stalled first — never-progressed first, then oldest activity,
 * then title, then mediaId. `entries` are list rows ({ mediaId, media,
 * status, addedAt }); `progress` are progressStore view rows.
 */
export function stalledUnfinished(entries, progress, { now = Date.now(), idleDays = DEFAULT_IDLE_DAYS } = {}) {
  const days = clampIdleDays(idleDays)
  const cutoff = now - days * DAY_MS
  const lastByMedia = new Map()
  for (const record of Array.isArray(progress) ? progress : []) {
    const mediaId = Number(record?.mediaId)
    const updatedAt = Number(record?.updatedAt)
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !Number.isFinite(updatedAt)) continue
    const last = lastByMedia.get(mediaId)
    if (last === undefined || updatedAt > last) lastByMedia.set(mediaId, updatedAt)
  }
  const seen = new Set()
  const rows = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const mediaId = Number(entry?.mediaId)
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || seen.has(mediaId)) continue
    if (!entry?.media || !UNFINISHED_STATUSES.has(entry.status)) continue
    seen.add(mediaId)
    const lastProgressAt = lastByMedia.has(mediaId) ? lastByMedia.get(mediaId) : null
    // Strictly older than the cutoff counts as stalled; exactly at the
    // cutoff still counts as recent (pinned by tests).
    if (lastProgressAt !== null && lastProgressAt >= cutoff) continue
    rows.push({
      mediaId,
      media: entry.media,
      status: entry.status,
      addedAt: Number.isFinite(entry?.addedAt) ? entry.addedAt : 0,
      lastProgressAt,
    })
  }
  rows.sort((a, b) => {
    if (a.lastProgressAt !== b.lastProgressAt) {
      if (a.lastProgressAt === null) return -1
      if (b.lastProgressAt === null) return 1
      return a.lastProgressAt - b.lastProgressAt
    }
    return String(a.media?.title ?? '').localeCompare(String(b.media?.title ?? '')) || a.mediaId - b.mediaId
  })
  return rows
}
