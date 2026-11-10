import { Link } from 'react-router-dom'
import { Bookmark } from 'lucide-react'
import { useBookmarks } from '../lib/bookmarks'
import { MediaGrid } from '../components/MediaCard'

export default function Bookmarks() {
  const bookmarks = useBookmarks()

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Bookmarks</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {bookmarks.length
              ? `${bookmarks.length} saved title${bookmarks.length === 1 ? '' : 's'} · stored on this machine`
              : 'Saved titles will appear here.'}
          </p>
        </div>
      </div>

      <div className="mt-6">
        {bookmarks.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-10 text-center ring-1 ring-white/5">
            <Bookmark size={30} className="mx-auto text-white/20" />
            <h2 className="mt-3 text-sm font-medium text-white/70">Nothing bookmarked yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-white/40">
              Hover any poster and hit the bookmark icon to keep track of what you want to download later.
            </p>
            <Link
              to="/"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
            >
              Browse this season
            </Link>
          </div>
        ) : (
          <MediaGrid items={bookmarks.map((b) => b.media)} />
        )}
      </div>
    </div>
  )
}
