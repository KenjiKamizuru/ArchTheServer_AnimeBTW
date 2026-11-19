// Progress export (AV-174): a deterministic, re-importable dump of one
// profile's progress records with STABLE EXTERNAL IDs (Media.externalIds,
// the AV-002 provider-slug → id map) so the data survives catalog changes
// and re-imports. Pure shaping — the route does the I/O.
//
// Scope decisions (recorded):
// - The export is scoped to the caller's profile; `profileId` itself is
//   NOT exported (noise that breaks portability across installs).
// - Ordering is deterministic (mediaId, then season, then episode — all
//   ascending) so exports diff cleanly; the live list's updatedAt-desc
//   order is a viewing concern, not a data one.
// - Missing media records keep their row with `externalIds: {}` and
//   `title: null` — an export never silently drops progress. When the
//   enrichment call itself fails, the route sets
//   `externalIdsUnavailable: true` so the gap is visible, not implied.

export const PROGRESS_EXPORT_FORMAT = 'animevault-progress-v1'

export function buildProgressExport(rows, mediaById, { exportedAt, externalIdsUnavailable = false } = {}) {
  const entries = rows
    .map((row) => {
      const media = mediaById.get(row.mediaId) ?? null
      const externalIds = {}
      if (media && media.externalIds && typeof media.externalIds === 'object') {
        for (const [key, value] of Object.entries(media.externalIds)) {
          if (typeof value === 'string' && value.length > 0) externalIds[key] = value
        }
      }
      return {
        mediaId: row.mediaId,
        title: media ? media.title ?? null : null,
        season: row.season,
        episode: row.episode,
        state: row.state,
        positionSeconds: row.positionSeconds,
        runtimeSeconds: row.runtimeSeconds ?? null,
        updatedAt: row.updatedAt,
        externalIds,
      }
    })
    .sort((a, b) => a.mediaId - b.mediaId || (a.season < b.season ? -1 : a.season > b.season ? 1 : 0) || a.episode - b.episode)
  return {
    format: PROGRESS_EXPORT_FORMAT,
    exportedAt,
    externalIdsUnavailable,
    entries,
  }
}
