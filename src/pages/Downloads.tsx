import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  Film,
  FolderDown,
  Globe,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { DownloadJob, DownloadStatus, ProviderSearchResult } from '../types'
import { api } from '../lib/api'
import {
  bulkDownloadAction,
  cancelDownload,
  deleteDownload,
  enqueueBulkDownload,
  enqueueDownload,
  pauseDownload,
  resumeDownload,
  retryDownload,
  useDownloads,
  useLibrary,
} from '../lib/downloads'
import { saveSettings, useSettings } from '../lib/settings'
import {
  formatBytes,
  formatQualityLabel,
  formatSpeed,
  inferSeasonFromTitle,
  relativeTime,
} from '../lib/format'
import { DownloadsTabs } from '../components/DownloadsTabs'
import { useDetail } from '../components/MediaModal'
import { localItemToPlayback, usePlayer } from '../components/Player'
import { UploadQueuePanel, UploadVideoModal } from '../components/UploadVideoModal'
import { useToast } from '../components/Toasts'

type FilterKey = 'all' | 'active' | 'queued' | 'paused' | 'completed' | 'failed'

const QUALITY_CHOICES = [
  { value: 'best', label: 'Best available' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: 'worst', label: 'Smallest' },
]

function statusMeta(status: DownloadStatus): { label: string; badge: string; bar: string } {
  switch (status) {
    case 'downloading':
      return {
        label: 'Downloading',
        badge: 'bg-accent/15 text-accent ring-accent/30',
        bar: 'bg-accent',
      }
    case 'resolving':
      return {
        label: 'Resolving',
        badge: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
        bar: 'bg-sky-400',
      }
    case 'queued':
      return {
        label: 'Queued',
        badge: 'bg-white/6 text-white/60 ring-white/12',
        bar: 'bg-white/25',
      }
    case 'paused':
      return {
        label: 'Paused',
        badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
        bar: 'bg-amber-400',
      }
    case 'completed':
      return {
        label: 'Completed',
        badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
        bar: 'bg-emerald-400',
      }
    case 'failed':
      return {
        label: 'Failed',
        badge: 'bg-red-500/15 text-red-300 ring-red-500/30',
        bar: 'bg-red-400',
      }
    case 'cancelled':
      return {
        label: 'Cancelled',
        badge: 'bg-white/5 text-white/40 ring-white/10',
        bar: 'bg-white/20',
      }
  }
}

function matchesFilter(job: DownloadJob, filter: FilterKey): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return job.status === 'downloading' || job.status === 'resolving'
  if (filter === 'failed') return job.status === 'failed' || job.status === 'cancelled'
  return job.status === filter
}

