import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import {
  Bookmark,
  BookmarkCheck,
  Check,
  Clock,
  Download,
  ExternalLink,
  Layers,
  Link2,
  Loader2,
  Play,
  Search,
  Star,
  Tv,
  X,
} from 'lucide-react'
import type { AniCliSearchResult, Media, MediaDetail } from '../types'
import { api } from '../lib/api'
import { toggleBookmark, useBookmarks } from '../lib/bookmarks'
import { useSettings, resolveSource } from '../lib/settings'
import { clampEpisode, formatMediaType, formatSeason, relativeTime } from '../lib/format'
import { usePlayer } from './Player'
import { useToast } from './Toasts'

type OpenFn = (media: Media | number, opts?: { download?: boolean }) => void
const DetailContext = createContext<OpenFn>(() => {})

export function useDetail() {
  return useContext(DetailContext)
}

export function DetailProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<{ target: Media | number; download: boolean } | null>(null)

  const open = useCallback<OpenFn>((target, opts) => {
    setSelection({ target, download: Boolean(opts?.download) })
  }, [])

  return (
    <DetailContext.Provider value={open}>
      {children}
      {selection ? (
        <DetailSheet
          target={selection.target}
          initialDownload={selection.download}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </DetailContext.Provider>
  )
}

function DetailSheet({
  target,
  initialDownload,
  onClose,
}: {
  target: Media | number
  initialDownload: boolean
  onClose: () => void
}) {
  const id = typeof target === 'number' ? target : target.id
  const [media, setMedia] = useState<Media | null>(typeof target === 'object' ? target : null)
  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [episode, setEpisode] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [anicliQuery, setAnicliQuery] = useState('')
  const [anicliIndex, setAnicliIndex] = useState(1)
  const [anicliResults, setAnicliResults] = useState<AniCliSearchResult[]>([])
  const [anicliTitle, setAnicliTitle] = useState<string | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const bookmarks = useBookmarks()
  const player = usePlayer()
  const settings = useSettings()
  const template = settings.sourceTemplate
  const provider = settings.downloadProvider
  const useAniCli = provider === 'anicli'
  const ready = useAniCli ? anicliQuery.trim().length > 0 : Boolean(template)
  const saved = media ? bookmarks.some((b) => b.mediaId === media.id) : false

  useEffect(() => {
    let alive = true
    api
      .detail(id)
      .then((data) => {
        if (!alive) return
        setDetail(data)
        setMedia(data)
        setEpisode(Math.max(1, data.airedEpisodes || 1))
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load details')
      })
    return () => {
      alive = false
    }
  }, [id])

  // Pre-fill the single-episode form from the configured default source.
  useEffect(() => {
    if (!template || !media) return
    setUrl(resolveSource(template, media, episode))
  }, [template, episode, media?.id])

  // ani-cli searches by title. Start from the AniList title, then prefer the
  // match this show was last downloaded with.
  useEffect(() => {
    if (!media) return
    setAnicliQuery(media.title)
    setAnicliIndex(settings.anicliResultIndex || 1)
    setAnicliTitle(null)
    setAnicliResults([])
    let alive = true
    api
      .anicliMatch(media.id)
      .then(({ match }) => {
        if (!alive || !match) return
        setAnicliQuery(match.query)
        setAnicliIndex(match.index)
        setAnicliTitle(match.title || null)
      })
      .catch(() => {
        /* a missing saved match is fine */
      })
    return () => {
      alive = false
    }
  }, [media?.id, settings.anicliResultIndex])

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

  useEffect(() => {
    if (initialDownload && media) {
      const timer = setTimeout(() => urlRef.current?.focus(), 250)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [initialDownload, media?.id])

  async function onBookmark() {
    if (!media) return
    try {
      await toggleBookmark(media)
      toast(saved ? 'Removed from bookmarks' : 'Added to bookmarks')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  async function onDownload(event: FormEvent) {
    event.preventDefault()
    if (!media) return
    if (useAniCli) {
      await runBulk([episode])
      return
    }
    const source = url.trim()
    if (!/^https?:\/\/\S+$/i.test(source)) {
      toast('Paste a direct http(s) link to the episode file', 'err')
      urlRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await api.startDownload({ mediaId: media.id, title: media.title, episode, url: source })
      toast(`Queued ${media.title} · EP ${episode}. Track it in Downloads.`)
      if (!template) setUrl('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start the download', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function onSearchAniCli() {
    const query = anicliQuery.trim()
    if (!query) return
    setSearchBusy(true)
    try {
      const { results } = await api.anicliSearch(query)
      setAnicliResults(results)
      if (!results.length) {
        toast(`ani-cli found no matches for "${query}"`, 'err')
        return
      }
      const picked = results.find((result) => result.index === anicliIndex) ?? results[0]
      setAnicliIndex(picked.index)
      setAnicliTitle(picked.title)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not search ani-cli', 'err')
    } finally {
      setSearchBusy(false)
    }
  }

  async function runBulk(episodes: number[]) {
    if (!media || !episodes.length) return
    if (!ready) {
      toast(
        useAniCli
          ? 'Enter a title to search for on ani-cli first'
          : 'Add a default source in Settings to queue episodes',
        'err',
      )
      return
    }
    setBulkBusy(true)
    try {
      const result = await api.bulkDownload({
        media: { id: media.id, title: media.title, romaji: media.romaji },
        episodes,
        ...(useAniCli
          ? {
              source: 'anicli' as const,
              anicli: {
                query: anicliQuery.trim(),
                resultIndex: anicliIndex,
                quality: settings.anicliQuality,
                dub: settings.anicliDub,
                title: anicliTitle,
              },
            }
          : {}),
      })
      if (result.created.length) {
        toast(`Queued ${result.created.length} episode${result.created.length === 1 ? '' : 's'} of ${media.title}`)
      }
      if (result.errors.length) {
        toast(`${result.errors.length} episode(s) could not be queued`, 'err')
      }
      setSelected([])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue the downloads', 'err')
    } finally {
      setBulkBusy(false)
    }
  }

  function toggleEpisode(number: number) {
    setEpisode(number)
    setSelected((list) => (list.includes(number) ? list.filter((n) => n !== number) : [...list, number]))
  }

  const aired = media ? media.airedEpisodes || 0 : 0
  const maxEpisode = Math.max(aired, media?.episodes ?? 0, 1)
  const episodeList = Array.from({ length: Math.min(maxEpisode, 200) }, (_, i) => i + 1)
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
            {media?.banner ? (
              <img src={media.banner} alt="" className="h-full w-full object-cover opacity-70" />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent" />
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
                  {media?.cover ? (
                    <img src={media.cover} alt={media.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>
              </div>

              <div className="min-w-0 flex-1 md:pt-16">
                <h2 className="text-xl leading-tight font-semibold text-white md:text-3xl">
                  {media?.title ?? <span className="inline-block h-7 w-2/3 animate-pulse rounded bg-ink-700" />}
                </h2>
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
                    onClick={() => {
                      if (!media) return
                      player.open({
                        kind: 'live',
                        title: media.title,
                        episode,
                        query: anicliQuery.trim() || media.title,
                        resultIndex: anicliIndex,
                        quality: settings.anicliQuality,
                        dub: settings.anicliDub,
                      })
                    }}
                    disabled={!media || !anicliQuery.trim()}
                    title={
                      anicliQuery.trim()
                        ? 'Stream this episode through ani-cli without downloading it'
                        : 'Enter a title to search for on ani-cli first'
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play size={14} className="fill-current" />
                    Watch now
                  </button>

                  <button
                    type="button"
                    onClick={() => void runBulk(episodeList)}
                    disabled={bulkBusy || !aired || !ready}
                    title={
                      !ready
                        ? useAniCli
                          ? 'Enter a title to search for on ani-cli first'
                          : 'Add a default source in Settings first'
                        : undefined
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download size={14} />
                    Download all aired
                  </button>

                  <button
                    type="button"
                    onClick={onBookmark}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ring-1 transition ${
                      saved
                        ? 'bg-accent/15 text-accent ring-accent/40'
                        : 'bg-white/5 text-white/80 ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                    {saved ? 'Bookmarked' : 'Bookmark'}
                  </button>

                  {media?.anidb ? (
                    <a
                      href={media.anidb}
                      target="_blank"
                      rel="noreferrer"
                      title={media.anidbSearch ? 'Search this title on AniDB' : 'Open the AniDB entry'}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                    >
                      AniDB
                      <ExternalLink size={12} />
                    </a>
                  ) : null}
                  {media?.siteUrl ? (
                    <a
                      href={media.siteUrl}
                      target="_blank"
                      rel="noreferrer"
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

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.55fr_1fr]">
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
                      {media.streams.map((stream) => (
                        <a
                          key={stream.url}
                          href={stream.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-white/70 ring-1 ring-white/10 transition hover:text-accent"
                        >
                          {stream.site}
                          <ExternalLink size={10} />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <form onSubmit={onDownload} className="h-fit rounded-xl bg-ink-850 p-4 ring-1 ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-white/80 uppercase">
                    <Download size={13} className="text-accent" />
                    Download to this machine
                  </h3>
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    {useAniCli ? 'ani-cli' : template ? 'URL source' : 'no source'}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-[76px_1fr] gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-white/45">Episode</span>
                    <input
                      type="number"
                      min={1}
                      max={maxEpisode}
                      value={episode}
                      onChange={(event) => setEpisode(clampEpisode(Number(event.target.value), maxEpisode))}
                      className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                    />
                  </label>

                  {useAniCli ? (
                    <div className="block min-w-0">
                      <span className="mb-1 block text-[11px] text-white/45">ani-cli search title</span>
                      <div className="flex gap-1.5">
                        <div className="relative min-w-0 flex-1">
                          <Search
                            size={13}
                            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-white/30"
                          />
                          <input
                            ref={urlRef}
                            value={anicliQuery}
                            onChange={(event) => setAnicliQuery(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void onSearchAniCli()
                              }
                            }}
                            placeholder="Title to search on the streaming site"
                            className="w-full rounded-lg bg-ink-800 py-2 pr-2.5 pl-8 text-sm text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void onSearchAniCli()}
                          disabled={searchBusy || !anicliQuery.trim()}
                          title="Search ani-cli matches"
                          className="shrink-0 rounded-lg bg-white/5 px-2.5 text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-accent disabled:opacity-40"
                        >
                          {searchBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="block min-w-0">
                      <span className="mb-1 block text-[11px] text-white/45">Source file URL</span>
                      <div className="relative">
                        <Link2
                          size={13}
                          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-white/30"
                        />
                        <input
                          ref={urlRef}
                          type="url"
                          value={url}
                          onChange={(event) => setUrl(event.target.value)}
                          placeholder="Set a default in Settings, or paste a link"
                          className="w-full rounded-lg bg-ink-800 py-2 pr-2.5 pl-8 text-sm text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                        />
                      </div>
                    </label>
                  )}
                </div>

                {useAniCli ? (
                  anicliResults.length ? (
                    <div className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1">
                      {anicliResults.map((result) => {
                        const on = result.index === anicliIndex
                        return (
                          <button
                            key={result.slug}
                            type="button"
                            onClick={() => {
                              setAnicliIndex(result.index)
                              setAnicliTitle(result.title)
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
                      {anicliTitle ? (
                        <>
                          Match: <span className="text-white/60">#{anicliIndex} {anicliTitle}</span>
                        </>
                      ) : (
                        <>Search to pick the right match. Result #{anicliIndex} is used by default.</>
                      )}
                    </p>
                  )
                ) : null}

                <button
                  type="submit"
                  disabled={busy || bulkBusy || !ready}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 py-2 text-xs font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-60"
                >
                  {busy || bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {busy || bulkBusy ? 'Starting…' : 'Queue this episode'}
                </button>

                <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                  {useAniCli ? (
                    <>
                      ani-cli downloads the episode and files it under{' '}
                      <span className="text-white/55">{settings.libraryDir || 'library/'}</span>.{' '}
                      <Link to="/settings" onClick={onClose} className="text-accent hover:underline">
                        ani-cli settings
                      </Link>
                    </>
                  ) : (
                    <>
                      Streams straight into{' '}
                      <span className="text-white/55">{settings.libraryDir || 'library/'}</span> on this machine.{' '}
                      <Link to="/settings" onClick={onClose} className="text-accent hover:underline">
                        {template ? 'Change source' : 'Add a default source'}
                      </Link>
                    </>
                  )}
                </p>
              </form>
            </div>

            {aired > 0 ? (
              <div className="mt-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-white/35 uppercase">
                    <Tv size={12} />
                    Episodes available ({aired})
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelected(episodeList)}
                      className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:text-white"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected([])}
                      className="rounded-md px-2 py-1 text-[11px] text-white/40 transition hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {episodeList.map((number) => {
                    const isOn = selected.includes(number)
                    return (
                      <button
                        key={number}
                        type="button"
                        onClick={() => toggleEpisode(number)}
                        aria-pressed={isOn}
                        className={`flex h-8 min-w-9 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium ring-1 transition ${
                          isOn
                            ? 'bg-accent text-black ring-accent'
                            : 'bg-white/5 text-white/60 ring-white/10 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {isOn ? <Check size={11} /> : null}
                        {number}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runBulk(selected)}
                    disabled={!selected.length || bulkBusy || !ready}
                    title={
                      !ready
                        ? useAniCli
                          ? 'Enter a title to search for on ani-cli first'
                          : 'Add a default source in Settings first'
                        : undefined
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                    Download selected{selected.length ? ` (${selected.length})` : ''}
                  </button>
                  {!ready ? (
                    useAniCli ? (
                      <span className="text-[11px] text-white/35">
                        Add a search title above to enable bulk downloads.
                      </span>
                    ) : (
                      <Link to="/settings" onClick={onClose} className="text-[11px] text-accent hover:underline">
                        Set a default source to enable bulk downloads →
                      </Link>
                    )
                  ) : null}
                </div>
              </div>
            ) : media ? (
              <p className="mt-6 text-xs text-white/35">No episodes have aired yet.</p>
            ) : null}

            {detail?.streamingEpisodes.length ? (
              <div className="mt-6">
                <h3 className="text-[11px] font-semibold tracking-wider text-white/35 uppercase">
                  Official episode pages
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.streamingEpisodes.slice(0, 12).map((ep) => (
                    <a
                      key={ep.url}
                      href={ep.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:text-accent"
                    >
                      {ep.site}
                      <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
