import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import {
  Bookmark,
  BookmarkCheck,
  Check,
  CheckSquare,
  Clock,
  Download,
  ExternalLink,
  FolderDown,
  HardDrive,
  ImagePlus,
  Layers,
  Loader2,
  Play,
  Radio,
  RotateCw,
  Search,
  Square,
  Star,
  Trash2,
  Tv,
  X,
} from 'lucide-react'
import type {
  BulkSeasonSpec,
  DownloadJob,
  LibraryItem,
  Media,
  MediaDetail,
  ProviderSearchResult,
} from '../types'
import { api } from '../lib/api'
import { artworkForMedia, focusObjectClass, useArtwork } from '../lib/artwork'
import { toggleBookmark, useBookmarks } from '../lib/bookmarks'
import {
  cancelDownload,
  deleteLibraryFile,
  enqueueBulkDownload,
  enqueueDownload,
  localFilesForMedia,
  retryDownload,
  useDownloads,
  useLibrary,
} from '../lib/downloads'
import { useSettings } from '../lib/settings'
import { seasonKeyFor } from '../lib/progress'
import {
  clampEpisode,
  formatBytes,
  formatEpisodeCode,
  formatMediaType,
  formatQualityLabel,
  formatSeason,
  formatSpeed,
  inferSeasonFromTitle,
  pickSharedSeriesTitle,
  relativeTime,
  safeExternalHref,
} from '../lib/format'
import { ImdbArtworkModal } from './ImdbArtworkModal'
import { localItemToPlayback, usePlayer } from './Player'
import { useToast } from './Toasts'

const QUALITY_OPTIONS = [
  { value: 'best', label: 'Best' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: 'worst', label: 'Lowest' },
]

type OpenFn = (media: Media | number, opts?: { watch?: boolean }) => void
const DetailContext = createContext<OpenFn>(() => {})

export function useDetail() {
  return useContext(DetailContext)
}