export default function DownloadsPage() {
  const { jobs, counts, maxConcurrent } = useDownloads()
  const library = useLibrary()
  const settings = useSettings()
  const player = usePlayer()
  const openDetail = useDetail()
  const toast = useToast()

  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [deleteLocalToo, setDeleteLocalToo] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [concurrencyBusy, setConcurrencyBusy] = useState(false)
  const [showExternal, setShowExternal] = useState(false)
  const [showSeasonBulk, setShowSeasonBulk] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

  // Bulk whole-season search & queue state
  const [seasonSearch, setSeasonSearch] = useState('')
  const [seasonSearchBusy, setSeasonSearchBusy] = useState(false)
  const [seasonMatches, setSeasonMatches] = useState<ProviderSearchResult[]>([])
  const [pickedMatch, setPickedMatch] = useState<ProviderSearchResult | null>(null)
  const [availableEps, setAvailableEps] = useState<number[]>([])
  const [epsLoading, setEpsLoading] = useState(false)
  const [seasonNum, setSeasonNum] = useState(1)
  const [seasonQuality, setSeasonQuality] = useState('best')
  const [seasonDub, setSeasonDub] = useState(false)
  const [seasonMode, setSeasonMode] = useState<'season' | 'range' | 'pick'>('season')
  const [seasonStart, setSeasonStart] = useState(1)
  const [seasonEnd, setSeasonEnd] = useState(12)
  const [pickedEps, setPickedEps] = useState<Set<number>>(() => new Set())
  const [seasonQueueBusy, setSeasonQueueBusy] = useState(false)

  useEffect(() => {
    setSeasonQuality(settings.quality || 'best')
    setSeasonDub(Boolean(settings.dub))
  }, [settings.quality, settings.dub])

  useEffect(() => {
    if (searchParams.get('bulk') === '1') {
      setShowSeasonBulk(true)
      setShowExternal(false)
      const next = new URLSearchParams(searchParams)
      next.delete('bulk')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  async function selectProviderMatch(query: string, match: ProviderSearchResult) {
    setPickedMatch(match)
    const inferred = inferSeasonFromTitle(match.title)
    setSeasonNum(inferred.season)
    setAvailableEps([])
    setPickedEps(new Set())
    setEpsLoading(true)
    try {
      const epRes = await api.resolverEpisodes(query, match.index)
      setAvailableEps(epRes.episodes)
      if (epRes.episodes.length > 0) {
        setSeasonStart(epRes.episodes[0])
        setSeasonEnd(epRes.episodes[epRes.episodes.length - 1])
        setPickedEps(new Set(epRes.episodes))
      }
    } catch {
      /* still allow whole-season auto-discovery on submit */
    } finally {
      setEpsLoading(false)
    }
  }

  async function onSearchSeasonAnime(ev: FormEvent) {
    ev.preventDefault()
    const q = seasonSearch.trim()
    if (!q) return
    setSeasonSearchBusy(true)
    setSeasonMatches([])
    setPickedMatch(null)
    setAvailableEps([])
    try {
      const { results } = await api.resolverSearch(q)
      setSeasonMatches(results)
      if (!results.length) {
        toast(`No anime found for "${q}"`, 'err')
        return
      }
      await selectProviderMatch(q, results[0])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Search failed', 'err')
    } finally {
      setSeasonSearchBusy(false)
    }
  }

  async function onSubmitSeasonBulk() {
    const q = seasonSearch.trim()
    if (!q || !pickedMatch) return
    setSeasonQueueBusy(true)
    try {
      const res = await enqueueBulkDownload(
        seasonMode === 'range'
          ? {
              mode: 'range',
              animeTitle: pickedMatch.title,
              query: q,
              resultIndex: pickedMatch.index,
              providerTitle: pickedMatch.title,
              season: seasonNum,
              startEpisode: Math.max(1, seasonStart),
              endEpisode: Math.max(seasonStart, seasonEnd),
              quality: seasonQuality,
              dub: seasonDub,
              format: 'TV',
            }
          : seasonMode === 'pick'
            ? {
                mode: 'episodes',
                animeTitle: pickedMatch.title,
                query: q,
                resultIndex: pickedMatch.index,
                providerTitle: pickedMatch.title,
                season: seasonNum,
                episodes: [...pickedEps].sort((a, b) => a - b),
                quality: seasonQuality,
                dub: seasonDub,
                format: 'TV',
              }
            : {
                mode: 'season',
                animeTitle: pickedMatch.title,
                query: q,
                resultIndex: pickedMatch.index,
                providerTitle: pickedMatch.title,
                season: seasonNum,
                episodes: availableEps.length > 0 ? availableEps : undefined,
                discoverFromProvider: availableEps.length === 0,
                quality: seasonQuality,
                dub: seasonDub,
                format: 'TV',
              },
      )
      const parts = [
        res.queuedCount > 0
          ? `Queued ${res.queuedCount} episode${res.queuedCount === 1 ? '' : 's'} of ${pickedMatch.title}`
          : 'Nothing new to queue',
      ]
      if (res.skippedDownloaded > 0) parts.push(`${res.skippedDownloaded} already local`)
      if (res.skippedQueued > 0) parts.push(`${res.skippedQueued} already queued`)
      toast(parts.join(' · '))
      if (res.queuedCount > 0) setShowSeasonBulk(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue season download', 'err')
    } finally {
      setSeasonQueueBusy(false)
    }
  }

  // External source form state
  const [extTitle, setExtTitle] = useState('')
  const [extUrl, setExtUrl] = useState('')
  const [extSeason, setExtSeason] = useState(1)
  const [extEpisode, setExtEpisode] = useState(1)
  const [extQuality, setExtQuality] = useState('best')
  const [extFormat, setExtFormat] = useState<'TV' | 'MOVIE'>('TV')
  const [extReferer, setExtReferer] = useState('')
  const [extOrigin, setExtOrigin] = useState('')
  const [extUserAgent, setExtUserAgent] = useState('')
  const [extSubUrl, setExtSubUrl] = useState('')
  const [showAdvHeaders, setShowAdvHeaders] = useState(false)
  const [extBusy, setExtBusy] = useState(false)

  const libraryById = useMemo(() => {
    const map = new Map(library.items.map((item) => [item.id, item]))
    return map
  }, [library.items])

  const filtered = useMemo(() => jobs.filter((j) => matchesFilter(j, filter)), [jobs, filter])

  const visibleSelectedIds = useMemo(
    () => filtered.filter((j) => selected.has(j.id)).map((j) => j.id),
    [filtered, selected],
  )
  const allVisibleSelected = filtered.length > 0 && visibleSelectedIds.length === filtered.length
  const anySelectedHasFile = useMemo(
    () => jobs.some((j) => selected.has(j.id) && Boolean(j.fileId)),
    [jobs, selected],
  )

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const j of filtered) next.delete(j.id)
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const j of filtered) next.add(j.id)
        return next
      })
    }
  }

  async function onChangeConcurrency(next: number) {
    setConcurrencyBusy(true)
    try {
      await saveSettings({ maxConcurrentDownloads: next })
      toast(`Simultaneous downloads set to ${next}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update limit', 'err')
    } finally {
      setConcurrencyBusy(false)
    }
  }

  async function runSingle(id: string, fn: () => Promise<unknown>, okMsg?: string) {
    setBusyId(id)
    try {
      await fn()
      if (okMsg) toast(okMsg)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'err')
    } finally {
      setBusyId(null)
    }
  }

  async function runBulk(
    action: 'delete' | 'cancel' | 'retry' | 'pause' | 'resume' | 'clear-finished',
    ids: string[],
  ) {
    setBulkBusy(true)
    try {
      const res = await bulkDownloadAction(action, ids, action === 'delete' && deleteLocalToo)
      if (action === 'delete' || action === 'clear-finished') {
        setSelected(new Set())
        setDeleteLocalToo(false)
      }
      toast(
        action === 'clear-finished'
          ? `Cleared ${res.affected} finished entr${res.affected === 1 ? 'y' : 'ies'}`
          : `Updated ${res.affected} download${res.affected === 1 ? '' : 's'}`,
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Bulk action failed', 'err')
    } finally {
      setBulkBusy(false)
    }
  }

  async function onSubmitExternal(event: FormEvent) {
    event.preventDefault()
    if (!extTitle.trim() || !extUrl.trim()) return
    setExtBusy(true)
    try {
      const headers: Record<string, string> = {}
      if (extReferer.trim()) headers.Referer = extReferer.trim()
      if (extOrigin.trim()) headers.Origin = extOrigin.trim()
      if (extUserAgent.trim()) headers['User-Agent'] = extUserAgent.trim()

      const res = await enqueueDownload({
        sourceType: 'external',
        animeTitle: extTitle.trim(),
        url: extUrl.trim(),
        subtitleUrl: extSubUrl.trim() || undefined,
        season: extSeason,
        episode: extEpisode,
        quality: extQuality,
        format: extFormat,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      })

      if (res.status === 'already_downloaded') {
        toast('That episode already exists in your shared library')
      } else if (res.status === 'already_queued') {
        toast('That episode is already in the queue')
      } else {
        toast(`Queued ${extTitle.trim()} S${String(extSeason).padStart(2, '0')}E${String(extEpisode).padStart(2, '0')}`)
        setExtUrl('')
        setExtSubUrl('')
        setExtEpisode((ep) => ep + 1)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add external source', 'err')
    } finally {
      setExtBusy(false)
    }
  }

  function onPlayJob(job: DownloadJob) {
    if (!job.fileId) return
    const item = libraryById.get(job.fileId)
    if (item) {
      player.open(localItemToPlayback(item))
      return
    }
    player.open({
      kind: 'local',
      id: job.fileId,
      title: job.animeTitle,
      fileName: job.fileName,
      season: job.season,
      episode: job.episode,
      hasSubtitle: false,
      directPlayable: true,
    })
  }

  const finishedCount = counts.completed + counts.failed + jobs.filter((j) => j.status === 'cancelled').length

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.total },
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'queued', label: 'Queued', count: counts.queued },
    { key: 'paused', label: 'Paused', count: counts.paused },
    { key: 'completed', label: 'Completed', count: counts.completed },
    {
      key: 'failed',
      label: 'Failed',
      count: counts.failed + jobs.filter((j) => j.status === 'cancelled').length,
    },
  ]

  return (
    <div>
      <DownloadsTabs />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Downloads</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Persistent server queue · continues in the background even when you close the browser
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-white/60 ring-1 ring-white/8">
            <span>Simultaneous</span>
            <select
              value={settings.maxConcurrentDownloads || maxConcurrent}
              disabled={concurrencyBusy}
              onChange={(e) => void onChangeConcurrency(Number(e.target.value))}
              aria-label="Simultaneous downloads"
              className="rounded bg-ink-800 px-1.5 py-0.5 text-xs font-medium text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              setShowSeasonBulk((v) => !v)
              setShowExternal(false)
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              showSeasonBulk
                ? 'bg-accent/20 text-accent ring-1 ring-accent/45'
                : 'bg-accent text-black hover:bg-accent-600'
            }`}
          >
            <FolderDown size={14} />
            Bulk Download Season
          </button>

          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-medium text-white/90 ring-1 ring-white/15 transition hover:bg-white/14"
          >
            <Upload size={13} className="text-accent" />
            Upload Movie
          </button>

          <button
            type="button"
            onClick={() => {
              setShowExternal((v) => !v)
              setShowSeasonBulk(false)
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition ${
              showExternal
                ? 'bg-accent/20 text-accent ring-accent/40'
                : 'bg-white/6 text-white/80 ring-white/12 hover:bg-white/12 hover:text-white'
            }`}
          >
            <Plus size={14} />
            External URL
          </button>
        </div>
      </div>

      <UploadVideoModal
        open={showUpload}
        initialCategory="movie"
        onClose={() => setShowUpload(false)}
        onQueued={(count, cat) =>
          toast(
            `Uploading ${count} ${cat === 'movie' ? (count === 1 ? 'movie' : 'movies') : count === 1 ? 'video' : 'videos'} in resumable chunks`,
          )
        }
      />

      <div className="mt-4">
        <UploadQueuePanel onPlayItem={(item) => player.open(localItemToPlayback(item))} />
      </div>

      {showSeasonBulk ? (
        <section className="mt-4 rounded-xl bg-ink-900 p-4 ring-1 ring-accent/35 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-white/85 uppercase">
                <FolderDown size={14} className="text-accent" />
                Bulk Download Whole Season
              </h2>
              <p className="mt-0.5 text-[11px] text-white/45">
                Search any anime, pick the season match, and download every episode (or a range) automatically into{' '}
                <span className="font-mono text-white/60">Anime Name / Season 01 / S01E01.mp4</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSeasonBulk(false)}
              className="rounded p-1 text-white/40 hover:text-white"
              aria-label="Close bulk season downloader"
            >
              <X size={15} />
            </button>
          </div>

          <form onSubmit={(ev) => void onSearchSeasonAnime(ev)} className="mt-3 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/35"
              />
              <input
                value={seasonSearch}
                onChange={(ev) => setSeasonSearch(ev.target.value)}
                placeholder="Type anime title (e.g. Frieren, Solo Leveling, Dandadan)…"
                className="w-full rounded-lg bg-ink-800 py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/30 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
            </div>
            <button
              type="submit"
              disabled={seasonSearchBusy || !seasonSearch.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
            >
              {seasonSearchBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Find Season
            </button>
          </form>

          {seasonMatches.length > 0 && (
            <div className="mt-3 space-y-3">
              <div>
                <span className="mb-1.5 block text-[11px] text-white/45">Select season / entry:</span>
                <div className="grid max-h-40 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                  {seasonMatches.map((m) => {
                    const active = pickedMatch?.index === m.index
                    return (
                      <button
                        key={m.slug}
                        type="button"
                        onClick={() => void selectProviderMatch(seasonSearch.trim(), m)}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ring-1 transition ${
                          active
                            ? 'bg-accent/18 font-medium text-accent ring-accent/50'
                            : 'bg-ink-850 text-white/75 ring-white/8 hover:bg-ink-800 hover:text-white'
                        }`}
                      >
                        <span className="shrink-0 font-mono text-[10px] opacity-60">#{m.index}</span>
                        <span className="min-w-0 flex-1 truncate">{m.title}</span>
                        {active ? <Check size={13} className="shrink-0" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              {pickedMatch && (
                <div className="space-y-3 rounded-xl bg-ink-850 p-3.5 ring-1 ring-white/8">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-white/45">Download mode</span>
                      <select
                        value={seasonMode}
                        onChange={(ev) => setSeasonMode(ev.target.value as 'season' | 'range' | 'pick')}
                        className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      >
                        <option value="season">
                          Whole Season{availableEps.length ? ` (${availableEps.length} eps)` : ''}
                        </option>
                        <option value="range">Episode Range</option>
                        <option value="pick">Pick Specific Episodes</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] text-white/45">Save as Season #</span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={seasonNum}
                        onChange={(ev) => setSeasonNum(Math.max(1, Math.min(99, Number(ev.target.value) || 1)))}
                        className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] text-white/45">Quality</span>
                      <select
                        value={seasonQuality}
                        onChange={(ev) => setSeasonQuality(ev.target.value)}
                        className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      >
                        {QUALITY_CHOICES.map((q) => (
                          <option key={q.value} value={q.value}>
                            {q.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] text-white/45">Audio</span>
                      <select
                        value={seasonDub ? 'dub' : 'sub'}
                        onChange={(ev) => setSeasonDub(ev.target.value === 'dub')}
                        className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      >
                        <option value="sub">Japanese (Sub)</option>
                        <option value="dub">English (Dub)</option>
                      </select>
                    </label>
                  </div>

                  {seasonMode === 'range' && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-white/55">Episodes</span>
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={seasonStart}
                        onChange={(ev) => setSeasonStart(Math.max(1, Number(ev.target.value) || 1))}
                        className="w-20 rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      />
                      <span className="text-white/40">through</span>
                      <input
                        type="number"
                        min={seasonStart}
                        max={9999}
                        value={seasonEnd}
                        onChange={(ev) => setSeasonEnd(Math.max(seasonStart, Number(ev.target.value) || seasonStart))}
                        className="w-20 rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      />
                    </div>
                  )}

                  {seasonMode === 'pick' && availableEps.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/50">
                        <span>{pickedEps.size} of {availableEps.length} episodes checked</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setPickedEps(new Set(availableEps))}
                            className="hover:text-white"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setPickedEps(new Set())}
                            className="hover:text-white"
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className="grid max-h-36 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-10 md:grid-cols-12">
                        {availableEps.map((ep) => {
                          const on = pickedEps.has(ep)
                          return (
                            <button
                              key={ep}
                              type="button"
                              onClick={() =>
                                setPickedEps((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(ep)) next.delete(ep)
                                  else next.add(ep)
                                  return next
                                })
                              }
                              className={`rounded py-1 font-mono text-[11px] ring-1 transition ${
                                on
                                  ? 'bg-accent font-semibold text-black ring-accent'
                                  : 'bg-ink-800 text-white/60 ring-white/10 hover:text-white'
                              }`}
                            >
                              {ep}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-white/50">
                      {epsLoading
                        ? 'Checking available episodes…'
                        : availableEps.length > 0
                          ? `${availableEps.length} episode${availableEps.length === 1 ? '' : 's'} found (EP ${availableEps[0]}–${availableEps[availableEps.length - 1]})`
                          : 'Will automatically fetch every episode on queue'}
                    </span>

                    <button
                      type="button"
                      disabled={seasonQueueBusy || (seasonMode === 'pick' && pickedEps.size === 0)}
                      onClick={() => void onSubmitSeasonBulk()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {seasonQueueBusy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <FolderDown size={14} />
                      )}
                      {seasonMode === 'season'
                        ? `Download Whole Season${availableEps.length ? ` (${availableEps.length} eps)` : ''}`
                        : seasonMode === 'range'
                          ? `Download EP ${seasonStart}–${seasonEnd}`
                          : `Download ${pickedEps.size} Episode${pickedEps.size === 1 ? '' : 's'}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      ) : null}

      {showExternal ? (
        <form
          onSubmit={(e) => void onSubmitExternal(e)}
          className="mt-4 rounded-xl bg-ink-900 p-4 ring-1 ring-white/10 md:p-5"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-white/75 uppercase">
              <Globe size={13} className="text-accent" />
              Download Authorized External MP4 or HLS (M3U8)
            </h2>
            <button
              type="button"
              onClick={() => setShowExternal(false)}
              className="rounded p-1 text-white/40 hover:text-white"
              aria-label="Close external source form"
            >
              <X size={15} />
            </button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-white/45">Anime / Movie title</span>
              <input
                required
                value={extTitle}
                onChange={(e) => setExtTitle(e.target.value)}
                placeholder="e.g. Frieren"
                className="w-full rounded-lg bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Season</span>
              <input
                type="number"
                min={1}
                max={99}
                value={extSeason}
                onChange={(e) => setExtSeason(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                className="w-full rounded-lg bg-ink-800 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Episode</span>
              <input
                type="number"
                min={1}
                max={9999}
                value={extEpisode}
                onChange={(e) => setExtEpisode(Math.max(1, Math.min(9999, Number(e.target.value) || 1)))}
                className="w-full rounded-lg bg-ink-800 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-white/45">Direct MP4 or HLS (.m3u8) URL</span>
              <input
                required
                type="url"
                value={extUrl}
                onChange={(e) => setExtUrl(e.target.value)}
                placeholder="https://example.org/stream/master.m3u8 or episode.mp4"
                className="w-full rounded-lg bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Quality (for HLS)</span>
              <select
                value={extQuality}
                onChange={(e) => setExtQuality(e.target.value)}
                className="w-full rounded-lg bg-ink-800 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
              >
                {QUALITY_CHOICES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Type</span>
              <select
                value={extFormat}
                onChange={(e) => setExtFormat(e.target.value as 'TV' | 'MOVIE')}
                className="w-full rounded-lg bg-ink-800 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
              >
                <option value="TV">Episode</option>
                <option value="MOVIE">Movie</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvHeaders((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[11px] text-white/50 transition hover:text-accent"
          >
            {showAdvHeaders ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Optional Referer, HTTP headers &amp; subtitle URL
          </button>

          {showAdvHeaders ? (
            <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-white/45">Referer URL</span>
                <input
                  type="url"
                  value={extReferer}
                  onChange={(e) => setExtReferer(e.target.value)}
                  placeholder="https://example.org/"
                  className="w-full rounded-lg bg-ink-800 px-3 py-2 text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-white/45">Origin URL</span>
                <input
                  type="url"
                  value={extOrigin}
                  onChange={(e) => setExtOrigin(e.target.value)}
                  placeholder="https://example.org"
                  className="w-full rounded-lg bg-ink-800 px-3 py-2 text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-white/45">Subtitle URL (.vtt or .srt)</span>
                <input
                  type="url"
                  value={extSubUrl}
                  onChange={(e) => setExtSubUrl(e.target.value)}
                  placeholder="https://example.org/subs/en.vtt"
                  className="w-full rounded-lg bg-ink-800 px-3 py-2 text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-white/45">Custom User-Agent</span>
                <input
                  value={extUserAgent}
                  onChange={(e) => setExtUserAgent(e.target.value)}
                  placeholder="Default browser User-Agent"
                  className="w-full rounded-lg bg-ink-800 px-3 py-2 text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
              </label>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-white/40">
              Only approved public domains are permitted; DRM-protected streams are rejected automatically.{' '}
              <Link to="/settings" className="text-accent hover:underline">
                Manage approved domains
              </Link>
            </p>
            <button
              type="submit"
              disabled={extBusy || !extTitle.trim() || !extUrl.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
            >
              {extBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Add to queue
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition ${
                filter === f.key
                  ? 'bg-white/12 font-medium text-white ring-1 ring-white/15'
                  : 'text-white/45 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              {f.label}
              <span className="text-[10px] opacity-65 tabular-nums">{f.count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {counts.active + counts.queued > 0 ? (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() =>
                void runBulk(
                  'pause',
                  jobs
                    .filter((j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'resolving')
                    .map((j) => j.id),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <Pause size={12} />
              Pause all
            </button>
          ) : null}

          {counts.paused > 0 ? (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() =>
                void runBulk(
                  'resume',
                  jobs.filter((j) => j.status === 'paused').map((j) => j.id),
                )
              }
              className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <Play size={12} />
              Resume all
            </button>
          ) : null}

          {finishedCount > 0 ? (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void runBulk('clear-finished', [])}
              title="Remove completed, failed, and cancelled rows from the queue list (keeps downloaded files)"
              className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <Check size={12} />
              Clear finished
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-ink-900/80 px-3 py-2 text-xs ring-1 ring-white/5">
          <button
            type="button"
            onClick={toggleAllVisible}
            className="inline-flex items-center gap-1.5 text-white/65 transition hover:text-white"
          >
            {allVisibleSelected ? (
              <CheckSquare size={15} className="text-accent" />
            ) : (
              <Square size={15} />
            )}
            {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
          </button>

          {selected.size > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                {anySelectedHasFile ? (
                  <label className="mr-1 inline-flex items-center gap-1.5 text-[11px] text-white/55">
                    <input
                      type="checkbox"
                      checked={deleteLocalToo}
                      onChange={(e) => setDeleteLocalToo(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                    Also delete local files
                  </label>
                ) : null}

                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulk('pause', [...selected])}
                  className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/75 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40"
                >
                  Pause
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulk('resume', [...selected])}
                  className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/75 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40"
                >
                  Resume
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulk('cancel', [...selected])}
                  className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/75 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulk('retry', [...selected])}
                  className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/75 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-40"
                >
                  Retry
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulk('delete', [...selected])}
                  className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-200 ring-1 ring-red-500/30 hover:bg-red-500/25 disabled:opacity-40"
                >
                  <Trash2 size={11} />
                  Delete ({selected.size})
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        {filtered.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-10 text-center ring-1 ring-white/5">
            <Download size={30} className="mx-auto text-white/20" />
            <h2 className="mt-3 text-sm font-medium text-white/70">
              {jobs.length === 0 ? 'No downloads queued yet' : 'No downloads match this filter'}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/40">
              {jobs.length === 0
                ? 'Open any anime to download an episode, custom range, season, or entire series into the shared local library — or add an authorized external MP4 / M3U8 link above.'
                : 'Switch filters above to view the rest of your download queue.'}
            </p>
            {jobs.length === 0 ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSeasonBulk(true)
                    setShowExternal(false)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
                >
                  <FolderDown size={14} />
                  Bulk Download Whole Season
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpload(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-4 py-2 text-xs font-medium text-white/85 ring-1 ring-white/12 transition hover:bg-white/12"
                >
                  <Upload size={13} className="text-accent" />
                  Upload Movie / Video
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((job) => {
              const meta = statusMeta(job.status)
              const checked = selected.has(job.id)
              const busy = busyId === job.id
              const speed = formatSpeed(job.speedBps)
              const qualityText = formatQualityLabel(job.quality, job.resolvedHeight)
              const sizeText =
                job.totalBytes && job.totalBytes > 0
                  ? job.status === 'completed'
                    ? formatBytes(job.totalBytes)
                    : `${formatBytes(job.downloadedBytes)} / ${formatBytes(job.totalBytes)}`
                  : job.downloadedBytes > 0
                    ? formatBytes(job.downloadedBytes)
                    : '—'
              const pct =
                job.status === 'completed'
                  ? 100
                  : job.progress != null
                    ? Math.min(100, Math.max(0, job.progress))
                    : null

              return (
                <div
                  key={job.id}
                  className={`rounded-xl bg-ink-900 p-3 ring-1 transition md:px-4 ${
                    checked ? 'ring-accent/45' : 'ring-white/6 hover:ring-white/12'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleOne(job.id)}
                      aria-label={`Select ${job.animeTitle} ${job.code}`}
                      className="mt-1 shrink-0 text-white/50 transition hover:text-accent"
                    >
                      {checked ? (
                        <CheckSquare size={16} className="text-accent" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>

                    <div className="hidden h-14 w-10 shrink-0 overflow-hidden rounded-md bg-ink-800 ring-1 ring-white/8 sm:block">
                      {job.cover ? (
                        <img src={job.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full place-items-center text-white/25">
                          <Film size={15} />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {job.mediaId ? (
                          <button
                            type="button"
                            onClick={() => openDetail(job.mediaId!)}
                            className="truncate text-left text-sm font-medium text-white/95 transition hover:text-accent"
                          >
                            {job.animeTitle}
                          </button>
                        ) : (
                          <p className="truncate text-sm font-medium text-white/95">{job.animeTitle}</p>
                        )}

                        <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white/85 tabular-nums">
                          Season {String(job.season).padStart(2, '0')} · {job.code}
                        </span>

                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-white/65 ring-1 ring-white/10">
                          {qualityText}
                        </span>

                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">
                          {job.dub ? 'Dub' : 'Sub'}
                        </span>

                        {job.sourceType === 'external' ? (
                          <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">
                            <ExternalLink size={9} />
                            External
                          </span>
                        ) : null}

                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${meta.badge}`}
                        >
                          {job.status === 'downloading' || job.status === 'resolving' ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : job.status === 'queued' ? (
                            <Clock size={10} />
                          ) : null}
                          {meta.label}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45 tabular-nums">
                        <span>Size: {sizeText}</span>
                        {pct != null ? <span>Progress: {pct.toFixed(pct === 100 ? 0 : 1)}%</span> : null}
                        {speed ? <span className="text-accent">{speed}</span> : null}
                        <span className="truncate text-white/30">
                          {job.folder}/{job.fileName}
                        </span>
                        <span className="ml-auto hidden text-white/30 lg:inline">
                          {relativeTime(job.completedAt || job.updatedAt)}
                        </span>
                      </div>

                      {job.status === 'downloading' ||
                      job.status === 'resolving' ||
                      job.status === 'paused' ||
                      (job.status === 'completed' && job.fileId) ? (
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${meta.bar} ${
                              job.status === 'resolving' || (job.status === 'downloading' && pct == null)
                                ? 'w-1/3 animate-pulse'
                                : ''
                            }`}
                            style={
                              job.status === 'resolving' || (job.status === 'downloading' && pct == null)
                                ? undefined
                                : { width: `${Math.max(pct ?? 0, job.downloadedBytes > 0 ? 2 : 0)}%` }
                            }
                          />
                        </div>
                      ) : null}

                      {job.status === 'completed' && !job.fileId ? (
                        <p className="mt-1.5 text-[11px] text-white/40">
                          Local file was removed from the library.
                        </p>
                      ) : null}

                      {job.error ? (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-300">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          <span>{job.error}</span>
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {job.status === 'completed' && job.fileId ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onPlayJob(job)}
                            title="Play downloaded episode from shared library"
                            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600"
                          >
                            <Play size={12} className="fill-current" />
                            Play
                          </button>
                          <a
                            href={api.localDownloadUrl(job.fileId)}
                            download={job.fileName}
                            title="Send MP4 file to this device"
                            className="rounded-lg bg-white/5 p-1.5 text-white/65 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                            aria-label={`Save ${job.fileName} to device`}
                          >
                            <Download size={14} />
                          </a>
                        </>
                      ) : null}

                      {job.canPause ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runSingle(job.id, () => pauseDownload(job.id))}
                          title="Pause download"
                          aria-label={`Pause ${job.animeTitle} ${job.code}`}
                          className="rounded-lg bg-white/5 p-1.5 text-white/65 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-amber-300 disabled:opacity-40"
                        >
                          <Pause size={14} />
                        </button>
                      ) : null}

                      {job.canResume ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runSingle(job.id, () => resumeDownload(job.id))}
                          title="Resume download"
                          aria-label={`Resume ${job.animeTitle} ${job.code}`}
                          className="rounded-lg bg-amber-500/15 p-1.5 text-amber-300 ring-1 ring-amber-500/30 transition hover:bg-amber-500/25 disabled:opacity-40"
                        >
                          <Play size={14} />
                        </button>
                      ) : null}

                      {job.status === 'queued' ||
                      job.status === 'resolving' ||
                      job.status === 'downloading' ||
                      job.status === 'paused' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runSingle(job.id, () => cancelDownload(job.id), `Cancelled ${job.code}`)
                          }
                          title="Cancel download"
                          aria-label={`Cancel ${job.animeTitle} ${job.code}`}
                          className="rounded-lg bg-white/5 p-1.5 text-white/60 ring-1 ring-white/10 transition hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
                        >
                          <X size={14} />
                        </button>
                      ) : null}

                      {job.status === 'failed' || job.status === 'cancelled' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runSingle(job.id, () => retryDownload(job.id), `Retrying ${job.code}`)
                          }
                          title="Retry download"
                          aria-label={`Retry ${job.animeTitle} ${job.code}`}
                          className="rounded-lg bg-white/5 p-1.5 text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-accent disabled:opacity-40"
                        >
                          <RotateCw size={14} />
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runSingle(
                            job.id,
                            () => deleteDownload(job.id, Boolean(job.status === 'completed' && job.fileId)),
                            job.status === 'completed' && job.fileId
                              ? `Deleted ${job.code} from queue & local library`
                              : `Removed ${job.code} from queue`,
                          )
                        }
                        title={
                          job.status === 'completed' && job.fileId
                            ? 'Delete download & remove local copy (keeps anime metadata)'
                            : 'Delete job from queue'
                        }
                        aria-label={`Delete ${job.animeTitle} ${job.code}`}
                        className="rounded-lg bg-white/5 p-1.5 text-white/45 ring-1 ring-white/10 transition hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
