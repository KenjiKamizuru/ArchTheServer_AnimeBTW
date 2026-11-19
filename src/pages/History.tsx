import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import type { Media, ProgressEntry } from '../types'
import { api } from '../lib/api'
import { filterWatchHistory, searchWatchHistory, watchHistoryRows, type WatchHistoryRow } from '../lib/history'
import { relativeTime } from '../lib/format'
import { useToast } from '../components/Toasts'

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
  const push = useToast()
  const [records, setRecords] = useState<ProgressEntry[] | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [mediaById, setMediaById] = useState<Map<number, Media>>(new Map())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')

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
  // AV-162: free-text search spans titles AND dates; the structured date
  // bounds stay as the precise filter.
  const filtered = useMemo(() => filterWatchHistory(searchWatchHistory(rows, query), { from, to }), [rows, from, to, query])
  const filtersActive = Boolean(from || to || query.trim())

  // AV-163: per-entry deletion. The entry IS the progress record, so
  // removing it clears the episode's watch mark and resume position too.
  async function removeEntry(row: WatchHistoryRow) {
    try {
      const { removed } = await api.removeProgressEntry(row.mediaId, row.season, row.episode)
      if (removed > 0) {
        setRecords((prev) =>
          prev
            ? prev.filter(
                (record) =>
                  !(record.mediaId === row.mediaId && record.season === row.season && record.episode === row.episode),
              )
            : prev,
        )
        push('Removed from history — the watch mark and resume position were cleared too')
      }
    } catch {
        push('Could not remove the history entry', 'err')
    }
  }

  // AV-164: bulk deletion with confirmation (the TODO scopes the confirm
  // dialog to bulk; per-entry is immediate). Same semantics as AV-163.
  const rowKey = (row: WatchHistoryRow) => `${row.mediaId}\u0000${row.season}\u0000${row.episode}`
  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function removeSelected() {
    const items = filtered
      .filter((row) => selected.has(rowKey(row)))
      .map((row) => ({ mediaId: row.mediaId, season: row.season, episode: row.episode }))
    if (items.length === 0) return
    if (!window.confirm(`Remove ${items.length} history ${items.length === 1 ? 'entry' : 'entries'}? Their watch marks and resume positions will be cleared.`)) return
    try {
      const { removed } = await api.removeProgressEntries(items)
      const keys = new Set(items.map((item) => `${item.mediaId}\u0000${item.season}\u0000${item.episode}`))
      setRecords((prev) =>
        prev
          ? prev.filter((record) => !keys.has(`${record.mediaId}\u0000${record.season}\u0000${record.episode}`))
          : prev,
      )
      setSelected(new Set())
      setSelectMode(false)
      push(`Removed ${removed} history ${removed === 1 ? 'entry' : 'entries'} — watch marks and resume positions were cleared too`)
    } catch {
      push('Could not remove the selected entries', 'err')
    }
  }

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
          <span className="mb-1 block text-[11px] text-white/45">Search titles or dates</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='e.g. "frieren march 2024"'
            className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
          />
        </label>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setFrom('')
              setTo('')
              setQuery('')
            }}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/20"
          >
            <RotateCcw size={13} /> Clear filters
          </button>
        ) : null}
        {records !== null && rows.length > 0 ? (
          selectMode ? (
            <>
              <button
                type="button"
                onClick={() =>
                  setSelected((prev) =>
                    prev.size === filtered.length && filtered.length > 0
                      ? new Set()
                      : new Set(filtered.map(rowKey)),
                  )
                }
                className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/20"
              >
                {selected.size === filtered.length && filtered.length > 0 ? 'Select none' : 'Select all shown'}
              </button>
              <button
                type="button"
                onClick={() => void removeSelected()}
                disabled={selected.size === 0}
                className="flex items-center gap-1.5 rounded-full bg-red-400/15 px-3.5 py-2 text-xs font-medium text-red-200 transition hover:bg-red-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={13} /> Remove selected ({selected.size})
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectMode(false)
                  setSelected(new Set())
                }}
                className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/20"
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/20"
            >
              Select
            </button>
          )
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
              <li key={rowKey(row)} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.05]">
                {selectMode ? (
                  <button
                    type="button"
                    onClick={() => toggleSelected(rowKey(row))}
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={selected.has(rowKey(row))}
                      className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">
                        {row.media ? row.media.title : 'Unknown title'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-white/45">
                        <span>Episode {row.episode}</span>
                        {row.season !== 'unknown' ? <span className="text-white/25">·</span> : null}
                        {row.season !== 'unknown' ? <span className="capitalize">{row.season.replace('-', ' ')}</span> : null}
                      </div>
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs text-white/40">{relativeTime(row.updatedAt)}</span>
                  </button>
                ) : (
                  <>
                    <Link to={`/anime/${row.mediaId}`} className="flex min-w-0 flex-1 items-center gap-4">
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
                    <button
                      type="button"
                      title="Remove from history (clears the watch mark and resume position)"
                      onClick={() => void removeEntry(row)}
                      className="shrink-0 rounded-full p-2 text-white/35 transition hover:bg-red-400/10 hover:text-red-300"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
