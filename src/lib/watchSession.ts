// Playback-session tracking (AV-166, slice 2): pure lifecycle logic the
// Player wires to the <video> events, mirroring the progressWriter's
// tested-lib pattern.
//
// Contract:
// - A session ARMS at the first play() — opening a source without playing
//   records nothing.
// - watchedSeconds accumulates only small positive playback deltas
//   (<= MAX_PLAYBACK_DELTA_SECONDS): seeks and clip jumps are excluded,
//   backwards seeks too; a tick always advances the cursor, so normal
//   playback after a seek keeps counting. Pause/buffering gaps simply have
//   no ticks, so they are never counted — pause time is not watched time
//   (the server enforces watched <= wall time; the clamp keeps us honest).
// - stop() saves exactly once when armed (ended OR unmount, whichever
//   comes first); stop() before any play() never saves.

export const MAX_PLAYBACK_DELTA_SECONDS = 2

export interface WatchSessionRecord {
  startedAt: number
  endedAt: number
  watchedSeconds: number
}

export interface WatchSessionDeps {
  save: (record: WatchSessionRecord) => void | Promise<void>
  now?: () => number
}

export interface WatchSession {
  /** Arms the session at the first call; later calls are no-ops. */
  play(): void
  /** Reports a playback position (seconds); deltas are clamped. */
  tick(positionSeconds: number): void
  /** Ends and saves the session once (ended/unmount); idempotent. */
  stop(): void
}

export function createWatchSession({ save, now = () => Date.now() }: WatchSessionDeps): WatchSession {
  let startedAt: number | null = null
  let lastPosition: number | null = null
  let watched = 0
  let stopped = false

  return {
    play() {
      if (startedAt === null) startedAt = now()
    },
    tick(positionSeconds: number) {
      if (!Number.isFinite(positionSeconds)) return
      if (lastPosition !== null) {
        const delta = positionSeconds - lastPosition
        if (delta > 0 && delta <= MAX_PLAYBACK_DELTA_SECONDS) watched += delta
      }
      lastPosition = positionSeconds
    },
    stop() {
      if (stopped) return
      stopped = true
      if (startedAt === null) return
      void save({
        startedAt,
        endedAt: now(),
        watchedSeconds: Math.round(watched),
      })
    },
  }
}
