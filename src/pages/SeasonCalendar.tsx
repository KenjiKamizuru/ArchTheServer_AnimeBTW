import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, type SeasonCalendarResponse } from '../lib/api'
import type { Media } from '../types'
import { CardSkeletons } from '../components/MediaCard'
import { formatSeason } from '../lib/format'

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function seasonMonths(season: (typeof SEASONS)[number], year: number) {
  switch (season) {
    case 'WINTER':
      return [
        { year: year - 1, month: 12 },
        { year, month: 1 },
        { year, month: 2 },
      ]
    case 'SPRING':
      return [{ year, month: 3 }, { year, month: 4 }, { year, month: 5 }]
    case 'SUMMER':
      return [{ year, month: 6 }, { year, month: 7 }, { year, month: 8 }]
    case 'FALL':
      return [{ year, month: 9 }, { year, month: 10 }, { year, month: 11 }]
  }
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function firstWeekday(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay() // 0 = Sunday
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function currentSeason() {
  const now = new Date()
  const month = now.getMonth()
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL'
  return { season, year: now.getFullYear() }
}

function SeasonCalendarPage() {
  const initial = useMemo(currentSeason, [])
  const [season, setSeason] = useState<typeof SEASONS[number]>(initial.season as typeof SEASONS[number])
  const [year, setYear] = useState(initial.year)
  const [data, setData] = useState<SeasonCalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const months = useMemo(() => seasonMonths(season, year), [season, year])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.seasonCalendar({ season, year })
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load release calendar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [season, year]) // eslint-disable-line react-hooks/exhaustive-deps

  function shiftSeason(direction: -1 | 1) {
    const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
    const index = order.indexOf(season) + direction
    if (index < 0) {
      setSeason('FALL')
      setYear((y) => y - 1)
    } else if (index > 3) {
      setSeason('WINTER')
      setYear((y) => y + 1)
    } else {
      setSeason(order[index])
    }
  }

  const releasesByDate = useMemo(() => {
    if (!data) return new Map<string, Media[]>()
    return new Map(data.calendar.map((d) => [d.date, d.media]))
  }, [data])

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            <Calendar size={17} className="text-accent" />
            Seasonal Release Calendar
          </h1>
          <p className="mt-0.5 text-[11px] text-white/35">
            Titles grouped by their start date across {formatSeason(season, year)}.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-ink-850 px-1 py-1 ring-1 ring-white/5">
          <button
            type="button"
            aria-label="Previous season"
            onClick={() => shiftSeason(-1)}
            className="rounded-md px-1.5 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-32 text-center text-[11px] font-medium text-white/75">
            {formatSeason(season, year)}
          </span>
          <button
            type="button"
            aria-label="Next season"
            onClick={() => shiftSeason(1)}
            className="rounded-md px-1.5 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red/50 bg-red/10 px-3 py-2 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-3">
          {months.map((_, i) => (
            <section key={i} className="rounded-xl bg-ink-900 ring-1 ring-white/6 p-3">
              <CardSkeletons count={5} />
            </section>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="text-[11px] font-medium text-white/50 uppercase tracking-wider">
            {data.returned} of {data.total} titles have a known start date
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {months.map((month, mi) => {
              const first = firstWeekday(month.year, month.month)
              const totalDays = daysInMonth(month.year, month.month)
              const cellCount = first + totalDays
              const rowCount = Math.ceil(cellCount / 7)

              return (
                <section
                  key={`${month.year}-${month.month}`}
                  className="rounded-xl bg-ink-900 ring-1 ring-white/6 flex flex-col"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                    <h2 className="text-sm font-semibold text-white">
                      {MONTH_NAMES[month.month - 1]} {month.year}
                    </h2>
                    <span className="text-[10px] text-white/40">
                      {releasesByDate.size} release days
                    </span>
                  </div>
                  <div className="grid grid-cols-7 px-3 text-[10px] text-white/30">
                    {weekdayLabels.map((label) => (
                      <div key={label} className="text-center" aria-hidden="true">
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 p-3">
                    {Array.from({ length: rowCount * 7 }).map((_, cell) => {
                      const day = cell - first + 1
                      const inMonth = day >= 1 && day <= totalDays
                      const dateKey = inMonth ? `${month.year}-${pad(month.month)}-${pad(day)}` : null
                      const releases = dateKey ? releasesByDate.get(dateKey) : undefined
                      return (
                        <div
                          key={cell}
                          className={`aspect-square flex flex-col items-center justify-center ${
                            inMonth
                              ? 'rounded-md text-white transition hover:bg-white/5'
                              : 'rounded-md text-white/10'
                          }`}
                        >
                          {inMonth ? (
                            <>
                              <div className="mb-1 text-[11px] font-medium tabular-nums">
                                {day}
                              </div>
                              {releases?.length ? (
                                <ul className="space-y-1 text-[10px] leading-none">
                                  {releases.slice(0, 3).map((m) => (
                                    <li key={m.id} className="flex items-center gap-1.5">
                                      <Link
                                        to={`/anime/${m.id}`}
                                        className="min-w-0 truncate text-white/70 hover:text-accent transition"
                                        title={m.title}
                                      >
                                        {m.title}
                                      </Link>
                                      {m.score != null && (
                                        <span className="shrink-0 text-[9px] text-accent font-medium">
                                          {m.score}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                  {releases.length > 3 && (
                                    <li className="text-[9px] text-white/30 italic">
                                      +{releases.length - 3} more
                                    </li>
                                  )}
                                </ul>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>

          {!data.calendar.length && (
            <div className="rounded-xl bg-ink-900 p-8 text-center text-sm text-white/50 ring-1 ring-white/5">
              No titles with a known start date for {formatSeason(season, year)}.
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default SeasonCalendarPage
