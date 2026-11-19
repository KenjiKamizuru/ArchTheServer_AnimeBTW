import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronDown, Clock3, Layers, Sparkles } from 'lucide-react'
import { api, type FranchiseGroup } from '../lib/api'
import type { Media } from '../types'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'
import { formatSeason } from '../lib/format'

function currentSeason() {
  const now = new Date()
  const month = now.getMonth()
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL'
  return { season, year: now.getFullYear() }
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: typeof Layers
  title: string
  subtitle: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
          <Icon size={15} className="text-accent" />
          {title}
        </h2>
        <p className="mt-0.5 text-[11px] text-white/35">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

function FranchiseCard({ group }: { group: FranchiseGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl bg-ink-900 ring-1 ring-white/6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left transition hover:bg-white/[0.02]"
      >
        <Layers size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{group.title}</span>
          <span className="mt-0.5 block text-[11px] text-white/35">
            {group.count} entries · {group.media[0]?.seasonYear ?? '—'}–
            {group.media[group.media.length - 1]?.seasonYear ?? '—'}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-white/35 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <ol className="border-t border-white/6 px-3.5 py-2.5">
          {group.media.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2.5 py-1.5">
              <span className="w-5 shrink-0 text-right text-[11px] text-white/25 tabular-nums">{index + 1}.</span>
              <Link
                to={`/anime/${item.id}`}
                className="min-w-0 flex-1 truncate text-xs text-white/70 transition hover:text-accent"
              >
                {item.title}
              </Link>
              <span className="shrink-0 text-[11px] text-white/25 tabular-nums">{item.seasonYear ?? ''}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

/** Discovery hub: franchises, recent additions, refreshed metadata (AV-040/045/047/048). */
export default function Discover() {
  const initial = useMemo(currentSeason, [])
  const [franchises, setFranchises] = useState<FranchiseGroup[]>([])
  const [considered, setConsidered] = useState(0)
  const [recent, setRecent] = useState<Media[]>([])
  const [updated, setUpdated] = useState<Media[]>([])
  const [season, setSeason] = useState(initial.season)
  const [year, setYear] = useState(initial.year)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const failures: string[] = []
    const settle = <T,>(p: Promise<T>, fallback: T, label: string) =>
      p.catch((err: unknown) => {
        failures.push(`${label}: ${err instanceof Error ? err.message : 'failed'}`)
        return fallback
      })

    Promise.all([
      settle(api.franchises({ season, year }), { season, year, groups: [], considered: 0 }, 'Franchises'),
      settle(api.recentlyAdded(18), { media: [], count: 0 }, 'Recent'),
      settle(api.recentlyUpdated(18), { media: [], count: 0 }, 'Updated'),
    ]).then(([franchiseRes, recentRes, updatedRes]) => {
      if (!alive) return
      setFranchises(franchiseRes.groups)
      setConsidered(franchiseRes.considered)
      setRecent(recentRes.media)
      setUpdated(updatedRes.media)
      setErrors(failures)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [season, year])

  function shiftSeason(direction: -1 | 1) {
    const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Discover</h1>
        <p className="mt-0.5 text-xs text-white/40">
          Franchise groupings, fresh catalog additions and recently refreshed metadata
        </p>
      </div>

      {errors.length > 0 ? (
        <div className="rounded-xl bg-amber-950/40 p-3 text-[11px] text-amber-200 ring-1 ring-amber-500/25">
          {errors.join(' · ')}
        </div>
      ) : null}

      <section aria-labelledby="franchises-heading">
        <SectionHeader
          icon={Layers}
          title="Franchises this season"
          subtitle={`${franchises.length} multi-entry franchises across ${considered} titles`}
          action={
            <div className="flex items-center gap-1 rounded-lg bg-ink-850 px-1 py-1 ring-1 ring-white/5">
              <button
                type="button"
                aria-label="Previous season"
                onClick={() => shiftSeason(-1)}
                className="rounded-md px-1.5 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
              >
                ‹
              </button>
              <span className="min-w-24 text-center text-[11px] font-medium text-white/75">
                {formatSeason(season, year)}
              </span>
              <button
                type="button"
                aria-label="Next season"
                onClick={() => shiftSeason(1)}
                className="rounded-md px-1.5 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white"
              >
                ›
              </button>
            </div>
          }
        />
        {loading ? (
          <CardSkeletons count={4} />
        ) : franchises.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-6 text-center text-sm text-white/50 ring-1 ring-white/5">
            No multi-entry franchises found for {formatSeason(season, year)}.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {franchises.map((group) => (
              <FranchiseCard key={group.key} group={group} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <SectionHeader
          icon={Sparkles}
          title="Recently added to the catalog"
          subtitle="Newest catalog IDs — usually announcements and fresh simulcasts"
          action={
            <Link to="/index" className="text-[11px] text-accent underline decoration-dotted hover:text-accent-600">
              Browse the full index
            </Link>
          }
        />
        {loading ? <CardSkeletons count={6} /> : recent.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-6 text-center text-sm text-white/50 ring-1 ring-white/5">
            Nothing new right now.
          </div>
        ) : (
          <MediaGrid items={recent} />
        )}
      </section>

      <section aria-labelledby="updated-heading">
        <SectionHeader
          icon={Clock3}
          title="Recently updated metadata"
          subtitle="Titles whose artwork, synopsis or scores changed most recently"
          action={
            <span className="inline-flex items-center gap-1 text-[11px] text-white/30">
              <CalendarClock size={11} /> live from AniList
            </span>
          }
        />
        {loading ? <CardSkeletons count={6} /> : updated.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-6 text-center text-sm text-white/50 ring-1 ring-white/5">
            No metadata updates recorded.
          </div>
        ) : (
          <MediaGrid items={updated} />
        )}
      </section>
    </div>
  )
}
