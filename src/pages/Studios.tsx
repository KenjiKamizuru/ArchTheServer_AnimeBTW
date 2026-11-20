import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, Loader2, Search, Star, Tv } from 'lucide-react'
import { api, type StudioSummary } from '../lib/api'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'

const SORTS = [
  { id: 'popular', label: 'Popular' },
  { id: 'rated', label: 'Top rated' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
] as const

function StudioBucket({ letter }: { letter: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-sm font-semibold text-accent ring-1 ring-accent/20">
      {letter}
    </span>
  )
}

/** Studio/producer directory with search and alphabetical grouping (AV-030, AV-044). */
export function StudiosPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const type = (params.get('type') as 'all' | 'animation' | 'producer' ?? 'all')
  const [draft, setDraft] = useState(query)
  const [studios, setStudios] = useState<StudioSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)

  useEffect(() => setDraft(query), [query])

  // Reset page when the studio/producer type filter changes.
  useEffect(() => {
    setPage(1)
  }, [type])

  // Debounced search so typing does not fire one request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (draft === query) return
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (draft.trim()) next.set('q', draft.trim())
          else next.delete('q')
          return next
        },
        { replace: true },
      )
      setPage(1)
    }, 300)
    return () => clearTimeout(handle)
  }, [draft, query, setParams])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .studios({ page, q: query || undefined, type })
      .then((res) => {
        if (!alive) return
        setStudios((prev) => {
          if (page === 1) return res.studios
          const seen = new Set(prev.map((s) => s.name))
          return [...prev, ...res.studios.filter((s) => !seen.has(s.name))]
        })
        setHasNext(res.hasNextPage)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load studios')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [page, query])

  const grouped = useMemo(() => {
    const map = new Map<string, StudioSummary[]>()
    for (const studio of studios) {
      const key = studio.bucket || '#'
      const list = map.get(key) ?? []
      list.push(studio)
      map.set(key, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [studios])

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Studios</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Animation studios and producers, most-favourited first
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/30" />
            <input
              type="search"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              placeholder="Find a studio…"
              aria-label="Search studios"
              className="w-56 rounded-lg bg-ink-850 py-2 pr-3 pl-8 text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
          </label>
          <div className="rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
            {[
              { id: 'all', label: 'All' },
              { id: 'animation', label: 'Animation' },
              { id: 'producer', label: 'Producer' },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="switch"
                aria-checked={type === option.id}
                onClick={() =>
                  setParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('type', option.id)
                    return next
                  }, { replace: true })
                }
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                  type === option.id
                    ? 'bg-accent text-black'
                    : 'text-white/55 hover:bg-white/5 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">{error}</div>
      ) : loading && page === 1 ? (
        <div className="mt-6">
          <CardSkeletons count={8} />
        </div>
      ) : studios.length === 0 ? (
        <div className="mt-6 rounded-xl bg-ink-900 p-6 text-center ring-1 ring-white/5">
          <p className="text-sm text-white/60">No studios found{query ? ` for “${query}”` : ''}.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {grouped.map(([bucket, list]) => (
            <section key={bucket} aria-labelledby={`studio-bucket-${bucket}`}>
              <h2
                id={`studio-bucket-${bucket}`}
                className="mb-2 text-[11px] font-semibold tracking-widest text-white/35 uppercase"
              >
                {bucket}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((studio) => (
                  <Link
                    key={`${studio.id ?? studio.name}`}
                    to={`/studios/${studio.id ?? ''}`}
                    className="flex items-center gap-3 rounded-xl bg-ink-900 p-3 ring-1 ring-white/5 transition hover:bg-ink-850 hover:ring-accent/30"
                  >
                    <StudioBucket letter={studio.bucket || '#'} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{studio.name}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-[11px] text-white/35">
                        {studio.isAnimationStudio ? (
                          <span className="inline-flex items-center gap-1">
                            <Tv size={10} /> Animation
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Building2 size={10} /> Producer
                          </span>
                        )}
                        {studio.favourites ? (
                          <span className="inline-flex items-center gap-1">
                            <Star size={10} /> {studio.favourites.toLocaleString()}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {hasNext ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Load more studios
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** One studio's filmography grouped by year (AV-044). */
export function StudioPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const studioId = Number(id)
  const [params, setParams] = useSearchParams()
  const sort = (SORTS.find((s) => s.id === params.get('sort'))?.id ?? 'popular') as (typeof SORTS)[number]['id']
  const [data, setData] = useState<Awaited<ReturnType<typeof api.studio>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [decade, setDecade] = useState<number | null>(null)

  const load = useCallback(
    async (page = 1, append = false) => {
      if (!Number.isInteger(studioId) || studioId <= 0) {
        setError('Invalid studio id')
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const res = await api.studio(studioId, { page, sort })
        setData((prev) =>
          append && prev
            ? { ...res, media: [...prev.media, ...res.media.filter((m) => !prev.media.some((p) => p.id === m.id))] }
            : res,
        )
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load this studio')
      } finally {
        setLoading(false)
      }
    },
    [studioId, sort],
  )

  useEffect(() => {
    void load(1)
  }, [load])

  const visible = useMemo(() => {
    if (!data) return []
    const sections = decade === null
      ? data.byYear
      : data.byYear.filter((section) => typeof section.year === 'number' && Math.floor(section.year / 10) * 10 === decade)
    return sections
  }, [data, decade])

  if (error) {
    return (
      <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
        {error}
        <button type="button" onClick={() => navigate('/studios')} className="ml-3 underline">
          Back to studios
        </button>
      </div>
    )
  }

  return (
    <div>
      <Link to="/studios" className="inline-flex items-center gap-1.5 text-xs text-white/45 transition hover:text-white">
        <ArrowLeft size={13} /> All studios
      </Link>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <StudioBucket letter={data?.studio.name?.charAt(0).toUpperCase() ?? '?'} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">
              {data?.studio.name ?? (loading ? 'Loading…' : 'Studio')}
            </h1>
            <p className="mt-0.5 text-xs text-white/40">
              {data
                ? `${data.total.toLocaleString()} title${data.total === 1 ? '' : 's'} · ${
                    data.studio.isAnimationStudio ? 'animation studio' : 'producer'
                  }`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sort === option.id}
              onClick={() =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev)
                    if (option.id === 'popular') next.delete('sort')
                    else next.set('sort', option.id)
                    return next
                  },
                  { replace: true },
                )
              }
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                sort === option.id ? 'bg-accent text-black' : 'text-white/55 hover:bg-white/5 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {data && data.decades.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] tracking-wider text-white/30 uppercase">Decade</span>
          <button
            type="button"
            onClick={() => setDecade(null)}
            aria-pressed={decade === null}
            className={`rounded-md px-2 py-1 text-[11px] transition ${
              decade === null ? 'bg-accent text-black' : 'bg-white/5 text-white/55 hover:bg-white/10'
            }`}
          >
            All
          </button>
          {data.decades.map((decadeYear) => (
            <button
              key={decadeYear}
              type="button"
              onClick={() => setDecade(decadeYear === decade ? null : decadeYear)}
              aria-pressed={decade === decadeYear}
              className={`rounded-md px-2 py-1 text-[11px] transition ${
                decade === decadeYear ? 'bg-accent text-black' : 'bg-white/5 text-white/55 hover:bg-white/10'
              }`}
            >
              {decadeYear}s
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6 space-y-8">
        {loading && !data ? <CardSkeletons /> : null}
        {!loading && visible.length === 0 && !error ? (
          <div className="rounded-xl bg-ink-900 p-6 text-center text-sm text-white/50 ring-1 ring-white/5">
            No titles for this decade.
          </div>
        ) : null}
        {visible.map((section) => (
          <section key={String(section.year)} aria-labelledby={`year-${section.year}`}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 id={`year-${section.year}`} className="text-sm font-semibold text-white/85 tabular-nums">
                {section.year}
              </h2>
              <span className="text-[11px] text-white/30">{section.count} titles</span>
            </div>
            <MediaGrid items={section.items} />
          </section>
        ))}
        {data?.hasNextPage ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void load(data.page + 1, true)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              Load more
            </button>
          </div>
        ) : null}
      </div>

      {data && (
        <p className="mt-8 text-[11px] text-white/25">
          Showing {data.media.length} of {data.total.toLocaleString()} titles credited with main animation by{' '}
          {data.studio.name}.
        </p>
      )}
    </div>
  )
}
