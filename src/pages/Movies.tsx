import { useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Film,
  Loader2,
  Play,
  Search as SearchIcon,
  Tv,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import { enqueueDownload, useDownloads } from '../lib/downloads'
import { useToast } from '../components/Toasts'
import type { MovieDetails, MovieSearchItem, VidsrcEmbedResult } from '../types'

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx += 1
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export default function Movies() {
  const toast = useToast()
  const { jobs: downloads } = useDownloads()

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<MovieSearchItem[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  const [selected, setSelected] = useState<MovieDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const [selectedSeason, setSelectedSeason] = useState<number>(1)
  const [selectedEpisode, setSelectedEpisode] = useState<number>(1)

  const [embed, setEmbed] = useState<VidsrcEmbedResult | null>(null)
  const [loadingEmbed, setLoadingEmbed] = useState(false)
  const [embedError, setEmbedError] = useState<string | null>(null)

  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadBusy, setDownloadBusy] = useState(false)

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setHasSearched(true)
    setSelected(null)
    setEmbed(null)
    try {
      const res = await api.movieSearch(q)
      setResults(res.items ?? [])
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  async function onSelectItem(item: MovieSearchItem) {
    setLoadingDetails(true)
    setDetailsError(null)
    setEmbed(null)
    setEmbedError(null)
    try {
      const details = await api.movieDetails(item.imdbId)
      setSelected(details)
      if (details.kind === 'series' && details.seasons.length > 0) {
        const firstSeason = details.seasons[0]
        setSelectedSeason(firstSeason.season)
        setSelectedEpisode(firstSeason.episodes[0]?.episode ?? 1)
      } else {
        setSelectedSeason(1)
        setSelectedEpisode(1)
      }
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Could not load title details')
    } finally {
      setLoadingDetails(false)
    }
  }

  async function onWatch(season?: number, episode?: number) {
    if (!selected) return
    setLoadingEmbed(true)
    setEmbedError(null)
    try {
      const res = await api.movieEmbed({
        imdbId: selected.imdbId,
        kind: selected.kind,
        season: selected.kind === 'series' ? (season ?? selectedSeason) : undefined,
        episode: selected.kind === 'series' ? (episode ?? selectedEpisode) : undefined,
      })
      setEmbed(res)
    } catch (err) {
      setEmbedError(err instanceof Error ? err.message : 'Could not open VidSrc player')
    } finally {
      setLoadingEmbed(false)
    }
  }

  async function onStartDownload(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const url = downloadUrl.trim()
    if (!url) {
      toast('Enter an authorized direct or HLS media URL to download', 'err')
      return
    }
    setDownloadBusy(true)
    try {
      await enqueueDownload({
        sourceType: 'external',
        url,
        animeTitle: selected.title,
        seriesTitle: selected.title,
        season: selected.kind === 'series' ? selectedSeason : 1,
        episode: selected.kind === 'series' ? selectedEpisode : 1,
        cover: selected.poster ?? undefined,
        format: selected.kind === 'series' ? 'TV' : 'MOVIE',
      })
      setDownloadUrl('')
      toast(`Started background download for ${selected.title}`, 'ok')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to start download', 'err')
    } finally {
      setDownloadBusy(false)
    }
  }

  const currentSeasonObj =
    selected?.seasons.find((s) => s.season === selectedSeason) ?? selected?.seasons[0] ?? null

  const recentDownloads = downloads.slice(0, 5)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
            <Film size={20} className="text-accent" />
            Movie &amp; Series Fetcher
          </h1>
          <p className="text-xs text-white/50">
            Search movies or TV series by name, retrieve their IMDb ID, and watch via VidSrc.
          </p>
        </div>
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-white/40"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies or TV series (e.g. Breaking Bad, Inception)…"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pr-4 pl-10 text-sm text-white placeholder-white/35 outline-none transition focus:border-accent/60 focus:bg-white/[0.07]"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-accent-600 disabled:opacity-50"
        >
          {searching ? <Loader2 size={15} className="animate-spin" /> : <SearchIcon size={15} />}
          Search
        </button>
      </form>

      {searchError ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={16} />
          {searchError}
        </div>
      ) : null}

      {loadingDetails ? (
        <div className="flex items-center justify-center py-12 text-sm text-white/60">
          <Loader2 size={18} className="mr-2 animate-spin text-accent" />
          Loading title details…
        </div>
      ) : null}

      {detailsError ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle size={16} />
          {detailsError}
        </div>
      ) : null}

      {selected ? (
        <div className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setSelected(null)
                setEmbed(null)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-white/75 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft size={14} />
              Back to results
            </button>
            <span className="rounded-md bg-white/10 px-2.5 py-1 font-mono text-xs text-white/80">
              {selected.imdbId}
            </span>
          </div>

          <div className="flex flex-col gap-5 md:flex-row">
            {selected.poster ? (
              <img
                src={selected.poster}
                alt={selected.title}
                className="h-64 w-44 shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-white/10"
              />
            ) : (
              <div className="grid h-64 w-44 shrink-0 place-items-center rounded-xl bg-white/5 text-white/30 ring-1 ring-white/10">
                <Film size={32} />
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
                  {selected.kind === 'series' ? <Tv size={12} /> : <Film size={12} />}
                  {selected.typeLabel}
                </span>
                {selected.year ? (
                  <span className="text-xs text-white/60">{selected.year}</span>
                ) : null}
                {selected.rating ? (
                  <span className="text-xs text-amber-300">★ {selected.rating}</span>
                ) : null}
              </div>

              <h2 className="text-2xl font-bold text-white">{selected.title}</h2>

              {selected.genres.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selected.genres.map((g) => (
                    <span
                      key={g}
                      className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-white/65"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              ) : null}

              {selected.plot ? (
                <p className="text-sm leading-relaxed text-white/70">{selected.plot}</p>
              ) : null}

              {selected.kind === 'movie' ? (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => onWatch()}
                    disabled={loadingEmbed}
                    className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-accent-600 disabled:opacity-50"
                  >
                    {loadingEmbed ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} />
                    )}
                    Watch Movie
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  {selected.seasons.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-white/70">
                        Season
                        <select
                          value={selectedSeason}
                          onChange={(e) => {
                            const sNum = Number(e.target.value)
                            setSelectedSeason(sNum)
                            const sObj = selected.seasons.find((s) => s.season === sNum)
                            setSelectedEpisode(sObj?.episodes[0]?.episode ?? 1)
                          }}
                          className="rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 text-xs text-white outline-none"
                        >
                          {selected.seasons.map((s) => (
                            <option key={s.season} value={s.season}>
                              Season {s.season}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex items-center gap-2 text-xs text-white/70">
                        Episode
                        <select
                          value={selectedEpisode}
                          onChange={(e) => setSelectedEpisode(Number(e.target.value))}
                          className="rounded-lg border border-white/10 bg-ink-900 px-2.5 py-1.5 text-xs text-white outline-none"
                        >
                          {(currentSeasonObj?.episodes ?? []).map((ep) => (
                            <option key={ep.episode} value={ep.episode}>
                              E{ep.episode}: {ep.title}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() => onWatch(selectedSeason, selectedEpisode)}
                        disabled={loadingEmbed}
                        className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:opacity-50"
                      >
                        {loadingEmbed ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Play size={14} />
                        )}
                        Watch S{selectedSeason} E{selectedEpisode}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onWatch(1, 1)}
                        disabled={loadingEmbed}
                        className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:opacity-50"
                      >
                        <Play size={14} />
                        Watch S1 E1
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {embedError ? (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertTriangle size={16} />
              {embedError}
            </div>
          ) : null}

          {embed ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-white/60">
                <span>
                  Playing via VidSrc ({embed.imdbId}
                  {embed.kind === 'series' ? ` · S${embed.season} E${embed.episode}` : ''})
                </span>
                <button
                  type="button"
                  onClick={() => setEmbed(null)}
                  className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <X size={12} />
                  Close player
                </button>
              </div>
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
                <iframe
                  src={embed.embedUrl}
                  title={`${selected.title} VidSrc Player`}
                  allowFullScreen
                  allow="autoplay; fullscreen; picture-in-picture"
                  className="h-full w-full border-0"
                />
              </div>
            </div>
          ) : null}

          <form
            onSubmit={onStartDownload}
            className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-4"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <Download size={14} className="text-accent" />
              Background Download (Authorized Direct / HLS Source)
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="https://example.com/authorized-video.mp4 or .m3u8"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/35 outline-none focus:border-accent/60"
              />
              <button
                type="submit"
                disabled={downloadBusy || !downloadUrl.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
              >
                {downloadBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Download
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {!selected && hasSearched && !searching && results.length === 0 && !searchError ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] py-12 text-center text-sm text-white/50">
          No movies or TV series found for &ldquo;{query}&rdquo;.
        </div>
      ) : null}

      {!selected && results.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {results.map((item) => (
            <button
              key={item.imdbId}
              type="button"
              onClick={() => onSelectItem(item)}
              className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-left transition hover:border-accent/50 hover:bg-white/[0.06]"
            >
              <div className="relative aspect-[2/3] w-full bg-white/5">
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={item.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-white/25">
                    <Film size={28} />
                  </div>
                )}
                <span className="absolute top-2 left-2 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                  {item.typeLabel}
                </span>
              </div>
              <div className="flex flex-1 flex-col justify-between gap-1 p-3">
                <p className="line-clamp-2 text-sm font-medium text-white group-hover:text-accent">
                  {item.title}
                </p>
                <div className="flex items-center justify-between text-[11px] text-white/50">
                  <span>{item.year ?? '—'}</span>
                  <span className="font-mono">{item.imdbId}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {recentDownloads.length > 0 ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <h3 className="text-xs font-semibold tracking-wide text-white/70 uppercase">
            Background Downloads
          </h3>
          <div className="space-y-2">
            {recentDownloads.map((dl) => (
              <div
                key={dl.id}
                className="flex flex-col gap-1.5 rounded-xl border border-white/5 bg-black/25 px-3.5 py-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-white/90">
                    {dl.animeTitle} {dl.episode ? `· E${dl.episode}` : ''}
                  </span>
                  <span className="shrink-0 capitalize text-white/60">{dl.status}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, dl.progress ?? 0))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-white/45">
                  <span>
                    {(dl.progress ?? 0).toFixed(0)}% · {formatBytes(dl.downloadedBytes)}
                    {dl.totalBytes ? ` / ${formatBytes(dl.totalBytes)}` : ''}
                  </span>
                  <span>{dl.speedBps ? `${formatBytes(dl.speedBps)}/s` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
