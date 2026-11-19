import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api, type CatalogIndexResponse, type IndexBucket } from '../lib/api'
import type { Media } from '../types'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'

const LATIN = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
const KANA = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']

const SORTS = [
  { id: 'title', label: 'A–Z' },
  { id: 'popular', label: 'Popular' },
  { id: 'rated', label: 'Top rated' },
] as const

type SortId = (typeof SORTS)[number]['id']

/**
 * Alphabetical catalog index with kana rows (AV-046).
 *
 * The whole index page is fetched once per sort; letter selection is then a
 * client-side filter, so jumping between letters is instant.
 */
export default function IndexPage() {
  const [params, setParams] = useSearchParams()
  const initialLetter = params.get('letter') ?? ''
  const [letter, setLetter] = useState<string>(initialLetter)
  const [sort, setSort] = useState<SortId>((params.get('sort') as SortId) || 'title')
  const [data, setData] = useState<CatalogIndexResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [extraPages, setExtraPages] = useState<IndexBucket[][]>([])
  const letterRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      setLoading(true)
      try {
        const res = await api.catalogIndex({ page: nextPage, sort })
        setData(res)
        setExtraPages((prev) => (append ? [...prev, res.buckets] : []))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the catalog index')
      } finally {
        setLoading(false)
      }
    },
    [sort],
  )

  useEffect(() => {
    setPage(1)
    void load(1, false)
  }, [load])

  // Persist the selected letter/sort so a refresh lands in the same place.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (letter) next.set('letter', letter)
        else next.delete('letter')
        if (sort !== 'title') next.set('sort', sort)
        else next.delete('sort')
        return next
      },
      { replace: true },
    )
  }, [letter, sort, setParams])

  const merged = useMemo(() => {
    const map = new Map<string, { bucket: string; items: Media[] }>()
    const add = (buckets: IndexBucket[]) => {
      for (const bucket of buckets) {
        const existing = map.get(bucket.bucket) ?? { bucket: bucket.bucket, items: [] }
        const seen = new Set(existing.items.map((m) => m.id))
        for (const item of bucket.items) if (!seen.has(item.id)) existing.items.push(item)
        map.set(bucket.bucket, existing)
      }
    }
    if (data) add(data.buckets)
    for (const buckets of extraPages) add(buckets)
    const order = [...LATIN, ...KANA]
    return [...map.values()].sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket))
  }, [data, extraPages])

  const populated = useMemo(() => new Set(merged.map((b) => b.bucket)), [merged])
  const visible = letter ? merged.filter((b) => b.bucket === letter) : merged
  const total = merged.reduce((sum, bucket) => sum + bucket.items.length, 0)

  function jumpTo(target: string) {
    setLetter(target)
    letterRefs.current[target]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">A–Z index</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Browse the catalog by initial, including kana rows · {total.toLocaleString()} loaded
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sort === option.id}
              onClick={() => setSort(option.id)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                sort === option.id ? 'bg-accent text-black' : 'text-white/55 hover:bg-white/5 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <nav aria-label="Index letters" className="mt-4 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setLetter('')}
          aria-pressed={letter === ''}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
            letter === '' ? 'bg-accent text-black' : 'bg-white/5 text-white/55 hover:bg-white/10'
          }`}
        >
          All
        </button>
        {LATIN.map((key) => (
          <button
            key={key}
            type="button"
            ref={(node) => {
              letterRefs.current[key] = node
            }}
            onClick={() => jumpTo(key)}
            aria-pressed={letter === key}
            disabled={!populated.has(key) && letter !== key}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
              letter === key
                ? 'bg-accent text-black'
                : populated.has(key)
                  ? 'bg-white/5 text-white/55 hover:bg-white/10'
                  : 'bg-white/2 text-white/15'
            }`}
          >
            {key}
          </button>
        ))}
        <span aria-hidden className="mx-1 self-center text-white/15">|</span>
        {KANA.map((key) => (
          <button
            key={key}
            type="button"
            ref={(node) => {
              letterRefs.current[key] = node
            }}
            onClick={() => jumpTo(key)}
            aria-pressed={letter === key}
            disabled={!populated.has(key) && letter !== key}
            aria-label={`Kana row ${key}`}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
              letter === key
                ? 'bg-accent text-black'
                : populated.has(key)
                  ? 'bg-white/5 text-white/55 hover:bg-white/10'
                  : 'bg-white/2 text-white/15'
            }`}
          >
            {key}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="mt-6 rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">{error}</div>
      ) : loading && !data ? (
        <div className="mt-6">
          <CardSkeletons count={12} />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-6 rounded-xl bg-ink-900 p-6 text-center text-sm text-white/50 ring-1 ring-white/5">
          Nothing indexed under “{letter}” yet.
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {visible.map((bucket) => (
            <section key={bucket.bucket} aria-labelledby={`index-${bucket.bucket}`}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 id={`index-${bucket.bucket}`} className="text-lg font-semibold text-accent">
                  {bucket.bucket}
                </h2>
                <span className="text-[11px] text-white/30">{bucket.items.length} titles</span>
              </div>
              <MediaGrid items={bucket.items} />
            </section>
          ))}
        </div>
      )}

      {data?.hasNextPage ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => {
              const next = page + 1
              setPage(next)
              void load(next, true)
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            Load more letters
          </button>
        </div>
      ) : null}
    </div>
  )
}
