import { useEffect, useState } from 'react'
import { CheckSquare, ChevronLeft, ChevronRight, FolderDown, Loader2, X } from 'lucide-react'
import type { Media } from '../types'
import { api } from '../lib/api'
import { enqueueBulkDownload } from '../lib/downloads'
import { useSettings } from '../lib/settings'
import { formatSeason, inferSeasonFromTitle } from '../lib/format'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'
import { useToast } from '../components/Toasts'

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
const SORTS = [
  { id: 'popular', label: 'Popular' },
  { id: 'trending', label: 'Trending' },
  { id: 'rated', label: 'Top rated' },
  { id: 'newest', label: 'Newest' },
] as const

const SEASON_LABEL: Record<string, string> = {
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
}

function currentSeason() {
  const date = new Date()
  const month = date.getMonth()
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL'
  return { season: season as (typeof SEASONS)[number], year: date.getFullYear() }
}

export default function Browse() {
  const initial = currentSeason()
  const toast = useToast()
  const settings = useSettings()
  const [season, setSeason] = useState<(typeof SEASONS)[number]>(initial.season)
  const [year, setYear] = useState(initial.year)
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('popular')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Media[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Bulk season download selection
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [scope, setScope] = useState<'season' | 'latest'>('season')
  const [quality, setQuality] = useState('best')
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    setQuality(settings.quality || 'best')
  }, [settings.quality])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .season({ season, year, sort, page })
      .then((res) => {
        if (!alive) return
        setHasNext(res.hasNextPage)
        setItems((prev) => {
          if (page === 1) return res.media
          const seen = new Set(prev.map((m) => m.id))
          return [...prev, ...res.media.filter((m) => !seen.has(m.id))]
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load this season')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [season, year, sort, page])

  function changeFilter(fn: () => void) {
    fn()
    setPage(1)
    setItems([])
    setSelectedIds(new Set())
  }

  function toggleSelect(media: Media) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(media.id)) next.delete(media.id)
      else next.add(media.id)
      return next
    })
  }

  async function queueSelectedShows() {
    const picked = items.filter((m) => selectedIds.has(m.id))
    if (picked.length === 0) return
    setBulkBusy(true)
    try {
      const res = await enqueueBulkDownload({
        mode: 'multi-anime',
        latestOnly: scope === 'latest',
        quality,
        dub: settings.dub,
        items: picked.map((m) => {
          const inferred = inferSeasonFromTitle(m.title)
          return {
            mediaId: m.id,
            animeTitle: m.title,
            query: m.title,
            season: inferred.season,
            episodeCount: m.airedEpisodes || m.episodes || undefined,
            discoverFromProvider: scope === 'season',
            format: m.format,
            cover: m.cover,
            durationMinutes: m.duration,
          }
        }),
      })
      const parts = [
        res.queuedCount > 0
          ? `Queued ${res.queuedCount} episode${res.queuedCount === 1 ? '' : 's'} across ${picked.length} show${picked.length === 1 ? '' : 's'}`
          : 'Nothing new to queue',
      ]
      if (res.skippedDownloaded > 0) parts.push(`${res.skippedDownloaded} already local`)
      if (res.skippedQueued > 0) parts.push(`${res.skippedQueued} already queued`)
      if (res.errors?.length) parts.push(`${res.errors.length} unmatched`)
      toast(parts.join(' · '))
      setSelectedIds(new Set())
      setSelectMode(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue bulk season download', 'err')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Browse seasons</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {formatSeason(season, year)} · official seasonal listings
          </p>
        </div>

        {items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => {
                if (v) setSelectedIds(new Set())
                return !v
              })
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold ring-1 transition ${
              selectMode
                ? 'bg-accent text-black ring-accent'
                : 'bg-accent/15 text-accent ring-accent/40 hover:bg-accent/25'
            }`}
          >
            <FolderDown size={14} />
            {selectMode ? 'Exit Bulk Select' : 'Bulk Download Seasons'}
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
          {SEASONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => changeFilter(() => setSeason(option))}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                season === option
                  ? 'bg-accent text-black'
                  : 'text-white/55 hover:bg-white/5 hover:text-white'
              }`}
            >
              {SEASON_LABEL[option]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-ink-850 px-1 py-1 ring-1 ring-white/5">
          <button
            type="button"
            aria-label="Previous year"
            onClick={() => changeFilter(() => setYear((y) => y - 1))}
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-12 text-center text-xs font-medium text-white/80 tabular-nums">{year}</span>
          <button
            type="button"
            aria-label="Next year"
            onClick={() => changeFilter(() => setYear((y) => y + 1))}
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => changeFilter(() => setSort(option.id))}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                sort === option.id
                  ? 'bg-accent text-black'
                  : 'text-white/55 hover:bg-white/5 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {selectMode && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-900 p-3.5 ring-1 ring-accent/40">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <CheckSquare size={15} className="text-accent" />
            <span className="font-medium text-white">
              {selectedIds.size} show{selectedIds.size === 1 ? '' : 's'} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set(items.map((m) => m.id)))}
              className="rounded-md bg-white/8 px-2.5 py-1 text-white/80 transition hover:bg-white/14"
            >
              Select all ({items.length})
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-md bg-white/6 px-2.5 py-1 text-white/60 transition hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={scope}
              onChange={(ev) => setScope(ev.target.value as 'season' | 'latest')}
              className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              <option value="season">Full season (all episodes)</option>
              <option value="latest">Latest episode only</option>
            </select>
            <select
              value={quality}
              onChange={(ev) => setQuality(ev.target.value)}
              className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              <option value="best">Best</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
            <button
              type="button"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={() => void queueSelectedShows()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}
              Download Selected ({selectedIds.size})
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false)
                setSelectedIds(new Set())
              }}
              aria-label="Cancel selection"
              className="rounded-lg bg-white/6 p-1.5 text-white/60 transition hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {loading && page === 1 ? (
          <CardSkeletons />
        ) : error ? (
          <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
            {error}
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl bg-ink-900 p-6 text-sm text-white/40 ring-1 ring-white/5">
            Nothing listed for {formatSeason(season, year)} yet. Try the previous season.
          </p>
        ) : (
          <>
            <MediaGrid
              items={items}
              selectable={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
            {hasNext ? (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
