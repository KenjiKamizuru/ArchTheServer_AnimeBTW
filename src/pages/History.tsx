import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RotateCcw } from 'lucide-react'
import type { Media, ProgressEntry } from '../types'
import { api } from '../lib/api'
import { filterWatchHistory, watchHistoryRows, type WatchHistoryRow } from '../lib/history'
import { relativeTime } from '../lib/format'

// Watch history (AV-161): the progress records (AV-153) newest first, with
// date and title filters. This is PROGRESS-based history — one row per
// episode with a last-watched time; session records are AV-166's scope.

const STATE_LABEL: Record<WatchHistoryRow['state'], { label: string; tone: string }> = {
  started: { label: 'In progress', tone: 'bg-amber-400/15 text-amber-200' },
  completed: { label: 'Watched', tone: 'bg-emerald-400/15 text-emerald-200' },
  manual: { label: 'Marked', tone: 'bg-sky-400/15 text-sky-200' },
}

function formatPosition(positionSeconds: number | null, runtimeSeconds: number | null): string | null {
  if (positionSeconds === null) return null
  const mmss = (total: number) => `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`
  return runtimeSeconds && runtimeSeconds > 0 ? `${mmss(positionSeconds)} / ${mmss(runtimeSeconds)}` : mmss(positionSeconds)
}

export default function History() {
  const [records, setRecords] = useState<ProgressEntry[] | null>(null)
  const [mediaById, setMediaById] = useState<Map<number, Media>>(new Map())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [title, setTitle] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      const progress = (await api.getProgress()).entries
      const ids = [...new Set(progress.map((record: ProgressEntry) => record.mediaId))]
      const mediaList = ids.length > 0 ? (await api.mediaMany(ids)).media : []
      if (!alive) return
      setRecords(progress)
      setMediaById(new Map(mediaList.map((media: Media) => [media.id, media])))
    })()
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(
    () => (records ? watchHistoryRows(records, mediaById) : []),
    [records, mediaById],
  )
  const filtered = useMemo(() => filterWatchHistory(rows, { from, to, title }), [rows, from, to, title])
  const filtersActive = Boolean(from || to || title.trim())

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Watch history</h1>
        <p className="mt-1 text-sm text-white/50">Every episode with saved playback progress, newest first.</p>
      </header>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] text-white/45">From (day)</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-white/45">To (day)</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
          />
        </label>
        <label className="block min-w-48 flex-1">
          <span className="mb-1 block text-[11px] text-white/45">Title contains</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Search titles…"
            className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
          />
        </label>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setFrom('')
              setTo('')
              setTitle('')
            }}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/20"
          >
            <RotateCcw size={13} /> Clear filters
          </button>
        ) : null}
        <span className="ml-auto pb-2 text-xs text-white/40">
          {records === null ? '' : `${filtered.length} of ${rows.length} episodes`}
        </span>
      </div>

      {records === null ? (
        <div className="flex items-center gap-2 py-16 text-sm text-white/50">
          <Loader2 size={16} className="animate-spin" /> Loading history…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-white/55">
          No watch history yet — episodes you watch will appear here.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-white/55">
          No entries match your filters.
        </div>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {filtered.map((row) => {
            const state = STATE_LABEL[row.state]
            const position = formatPosition(row.positionSeconds, row.runtimeSeconds)
            return (
              <li key={`${row.mediaId}-${row.season}-${row.episode}`}>
                <Link
                  to={`/anime/${row.mediaId}`}
                  className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/[0.05]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">
                      {row.media ? row.media.title : 'Unknown title'}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-white/45">
                      <span>Episode {row.episode}</span>
                      {row.season !== 'unknown' ? <span className="text-white/25">·</span> : null}
                      {row.season !== 'unknown' ? <span className="capitalize">{row.season.replace('-', ' ')}</span> : null}
                      {position ? (
                        <>
                          <span className="text-white/25">·</span>
                          <span>{position}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${state.tone}`}>{state.label}</span>
                  <span className="w-28 shrink-0 text-right text-xs text-white/40">{relativeTime(row.updatedAt)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
