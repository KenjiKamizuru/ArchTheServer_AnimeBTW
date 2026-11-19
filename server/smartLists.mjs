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

// ── Returning soon (AV-138) ─────────────────────────────────────────────
// "Shows returning in a future season" = entries with a SEQUEL relation
// (AniList relationship data — never title similarity) whose installment is
// dated into a FUTURE season. Scope decisions recorded: only `SEQUEL` counts
// as "returning" (side stories/spin-offs are new shows, not returns); a
// related record is "future" only when BOTH season and seasonYear are known
// and its (year, season) key is strictly after the current season —
// undated or same-season-unknown cases are excluded (mark uncertain, never
// guess). Pure: relationship data is injected; `now` is injected.

export const RETURNING_RELATIONS = new Set(['SEQUEL'])
const SEASON_INDEX = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 }
const SEASON_STEP = 10

/** Sortable (year, season) key, or null when the season date is unknown. */
export function seasonKey(media) {
  const year = Number(media?.seasonYear)
  const season = SEASON_INDEX[media?.season]
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || season === undefined) return null
  return year * SEASON_STEP + season
}

/** The key of the season in progress at `now` (UTC). */
export function currentSeasonKey(now = Date.now()) {
  const date = new Date(now)
  return date.getUTCFullYear() * SEASON_STEP + Math.floor(date.getUTCMonth() / 3)
}

/**
 * Rows for the "returning soon" list:
 * `[{ mediaId, media, status, addedAt, upcoming: [{ id, title, format, season, seasonYear }] }]`
 * sorted by the soonest upcoming installment. `edgesByMedia` maps entry
 * mediaId → relation edges (`{ relationType, node: { id } }`); `recordsById`
 * maps related ids → normalized catalog records (title/season/seasonYear).
 */
export function returningSoon(entries, edgesByMedia, recordsById, { now = Date.now() } = {}) {
  const current = currentSeasonKey(now)
  const rows = []
  const seen = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const mediaId = Number(entry?.mediaId)
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || seen.has(mediaId) || !entry?.media) continue
    seen.add(mediaId)
    const upcoming = []
    const claimed = new Set()
    for (const edge of (edgesByMedia instanceof Map ? edgesByMedia.get(mediaId) : null) ?? []) {
      if (!RETURNING_RELATIONS.has(edge?.relationType)) continue
      const relatedId = Number(edge?.node?.id)
      if (!Number.isSafeInteger(relatedId) || relatedId <= 0 || relatedId === mediaId || claimed.has(relatedId)) continue
      const record = recordsById instanceof Map ? recordsById.get(relatedId) : undefined
      const key = record ? seasonKey(record) : null
      if (key === null || key <= current) continue
      claimed.add(relatedId)
      upcoming.push({
        id: relatedId,
        title: typeof record?.title === 'string' ? record.title : '',
        format: record?.format ?? null,
        season: record.season,
        seasonYear: record.seasonYear,
      })
    }
    if (!upcoming.length) continue
    upcoming.sort((a, b) => seasonKey(a) - seasonKey(b) || String(a.title).localeCompare(String(b.title)) || a.id - b.id)
    rows.push({
      mediaId,
      media: entry.media,
      status: entry.status,
      addedAt: Number.isFinite(entry?.addedAt) ? entry.addedAt : 0,
      upcoming,
    })
  }
  rows.sort((a, b) => seasonKey(a.upcoming[0]) - seasonKey(b.upcoming[0]) || String(a.media?.title ?? '').localeCompare(String(b.media?.title ?? '')) || a.mediaId - b.mediaId)
  return rows
}

// ── New episodes available (AV-137) ────────────────────────────────────
// "Anime with new episodes available" = started-but-unfinished entries
// (watching/paused — same set as stalled shows; planned is "not started",
// completed/dropped are done or abandoned) whose episodes have AIRED past
// the viewer's recorded marker. Scope decisions recorded: the marker is the
// MAX episode number across the media's progress records (any season —
// per-season numbering is AV-171/172 work and can skew multi-season
// trackers; intentionally conservative), and entries with NO progress
// records are EXCLUDED (pre-AV-151 viewing is unrecorded, so "how far
// along" is unknown — mark uncertain, never guess). `airedEpisodes` must be
// a valid positive integer. Pure: airing data and progress are injected.

/** Rows: `[{ mediaId, media, status, addedAt, airedEpisodes, watchedThrough, newCount }]`
 * sorted by most new episodes first, then title, then id. */
export function newEpisodesAvailable(entries, progress, recordsById) {
  const markerByMedia = new Map()
  for (const record of Array.isArray(progress) ? progress : []) {
    const mediaId = Number(record?.mediaId)
    const episode = Number(record?.episode)
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !Number.isInteger(episode) || episode <= 0) continue
    const marker = markerByMedia.get(mediaId)
    if (marker === undefined || episode > marker) markerByMedia.set(mediaId, episode)
  }
  const rows = []
  const seen = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const mediaId = Number(entry?.mediaId)
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || seen.has(mediaId) || !entry?.media) continue
    seen.add(mediaId)
    if (entry.status !== 'watching' && entry.status !== 'paused') continue
    const watchedThrough = markerByMedia.get(mediaId)
    if (watchedThrough === undefined) continue
    const record = recordsById instanceof Map ? recordsById.get(mediaId) : undefined
    const airedEpisodes = Number(record?.airedEpisodes)
    if (!Number.isInteger(airedEpisodes) || airedEpisodes <= 0) continue
    if (airedEpisodes <= watchedThrough) continue
    rows.push({
      mediaId,
      media: entry.media,
      status: entry.status,
      addedAt: Number.isFinite(entry?.addedAt) ? entry.addedAt : 0,
      airedEpisodes,
      watchedThrough,
      newCount: airedEpisodes - watchedThrough,
    })
  }
  rows.sort((a, b) => b.newCount - a.newCount || String(a.media?.title ?? '').localeCompare(String(b.media?.title ?? '')) || a.mediaId - b.mediaId)
  return rows
}
