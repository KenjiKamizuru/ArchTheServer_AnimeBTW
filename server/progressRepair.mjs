// Progress integrity repair (AV-175): find INTERIOR episode gaps — a
// (media, season) with a record at episode N but no record for some
// episode in 1..N-1. Trailing episodes are NOT gaps (the total is
// unknown and the show may simply be unwatched there).
//
// Scope decisions (recorded):
// - The repair is user-invoked (confirmed in the UI) and IDEMPOTENT:
//   it only ever CREATES marks for missing episodes, never touches an
//   existing record (a stale manual mark must survive).
// - Filled marks use the explicit state 'manual' (the AV-173/154
//   precedent — repairing history is a user claim, never a derived
//   completion) with positionSeconds 0.
// - Specials/absolute numbering (AV-171/172) are out of scope: episode
//   numbers are the positive integers the store already keys on.

/**
 * Pure plan: the missing interior episodes per (mediaId, season), only
 * for seasons that HAVE gaps. `missing` is ascending.
 */
export function findProgressGaps(rows) {
  const seasons = new Map()
  for (const row of rows) {
    const episode = Number(row?.episode)
    if (!Number.isInteger(episode) || episode < 1) continue
    const key = `${row.mediaId}\u0000${row.season}`
    let set = seasons.get(key)
    if (!set) {
      set = { mediaId: row.mediaId, season: row.season, episodes: new Set() }
      seasons.set(key, set)
    }
    set.episodes.add(episode)
  }
  const gaps = []
  for (const { mediaId, season, episodes } of seasons.values()) {
    const maxEpisode = Math.max(...episodes)
    const missing = []
    for (let episode = 1; episode < maxEpisode; episode += 1) {
      if (!episodes.has(episode)) missing.push(episode)
    }
    if (missing.length > 0) gaps.push({ mediaId, season, missing })
  }
  gaps.sort((a, b) => a.mediaId - b.mediaId || (a.season < b.season ? -1 : a.season > b.season ? 1 : 0))
  return gaps
}

/** The repair rows for a gap plan (ascending media/season/episode). */
export function repairMarks(gaps) {
  const marks = []
  for (const gap of gaps) {
    for (const episode of gap.missing) {
      marks.push({ mediaId: gap.mediaId, season: gap.season, episode, positionSeconds: 0, state: 'manual' })
    }
  }
  return marks
}