export function DetailProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<{ target: Media | number; watch: boolean } | null>(null)

  const open = useCallback<OpenFn>((target, opts) => {
    setSelection({ target, watch: Boolean(opts?.watch) })
  }, [])

  return (
    <DetailContext.Provider value={open}>
      {children}
      {selection ? (
        <DetailSheet
          target={selection.target}
          initialWatch={selection.watch}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </DetailContext.Provider>
  )
}

function DetailSheet({
  target,
  initialWatch,
  onClose,
}: {
  target: Media | number
  initialWatch: boolean
  onClose: () => void
}) {
  const id = typeof target === 'number' ? target : target.id
  const [media, setMedia] = useState<Media | null>(typeof target === 'object' ? target : null)
  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [episode, setEpisode] = useState(1)
  const [season, setSeason] = useState(1)
  const [selectedQuality, setSelectedQuality] = useState('best')
  const [watchBusy, setWatchBusy] = useState(false)
  const [downloadBusyEp, setDownloadBusyEp] = useState<number | null>(null)
  const [bulkBusy, setBulkBusy] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(() => new Set())
  const [showRange, setShowRange] = useState(false)
  const [rangeStart, setRangeStart] = useState(1)
  const [rangeEnd, setRangeEnd] = useState(1)
  const [providerQuery, setProviderQuery] = useState('')
  const [providerIndex, setProviderIndex] = useState(1)
  const [providerResults, setProviderResults] = useState<ProviderSearchResult[]>([])
  const [providerTitle, setProviderTitle] = useState<string | null>(null)
  const [providerEpCount, setProviderEpCount] = useState<number | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [imdbOpen, setImdbOpen] = useState(false)

  const autoWatched = useRef(false)
  const toast = useToast()
  const bookmarks = useBookmarks()
  const player = usePlayer()
  const settings = useSettings()
  const downloads = useDownloads()
  const libraryStore = useLibrary()
  const artwork = useArtwork()
  const mediaArt = artworkForMedia(artwork, media)
  const bannerUrl = mediaArt?.banner
    ? `${mediaArt.banner.url}?v=${mediaArt.banner.updatedAt}`
    : media?.banner ?? null
  const posterUrl = mediaArt?.poster
    ? `${mediaArt.poster.url}?v=${mediaArt.poster.updatedAt}`
    : media?.cover ?? null
  const iconSlot = mediaArt?.icon ?? null
  const saved = media ? bookmarks.some((b) => b.mediaId === media.id) : false

  useEffect(() => {
    setSelectedQuality(settings.quality || 'best')
  }, [settings.quality])

  const localEpisodes = useMemo(
    () => localFilesForMedia(libraryStore.items, media),
    [libraryStore.items, media],
  )

  const localByEpisode = useMemo(() => {
    const map = new Map<number, LibraryItem>()
    for (const item of localEpisodes) {
      if (item.episode == null) continue
      // Prefer exact selected season match, else fall back to any matching episode for this mediaId.
      if (!map.has(item.episode) || item.season === season) {
        map.set(item.episode, item)
      }
    }
    return map
  }, [localEpisodes, season])

  const jobByEpisode = useMemo(() => {
    const map = new Map<number, DownloadJob>()
    if (!media) return map
    const baseSeries = inferSeasonFromTitle(media.title).seriesTitle.toLowerCase()
    for (const job of downloads.jobs) {
      const sameShow =
        (job.mediaId != null && job.mediaId === media.id) ||
        (job.mediaId == null && job.seriesTitle.toLowerCase() === baseSeries && job.season === season)
      if (!sameShow) continue
      if (job.season !== season && job.mediaId !== media.id) continue
      if (job.status === 'completed' || job.status === 'cancelled') continue
      if (!map.has(job.episode)) map.set(job.episode, job)
    }
    return map
  }, [downloads.jobs, media, season])

  const maxLocalEp = useMemo(
    () => localEpisodes.reduce((max, item) => Math.max(max, item.episode ?? 0), 0),
    [localEpisodes],
  )

  const aired = Math.max(media?.airedEpisodes || 0, providerEpCount || 0, maxLocalEp)
  const maxEpisode = Math.max(aired, media?.episodes ?? 0, 1)
  const episodeList = useMemo(
    () => Array.from({ length: Math.min(maxEpisode, 500) }, (_, i) => i + 1),
    [maxEpisode],
  )

  useEffect(() => {
    setRangeEnd(Math.min(Math.max(aired, 1), 500))
  }, [aired])

  useEffect(() => {
    let alive = true
    api
      // Fetch the same enriched payload the standalone page uses so the modal
      // and the route never disagree about episodes or relations.
      .detail(id)
      .then((data) => {
        if (!alive) return
        setDetail(data)
        setMedia(data)
        setEpisode(Math.max(1, data.airedEpisodes || 1))
      })
      .catch((err: unknown) => {
        if (!alive) return
        // Keep cached/local view usable when offline.
        if (!media) setError(err instanceof Error ? err.message : 'Could not load details')
      })
    return () => {
      alive = false
    }
  }, [id])

  // Initialize season, provider query, and remembered search match per show.
  useEffect(() => {
    if (!media) return
    const inferred = inferSeasonFromTitle(media.title)
    setSeason(inferred.season)
    setProviderQuery(media.title)
    setProviderIndex(settings.resultIndex || 1)
    setProviderTitle(null)
    setProviderResults([])
    setProviderEpCount(null)
    setSelectedEpisodes(new Set())
    setSelectMode(false)
    let alive = true
    api
      .resolverMatch(media.id)
      .then(({ match }) => {
        if (!alive || !match) return
        setProviderQuery(match.query)
        setProviderIndex(match.index)
        setProviderTitle(match.title || null)
      })
      .catch(() => {
        /* a missing saved match is fine */
      })
    return () => {
      alive = false
    }
  }, [media?.id, settings.resultIndex])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  // "Watch episode" from a card launches the latest episode immediately
  // (automatically using the local copy if already downloaded).
  useEffect(() => {
    if (initialWatch && media && !libraryStore.loading && !autoWatched.current) {
      autoWatched.current = true
      const targetEp = Math.max(1, media.airedEpisodes || maxLocalEp || 1)
      void onWatch(targetEp)
    }
  }, [initialWatch, media?.id, libraryStore.loading])

  async function onBookmark() {
    if (!media) return
    try {
      await toggleBookmark(media)
      toast(saved ? 'Removed from bookmarks' : 'Added to bookmarks')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  function playLocal(item: LibraryItem) {
    // AV-153: carry the stable identity so the player can store playback
    // progress under the same keys the detail page's marks use.
    player.open({
      ...localItemToPlayback(item),
      mediaId: media?.id ?? item.mediaId ?? null,
      seasonKey: seasonKeyFor(media?.season, media?.seasonYear),
    })
    onClose()
  }

  /**
   * Plays an episode: prefers the local shared library copy when available,
   * and falls back to live streaming automatically when no local copy exists.
   */
  async function onWatch(n: number, opts?: { forceRemote?: boolean }) {
    if (!media) return
    const ep = clampEpisode(n, maxEpisode)
    setEpisode(ep)

    const localCopy = localByEpisode.get(ep)
    if (localCopy && settings.preferLocalPlayback && !opts?.forceRemote) {
      playLocal(localCopy)
      return
    }

    const query = providerQuery.trim() || media.title
    setWatchBusy(true)
    try {
      await api.watch({
        query,
        resultIndex: providerIndex,
        episode: ep,
        quality: selectedQuality,
        dub: settings.dub,
        mediaId: media.id,
        title: providerTitle ?? undefined,
      })
      player.open({
        kind: 'live',
        title: media.title,
        episode: ep,
        query,
        resultIndex: providerIndex,
        quality: selectedQuality,
        dub: settings.dub,
        mediaId: media.id,
        seasonKey: seasonKeyFor(media.season, media.seasonYear),
      })
      onClose()
    } catch (err) {
      // If streaming failed and a local copy exists despite preferLocalPlayback=false, offer it directly.
      if (localCopy && !opts?.forceRemote) {
        playLocal(localCopy)
        return
      }
      toast(err instanceof Error ? err.message : 'Could not start the stream', 'err')
    } finally {
      setWatchBusy(false)
    }
  }

  async function onDownloadEpisode(n: number) {
    if (!media) return
    const ep = clampEpisode(n, Math.max(maxEpisode, 9999))
    const query = providerQuery.trim() || media.title
    setDownloadBusyEp(ep)
    try {
      const result = await enqueueDownload({
        sourceType: 'resolver',
        mediaId: media.id,
        animeTitle: media.title,
        query,
        resultIndex: providerIndex,
        providerTitle: providerTitle ?? undefined,
        season,
        episode: ep,
        quality: selectedQuality,
        dub: settings.dub,
        format: media.format,
        cover: media.cover,
        durationMinutes: media.duration,
      })
      const code = formatEpisodeCode(season, ep)
      if (result.status === 'already_downloaded') {
        toast(`${code} is already in your local library`)
      } else if (result.status === 'already_queued') {
        toast(`${code} is already in the download queue`)
      } else {
        toast(`Queued ${media.title} ${code} (${formatQualityLabel(selectedQuality)})`)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue download', 'err')
    } finally {
      setDownloadBusyEp(null)
    }
  }

  async function onCancelJob(job: DownloadJob) {
    try {
      await cancelDownload(job.id)
      toast(`Cancelled ${job.code}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not cancel download', 'err')
    }
  }

  async function onRetryJob(job: DownloadJob) {
    try {
      await retryDownload(job.id)
      toast(`Retrying ${job.code}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not retry download', 'err')
    }
  }

  async function onDeleteLocal(item: LibraryItem) {
    const label = item.episode ? formatEpisodeCode(item.season, item.episode) : item.fileName
    try {
      await deleteLibraryFile(item.id)
      toast(`Deleted local copy of ${label}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete local file', 'err')
    }
  }

  function formatBulkSummary(res: { queuedCount: number; skippedDownloaded: number; skippedQueued: number }) {
    const parts: string[] = []
    if (res.queuedCount > 0) {
      parts.push(`Queued ${res.queuedCount} episode${res.queuedCount === 1 ? '' : 's'}`)
    } else {
      parts.push('Nothing new to queue')
    }
    if (res.skippedDownloaded > 0) parts.push(`${res.skippedDownloaded} already downloaded`)
    if (res.skippedQueued > 0) parts.push(`${res.skippedQueued} already queued`)
    return parts.join(' · ')
  }

  async function onDownloadSelected() {
    if (!media || selectedEpisodes.size === 0) return
    const query = providerQuery.trim() || media.title
    setBulkBusy('selected')
    try {
      const res = await enqueueBulkDownload({
        mode: 'episodes',
        mediaId: media.id,
        animeTitle: media.title,
        query,
        resultIndex: providerIndex,
        providerTitle: providerTitle ?? undefined,
        season,
        episodes: [...selectedEpisodes].sort((a, b) => a - b),
        quality: selectedQuality,
        dub: settings.dub,
        format: media.format,
        cover: media.cover,
        durationMinutes: media.duration,
      })
      toast(formatBulkSummary(res))
      setSelectedEpisodes(new Set())
      setSelectMode(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue selected episodes', 'err')
    } finally {
      setBulkBusy(null)
    }
  }

  async function onDownloadRange() {
    if (!media) return
    const start = Math.max(1, Math.floor(rangeStart || 1))
    const end = Math.max(start, Math.floor(rangeEnd || start))
    const query = providerQuery.trim() || media.title
    setBulkBusy('range')
    try {
      const res = await enqueueBulkDownload({
        mode: 'range',
        mediaId: media.id,
        animeTitle: media.title,
        query,
        resultIndex: providerIndex,
        providerTitle: providerTitle ?? undefined,
        season,
        startEpisode: start,
        endEpisode: end,
        quality: selectedQuality,
        dub: settings.dub,
        format: media.format,
        cover: media.cover,
        durationMinutes: media.duration,
      })
      toast(formatBulkSummary(res))
      setShowRange(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue episode range', 'err')
    } finally {
      setBulkBusy(null)
    }
  }

  async function onDownloadSeason() {
    if (!media) return
    const query = providerQuery.trim() || media.title
    setBulkBusy('season')
    try {
      const count = aired > 0 ? aired : media.episodes ?? undefined
      const res = await enqueueBulkDownload({
        mode: 'season',
        mediaId: media.id,
        animeTitle: media.title,
        query,
        resultIndex: providerIndex,
        providerTitle: providerTitle ?? undefined,
        season,
        episodeCount: count,
        discoverFromProvider: true,
        quality: selectedQuality,
        dub: settings.dub,
        format: media.format,
        cover: media.cover,
        durationMinutes: media.duration,
      })
      toast(formatBulkSummary(res))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue season', 'err')
    } finally {
      setBulkBusy(null)
    }
  }

  async function onDownloadSeries() {
    if (!media) return
    const query = providerQuery.trim() || media.title
    const relatedTv = (detail?.relatedSeasons ?? []).filter(
      (r) =>
        (r.format === 'TV' || r.format === 'TV_SHORT' || r.format === 'ONA' || r.format === 'OVA') &&
        (r.airedEpisodes > 0 || (r.episodes ?? 0) > 0),
    )

    setBulkBusy('series')
    try {
      if (relatedTv.length > 0) {
        // Combine current entry with linked prequel/sequel seasons in release order.
        const seasonRank: Record<string, number> = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 }
        const all = [
          {
            id: media.id,
            title: media.title,
            query,
            resultIndex: providerIndex,
            providerTitle: providerTitle ?? undefined,
            episodeCount: aired || media.episodes || 0,
            format: media.format,
            cover: media.cover,
            seasonYear: media.seasonYear,
            seasonName: media.season,
            duration: media.duration,
          },
          ...relatedTv
            .filter((r) => r.id !== media.id)
            .map((r) => ({
              id: r.id,
              title: r.title,
              query: r.title,
              resultIndex: settings.resultIndex || 1,
              providerTitle: undefined,
              episodeCount: r.airedEpisodes || r.episodes || 0,
              format: r.format,
              cover: r.cover,
              seasonYear: r.seasonYear,
              seasonName: r.season,
              duration: media.duration,
            })),
        ].sort(
          (a, b) =>
            (a.seasonYear ?? 9999) - (b.seasonYear ?? 9999) ||
            (seasonRank[a.seasonName ?? ''] ?? 9) - (seasonRank[b.seasonName ?? ''] ?? 9) ||
            a.id - b.id,
        )

        // Derive the shared series base from every known title so a franchise that
        // names seasons inconsistently ("… S2", "… II", "… Final Season) still
        // lands in one folder tree. Then number seasons by release order.
        const sharedSeries = pickSharedSeriesTitle(all.map((entry) => entry.title)) || inferSeasonFromTitle(all[0].title).seriesTitle
        const seasons: BulkSeasonSpec[] = all.map((entry, idx) => ({
          mediaId: entry.id,
          animeTitle: entry.title,
          query: entry.query,
          resultIndex: entry.resultIndex,
          providerTitle: entry.providerTitle,
          season: idx + 1,
          episodeCount: entry.episodeCount || undefined,
          discoverFromProvider: true,
          format: entry.format,
          cover: entry.cover,
          durationMinutes: entry.duration,
        }))

        const res = await enqueueBulkDownload({
          mode: 'series',
          mediaId: media.id,
          seriesTitle: sharedSeries,
          seasons,
          quality: selectedQuality,
          dub: settings.dub,
        })
        toast(formatBulkSummary(res))
      } else {
        // Single-entry series: discover the full provider episode list and queue all of them.
        const res = await enqueueBulkDownload({
          mode: 'series',
          mediaId: media.id,
          animeTitle: media.title,
          query,
          resultIndex: providerIndex,
          providerTitle: providerTitle ?? undefined,
          season,
          episodeCount: Math.max(aired, media.episodes ?? 0) || undefined,
          discoverFromProvider: true,
          quality: selectedQuality,
          dub: settings.dub,
          format: media.format,
          cover: media.cover,
          durationMinutes: media.duration,
        })
        toast(formatBulkSummary(res))
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue full series', 'err')
    } finally {
      setBulkBusy(null)
    }
  }

  async function onSearchProvider() {
    const query = providerQuery.trim()
    if (!query) return
    setSearchBusy(true)
    try {
      const { results } = await api.resolverSearch(query)
      setProviderResults(results)
      if (!results.length) {
        toast(`The provider found no matches for "${query}"`, 'err')
        return
      }
      const picked = results.find((result) => result.index === providerIndex) ?? results[0]
      setProviderIndex(picked.index)
      setProviderTitle(picked.title)
      api
        .resolverEpisodes(query, picked.index)
        .then((epRes) => {
          if (epRes.episodes.length > 0) {
            setProviderEpCount(epRes.episodes[epRes.episodes.length - 1])
          }
        })
        .catch(() => {})
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not search the provider', 'err')
    } finally {
      setSearchBusy(false)
    }
  }

  function toggleEpisodeSelect(n: number) {
    setSelectedEpisodes((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  function selectAllMissing() {
    const missing = episodeList.filter((n) => !localByEpisode.has(n) && !jobByEpisode.has(n))
    setSelectedEpisodes(new Set(missing))
    setSelectMode(true)
  }

  const currentLocal = localByEpisode.get(episode) ?? null
  const currentJob = jobByEpisode.get(episode) ?? null
  const relatedCount = (detail?.relatedSeasons ?? []).filter(
    (r) => r.format === 'TV' || r.format === 'TV_SHORT' || r.format === 'ONA' || r.format === 'OVA',
  ).length

  const meta = media
    ? [
        formatMediaType(media.format),
        formatSeason(media.season, media.seasonYear),
        media.episodes ? `${media.episodes} eps` : null,
        media.duration ? `${media.duration} min` : null,
        media.studios[0] ?? null,
      ].filter(Boolean)
    : []

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/75 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="mx-auto w-[min(1080px,calc(100%-1.5rem))] py-4 md:py-8"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="animate-slide-up overflow-hidden rounded-2xl bg-ink-900 shadow-2xl ring-1 ring-white/10">
          <div className="relative h-40 w-full overflow-hidden bg-ink-800 md:h-64">
            {bannerUrl ? (
              <img
                src={bannerUrl}
                alt=""
                className={`h-full w-full object-cover opacity-75 ${focusObjectClass(mediaArt?.banner?.focus)}`}
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent" />
            {media ? (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  window.location.assign(`/anime/${media.id}`)
                }}
                title="Open the full detail page with episode guide, relations and notes"
                className="absolute top-3 right-40 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-[11px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur transition hover:bg-black/85 hover:text-accent"
              >
                Full page
              </button>
            ) : null}
            {media ? (
              <button
                type="button"
                onClick={() => setImdbOpen(true)}
                title="Claim banner, poster, or icon photo from IMDb using a tt… number"
                className="absolute top-3 right-14 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-[11px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur transition hover:bg-black/85 hover:text-amber-200"
              >
                <ImagePlus size={13} className="text-amber-300" />
                IMDb Banner / Icon
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 rounded-full bg-black/60 p-2 text-white/80 backdrop-blur transition hover:bg-black/80 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          <div className="relative -mt-14 px-4 pb-7 md:-mt-24 md:px-7 md:pb-9">
            <div className="flex flex-col gap-4 md:flex-row md:gap-6">
              <div className="w-24 shrink-0 md:w-44">
                <div className="aspect-2/3 overflow-hidden rounded-xl bg-ink-800 shadow-xl ring-1 ring-white/10">
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={media?.title ?? ''}
                      className={`h-full w-full object-cover ${focusObjectClass(mediaArt?.poster?.focus)}`}
                    />
                  ) : null}
                </div>
              </div>

              <div className="min-w-0 flex-1 md:pt-16">
                <div className="flex items-center gap-2.5">
                  {iconSlot ? (
                    <img
                      src={`${iconSlot.url}?v=${iconSlot.updatedAt}`}
                      alt=""
                      className={`h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-white/20 md:h-9 md:w-9 ${focusObjectClass(iconSlot.focus)}`}
                    />
                  ) : null}
                  <h2 className="min-w-0 text-xl leading-tight font-semibold text-white md:text-3xl">
                    {media?.title ?? <span className="inline-block h-7 w-2/3 animate-pulse rounded bg-ink-700" />}
                  </h2>
                </div>
                {media?.romaji && media.romaji !== media.title ? (
                  <p className="mt-1 text-sm text-white/40">{media.romaji}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-white/55">
                  {media?.score ? (
                    <span className="inline-flex items-center gap-1 font-medium text-amber-300">
                      <Star size={12} className="fill-amber-300" />
                      {media.score}%
                    </span>
                  ) : null}
                  {meta.map((item) => (
                    <span key={String(item)} className="inline-flex items-center gap-2.5">
                      <span className="h-1 w-1 rounded-full bg-white/25" />
                      {item}
                    </span>
                  ))}
                  {localEpisodes.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                      <HardDrive size={11} />
                      {localEpisodes.length} downloaded
                    </span>
                  ) : null}
                  {media?.status === 'RELEASING' && media.nextEpisode ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                      <Clock size={11} />
                      EP {media.nextEpisode.episode} {relativeTime(media.nextEpisode.airingAt)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void onWatch(episode)}
                    disabled={!media || (!currentLocal && !providerQuery.trim()) || watchBusy}
                    title={
                      currentLocal && settings.preferLocalPlayback
                        ? 'Play downloaded file directly from local library'
                        : 'Stream this episode in the browser'
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {watchBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} className="fill-current" />
                    )}
                    {currentLocal && settings.preferLocalPlayback
                      ? `Play EP ${episode} (Local)`
                      : `Watch EP ${episode}`}
                  </button>

                  {currentLocal ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                      <Check size={14} />
                      Downloaded ({formatBytes(currentLocal.size)})
                    </span>
                  ) : currentJob && currentJob.status !== 'failed' ? (
                    <button
                      type="button"
                      onClick={() => void onCancelJob(currentJob)}
                      title="Cancel active download"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-200 ring-1 ring-amber-500/30 transition hover:bg-amber-500/25"
                    >
                      <Loader2
                        size={13}
                        className={currentJob.status === 'paused' ? '' : 'animate-spin'}
                      />
                      {currentJob.status === 'downloading' && currentJob.progress != null
                        ? `${Math.round(currentJob.progress)}% · Cancel`
                        : `${currentJob.status === 'paused' ? 'Paused' : 'Queued'} · Cancel`}
                    </button>
                  ) : currentJob?.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => void onRetryJob(currentJob)}
                      title={currentJob.error || 'Retry failed download'}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-medium text-red-200 ring-1 ring-red-500/30 transition hover:bg-red-500/25"
                    >
                      <RotateCw size={13} />
                      Retry EP {episode}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onDownloadEpisode(episode)}
                      disabled={!media || !providerQuery.trim() || downloadBusyEp === episode}
                      title="Download this episode to the shared local library"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {downloadBusyEp === episode ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      Download EP {episode}
                    </button>
                  )}

                  {media && media.format !== 'MOVIE' ? (
                    <button
                      type="button"
                      onClick={() => void onDownloadSeason()}
                      disabled={!providerQuery.trim() || bulkBusy !== null}
                      title={`Bulk download every available episode of Season ${String(season).padStart(2, '0')} to the local library`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent/18 px-3 py-2 text-xs font-semibold text-accent ring-1 ring-accent/45 transition hover:bg-accent/28 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {bulkBusy === 'season' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <FolderDown size={14} />
                      )}
                      Download Full Season{aired > 1 ? ` (${aired} eps)` : ''}
                    </button>
                  ) : null}

                  {media && relatedCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => void onDownloadSeries()}
                      disabled={!providerQuery.trim() || bulkBusy !== null}
                      title={`Bulk download all ${relatedCount + 1} seasons of this series`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {bulkBusy === 'series' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Layers size={14} className="text-accent" />
                      )}
                      All Seasons ({relatedCount + 1})
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void onBookmark()}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ring-1 transition ${
                      saved
                        ? 'bg-accent/15 text-accent ring-accent/40'
                        : 'bg-white/5 text-white/80 ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                    {saved ? 'Bookmarked' : 'Bookmark'}
                  </button>

                  {media ? (
                    <button
                      type="button"
                      onClick={() => setImdbOpen(true)}
                      title="Claim photo for banner, poster, or icon from IMDb (e.g. tt0234144)"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/12 px-3 py-2 text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 transition hover:bg-amber-400/22"
                    >
                      <ImagePlus size={14} className="text-amber-300" />
                      {mediaArt?.imdbId ? `IMDb (${mediaArt.imdbId})` : 'IMDb Photo'}
                    </button>
                  ) : null}

                  {safeExternalHref(media?.anidb) ? (
                    <a
                      href={safeExternalHref(media?.anidb)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={media?.anidbSearch ? 'Search this title on AniDB' : 'Open the AniDB entry'}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                    >
                      AniDB
                      <ExternalLink size={12} />
                    </a>
                  ) : null}
                  {safeExternalHref(media?.siteUrl) ? (
                    <a
                      href={safeExternalHref(media?.siteUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                    >
                      AniList
                      <ExternalLink size={12} />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            {error ? (
              <p className="mt-5 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/30">
                {error}
              </p>
            ) : null}

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1.05fr]">
              <div>
                <p className="text-sm leading-relaxed whitespace-pre-line text-white/65">
                  {media?.description || (media ? 'No synopsis available yet.' : 'Loading synopsis…')}
                </p>

                {media?.genres.length ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {media.genres.map((genre) => (
                      <span
                        key={genre}
                        className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/60 ring-1 ring-white/10"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                ) : null}

                {media?.streams.length ? (
                  <div className="mt-5">
                    <h3 className="text-[11px] font-semibold tracking-wider text-white/35 uppercase">
                      Watch legally on
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {media.streams.map((stream) => {
                        const href = safeExternalHref(stream.url)
                        if (!href) return null
                        return (
                          <a
                            key={href}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-white/70 ring-1 ring-white/10 transition hover:text-accent"
                          >
                            {stream.site}
                            <ExternalLink size={10} />
                          </a>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="h-fit rounded-xl bg-ink-850 p-4 ring-1 ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-white/80 uppercase">
                    <Play size={13} className="text-accent" />
                    Watch &amp; Download
                  </h3>
                  {currentLocal ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                      <HardDrive size={10} />
                      local ready
                    </span>
                  ) : (
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      in-app
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-white/45">Season</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={season}
                      onChange={(event) => setSeason(clampEpisode(Number(event.target.value), 99))}
                      className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] text-white/45">Episode</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(maxEpisode, 9999)}
                      value={episode}
                      onChange={(event) =>
                        setEpisode(clampEpisode(Number(event.target.value), Math.max(maxEpisode, 9999)))
                      }
                      className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] text-white/45">Quality</span>
                    <select
                      value={selectedQuality}
                      onChange={(event) => setSelectedQuality(event.target.value)}
                      className="w-full rounded-lg bg-ink-800 px-2 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                    >
                      {QUALITY_OPTIONS.map((q) => (
                        <option key={q.value} value={q.value}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-2.5">
                  <span className="mb-1 block text-[11px] text-white/45">Search title</span>
                  <div className="flex gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <Search
                        size={13}
                        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-white/30"
                      />
                      <input
                        value={providerQuery}
                        onChange={(event) => setProviderQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void onSearchProvider()
                          }
                        }}
                        placeholder="Title to search on the streaming site"
                        className="w-full rounded-lg bg-ink-800 py-2 pr-2.5 pl-8 text-sm text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void onSearchProvider()}
                      disabled={searchBusy || !providerQuery.trim()}
                      title="Search provider matches"
                      className="shrink-0 rounded-lg bg-white/5 px-2.5 text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-accent disabled:opacity-40"
                    >
                      {searchBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                    </button>
                  </div>
                </div>

                {providerResults.length ? (
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1">
                    {providerResults.map((result) => {
                      const on = result.index === providerIndex
                      return (
                        <button
                          key={result.slug}
                          type="button"
                          onClick={() => {
                            setProviderIndex(result.index)
                            setProviderTitle(result.title)
                            api
                              .resolverEpisodes(providerQuery.trim(), result.index)
                              .then((epRes) => {
                                if (epRes.episodes.length > 0) {
                                  setProviderEpCount(epRes.episodes[epRes.episodes.length - 1])
                                }
                              })
                              .catch(() => {})
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ring-1 transition ${
                            on
                              ? 'bg-accent/15 text-accent ring-accent/40'
                              : 'bg-white/[0.03] text-white/55 ring-white/10 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          <span className="shrink-0 tabular-nums opacity-60">#{result.index}</span>
                          <span className="min-w-0 flex-1 truncate">{result.title}</span>
                          {on ? <Check size={12} className="shrink-0" /> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] leading-relaxed text-white/35">
                    {providerTitle ? (
                      <>
                        Match: <span className="text-white/60">#{providerIndex} {providerTitle}</span>
                      </>
                    ) : (
                      <>Search to pick the right match. Result #{providerIndex} is used by default.</>
                    )}
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void onWatch(episode)}
                    disabled={!media || (!currentLocal && !providerQuery.trim()) || watchBusy}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-2.5 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {watchBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} className="fill-current" />
                    )}
                    {currentLocal && settings.preferLocalPlayback
                      ? `Play ${formatEpisodeCode(currentLocal.season, episode)}`
                      : `Play EP ${episode}`}
                  </button>

                  {currentLocal ? (
                    <a
                      href={api.localDownloadUrl(currentLocal.id)}
                      download={currentLocal.fileName}
                      title="Download saved MP4 file from server to this device"
                      className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-2 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25"
                    >
                      <Download size={13} />
                      Save to device
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void onDownloadEpisode(episode)}
                      disabled={
                        !media ||
                        !providerQuery.trim() ||
                        downloadBusyEp === episode ||
                        Boolean(currentJob && currentJob.status !== 'failed')
                      }
                      className="flex items-center justify-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-2 text-xs font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {downloadBusyEp === episode ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      {currentJob && currentJob.status !== 'failed'
                        ? 'In queue'
                        : `Download ${formatEpisodeCode(season, episode)}`}
                    </button>
                  )}
                </div>

                {media && media.format !== 'MOVIE' ? (
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void onDownloadSeason()}
                      disabled={!providerQuery.trim() || bulkBusy !== null}
                      title={`Queue all available episodes of Season ${String(season).padStart(2, '0')}`}
                      className="flex items-center justify-center gap-1.5 rounded-lg bg-accent/18 px-2.5 py-2 text-xs font-semibold text-accent ring-1 ring-accent/45 transition hover:bg-accent/28 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {bulkBusy === 'season' ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <FolderDown size={13} />
                      )}
                      Whole Season {String(season).padStart(2, '0')}
                      {aired > 1 ? ` (${aired})` : ''}
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDownloadSeries()}
                      disabled={!providerQuery.trim() || bulkBusy !== null}
                      title={
                        relatedCount > 0
                          ? `Queue all ${relatedCount + 1} seasons`
                          : 'Discover and queue every episode from provider'
                      }
                      className="flex items-center justify-center gap-1.5 rounded-lg bg-white/7 px-2.5 py-2 text-xs font-medium text-white/85 ring-1 ring-white/12 transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {bulkBusy === 'series' ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Layers size={13} className="text-accent" />
                      )}
                      {relatedCount > 0 ? `All ${relatedCount + 1} Seasons` : 'Full Series'}
                    </button>
                  </div>
                ) : null}

                {currentLocal ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-950/30 px-2.5 py-1.5 text-[11px] text-emerald-200/80 ring-1 ring-emerald-500/20">
                    <span className="truncate">
                      Stored locally · {formatBytes(currentLocal.size)}
                      {currentLocal.quality ? ` · ${formatQualityLabel(currentLocal.quality)}` : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onWatch(episode, { forceRemote: true })}
                        className="inline-flex items-center gap-1 text-white/55 transition hover:text-accent"
                        title="Stream from remote provider instead of local file"
                      >
                        <Radio size={11} />
                        Stream
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteLocal(currentLocal)}
                        className="inline-flex items-center gap-1 text-red-300/80 transition hover:text-red-200"
                        title="Delete local copy (keeps anime metadata & bookmarks)"
                      >
                        <Trash2 size={11} />
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}

                <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                  {settings.dub ? 'Dub' : 'Sub'} · quality{' '}
                  <span className="text-white/55">{formatQualityLabel(selectedQuality)}</span> ·{' '}
                  <Link to="/downloads" onClick={onClose} className="text-accent hover:underline">
                    queue
                  </Link>{' '}
                  ·{' '}
                  <Link to="/settings" onClick={onClose} className="text-accent hover:underline">
                    settings
                  </Link>
                </p>
              </div>
            </div>

            {media ? (
              <div className="mt-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                    <Tv size={12} />
                    Episodes {aired > 0 ? `(${aired})` : ''}
                    {localEpisodes.length > 0 ? (
                      <span className="ml-1 text-emerald-300/85 normal-case">
                        · {localEpisodes.length} local
                      </span>
                    ) : null}
                  </h3>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void onDownloadSeason()}
                      disabled={!providerQuery.trim() || bulkBusy !== null}
                      title={`Queue all episodes of Season ${String(season).padStart(2, '0')}`}
                      className="inline-flex items-center gap-1 rounded-md bg-accent/18 px-2.5 py-1.5 text-[11px] font-semibold text-accent ring-1 ring-accent/40 transition hover:bg-accent/28 disabled:opacity-40"
                    >
                      {bulkBusy === 'season' ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <FolderDown size={12} />
                      )}
                      Download Whole Season {String(season).padStart(2, '0')}
                    </button>

                    <button
                      type="button"
                      onClick={() => void onDownloadSeries()}
                      disabled={!providerQuery.trim() || bulkBusy !== null}
                      title={
                        relatedCount > 0
                          ? `Queue all ${relatedCount + 1} seasons of this series`
                          : 'Discover and queue every available episode of this series'
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-white/6 px-2.5 py-1 text-[11px] font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white disabled:opacity-40"
                    >
                      {bulkBusy === 'series' ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Layers size={11} className="text-accent" />
                      )}
                      Download Series{relatedCount > 0 ? ` (${relatedCount + 1} seasons)` : ''}
                    </button>

                    {aired > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowRange((v) => !v)}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition ${
                            showRange
                              ? 'bg-accent/15 text-accent ring-accent/40'
                              : 'bg-white/5 text-white/65 ring-white/10 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          Range
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectMode((v) => {
                              if (v) setSelectedEpisodes(new Set())
                              return !v
                            })
                          }}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition ${
                            selectMode
                              ? 'bg-accent/15 text-accent ring-accent/40'
                              : 'bg-white/5 text-white/65 ring-white/10 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <CheckSquare size={11} />
                          Select
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {showRange ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 px-3 py-2 text-xs ring-1 ring-white/10">
                    <span className="text-white/55">Episode range:</span>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={rangeStart}
                      onChange={(e) => setRangeStart(Math.max(1, Number(e.target.value) || 1))}
                      aria-label="Start episode"
                      className="w-20 rounded-md bg-ink-800 px-2 py-1 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                    />
                    <span className="text-white/35">to</span>
                    <input
                      type="number"
                      min={rangeStart}
                      max={9999}
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(Math.max(rangeStart, Number(e.target.value) || rangeStart))}
                      aria-label="End episode"
                      className="w-20 rounded-md bg-ink-800 px-2 py-1 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                    />
                    <span className="text-[11px] text-white/40">
                      ({Math.max(0, rangeEnd - rangeStart + 1)} ep{rangeEnd - rangeStart === 0 ? '' : 's'} ·{' '}
                      {formatQualityLabel(selectedQuality)})
                    </span>
                    <button
                      type="button"
                      onClick={() => void onDownloadRange()}
                      disabled={bulkBusy !== null || !providerQuery.trim()}
                      className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                    >
                      {bulkBusy === 'range' ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                      Queue range
                    </button>
                  </div>
                ) : null}

                {selectMode ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 px-3 py-2 text-xs ring-1 ring-white/10">
                    <span className="text-white/65">
                      {selectedEpisodes.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={selectAllMissing}
                      className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/65 ring-1 ring-white/10 hover:text-white"
                    >
                      Select missing
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEpisodes(new Set(episodeList))}
                      className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/65 ring-1 ring-white/10 hover:text-white"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEpisodes(new Set())}
                      className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/65 ring-1 ring-white/10 hover:text-white"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDownloadSelected()}
                      disabled={selectedEpisodes.size === 0 || bulkBusy !== null || !providerQuery.trim()}
                      className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                    >
                      {bulkBusy === 'selected' ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Download size={11} />
                      )}
                      Download {selectedEpisodes.size || ''} selected
                    </button>
                  </div>
                ) : null}

                {aired > 0 ? (
                  <div className="mt-3 grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {episodeList.map((number) => {
                      const localItem = localByEpisode.get(number)
                      const job = jobByEpisode.get(number)
                      const checked = selectedEpisodes.has(number)
                      const isCurrent = number === episode
                      const code = formatEpisodeCode(localItem?.season ?? season, number)
                      const speed = job ? formatSpeed(job.speedBps) : null

                      return (
                        <div
                          key={number}
                          className={`group relative overflow-hidden rounded-lg px-2.5 py-2 ring-1 transition ${
                            localItem
                              ? 'bg-emerald-500/[0.07] ring-emerald-500/25 hover:bg-emerald-500/[0.11]'
                              : isCurrent
                                ? 'bg-accent/10 ring-accent/35'
                                : 'bg-white/[0.03] ring-white/8 hover:bg-white/[0.06]'
                          }`}
                        >
                          {job && job.status === 'downloading' && job.progress != null ? (
                            <div
                              className="pointer-events-none absolute inset-y-0 left-0 bg-accent/12 transition-all duration-300"
                              style={{ width: `${Math.min(100, Math.max(2, job.progress))}%` }}
                            />
                          ) : null}

                          <div className="relative flex items-center gap-2">
                            {selectMode ? (
                              <button
                                type="button"
                                onClick={() => toggleEpisodeSelect(number)}
                                aria-label={`Select episode ${number}`}
                                className="shrink-0 text-white/60 transition hover:text-accent"
                              >
                                {checked ? (
                                  <CheckSquare size={15} className="text-accent" />
                                ) : (
                                  <Square size={15} />
                                )}
                              </button>
                            ) : null}

                            <button
                              type="button"
                              onClick={() =>
                                selectMode ? toggleEpisodeSelect(number) : void onWatch(number)
                              }
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                              title={
                                localItem
                                  ? `Play ${code} from local library (${formatBytes(localItem.size)})`
                                  : `Watch ${code}`
                              }
                            >
                              <span className="shrink-0 font-mono text-xs font-semibold text-white/90 tabular-nums">
                                {code}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[11px]">
                                {localItem ? (
                                  <span className="text-emerald-300">
                                    Downloaded · {formatBytes(localItem.size)}
                                    {localItem.quality ? ` · ${formatQualityLabel(localItem.quality)}` : ''}
                                  </span>
                                ) : job ? (
                                  job.status === 'downloading' ? (
                                    <span className="text-accent tabular-nums">
                                      {job.progress != null ? `${job.progress.toFixed(0)}%` : 'Downloading'}
                                      {job.downloadedBytes > 0 ? ` · ${formatBytes(job.downloadedBytes)}` : ''}
                                      {speed ? ` · ${speed}` : ''}
                                    </span>
                                  ) : job.status === 'resolving' ? (
                                    <span className="text-accent">Resolving…</span>
                                  ) : job.status === 'queued' ? (
                                    <span className="text-white/50">Queued</span>
                                  ) : job.status === 'paused' ? (
                                    <span className="text-amber-300">Paused</span>
                                  ) : job.status === 'failed' ? (
                                    <span className="text-red-300" title={job.error || undefined}>
                                      Failed{job.error ? ` — ${job.error}` : ''}
                                    </span>
                                  ) : null
                                ) : (
                                  <span className="text-white/35">Stream</span>
                                )}
                              </span>
                            </button>

                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void onWatch(number)}
                                aria-label={`Play episode ${number}`}
                                title={localItem ? 'Play local copy' : 'Stream episode'}
                                className="rounded p-1 text-white/55 transition hover:bg-white/10 hover:text-accent"
                              >
                                <Play size={13} />
                              </button>

                              {localItem ? (
                                <>
                                  <a
                                    href={api.localDownloadUrl(localItem.id)}
                                    download={localItem.fileName}
                                    aria-label={`Save episode ${number} to device`}
                                    title="Send MP4 to this device"
                                    className="rounded p-1 text-emerald-300/75 transition hover:bg-white/10 hover:text-emerald-200"
                                  >
                                    <Download size={13} />
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => void onDeleteLocal(localItem)}
                                    aria-label={`Delete local copy of episode ${number}`}
                                    title="Delete local copy"
                                    className="rounded p-1 text-white/40 transition hover:bg-red-500/15 hover:text-red-300"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              ) : job && job.status === 'failed' ? (
                                <button
                                  type="button"
                                  onClick={() => void onRetryJob(job)}
                                  aria-label={`Retry episode ${number}`}
                                  title="Retry failed download"
                                  className="rounded p-1 text-red-300 transition hover:bg-red-500/15 hover:text-red-200"
                                >
                                  <RotateCw size={13} />
                                </button>
                              ) : job ? (
                                <button
                                  type="button"
                                  onClick={() => void onCancelJob(job)}
                                  aria-label={`Cancel download of episode ${number}`}
                                  title="Cancel download"
                                  className="rounded p-1 text-amber-300 transition hover:bg-amber-500/15 hover:text-amber-200"
                                >
                                  <X size={13} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void onDownloadEpisode(number)}
                                  disabled={downloadBusyEp === number || !providerQuery.trim()}
                                  aria-label={`Download episode ${number}`}
                                  title={`Download ${code} (${formatQualityLabel(selectedQuality)})`}
                                  className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-accent disabled:opacity-35"
                                >
                                  {downloadBusyEp === number ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <Download size={13} />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-white/35">
                    No aired episode count reported yet — use Search title above or click Download Season to
                    discover episodes from the provider.
                  </p>
                )}
              </div>
            ) : null}

            {detail?.streamingEpisodes.length ? (
              <div className="mt-6">
                <h3 className="text-[11px] font-semibold tracking-wider text-white/35 uppercase">
                  Official episode pages
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.streamingEpisodes.slice(0, 12).map((ep) => {
                    const href = safeExternalHref(ep.url)
                    if (!href) return null
                    return (
                      <a
                        key={href}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:text-accent"
                      >
                        {ep.site}
                        <ExternalLink size={10} />
                      </a>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {media && imdbOpen ? (
        <ImdbArtworkModal
          open
          onClose={() => setImdbOpen(false)}
          targetLabel={media.title}
          targetType="media"
          targetKey={String(media.id)}
          initialImdbId={mediaArt?.imdbId}
          searchHint={media.title}
          defaultAsMovie={media.format === 'MOVIE'}
        />
      ) : null}
    </div>
  )
}
