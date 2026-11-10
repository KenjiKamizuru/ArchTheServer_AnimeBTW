import { Bookmark, BookmarkCheck, Download, Star } from 'lucide-react'
import type { Media } from '../types'
import { toggleBookmark, useBookmarks } from '../lib/bookmarks'
import { formatMediaType, formatSeason } from '../lib/format'
import { useDetail } from './MediaModal'
import { useToast } from './Toasts'

export function MediaCard({ media }: { media: Media }) {
  const open = useDetail()
  const toast = useToast()
  const bookmarks = useBookmarks()
  const saved = bookmarks.some((b) => b.mediaId === media.id)
  const latest = media.nextEpisode ? Math.max(0, media.nextEpisode.episode - 1) : media.airedEpisodes

  async function onBookmark() {
    try {
      await toggleBookmark(media)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  return (
    <div className="group relative">
      <div className="relative aspect-2/3 overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5 transition group-hover:ring-accent/50">
        <button
          type="button"
          onClick={() => open(media)}
          aria-label={`View ${media.title}`}
          className="absolute inset-0 block h-full w-full"
        >
          {media.cover ? (
            <img
              src={media.cover}
              alt={media.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
            />
          ) : (
            <span className="grid h-full place-items-center px-2 text-center text-xs text-white/40">
              {media.title}
            </span>
          )}
        </button>

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />

        {media.score ? (
          <span className="pointer-events-none absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 backdrop-blur-sm">
            <Star size={10} className="fill-amber-300" />
            {media.score}%
          </span>
        ) : null}

        {latest > 0 ? (
          <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white/80 backdrop-blur-sm">
            EP {latest}
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex translate-y-1 items-center gap-1.5 p-2 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => open(media, { download: true })}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-2 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600"
          >
            <Download size={13} />
            Download
          </button>
          <button
            type="button"
            onClick={() => void onBookmark()}
            aria-label={saved ? 'Remove bookmark' : 'Add bookmark'}
            className="rounded-md bg-black/70 p-1.5 text-white/80 transition hover:text-accent"
          >
            {saved ? <BookmarkCheck size={14} className="text-accent" /> : <Bookmark size={14} />}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => open(media)}
        className="mt-2 block w-full truncate text-left text-[13px] font-medium text-white/90 transition hover:text-accent"
      >
        {media.title}
      </button>
      <p className="truncate text-[11px] text-white/40">
        {formatMediaType(media.format)} · {formatSeason(media.season, media.seasonYear)}
      </p>
    </div>
  )
}

export function MediaGrid({ items }: { items: Media[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((media) => (
        <MediaCard key={media.id} media={media} />
      ))}
    </div>
  )
}

export function CardSkeletons({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-2/3 rounded-xl bg-ink-800" />
          <div className="mt-2 h-3 w-4/5 rounded bg-ink-800" />
          <div className="mt-1.5 h-2.5 w-1/2 rounded bg-ink-800/70" />
        </div>
      ))}
    </div>
  )
}
