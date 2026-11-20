import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bookmark,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Info,
  Layers,
  Loader2,
  ListOrdered,
  Play,
  Printer,
  Save,
  ShieldAlert,
  Sparkles,
  Star,
  Users,
} from 'lucide-react'
import { api } from '../lib/api'
import type {
  AnimeNote,
  EpisodeEntry,
  MediaDetail,
  RelationGroup,
  TimelineEntry,
} from '../types'
import { CardSkeletons } from '../components/MediaCard'
import { useDetail } from '../components/MediaModal'
import { useToast } from '../components/Toasts'
import { useBookmarks, toggleBookmark } from '../lib/bookmarks'
import { formatEpisodeCode, formatMediaType, formatSeason, inferSeasonFromTitle } from '../lib/format'

const SEASON_ORDER: Record<string, string> = { WINTER: '0', SPRING: '1', SUMMER: '2', FALL: '3' }

function SectionCard({
  id,
  title,
  icon: Icon,
  action,
  children,
}: {
  id: string
  title: string
  icon: typeof Info
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl bg-ink-900 p-4 ring-1 ring-white/6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon size={14} className="text-accent" />
          {title}
        </h2>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

function EpisodeRow({
  episode,
  canPlay,
  onPlay,
  onDownload,
}: {
  episode: EpisodeEntry
  canPlay: boolean
  onPlay: () => void
  onDownload: () => void
}) {
  const date = episode.airDate ? new Date(episode.airDate) : null
  const valid = date && !Number.isNaN(date.getTime())
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/[0.02]">
      <span className="w-8 shrink-0 text-center text-[11px] font-medium text-white/30 tabular-nums">
        {episode.number}
      </span>
      {episode.thumbnail ? (
        <img
          src={episode.thumbnail}
          alt=""
          loading="lazy"
          className="h-11 w-20 shrink-0 rounded object-cover ring-1 ring-white/10"
        />
      ) : (
        <span className="grid h-11 w-20 shrink-0 place-items-center rounded bg-ink-850 text-white/15 ring-1 ring-white/5">
          <Clapperboard size={14} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white">
          {episode.title ?? `Episode ${episode.number}`}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-white/30">
          {episode.runtimeMinutes ? <span>{episode.runtimeMinutes} min</span> : null}
          {valid ? <span>{date.toLocaleDateString()}</span> : <span className="text-white/20">air date unknown</span>}
          {episode.site ? <span>{episode.site}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={!canPlay}
          onClick={onPlay}
          aria-label={`Play episode ${episode.number}`}
          className="rounded-md bg-white/6 p-1.5 text-white/60 transition hover:bg-accent hover:text-black disabled:opacity-25 disabled:hover:bg-white/6 disabled:hover:text-white/60"
        >
          <Play size={12} />
        </button>
        <button
          type="button"
          onClick={onDownload}
          aria-label={`Download episode ${episode.number}`}
          className="rounded-md bg-white/6 p-1.5 text-white/60 transition hover:bg-white/12 hover:text-white"
        >
          <Download size={12} />
        </button>
      </div>
    </li>
  )
}

function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative space-y-2.5 border-l border-white/10 pl-4">
      {entries.map((entry) => (
        <li key={`${entry.id}-${entry.position}`} className="relative">
          <span className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-accent ring-2 ring-ink-900" />
          <Link to={`/anime/${entry.id}`} className="group flex items-baseline gap-2">
            <span className="w-5 shrink-0 text-[10px] text-white/25 tabular-nums">{entry.position}.</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-white/80 transition group-hover:text-accent">
                {entry.title}
              </span>
              <span className="mt-0.5 block text-[10px] text-white/30">
                {[entry.year ?? 'TBA', formatMediaType(entry.format), entry.episodes ? `${entry.episodes} ep` : null]
                  .filter(Boolean)
                  .join(' · ')}
                {entry.uncertain ? ' · date uncertain' : ''}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

export default function AnimeDetailPage() {
  const { id } = useParams()
  const mediaId = Number(id)
  const toast = useToast()
  const openDetail = useDetail()
  const bookmarks = useBookmarks()
  const [params, setParams] = useSearchParams()

  const revealSpoilers = params.get('spoilers') === '1'
  const order = params.get('order') === 'chronological' ? 'chronological' : 'release'

  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<AnimeNote | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [expandedSynopsis, setExpandedSynopsis] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportField, setReportField] = useState('title')
  const [reportMessage, setReportMessage] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['SEQUEL', 'PREQUEL']))

  const load = useCallback(async () => {
    if (!Number.isInteger(mediaId) || mediaId <= 0) {
      setError('Invalid anime id')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.detail(mediaId, { spoilers: revealSpoilers, order })
      setDetail(res)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this anime')
    } finally {
      setLoading(false)
    }
  }, [mediaId, revealSpoilers, order])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!Number.isInteger(mediaId) || mediaId <= 0) return
    let alive = true
    api
      .animeNotes(mediaId)
      .then((res) => {
        if (!alive) return
        setNote(res)
        setNoteDraft(res.note)
      })
      .catch(() => {
        /* notes are optional */
      })
    return () => {
      alive = false
    }
  }, [mediaId])

  const saved = useMemo(
    () => Boolean(detail && bookmarks.some((b) => b.mediaId === detail.id)),
    [bookmarks, detail],
  )

  // Season selector: prequels/sequels plus the current title, in air order.
  const seasonOptions = useMemo(() => {
    if (!detail) return []
    const entries = [
      {
        id: detail.id,
        title: detail.title,
        seasonYear: detail.seasonYear,
        season: detail.season,
        current: true,
      },
      ...(detail.relatedSeasons ?? []).map((season) => ({
        id: season.id,
        title: season.title,
        seasonYear: season.seasonYear,
        season: season.season,
        current: false,
      })),
    ]
    return entries.sort(
      (a, b) =>
        (a.seasonYear ?? 9999) - (b.seasonYear ?? 9999) ||
        Number(SEASON_ORDER[a.season ?? ''] ?? 9) - Number(SEASON_ORDER[b.season ?? ''] ?? 9) ||
        a.id - b.id,
    )
  }, [detail])

  function setParam(key: string, value: string | null) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === null) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  async function saveNote() {
    setNoteSaving(true)
    try {
      const res = await api.saveAnimeNotes(mediaId, noteDraft)
      setNote(res)
      toast(res.note ? 'Note saved' : 'Note removed')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the note', 'err')
    } finally {
      setNoteSaving(false)
    }
  }

  async function submitReport() {
    if (!reportMessage.trim()) return
    setReportBusy(true)
    try {
      const res = await api.reportAnimeIssue(mediaId, {
        field: reportField,
        message: reportMessage.trim(),
        kind: reportField === 'episode-order' ? 'episode-order' : 'metadata',
      })
      toast(`Thanks — report ${res.report.id} queued for review`)
      setReportMessage('')
      setReportOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not file the report', 'err')
    } finally {
      setReportBusy(false)
    }
  }

  async function onBookmark() {
    if (!detail) return
    try {
      await toggleBookmark(detail)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  function printSheet() {
    if (!detail) return
    const lines: string[] = [`# ${detail.title}`, '']
    const meta = [
      detail.format ? `Format: ${detail.format}` : null,
      detail.season ? `Season: ${formatSeason(detail.season, detail.seasonYear)}` : null,
      detail.status ? `Status: ${detail.status}` : null,
      detail.episodes ? `Episodes: ${detail.episodes}` : null,
      detail.duration ? `Runtime: ${detail.duration} min` : null,
      detail.score ? `Score: ${detail.score}/100` : null,
      detail.studios?.length ? `Studios: ${detail.studios.join(', ')}` : null,
      detail.genres?.length ? `Genres: ${detail.genres.join(', ')}` : null,
    ].filter(Boolean) as string[]
    lines.push(...meta, '', detail.synopsis?.text ?? '')
    if (detail.relatedSeasons?.length) {
      lines.push('', '## Watch order', '')
      detail.relatedSeasons.forEach((season, index) => {
        lines.push(`${index + 2}. ${season.title} (${season.relationType.toLowerCase()})`)
      })
    }
    if (detail.links?.length) {
      lines.push('', '## Links', '')
      for (const link of detail.links) lines.push(`- ${link.site}: ${link.url}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${detail.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-sheet.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Information sheet downloaded')
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-950/50 p-5 text-sm text-red-200 ring-1 ring-red-500/30">
        <p>{error}</p>
        <Link to="/browse" className="mt-3 inline-block rounded-lg bg-white/8 px-3 py-1.5 text-xs text-white/80">
          Browse instead
        </Link>
      </div>
    )
  }

  if (loading && !detail) return <CardSkeletons count={6} />
  if (!detail) return null

  const episodes = detail.episodesGuide ?? []
  const relations = detail.relations ?? []
  const timeline = detail.timeline ?? []
  const scores = detail.scores ?? null
  const synopsisText = detail.synopsis?.text ?? ''
  const synopsisTooLong = synopsisText.length > 420
  const shownSynopsis =
    expandedSynopsis || !synopsisTooLong ? synopsisText : `${synopsisText.slice(0, 420).trimEnd()}…`

  return (
    <article>
      <Link to="/browse" className="inline-flex items-center gap-1.5 text-xs text-white/45 transition hover:text-white">
        <ArrowLeft size={13} /> Back to browse
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="relative mt-3 overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-white/6">
        {detail.banner ? (
          <img src={detail.banner} alt="" className="h-36 w-full object-cover opacity-45 md:h-48" />
        ) : (
          <div
            className="h-24 w-full md:h-32"
            style={{ background: `linear-gradient(120deg, ${detail.color ?? '#1a1a20'}, transparent)` }}
          />
        )}
        <div className="flex flex-wrap items-start gap-4 p-4 md:-mt-16 md:p-5">
          {detail.cover ? (
            <img
              src={detail.cover}
              alt=""
              className="h-40 w-28 shrink-0 rounded-xl object-cover shadow-xl ring-1 ring-white/10 md:h-52 md:w-36"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">{detail.title}</h1>
            {detail.romaji && detail.romaji !== detail.title ? (
              <p className="mt-0.5 text-xs text-white/35">{detail.romaji}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
              {detail.score ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">
                  <Star size={10} /> {detail.score}/100
                </span>
              ) : null}
              <span>{formatMediaType(detail.format)}</span>
              {detail.season ? <span>· {formatSeason(detail.season, detail.seasonYear)}</span> : null}
              <span>· {detail.status.replace(/_/g, ' ').toLowerCase()}</span>
              {detail.episodes ? <span>· {detail.episodes} episodes</span> : null}
              {detail.duration ? <span>· {detail.duration} min</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openDetail(detail, { watch: true })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
              >
                <Play size={13} /> Watch
              </button>
              <button
                type="button"
                onClick={() => void onBookmark()}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ring-1 transition ${
                  saved
                    ? 'bg-accent/15 text-accent ring-accent/40'
                    : 'bg-white/6 text-white/70 ring-white/10 hover:text-white'
                }`}
              >
                <Bookmark size={13} className={saved ? 'fill-accent' : ''} /> {saved ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                onClick={printSheet}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-2 text-xs font-medium text-white/70 ring-1 ring-white/10 transition hover:text-white"
              >
                <Printer size={13} /> Export sheet
              </button>
              <button
                type="button"
                onClick={() => setReportOpen((v) => !v)}
                aria-expanded={reportOpen}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-2 text-xs font-medium text-white/70 ring-1 ring-white/10 transition hover:text-white"
              >
                <Flag size={13} /> Report an issue
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Season selector (AV-080) */}
      {seasonOptions.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-ink-900 px-3 py-2.5 ring-1 ring-white/6">
          <Layers size={13} className="text-accent" />
          <span className="mr-1 text-[11px] tracking-wider text-white/35 uppercase">Season</span>
          {seasonOptions.map((option) =>
            option.current ? (
              <span
                key={option.id}
                aria-current="page"
                className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black"
              >
                {formatSeason(option.season, option.seasonYear)}
              </span>
            ) : (
              <Link
                key={option.id}
                to={`/anime/${option.id}`}
                title={option.title}
                className="rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                {formatSeason(option.season, option.seasonYear)}
              </Link>
            ),
          )}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {/* Overview + spoiler control (AV-091/092) */}
          <SectionCard
            id="overview"
            title="Overview"
            icon={Info}
            action={
              detail.hasSpoilers ? (
                <button
                  type="button"
                  onClick={() => setParam('spoilers', revealSpoilers ? null : '1')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1 text-[11px] text-white/65 ring-1 ring-white/10 transition hover:text-white"
                >
                  {revealSpoilers ? <EyeOff size={11} /> : <Eye size={11} />}
                  {revealSpoilers ? 'Hide spoilers' : 'Reveal spoilers'}
                </button>
              ) : null
            }
          >
            {!revealSpoilers && detail.overview ? (
              <p className="text-[13px] leading-relaxed text-white/65">{detail.overview}</p>
            ) : null}
            <p className={`text-[13px] leading-relaxed text-white/65 ${!revealSpoilers && detail.overview ? 'mt-2' : ''}`}>
              {shownSynopsis || 'No synopsis available yet.'}
            </p>
            {detail.synopsis && detail.synopsis.hiddenCount > 0 && !revealSpoilers ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-200 ring-1 ring-amber-500/25">
                <ShieldAlert size={11} />
                {detail.synopsis.hiddenCount} spoiler{detail.synopsis.hiddenCount === 1 ? '' : 's'} hidden
              </p>
            ) : null}
            {synopsisTooLong ? (
              <button
                type="button"
                onClick={() => setExpandedSynopsis((v) => !v)}
                className="mt-2 text-[11px] text-accent underline decoration-dotted"
              >
                {expandedSynopsis ? 'Show less' : 'Read more'}
              </button>
            ) : null}
            {detail.genres?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {detail.genres.map((genre) => (
                  <Link
                    key={genre}
                    to={`/browse?genres=${encodeURIComponent(genre)}`}
                    className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] text-white/55 ring-1 ring-white/10 transition hover:text-white"
                  >
                    {genre}
                  </Link>
                ))}
              </div>
            ) : null}
          </SectionCard>

          {/* Episode guide (AV-077/078/079) */}
          <SectionCard
            id="episodes"
            title={`Episode guide${episodes.length ? ` · ${episodes.length}` : ''}`}
            icon={ListOrdered}
            action={
              episodes.length > 0 ? (
                <span className="text-[10px] text-white/25">
                  {episodes.filter((e) => e.hasMetadata).length} with titles
                </span>
              ) : null
            }
          >
            {episodes.length === 0 ? (
              <p className="text-xs text-white/40">No episode information published for this title yet.</p>
            ) : (
              <ul className="-mx-1 divide-y divide-white/5">
                {episodes.map((episode) => (
                  <EpisodeRow
                    key={episode.number}
                    episode={episode}
                    canPlay={Boolean(detail.airedEpisodes >= episode.number || detail.status === 'FINISHED')}
                    onPlay={() => openDetail(detail, { watch: true })}
                    onDownload={() => openDetail(detail)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>

          {/* Related content (AV-081/082) */}
          <SectionCard id="relations" title="Related" icon={Layers}>
            {relations.length === 0 ? (
              <p className="text-xs text-white/40">No related titles catalogued.</p>
            ) : (
              <div className="space-y-1.5">
                {(relations as RelationGroup[]).map((group) => {
                  const open = openGroups.has(group.key)
                  return (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenGroups((prev) => {
                            const next = new Set(prev)
                            if (next.has(group.key)) next.delete(group.key)
                            else next.add(group.key)
                            return next
                          })
                        }
                        aria-expanded={open}
                        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-white/[0.02]"
                      >
                        <span className="text-[11px] font-medium text-white/70">{group.label}</span>
                        <span className="rounded-full bg-white/6 px-1.5 text-[10px] text-white/40 tabular-nums">
                          {group.items.length}
                        </span>
                        <ChevronDown
                          size={12}
                          className={`ml-auto text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {open ? (
                        <div className="grid gap-1.5 pb-1.5 sm:grid-cols-2">
                          {group.items.map((item) => (
                            <Link
                              key={item.id}
                              to={`/anime/${item.id}`}
                              className="flex items-center gap-2.5 rounded-lg bg-ink-850 p-2 ring-1 ring-white/5 transition hover:ring-accent/30"
                            >
                              {item.cover ? (
                                <img src={item.cover} alt="" loading="lazy" className="h-12 w-9 rounded object-cover" />
                              ) : (
                                <span className="grid h-12 w-9 place-items-center rounded bg-white/5 text-white/20">
                                  {item.type === 'MANGA' ? <FileText size={12} /> : <Clapperboard size={12} />}
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] text-white/80">{item.title}</span>
                                <span className="block text-[10px] text-white/30">
                                  {[
                                    item.type === 'MANGA' ? 'Manga' : formatMediaType(item.format),
                                    item.seasonYear ?? null,
                                    item.episodes ? `${item.episodes} ep` : null,
                                    item.averageScore ? `${item.averageScore}%` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </span>
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>

          {/* Franchise timeline (AV-083) */}
          {timeline.length > 1 ? (
            <SectionCard
              id="timeline"
              title="Franchise timeline"
              icon={CalendarDays}
              action={
                <div className="flex items-center gap-1 rounded-lg bg-ink-850 p-0.5 ring-1 ring-white/5">
                  {(['release', 'chronological'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={order === mode}
                      onClick={() => setParam('order', mode === 'release' ? null : mode)}
                      className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                        order === mode ? 'bg-accent text-black' : 'text-white/50 hover:text-white'
                      }`}
                    >
                      {mode === 'release' ? 'Release order' : 'Chronological'}
                    </button>
                  ))}
                </div>
              }
            >
              <TimelineList entries={timeline} />
              <p className="mt-2 text-[10px] text-white/25">
                Chronological ordering follows premiere dates; undated entries are listed last and marked uncertain.
              </p>
            </SectionCard>
          ) : null}

          {/* Characters (AV-085) */}
          {detail.characters?.length ? (
            <SectionCard id="characters" title="Characters" icon={Users}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {detail.characters.map((character) => (
                  <div key={character.id} className="flex items-center gap-2 rounded-lg bg-ink-850 p-2">
                    {character.image ? (
                      <img src={character.image} alt="" loading="lazy" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/5 text-white/20">
                        <Users size={13} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-white/80">{character.name}</span>
                      <span className="block truncate text-[10px] text-white/30">
                        {character.role.toLowerCase()}
                        {character.voiceActors[0] ? ` · ${character.voiceActors[0].name}` : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {/* Staff (AV-086/087) */}
          {detail.staff?.length ? (
            <SectionCard id="staff" title="Staff & cast" icon={Clapperboard}>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {detail.staff.map((member) => (
                  <li key={member.id} className="flex items-center gap-2 rounded-lg bg-ink-850 p-2">
                    {member.image ? (
                      <img src={member.image} alt="" loading="lazy" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5 text-white/20">
                        <Users size={12} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-white/80">{member.name}</span>
                      <span className="block truncate text-[10px] text-white/30">{member.role ?? member.occupations.join(', ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {scores ? (
            <SectionCard id="scores" title="Score distribution" icon={Star}>
              <div className="space-y-1">
                {scores.buckets.map((bucket) => (
                  <div key={bucket.score} className="flex items-center gap-2">
                    <span className="w-6 text-right text-[10px] text-white/30 tabular-nums">{bucket.score}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(1, bucket.percent)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[10px] text-white/30 tabular-nums">{bucket.percent}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-white/30">
                {scores.total.toLocaleString()} ratings · mean {detail.scoreMean ?? '—'}
                {detail.scoreMode ? ` · most common ${detail.scoreMode.score}` : ''}
              </p>
            </SectionCard>
          ) : null}

          {detail.statusTimeline?.length ? (
            <SectionCard id="status" title="Release timeline" icon={CalendarDays}>
              <ol className="space-y-2">
                {detail.statusTimeline.map((event) => (
                  <li key={`${event.label}-${event.display}`} className="flex items-baseline gap-2 text-[11px]">
                    <span className="w-20 shrink-0 text-white/30 tabular-nums">{event.display}</span>
                    <span className="min-w-0 flex-1 text-white/70">{event.label}</span>
                  </li>
                ))}
              </ol>
            </SectionCard>
          ) : null}

          {detail.rankings?.length ? (
            <SectionCard id="rankings" title="Rankings" icon={Sparkles}>
              <ul className="space-y-1">
                {detail.rankings.map((ranking) => (
                  <li key={`${ranking.type}-${ranking.context}-${ranking.rank}`} className="flex items-baseline gap-2 text-[11px]">
                    <span className="font-medium text-accent tabular-nums">#{ranking.rank}</span>
                    <span className="text-white/50">
                      {ranking.allTime ? 'all time' : ranking.season ? formatSeason(ranking.season, ranking.year) : ranking.context}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {(detail as unknown as { studios?: string[] }).studios?.length ? (
            <SectionCard id="studios" title="Studios" icon={Clapperboard}>
              <ul className="space-y-1">
                {detail.studios.map((studio) => (
                  <li key={studio} className="text-[11px] text-white/70">
                    {studio}
                  </li>
                ))}
              </ul>
              {detail.links?.length ? (
                <p className="mt-2 text-[10px] text-white/25">
                  Metadata and artwork provided by AniList. Streaming availability varies by region.
                </p>
              ) : null}
            </SectionCard>
          ) : null}

          {detail.links?.length ? (
            <SectionCard id="links" title="External links" icon={Info}>
              <ul className="space-y-1">
                {detail.links.map((link) => (
                  <li key={`${link.site}-${link.url}`}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block truncate text-[11px] text-white/60 underline decoration-dotted transition hover:text-accent"
                    >
                      {link.site}
                    </a>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {/* Notes (AV-099) */}
          <SectionCard id="notes" title="My notes" icon={FileText}>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value.slice(0, 4000))}
              rows={4}
              placeholder="Private notes for this title — only visible on this device."
              className="w-full resize-y rounded-lg bg-ink-850 p-2.5 text-[11px] leading-relaxed text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveNote()}
                disabled={noteSaving || noteDraft === (note?.note ?? '')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
              >
                {noteSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Save note
              </button>
              <span className="text-[10px] text-white/25 tabular-nums">{noteDraft.length}/4000</span>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Report dialog (AV-096/097) */}
      {reportOpen ? (
        <div className="mt-3 rounded-xl bg-ink-900 p-4 ring-1 ring-amber-500/25">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Flag size={13} className="text-amber-300" />
            Report a problem
          </h2>
          <p className="mt-1 text-[11px] text-white/40">
            Corrections go to a local review queue. Nothing is sent anywhere automatically.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={reportField}
              onChange={(event) => setReportField(event.target.value)}
              className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              {['title', 'episodes', 'season', 'year', 'format', 'status', 'score', 'synopsis', 'studio', 'relations', 'episode-order', 'other'].map(
                (field) => (
                  <option key={field} value={field}>
                    {field.replace(/-/g, ' ')}
                  </option>
                ),
              )}
            </select>
            <input
              type="text"
              value={reportMessage}
              onChange={(event) => setReportMessage(event.target.value.slice(0, 1000))}
              placeholder="What is wrong?"
              className="min-w-40 flex-1 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <button
              type="button"
              onClick={() => void submitReport()}
              disabled={!reportMessage.trim() || reportBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-amber-300 disabled:opacity-40"
            >
              {reportBusy ? <Loader2 size={11} className="animate-spin" /> : <Flag size={11} />}
              Submit report
            </button>
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="rounded-lg bg-white/6 px-2.5 py-1.5 text-[11px] text-white/60 transition hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {inferSeasonFromTitle(detail.title) && detail.relatedSeasons?.length ? (
        <p className="mt-4 text-[10px] text-white/20">
          Episode numbering: {formatEpisodeCode(inferSeasonFromTitle(detail.title).season, 1)} …
        </p>
      ) : null}
    </article>
  )
}
