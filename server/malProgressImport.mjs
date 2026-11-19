// Watched-progress import (AV-173, slice 1): the pure mapping from
// matched MAL export entries (malImport's parse + matchResolved) onto
// progress marks and watch statuses. Matching stays EXACTLY what
// matchResolved established — anime_id through the injected resolver,
// never title similarity.
//
// Scope decisions (recorded):
// - Marks: episodes 1..watchedEpisodes each get a row with the explicit
//   state 'manual' (the markWatchedPayload precedent — an import is a
//   user claim, never a derived completion) and positionSeconds 0, since
//   per-episode positions do not exist in a MAL export.
// - Status rows carry malImport's already-mapped vocabulary
//   ('watching' | 'completed' | 'paused' | 'dropped' | 'planned').
// - Progress is imported from the WATCHED COUNT regardless of status —
//   a dropped show with 3 watched episodes still watched 3. Entries with
//   0 watched emit no marks (status still applies).
// - The season key is INJECTED (`seasonOf(media)`) like the resolver —
//   the mapper stays pure and the route owns the key policy (slice 2).
// - Bounded: at most maxEpisodesPerEntry (default 2000) marks per entry;
//   beyond that the row reports `truncated: true` instead of flooding.

export const MAX_EPISODES_PER_ENTRY = 2000

export function mapWatchedProgress(matched, { seasonOf, maxEpisodesPerEntry = MAX_EPISODES_PER_ENTRY } = {}) {
  if (typeof seasonOf !== 'function') throw new Error('mapWatchedProgress requires a seasonOf(media) resolver')
  const marks = []
  const statuses = []
  const truncated = []
  for (const entry of matched) {
    const mediaId = Number(entry?.media?.id)
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0) continue
    if (typeof entry.status === 'string') statuses.push({ mediaId, status: entry.status })
    const watched = Number(entry.watchedEpisodes ?? 0)
    if (!Number.isSafeInteger(watched) || watched <= 0) continue
    const season = String(seasonOf(entry.media) ?? 'unknown')
    const count = Math.min(watched, maxEpisodesPerEntry)
    if (count < watched) truncated.push({ mediaId, watchedEpisodes: watched, importedMarks: count })
    for (let episode = 1; episode <= count; episode += 1) {
      marks.push({ mediaId, season, episode, positionSeconds: 0, state: 'manual' })
    }
  }
  return { marks, statuses, truncated }
}
