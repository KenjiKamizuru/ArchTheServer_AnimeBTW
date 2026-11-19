// Playback-position writer (AV-153): stores the playback position at
// CONFIGURABLE intervals. The player reports positions on its own cadence
// (timeupdate); the writer decides when a report becomes a save — at most
// once per interval, always keeping the LATEST position, and always
// flushing what is pending on stop (pause/close/unmount). Saves are
// serialized so a slower earlier request can never overwrite a newer one.
//
// The writer never sends an explicit episode `state`: the server derives
// completion from the configured threshold (AV-155) and preserves manual
// marks (AV-154/156). It only reports records with a STABLE identity —
// mediaId + season key + episode — never guessable keys (the season key
// comes from `seasonKeyFor`, the shared convention of AV-156).
//
// Pure decision core with injectable `save`/`now` so interval semantics are
// real tests, not inspection.

export interface PositionRecord {
  mediaId: number
  season: string
  episode: number
  positionSeconds: number
  runtimeSeconds?: number
}

export interface ProgressWriterDeps {
  save: (record: PositionRecord) => Promise<unknown>
  intervalSeconds: number
  now?: () => number
}

export interface ProgressWriter {
  report: (record: PositionRecord) => void
  flush: () => Promise<void>
  stop: () => Promise<void>
}

export const MIN_FLUSH_INTERVAL_SECONDS = 5
export const MAX_FLUSH_INTERVAL_SECONDS = 300
export const DEFAULT_FLUSH_INTERVAL_SECONDS = 15

/** Clamp the configured interval to 5–300 seconds (invalid → default). */
export function clampFlushInterval(value: number | string | null | undefined, fallback = DEFAULT_FLUSH_INTERVAL_SECONDS): number {
  const seconds = Number(value)
  return Number.isInteger(seconds) && seconds >= MIN_FLUSH_INTERVAL_SECONDS && seconds <= MAX_FLUSH_INTERVAL_SECONDS
    ? seconds
    : fallback
}

/** Only records with a stable identity are ever stored. */
export function isValidRecord(record: PositionRecord | null | undefined): boolean {
  return Boolean(
    record
    && Number.isSafeInteger(record.mediaId) && record.mediaId > 0
    && typeof record.season === 'string' && record.season.length > 0 && record.season.length <= 40
    && Number.isInteger(record.episode) && record.episode > 0
    && Number.isFinite(record.positionSeconds) && record.positionSeconds >= 0,
  )
}

export function createProgressWriter(deps: ProgressWriterDeps): ProgressWriter {
  const now = deps.now ?? Date.now
  const intervalMs = clampFlushInterval(deps.intervalSeconds) * 1000
  let pending: PositionRecord | null = null
  let lastSaveAt = 0
  let queue: Promise<unknown> = Promise.resolve()

  function save(record: PositionRecord) {
    // Serialize saves: an earlier slow request can never land after a later
    // one and regress the position (the store upserts by key).
    queue = queue.catch(() => {}).then(() => deps.save(record))
    return queue
  }

  async function flush() {
    if (pending) {
      const ready = pending
      pending = null
      lastSaveAt = now()
      void save(ready)
    }
    // Barrier semantics: after flush, every reported position is persisted.
    await queue
  }

  return {
    report(record) {
      if (!isValidRecord(record)) return
      pending = record
      const timestamp = now()
      if (timestamp - lastSaveAt >= intervalMs) {
        const ready = pending
        pending = null
        lastSaveAt = timestamp
        void save(ready)
      }
    },
    flush,
    stop: flush,
  }
}
