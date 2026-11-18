import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Captions,
  CheckSquare,
  Download,
  FileVideo,
  Film,
  Folder,
  FolderDown,
  HardDrive,
  ImagePlus,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
  Subtitles,
  Trash2,
  Upload,
} from 'lucide-react'
import type { ArtworkTargetType, LibraryItem, Media, UploadCategory } from '../types'
import { api } from '../lib/api'
import {
  artworkForLibraryItem,
  artworkForSeriesGroup,
  focusObjectClass,
  useArtwork,
} from '../lib/artwork'
import {
  bulkDeleteLibraryFiles,
  deleteLibraryFile,
  refreshLibrary,
  useLibrary,
} from '../lib/downloads'
import { exactDate, formatBytes, formatEpisodeCode, formatQualityLabel } from '../lib/format'
import { DownloadsTabs } from '../components/DownloadsTabs'
import { ImdbArtworkModal } from '../components/ImdbArtworkModal'
import { useDetail } from '../components/MediaModal'
import { localItemToPlayback, usePlayer } from '../components/Player'
import { UploadQueuePanel, UploadVideoModal } from '../components/UploadVideoModal'
import { useToast } from '../components/Toasts'

type KindFilter = 'all' | 'episodes' | 'movies' | 'unknown'

interface SeriesGroup {
  key: string
  title: string
  mediaId: number | null
  cover: string | null
  isMovieGroup: boolean
  totalBytes: number
  seasons: { season: number; label: string; items: LibraryItem[] }[]
}

