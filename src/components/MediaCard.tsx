import { Bookmark, BookmarkCheck, Check, FolderDown, HardDrive, Loader2, Play, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Media } from '../types'
import { highlightSegments, type HighlightSegment } from '../lib/api'
import { artworkForMedia, focusObjectClass, useArtwork } from '../lib/artwork'
import { toggleBookmark, useBookmarks } from '../lib/bookmarks'
import { enqueueBulkDownload, localFilesForMedia, useLibrary } from '../lib/downloads'
import { useSettings } from '../lib/settings'
import { formatMediaType, formatSeason, inferSeasonFromTitle } from '../lib/format'
import { useDetail } from './MediaModal'
import { useToast } from './Toasts'

export function MediaCard({
  media,
  selectable = false,
  selected = false,
  onToggleSelect,
  query,
}: {
  media: Media
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (media: Media) => void
  query?: string
}) {
  const titleHighlight = query ? highlightSegments(media.title, query) : null
  const open = useDetail()
  const toast = useToast()
  const bookmarks = useBookmarks()
  const settings = useSettings()
  const libraryStore = useLibrary()
  const artwork = useArtwork()
  const mediaArt = artworkForMedia(artwork, media)
  const coverUrl = mediaArt?.poster
    ? `${mediaArt.poster.url}?v=${mediaArt.poster.updatedAt}`
    : media.cover
  const [seasonBusy, setSeasonBusy] = useState(false)
  const localCount = useMemo(
    () => localFilesForMedia(libraryStore.items, media).length,
    [libraryStore.items, media],
  )
  const saved = bookmarks.some((b) => b.mediaId === media.id)
  const latest = media.nextEpisode ? Math.max(0, media.nextEpisode.episode - 1) : media.airedEpisodes

  async function onBookmark() {
    try {
      await toggleBookmark(media)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  async function onDownloadWholeSeason() {
    if (seasonBusy) return
    setSeasonBusy(true)
    try {
      const inferred = inferSeasonFromTitle(media.title)
      const count = latest > 0 ? latest : media.episodes ?? undefined
      const res = await enqueueBulkDownload({
        mode: 'season',
        mediaId: media.id,
        animeTitle: media.title,
        query: media.title,
        season: inferred.season,
        episodeCount: count,
        discoverFromProvider: true,
        quality: settings.quality,
        dub: settings.dub,
        format: media.format,
        cover: media.cover,
        durationMinutes: media.duration,
      })
      if (res.queuedCount > 0) {
        toast(
          `Queued ${res.queuedCount} episode${res.queuedCount === 1 ? '' : 's'} of ${media.title}`,
        )
      } else if (res.skippedDownloaded > 0) {
        toast(`Whole season of ${media.title} is already downloaded`)
      } else if (res.skippedQueued > 0) {
        toast(`${media.title} is already in the download queue`)
      } else {
        toast('Nothing new to queue')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue season download', 'err')
    } finally {
      setSeasonBusy(false)
    }
  }

  return (
    <div className="group relative">
      <div
        className={`relative aspect-2/3 overflow-hidden rounded-xl bg-ink-800 ring-1 transition ${
          selectable && selected
            ? 'ring-2 ring-accent shadow-lg shadow-accent/20'
            : 'ring-white/5 group-hover:ring-accent/50'
        }`}
      >
        <button
          type="button"
          onClick={() => (selectable && onToggleSelect ? onToggleSelect(media) : open(media))}
          aria-label={selectable ? `Select ${media.title}` : `View ${media.title}`}
          className="absolute inset-0 block h-full w-full"
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={media.title}
              loading="lazy"
              decoding="async"
              className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.05] ${focusObjectClass(mediaArt?.poster?.focus)}`}
            />
          ) : (
            <span className="grid h-full place-items-center px-2 text-center text-xs text-white/40">
              {media.title}
            </span>
          )}
        </button>

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />

        {selectable ? (
          <span
            className={`pointer-events-none absolute top-2 left-2 grid h-6 w-6 place-items-center rounded-md ring-1 transition ${
              selected
                ? 'bg-accent text-black ring-accent'
                : 'bg-black/75 text-white/60 ring-white/25'
            }`}
          >
            {selected ? <Check size={14} strokeWidth={3} /> : null}
          </span>
        ) : media.score ? (
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

        {localCount > 0 ? (
          <span
            title={`${localCount} episode${localCount === 1 ? '' : 's'} saved in local library`}
            className="pointer-events-none absolute bottom-2 left-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-950/85 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/30 backdrop-blur-sm transition group-hover:opacity-0"
          >
            <HardDrive size={10} />
            {localCount} local
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex translate-y-1 items-center gap-1.5 p-2 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => open(media, { watch: true })}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-2 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600"
          >
            <Play size={13} />
            {latest > 0 ? `Watch EP ${latest}` : 'Watch'}
          </button>
          <button
            type="button"
            onClick={() => void onDownloadWholeSeason()}
            disabled={seasonBusy}
            title={media.format === 'MOVIE' ? 'Download movie' : 'Bulk download whole season'}
            aria-label={media.format === 'MOVIE' ? 'Download movie' : 'Download whole season'}
            className="rounded-md bg-black/75 p-1.5 text-white/85 ring-1 ring-white/15 transition hover:text-accent disabled:opacity-50"
          >
            {seasonBusy ? <Loader2 size={14} className="animate-spin text-accent" /> : <FolderDown size={14} />}
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
        className="mt-2 flex w-full items-center gap-1.5 text-left text-[13px] font-medium text-white/90 transition hover:text-accent"
      >
        {mediaArt?.icon ? (
          <img
            src={`${mediaArt.icon.url}?v=${mediaArt.icon.updatedAt}`}
            alt=""
            className={`h-4 w-4 shrink-0 rounded object-cover ring-1 ring-white/15 ${focusObjectClass(mediaArt.icon.focus)}`}
          />
        ) : null}
        {titleHighlight ? (
          <span className="truncate flex flex-wrap">
            {titleHighlight.map((segment: HighlightSegment, index) =>
              segment.match ? (
                <mark
                  key={index}
                  className="rounded-sm bg-accent/25 px-0.5 text-accent"
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </span>
        ) : (
          <span className="truncate">{media.title}</span>
        )}
      </button>
      <p className="truncate text-[11px] text-white/40">
        {formatMediaType(media.format)} · {formatSeason(media.season, media.seasonYear)}
      </p>
    </div>
  )
}

export function MediaGrid({
  items,
  selectable = false,
  selectedIds,
  onToggleSelect,
  query,
}: {
  items: Media[]
  selectable?: boolean
  selectedIds?: Set<number>
  onToggleSelect?: (media: Media) => void
  query?: string
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((media) => (
        <MediaCard
          key={media.id}
          media={media}
          selectable={selectable}
          selected={Boolean(selectedIds?.has(media.id))}
          onToggleSelect={onToggleSelect}
          query={query}
        />
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
