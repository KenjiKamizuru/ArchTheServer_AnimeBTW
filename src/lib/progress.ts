// Watch-progress client helpers (AV-156): the season-key convention for
// progress records plus the mark-as-watched / mark-as-unwatched payloads.
//
// The season key is OPAQUE to the server — it only means something when the
// writers agree, so AV-153's player-side writer MUST derive its keys with
// `seasonKeyFor` too (documented in the TODO evidence). Convention: the
// media's own broadcast season as `<season>-<year>` lowercased (the
// progressStore docs' 'winter-2024' example), or 'unknown' when the season
// date is not published.

export function seasonKeyFor(season: string | null | undefined, seasonYear: number | null | undefined): string {
  if (season && seasonYear) return `${season.toLowerCase()}-${seasonYear}`
  return 'unknown'
}

/** 'manual' = manually marked, 'completed' = finished — both count as watched. */
export function isWatchedState(state: string | null | undefined): boolean {
  return state === 'manual' || state === 'completed'
}

/**
 * Mark watched: an explicit 'manual' mark at position 0 (the claim is
 * "watched", not "watched to position X" — no playback happened). A known
 * runtime rides along so the completion threshold (AV-155) can apply to
 * later rewatch starts.
 */
export function markWatchedPayload(
  mediaId: number,
  season: string,
  episode: number,
  runtimeMinutes?: number | null,
): { mediaId: number; season: string; episode: number; positionSeconds: number; state: 'manual'; runtimeSeconds?: number } {
  return {
    mediaId,
    season,
    episode,
    positionSeconds: 0,
    state: 'manual',
    ...(runtimeMinutes && runtimeMinutes > 0 ? { runtimeSeconds: Math.round(runtimeMinutes * 60) } : {}),
  }
}

/**
 * Mark unwatched: an explicit 'started' mark at position 0 — the episode
 * behaves as not-watched again without deleting the record (full progress
 * RESET with confirmation is AV-157's job).
 */
export function markUnwatchedPayload(
  mediaId: number,
  season: string,
  episode: number,
): { mediaId: number; season: string; episode: number; positionSeconds: number; state: 'started' } {
  return { mediaId, season, episode, positionSeconds: 0, state: 'started' }
}

/**
 * Rewind (AV-157): position back to 0 with NO explicit state — the episode
 * state is preserved (a completed/manual mark survives a deliberate
 * rewatch; AV-154 semantics). Distinct from markUnwatchedPayload, which
 * clears the mark itself.
 */
export function rewindPayload(
  mediaId: number,
  season: string,
  episode: number,
): { mediaId: number; season: string; episode: number; positionSeconds: number } {
  return { mediaId, season, episode, positionSeconds: 0 }
}