export default function DownloadedPage() {
  const { items, stats, loading } = useLibrary()
  const artwork = useArtwork()
  const player = usePlayer()
  const openDetail = useDetail()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [kind, setKind] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [rescanBusy, setRescanBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null)
  const [subBusyId, setSubBusyId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>('movie')
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>(undefined)
  const [pageDrag, setPageDrag] = useState(false)
  const [imdbTarget, setImdbTarget] = useState<{
    label: string
    targetType: ArtworkTargetType
    targetKey: string
    initialImdbId?: string | null
    searchHint?: string | null
    allowApplyTitle?: boolean
    defaultAsMovie?: boolean
  } | null>(null)
  const [mediaMap, setMediaMap] = useState<Map<number, Media>>(() => new Map())

  useEffect(() => {
    const up = searchParams.get('upload')
    if (up === 'movie' || up === 'episode' || up === 'unknown' || up === '1') {
      setUploadCategory(up === 'episode' ? 'episode' : up === 'unknown' ? 'unknown' : 'movie')
      setDroppedFiles(undefined)
      setUploadOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('upload')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  function openUpload(cat?: UploadCategory, files?: File[]) {
    const resolved: UploadCategory =
      cat ?? (kind === 'episodes' ? 'episode' : kind === 'unknown' ? 'unknown' : 'movie')
    setUploadCategory(resolved)
    setDroppedFiles(files)
    setUploadOpen(true)
  }

  // Optional poster enrichment for items without stored cover; fails silently offline.
  useEffect(() => {
    const missingIds = [
      ...new Set(
        items
          .filter((i) => i.mediaId && !i.cover && !mediaMap.has(i.mediaId))
          .map((i) => i.mediaId as number),
      ),
    ].slice(0, 50)
    if (missingIds.length === 0) return
    let alive = true
    api
      .mediaMany(missingIds)
      .then(({ media }) => {
        if (!alive || media.length === 0) return
        setMediaMap((prev) => {
          const next = new Map(prev)
          for (const m of media) next.set(m.id, m)
          return next
        })
      })
      .catch(() => {
        /* completely fine offline */
      })
    return () => {
      alive = false
    }
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (kind === 'episodes' && (!item.known || item.isMovie)) return false
      if (kind === 'movies' && (!item.known || !item.isMovie)) return false
      if (kind === 'unknown' && item.known) return false
      if (!q) return true
      const code = formatEpisodeCode(item.season, item.episode).toLowerCase()
      return (
        item.fileName.toLowerCase().includes(q) ||
        item.folder.toLowerCase().includes(q) ||
        (item.seriesTitle?.toLowerCase().includes(q) ?? false) ||
        (item.animeTitle?.toLowerCase().includes(q) ?? false) ||
        code.includes(q)
      )
    })
  }, [items, kind, query])

  const { seriesGroups, unknownItems } = useMemo(() => {
    const groupMap = new Map<string, { title: string; mediaId: number | null; cover: string | null; isMovieGroup: boolean; totalBytes: number; bySeason: Map<number, LibraryItem[]> }>()
    const unknowns: LibraryItem[] = []

    for (const item of filtered) {
      if (!item.known) {
        unknowns.push(item)
        continue
      }
      const title = item.seriesTitle || item.animeTitle || item.fileName
      const key = title.toLowerCase()
      let group = groupMap.get(key)
      if (!group) {
        const coverFromApi = item.mediaId ? mediaMap.get(item.mediaId)?.cover ?? null : null
        group = {
          title,
          mediaId: item.mediaId,
          cover: item.cover || coverFromApi,
          isMovieGroup: item.isMovie,
          totalBytes: 0,
          bySeason: new Map(),
        }
        groupMap.set(key, group)
      } else {
        if (!group.cover) {
          group.cover = item.cover || (item.mediaId ? mediaMap.get(item.mediaId)?.cover ?? null : null)
        }
        if (!group.mediaId && item.mediaId) group.mediaId = item.mediaId
        if (!item.isMovie) group.isMovieGroup = false
      }
      group.totalBytes += item.size
      const s = item.season ?? 1
      const list = group.bySeason.get(s) ?? []
      list.push(item)
      group.bySeason.set(s, list)
    }

    const groups: SeriesGroup[] = [...groupMap.entries()]
      .map(([key, g]) => ({
        key,
        title: g.title,
        mediaId: g.mediaId,
        cover: g.cover,
        isMovieGroup: g.isMovieGroup,
        totalBytes: g.totalBytes,
        seasons: [...g.bySeason.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([season, list]) => ({
            season,
            label: `Season ${String(season).padStart(2, '0')}`,
            items: list.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0) || a.fileName.localeCompare(b.fileName)),
          })),
      }))
      .sort((a, b) => a.title.localeCompare(b.title))

    return { seriesGroups: groups, unknownItems: unknowns }
  }, [filtered, mediaMap])

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onRescan() {
    setRescanBusy(true)
    try {
      await refreshLibrary(true)
      toast('Library rescanned')
    } finally {
      setRescanBusy(false)
    }
  }

  async function onDeleteOne(item: LibraryItem) {
    setDeleteBusy(item.id)
    try {
      await deleteLibraryFile(item.id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      toast(`Deleted ${item.fileName} from local library`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete local file', 'err')
    } finally {
      setDeleteBusy(null)
    }
  }

  async function onBulkDelete() {
    if (selected.size === 0) return
    setDeleteBusy('bulk')
    try {
      const res = await bulkDeleteLibraryFiles([...selected])
      setSelected(new Set())
      setSelectMode(false)
      toast(`Deleted ${res.deleted.length} local file${res.deleted.length === 1 ? '' : 's'} (anime metadata preserved)`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Bulk delete failed', 'err')
    } finally {
      setDeleteBusy(null)
    }
  }

  async function onAttachSubtitle(item: LibraryItem, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setSubBusyId(item.id)
    try {
      await api.uploadLibrarySubtitle(item.id, file)
      await refreshLibrary(true)
      toast(`Attached subtitle "${file.name}" to ${item.fileName}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not attach subtitle', 'err')
    } finally {
      setSubBusyId(null)
    }
  }

  const tabs: { key: KindFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: stats.totalFiles },
    { key: 'episodes', label: 'Episodes', count: stats.episodeCount },
    { key: 'movies', label: 'Movies', count: stats.movieCount },
    { key: 'unknown', label: 'Unsorted Videos', count: stats.unknownCount },
  ]

  return (
    <div
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes('Files')) {
          ev.preventDefault()
          if (!uploadOpen) setPageDrag(true)
        }
      }}
      onDragLeave={(ev) => {
        if (ev.currentTarget === ev.target) setPageDrag(false)
      }}
      onDrop={(ev) => {
        if (ev.dataTransfer.files?.length && !uploadOpen) {
          ev.preventDefault()
          setPageDrag(false)
          openUpload(undefined, Array.from(ev.dataTransfer.files))
        }
      }}
    >
      <DownloadsTabs />

      {pageDrag && !uploadOpen ? (
        <div
          onDragLeave={() => setPageDrag(false)}
          className="mb-4 rounded-xl border-2 border-dashed border-accent bg-accent/12 px-4 py-5 text-center text-sm font-medium text-accent"
        >
          Drop your movie or video file anywhere to start a resumable upload
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">
            Shared Media Library
          </h1>
          <p className="mt-0.5 text-xs text-white/40">
            {stats.totalFiles > 0
              ? `${stats.totalFiles} file${stats.totalFiles === 1 ? '' : 's'} (${formatBytes(stats.totalBytes)}) · plays directly from this server without internet`
              : 'Downloaded episodes, your uploaded movies, and local video files stored on this server'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openUpload()}
            title="Upload your own movie, episode, or video file (resumable chunked transfer — no 413 errors)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600"
          >
            <Upload size={13} />
            Upload Movie / Video
          </button>

          <Link
            to="/downloads?bulk=1"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/35 transition hover:bg-accent/25"
          >
            <FolderDown size={13} />
            Bulk Download Season
          </Link>

          <button
            type="button"
            onClick={() =>
              setImdbTarget({
                label: 'AnimeVault App (Banner, Icon & Cover)',
                targetType: 'app',
                targetKey: 'global',
                initialImdbId: artwork.app?.imdbId,
              })
            }
            title="Claim a banner, poster, or icon photo from IMDb using a tt0234144 ID"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/12 px-2.5 py-1.5 text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 transition hover:bg-amber-400/22"
          >
            <ImagePlus size={13} className="text-amber-300" />
            IMDb Banner / Icon
          </button>

          <button
            type="button"
            disabled={rescanBusy}
            onClick={() => void onRescan()}
            title="Scan the shared library directory for newly added files"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1.5 text-xs font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={13} className={rescanBusy ? 'animate-spin' : ''} />
            Rescan
          </button>

          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => {
                  if (v) setSelected(new Set())
                  return !v
                })
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ${
                selectMode
                  ? 'bg-accent/15 text-accent ring-accent/40'
                  : 'bg-white/6 text-white/75 ring-white/10 hover:bg-white/10 hover:text-white'
              }`}
            >
              <CheckSquare size={13} />
              Select
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <UploadQueuePanel onPlayItem={(item) => player.open(localItemToPlayback(item))} />
      </div>

      <UploadVideoModal
        open={uploadOpen}
        initialCategory={uploadCategory}
        initialFiles={droppedFiles}
        onClose={() => {
          setUploadOpen(false)
          setDroppedFiles(undefined)
        }}
        onQueued={(count, cat) => {
          toast(
            `Uploading ${count} ${cat === 'movie' ? (count === 1 ? 'movie' : 'movies') : count === 1 ? 'video' : 'videos'} in resumable chunks`,
          )
        }}
      />

      {imdbTarget ? (
        <ImdbArtworkModal
          open
          onClose={() => setImdbTarget(null)}
          targetLabel={imdbTarget.label}
          targetType={imdbTarget.targetType}
          targetKey={imdbTarget.targetKey}
          initialImdbId={imdbTarget.initialImdbId}
          searchHint={imdbTarget.searchHint}
          allowApplyTitle={imdbTarget.allowApplyTitle}
          defaultAsMovie={imdbTarget.defaultAsMovie}
        />
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setKind(tab.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition ${
                kind === tab.key
                  ? 'bg-white/12 font-medium text-white ring-1 ring-white/15'
                  : 'text-white/45 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              {tab.label}
              <span className="text-[10px] opacity-65 tabular-nums">{tab.count}</span>
            </button>
          ))}
        </div>

        {items.length > 0 ? (
          <div className="relative w-full max-w-xs">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/35"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter library…"
              aria-label="Filter downloaded library"
              className="w-full rounded-lg bg-ink-900 py-1.5 pr-3 pl-8 text-xs text-white placeholder:text-white/30 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
          </div>
        ) : null}
      </div>

      {selectMode && filtered.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-ink-900 px-3 py-2 text-xs ring-1 ring-white/8">
          <span className="text-white/70">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => setSelected(new Set(filtered.map((i) => i.id)))}
            className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/70 ring-1 ring-white/10 hover:text-white"
          >
            Select all shown
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/70 ring-1 ring-white/10 hover:text-white"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || deleteBusy === 'bulk'}
            onClick={() => void onBulkDelete()}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-200 ring-1 ring-red-500/30 transition hover:bg-red-500/25 disabled:opacity-40"
          >
            {deleteBusy === 'bulk' ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            Delete local files ({selected.size})
          </button>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-ink-900" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-xl bg-ink-900 p-10 text-center ring-1 ring-white/5">
          <HardDrive size={30} className="mx-auto text-white/20" />
          <h2 className="mt-3 text-sm font-medium text-white/70">
            {items.length === 0 ? 'Your shared library is empty' : 'No matching local files'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/40">
            {items.length === 0
              ? 'Downloaded episodes are saved automatically under Anime Name / Season 01 / Anime Name - S01E01.mp4. You can also place or import any MP4 file into the library folder to stream it or send it to your devices.'
              : 'Try a different filter or search query.'}
          </p>
          {items.length === 0 ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => openUpload('movie')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
              >
                <Upload size={13} />
                Upload a Movie or Video
              </button>
              <Link
                to="/downloads?bulk=1"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-4 py-2 text-xs font-medium text-white/85 ring-1 ring-white/12 transition hover:bg-white/12"
              >
                <FolderDown size={13} className="text-accent" />
                Bulk Download a Season
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {seriesGroups.map((group) => {
            const allGroupItems = group.seasons.flatMap((s) => s.items)
            const totalEps = allGroupItems.length
            const groupArt = artworkForSeriesGroup(
              artwork,
              group.title,
              group.mediaId,
              allGroupItems.map((i) => i.id),
            )
            const bannerSlot = groupArt?.banner ?? null
            const posterSrc = groupArt?.poster
              ? `${groupArt.poster.url}?v=${groupArt.poster.updatedAt}`
              : group.cover ||
                (artwork.app?.poster
                  ? `${artwork.app.poster.url}?v=${artwork.app.poster.updatedAt}`
                  : null)
            const iconSlot = groupArt?.icon ?? null
            const groupImdbId =
              groupArt?.imdbId || allGroupItems.find((i) => i.imdbId)?.imdbId || null

            return (
              <section
                key={group.key}
                className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-white/6"
              >
                <div className="relative overflow-hidden border-b border-white/6 bg-ink-850/60">
                  {bannerSlot ? (
                    <div className="relative h-32 w-full sm:h-44">
                      <img
                        src={`${bannerSlot.url}?v=${bannerSlot.updatedAt}`}
                        alt=""
                        loading="lazy"
                        className={`h-full w-full object-cover ${focusObjectClass(bannerSlot.focus)}`}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/55 to-black/15" />
                    </div>
                  ) : null}

                  <div
                    className={`relative flex flex-wrap items-end gap-3.5 px-4 py-3 ${
                      bannerSlot ? '-mt-14 pt-0' : 'items-center'
                    }`}
                  >
                    <div
                      className={`shrink-0 overflow-hidden rounded-lg bg-ink-800 shadow-lg ring-1 ring-white/15 ${
                        bannerSlot ? 'h-20 w-14' : 'h-14 w-10'
                      }`}
                    >
                      {posterSrc ? (
                        <img
                          src={posterSrc}
                          alt=""
                          loading="lazy"
                          className={`h-full w-full object-cover ${focusObjectClass(groupArt?.poster?.focus)}`}
                        />
                      ) : (
                        <span className="grid h-full place-items-center text-white/25">
                          <Film size={15} />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {iconSlot ? (
                          <img
                            src={`${iconSlot.url}?v=${iconSlot.updatedAt}`}
                            alt=""
                            className={`h-6 w-6 shrink-0 rounded-md object-cover ring-1 ring-white/20 ${focusObjectClass(iconSlot.focus)}`}
                          />
                        ) : null}
                        {group.mediaId ? (
                          <button
                            type="button"
                            onClick={() => openDetail(group.mediaId!)}
                            className="truncate text-left text-base font-semibold text-white transition hover:text-accent"
                          >
                            {group.title}
                          </button>
                        ) : (
                          <h2 className="truncate text-base font-semibold text-white">{group.title}</h2>
                        )}
                        {group.isMovieGroup ? (
                          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            Movie
                          </span>
                        ) : null}
                        {groupImdbId ? (
                          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                            {groupImdbId}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-white/45">
                        {group.isMovieGroup
                          ? `${totalEps} movie file${totalEps === 1 ? '' : 's'} · ${formatBytes(group.totalBytes)}`
                          : `${group.seasons.length} season${group.seasons.length === 1 ? '' : 's'} · ${totalEps} file${totalEps === 1 ? '' : 's'} · ${formatBytes(group.totalBytes)}`}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setImdbTarget({
                          label: group.title,
                          targetType: group.mediaId ? 'media' : 'series',
                          targetKey: group.mediaId ? String(group.mediaId) : group.title,
                          initialImdbId: groupImdbId,
                          searchHint: group.title,
                          defaultAsMovie: group.isMovieGroup,
                        })
                      }
                      title="Claim banner, poster, or icon photo from IMDb using a tt… number"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1.5 text-[11px] font-medium text-white/85 ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-white/15 hover:text-amber-200"
                    >
                      <ImagePlus size={12} className="text-amber-300" />
                      IMDb Photo
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-white/5">
                  {group.seasons.map((seasonBlock) => (
                    <div key={seasonBlock.season} className="px-4 py-3">
                      {!group.isMovieGroup ? (
                        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                          <Folder size={12} className="text-accent/80" />
                          {seasonBlock.label}
                          <span className="font-normal text-white/30 normal-case">
                            ({seasonBlock.items.length})
                          </span>
                        </h3>
                      ) : null}

                      <div className="space-y-1.5">
                        {seasonBlock.items.map((item) => (
                          <LibraryFileRow
                            key={item.id}
                            item={item}
                            selectMode={selectMode}
                            checked={selected.has(item.id)}
                            busy={deleteBusy === item.id}
                            subBusy={subBusyId === item.id}
                            onToggle={() => toggleItem(item.id)}
                            onPlay={() => player.open(localItemToPlayback(item))}
                            onAttachSub={(ev) => void onAttachSubtitle(item, ev)}
                            onDelete={() => void onDeleteOne(item)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}

          {unknownItems.length > 0 ? (
            <section className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-white/6">
              <div className="flex items-center justify-between gap-2 border-b border-white/6 bg-ink-850/60 px-4 py-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <FileVideo size={15} className="text-accent" />
                    Unknown &amp; Unmatched Media Files
                  </h2>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    Standalone MP4 and video files in the shared library — stream in-browser or download to
                    any client device
                  </p>
                </div>
                <span className="rounded-full bg-white/6 px-2.5 py-0.5 text-[11px] text-white/55 tabular-nums">
                  {unknownItems.length}
                </span>
              </div>

              <div className="space-y-1.5 p-4">
                {unknownItems.map((item) => (
                  <LibraryFileRow
                    key={item.id}
                    item={item}
                    iconUrl={(() => {
                      const art = artworkForLibraryItem(artwork, item)
                      const pick = art?.icon ?? art?.poster
                      return pick ? `${pick.url}?v=${pick.updatedAt}` : null
                    })()}
                    selectMode={selectMode}
                    checked={selected.has(item.id)}
                    busy={deleteBusy === item.id}
                    subBusy={subBusyId === item.id}
                    onToggle={() => toggleItem(item.id)}
                    onPlay={() => player.open(localItemToPlayback(item))}
                    onClaimImdb={() =>
                      setImdbTarget({
                        label: item.fileName,
                        targetType: 'file',
                        targetKey: item.id,
                        initialImdbId: item.imdbId,
                        searchHint: item.fileName.replace(/\.[^.]+$/, ''),
                        allowApplyTitle: true,
                        defaultAsMovie: true,
                      })
                    }
                    onAttachSub={(ev) => void onAttachSubtitle(item, ev)}
                    onDelete={() => void onDeleteOne(item)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function LibraryFileRow({
  item,
  iconUrl,
  selectMode,
  checked,
  busy,
  subBusy,
  onToggle,
  onPlay,
  onClaimImdb,
  onAttachSub,
  onDelete,
}: {
  item: LibraryItem
  iconUrl?: string | null
  selectMode: boolean
  checked: boolean
  busy: boolean
  subBusy: boolean
  onToggle: () => void
  onPlay: () => void
  onClaimImdb?: () => void
  onAttachSub: (ev: ChangeEvent<HTMLInputElement>) => void
  onDelete: () => void
}) {
  const code =
    item.known && !item.isMovie && item.episode ? formatEpisodeCode(item.season, item.episode) : null

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 transition ${
        checked
          ? 'bg-accent/10 ring-accent/40'
          : 'bg-white/[0.025] ring-white/6 hover:bg-white/[0.05]'
      }`}
    >
      {selectMode ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Select ${item.fileName}`}
          className="shrink-0 text-white/55 transition hover:text-accent"
        >
          {checked ? <CheckSquare size={15} className="text-accent" /> : <Square size={15} />}
        </button>
      ) : null}

      <button
        type="button"
        onClick={selectMode ? onToggle : onPlay}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left"
      >
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="h-6 w-6 shrink-0 rounded object-cover ring-1 ring-white/15"
          />
        ) : null}
        {code ? (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-300 tabular-nums">
            {code}
          </span>
        ) : (
          <span className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white/70">
            {item.container}
          </span>
        )}

        <span className="min-w-0 truncate text-xs font-medium text-white/90 sm:text-[13px]">
          {item.fileName}
        </span>

        {item.isMovie ? (
          <span className="rounded bg-accent/12 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            Movie
          </span>
        ) : null}

        {item.quality ? (
          <span className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-white/60">
            {formatQualityLabel(item.quality, item.resolvedHeight)}
          </span>
        ) : null}

        {item.dub ? (
          <span className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-white/60">Dub</span>
        ) : null}

        {item.hasSubtitle ? (
          <span
            title="WebVTT subtitles available offline"
            className="inline-flex items-center gap-0.5 rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-white/60"
          >
            <Captions size={10} />
            CC
          </span>
        ) : null}

        {!item.known && item.folder ? (
          <span className="hidden truncate text-[11px] text-white/30 md:inline">
            in {item.folder}
          </span>
        ) : null}
      </button>

      <span
        title={`Saved ${exactDate(item.addedAt)}`}
        className="hidden shrink-0 text-[11px] text-white/45 tabular-nums sm:inline"
      >
        {formatBytes(item.size)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onPlay}
          title="Play directly from shared library"
          className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-black transition hover:bg-accent-600"
        >
          <Play size={11} className="fill-current" />
          <span className="hidden sm:inline">Play</span>
        </button>

        {onClaimImdb ? (
          <button
            type="button"
            onClick={onClaimImdb}
            title="Claim banner, poster, or icon from IMDb (tt…)"
            className="inline-flex items-center gap-1 rounded-md bg-white/6 px-2 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-white/10 transition hover:bg-amber-400/20"
          >
            <ImagePlus size={12} className="text-amber-300" />
          </button>
        ) : null}

        <label
          title={item.hasSubtitle ? 'Replace subtitle (.srt/.vtt/.ass)' : 'Attach subtitle (.srt/.vtt/.ass)'}
          className={`inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/6 px-2 py-1 text-[11px] font-medium text-white/70 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white ${
            subBusy ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          {subBusy ? <Loader2 size={12} className="animate-spin" /> : <Subtitles size={12} />}
          <input
            type="file"
            accept=".vtt,.srt,.ass,.ssa"
            className="hidden"
            onChange={onAttachSub}
          />
        </label>

        <a
          href={api.localDownloadUrl(item.id)}
          download={item.fileName}
          title="Send MP4 file to this client device"
          aria-label={`Download ${item.fileName} to client`}
          className="inline-flex items-center gap-1 rounded-md bg-white/6 px-2 py-1 text-[11px] font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
        >
          <Download size={12} />
          <span className="hidden lg:inline">Save</span>
        </a>

        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          title="Delete local file (preserves anime metadata & bookmarks)"
          aria-label={`Delete ${item.fileName}`}
          className="rounded-md p-1.5 text-white/40 transition hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>
    </div>
  )
}
