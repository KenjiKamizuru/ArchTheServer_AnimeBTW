import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, CheckSquare, FolderDown, Loader2, X } from 'lucide-react'
import type { Media } from '../types'
import { useBookmarks } from '../lib/bookmarks'
import { enqueueBulkDownload } from '../lib/downloads'
import { useSettings } from '../lib/settings'
import { inferSeasonFromTitle } from '../lib/format'
import { MediaGrid } from '../components/MediaCard'
import { useToast } from '../components/Toasts'

export default function Bookmarks() {
  const bookmarks = useBookmarks()
  const settings = useSettings()
  const toast = useToast()
  const items = bookmarks.map((b) => b.media)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [scope, setScope] = useState<'season' | 'latest'>('season')
  const [quality, setQuality] = useState('best')
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    setQuality(settings.quality || 'best')
  }, [settings.quality])

  function toggleSelect(media: Media) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(media.id)) next.delete(media.id)
      else next.add(media.id)
      return next
    })
  }

  async function queueBookmarks(target: Media[]) {
    if (target.length === 0) return
    setBulkBusy(true)
    try {
      const res = await enqueueBulkDownload({
        mode: 'multi-anime',
        latestOnly: scope === 'latest',
        quality,
        dub: settings.dub,
        items: target.map((m) => {
          const inferred = inferSeasonFromTitle(m.title)
          return {
            mediaId: m.id,
            animeTitle: m.title,
            query: m.title,
            season: inferred.season,
            episodeCount: m.airedEpisodes || m.episodes || undefined,
            discoverFromProvider: scope === 'season',
            format: m.format,
            cover: m.cover,
            durationMinutes: m.duration,
          }
        }),
      })
      const parts = [
        res.queuedCount > 0
          ? `Queued ${res.queuedCount} episode${res.queuedCount === 1 ? '' : 's'} across ${target.length} bookmarked show${target.length === 1 ? '' : 's'}`
          : 'Nothing new to queue',
      ]
      if (res.skippedDownloaded > 0) parts.push(`${res.skippedDownloaded} already local`)
      if (res.skippedQueued > 0) parts.push(`${res.skippedQueued} already queued`)
      if (res.errors?.length) parts.push(`${res.errors.length} unmatched`)
      toast(parts.join(' · '))
      setSelectedIds(new Set())
      setSelectMode(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue season downloads', 'err')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Bookmarks</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {bookmarks.length
              ? `${bookmarks.length} saved title${bookmarks.length === 1 ? '' : 's'} · stored on this machine`
              : 'Saved titles will appear here.'}
          </p>
        </div>

        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => {
                  if (v) setSelectedIds(new Set())
                  else setSelectedIds(new Set(items.map((m) => m.id)))
                  return !v
                })
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold ring-1 transition ${
                selectMode
                  ? 'bg-accent text-black ring-accent'
                  : 'bg-accent/15 text-accent ring-accent/40 hover:bg-accent/25'
              }`}
            >
              <FolderDown size={14} />
              {selectMode ? 'Exit Bulk Select' : 'Download All Seasons'}
            </button>
          </div>
        )}
      </div>

      {selectMode && items.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-900 p-3.5 ring-1 ring-accent/40">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <CheckSquare size={15} className="text-accent" />
            <span className="font-medium text-white">
              {selectedIds.size} of {items.length} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set(items.map((m) => m.id)))}
              className="rounded-md bg-white/8 px-2.5 py-1 text-white/80 transition hover:bg-white/14"
            >
              Select all
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-md bg-white/6 px-2.5 py-1 text-white/60 transition hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={scope}
              onChange={(ev) => setScope(ev.target.value as 'season' | 'latest')}
              className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              <option value="season">Full season (all episodes)</option>
              <option value="latest">Latest episode only</option>
            </select>
            <select
              value={quality}
              onChange={(ev) => setQuality(ev.target.value)}
              className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              <option value="best">Best</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
            <button
              type="button"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={() => void queueBookmarks(items.filter((m) => selectedIds.has(m.id)))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}
              Queue {selectedIds.size} Show{selectedIds.size === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false)
                setSelectedIds(new Set())
              }}
              aria-label="Cancel selection"
              className="rounded-lg bg-white/6 p-1.5 text-white/60 transition hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {items.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-10 text-center ring-1 ring-white/5">
            <Bookmark size={30} className="mx-auto text-white/20" />
            <h2 className="mt-3 text-sm font-medium text-white/70">Nothing bookmarked yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-white/40">
              Hover any poster and hit the bookmark icon to keep track of the shows you want to watch later.
            </p>
            <Link
              to="/"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
            >
              Browse this season
            </Link>
          </div>
        ) : (
          <MediaGrid
            items={items}
            selectable={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        )}
      </div>
    </div>
  )
}
