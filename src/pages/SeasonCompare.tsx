import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightCircle, Columns, RefreshCw } from 'lucide-react'
import { api, type SeasonComparisonResponse } from '../lib/api'
import type { Media } from '../types'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'
import { formatSeason } from '../lib/format'

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const

const CURRENT_YEAR = new Date().getFullYear()
const DEFAULT_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1]

function SeasonComparePage() {
  const [selections, setSelections] = useState<Array<{ season: (typeof SEASONS)[number]; year: number }>>([
    { season: 'WINTER', year: DEFAULT_YEARS[0] },
    { season: 'SPRING', year: DEFAULT_YEARS[0] },
  ])
  const [comparison, setComparison] = useState<SeasonComparisonResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addSeason = () => {
    if (selections.length >= 4) return
    setSelections([...selections, { season: 'WINTER', year: DEFAULT_YEARS[0] }])
  }

  const removeSeason = (index: number) => {
    if (selections.length <= 2) return
    setSelections(selections.filter((_, i) => i !== index))
  }

  const setSelection = (index: number, field: 'season' | 'year', value: string | number) => {
    const next = [...selections]
    next[index] = { ...next[index], [field]: value as never }
    setSelections(next)
  }

  const compare = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.compareSeasons(
        selections.map((s) => ({ season: s.season, year: s.year })),
      )
      setComparison(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compare seasons')
    } finally {
      setLoading(false)
    }
  }

  const sharedTitles = useMemo(() => {
    if (!comparison) return []
    const sharedIds = new Set(comparison.sharedTitleIds)
    const seen = new Set<number>()
    const shared: Media[] = []
    for (const season of comparison.seasons) {
      for (const m of season.media) {
        if (sharedIds.has(m.id) && !seen.has(m.id)) {
          seen.add(m.id)
          shared.push(m)
        }
      }
    }
    return shared
  }, [comparison])

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-4">
        <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
          <Columns size={17} className="text-accent" />
          Season Comparison
        </h1>
          <p className="mt-0.5 text-[11px] text-white/35">
            Compare two or more seasons side by side — shared titles, average scores, and top picks.
          </p>
        </div>
        <button
          type="button"
          onClick={compare}
          disabled={loading || selections.length < 2}
          className="flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground transition hover:bg-accent/90"
        >
          <RefreshCw size={14} className="shrink-0" />
          Compare
        </button>
      </div>

      <div className="rounded-xl bg-ink-900 ring-1 ring-white/6 p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider">Seasons</span>
          {selections.map((sel, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={sel.season}
                onChange={(e) => setSelection(i, 'season', e.target.value)}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-accent"
              >
                {SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={String(sel.year)}
                onChange={(e) => setSelection(i, 'year', Number(e.target.value))}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-accent"
              >
                {[CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3].map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
              {selections.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeSeason(i)}
                  className="rounded-md p-1 text-white/40 hover:text-white transition"
                  aria-label={`Remove ${formatSeason(sel.season, sel.year)}`}
                >
                  <ArrowRightCircle size={12} className="rotate-90" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addSeason}
            disabled={selections.length >= 4}
            className="disabled:opacity-50 disabled:pointer-events-none rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none hover:bg-white/10 transition"
          >
            +
          </button>
        </div>
        {error && (
          <div className="rounded-md border border-red/50 bg-red/10 px-3 py-2 text-[11px] text-red-400">{error}</div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <CardSkeletons key={i} count={3} />
          ))}
        </div>
      )}

      {comparison && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider">Result</span>
            <span className="text-[11px] text-white/50">
              {comparison.compared} seasons compared · {comparison.sharedCount} shared title
              {comparison.sharedCount !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {comparison.seasons.map((season) => (
              <section key={`${season.season}:${season.year}`} className="rounded-xl bg-ink-900 ring-1 ring-white/6 p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/10 text-[10px] font-semibold text-white">
                    {comparison.seasons.indexOf(season) + 1}
                  </span>
                  <h2 className="flex-1 truncate text-sm font-semibold text-white">{formatSeason(season.season, season.year)}</h2>
                </div>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/40">Total titles</span>
                    <span className="text-white font-medium">{season.count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40">Returned</span>
                    <span className="text-white font-medium">{season.returned}</span>
                  </div>
                  {season.averageScore !== null && (
                    <div className="flex justify-between">
                      <span className="text-white/40">Avg. score</span>
                      <span className="text-white font-medium">{season.averageScore}</span>
                    </div>
                  )}
                </dl>

                <div className="mt-3 flex-1">
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">Top titles</h3>
                  <ul className="space-y-1.5">
                    {season.topTitles.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-[11px]">
                        <span className="shrink-0 w-2 h-2 rounded-full bg-white/10" />
                        <span className="truncate text-white">{t.title}</span>
                        {t.score != null && (
                          <span className="ml-auto text-white/50">{t.score}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ))}
          </div>

          {comparison.sharedCount > 0 && sharedTitles.length > 0 && (
            <section className="rounded-xl bg-ink-900 ring-1 ring-white/6 p-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
                <Columns size={14} className="shrink-0 text-accent" />
                Shared titles ({sharedTitles.length})
              </h2>
              <MediaGrid items={sharedTitles} />
            </section>
          )}

          {!comparison.sharedCount && (
            <p className="text-[11px] text-white/40">No shared titles across the selected seasons.</p>
          )}
        </>
      )}
    </div>
  )
}

export default SeasonComparePage
