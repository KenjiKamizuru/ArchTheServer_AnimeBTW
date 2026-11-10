import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { Media } from '../types'
import { api } from '../lib/api'
import { formatSeason } from '../lib/format'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'

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
  const [season, setSeason] = useState<(typeof SEASONS)[number]>(initial.season)
  const [year, setYear] = useState(initial.year)
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('popular')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Media[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
            <MediaGrid items={items} />
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
