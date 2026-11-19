// Watch history (AV-161): pure shaping of the AV-153 progress records into
// the history page's rows and its date/title filters. History here is
// PROGRESS-based (one row per episode with a last-watched time) — session
// records (start/end/duration) are AV-166's scope and deliberately absent.

import type { Media, ProgressEntry } from '../types'

export interface WatchHistoryRow {
  mediaId: number
  season: string
  episode: number
  state: 'started' | 'completed' | 'manual'
  positionSeconds: number | null
  runtimeSeconds: number | null
  updatedAt: number
  media: Media | null
}

export interface WatchHistoryFilters {
  /** Inclusive day bound (YYYY-MM-DD, UTC day of updatedAt). */
  from?: string
  /** Inclusive day bound (YYYY-MM-DD, UTC day of updatedAt). */
  to?: string
  /** Case-insensitive substring of the media title. */
  title?: string
}

/** Newest first; mediaId breaks ties like the continue-watching rows. */
export function watchHistoryRows(
  records: ProgressEntry[],
  mediaById: Map<number, Media>,
): WatchHistoryRow[] {
  return records
    .map((record) => ({
      mediaId: record.mediaId,
      season: record.season,
      episode: record.episode,
      state: record.state,
      positionSeconds: Number.isFinite(record.positionSeconds) ? record.positionSeconds : null,
      runtimeSeconds: Number.isFinite(record.runtimeSeconds) ? record.runtimeSeconds : null,
      updatedAt: record.updatedAt,
      media: mediaById.get(record.mediaId) ?? null,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.mediaId - b.mediaId)
}

const utcDay = (updatedAt: number): string => new Date(updatedAt).toISOString().slice(0, 10)

/**
 * Filters preserve the row order. Day bounds are INCLUSIVE and compare
 * against the record's UTC day, so the filter is deterministic regardless of
 * the viewer's timezone. A row without media matches a title filter only
 * when the filter is empty.
 */
export function filterWatchHistory(
  rows: WatchHistoryRow[],
  filters: WatchHistoryFilters,
): WatchHistoryRow[] {
  const from = filters.from?.trim() || ''
  const to = filters.to?.trim() || ''
  const title = filters.title?.trim().toLowerCase() || ''
  return rows.filter((row) => {
    const day = utcDay(row.updatedAt)
    if (from && day < from) return false
    if (to && day > to) return false
    if (title) {
      const rowTitle = row.media?.title?.toLowerCase() ?? null
      if (rowTitle === null || !rowTitle.includes(title)) return false
    }
    return true
  })
}
