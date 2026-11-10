import { Link, useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'

export default function Search() {
  const [params] = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const { data, error, loading } = useAsync(
    () => (query ? api.search(query) : Promise.resolve({ media: [], hasNextPage: false })),
    [query],
  )

  const items = data?.media ?? []

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">
        {query ? `Results for “${query}”` : 'Search'}
      </h1>
      <p className="mt-0.5 text-xs text-white/40">
        {query
          ? `${items.length} title${items.length === 1 ? '' : 's'} found · official metadata`
          : 'Type a title in the search bar above.'}
      </p>

      <div className="mt-6">
        {!query ? (
          <div className="rounded-xl bg-ink-900 p-8 text-center ring-1 ring-white/5">
            <SearchX size={28} className="mx-auto text-white/25" />
            <p className="mt-2 text-sm text-white/45">
              Search across the whole catalogue, then watch or bookmark from any result.
            </p>
            <Link
              to="/browse"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
            >
              Browse this season instead
            </Link>
          </div>
        ) : loading && !items.length ? (
          <CardSkeletons />
        ) : error ? (
          <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
            {error}
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl bg-ink-900 p-6 text-sm text-white/40 ring-1 ring-white/5">
            No anime matched that title. Try a shorter phrase or the Japanese romaji name.
          </p>
        ) : (
          <MediaGrid items={items} />
        )}
      </div>
    </div>
  )
}
