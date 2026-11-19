import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  FolderDown,
  ImagePlus,
  Loader2,
  Play,
  Star,
  Upload,
} from 'lucide-react'
import type { Media } from '../types'
import { api } from '../lib/api'
import { artworkForMedia, focusObjectClass, useArtwork } from '../lib/artwork'
import { useAsync } from '../lib/hooks'
import { toggleBookmark, useBookmarks } from '../lib/bookmarks'
import { enqueueBulkDownload } from '../lib/downloads'
import { useSettings } from '../lib/settings'
import { formatMediaType, formatSeason, inferSeasonFromTitle, relativeTime } from '../lib/format'
import { ImdbArtworkModal } from '../components/ImdbArtworkModal'
import { CardSkeletons } from '../components/MediaCard'
import { MediaRow } from '../components/MediaRow'
import { ContinueWatching } from '../components/ContinueWatching'
import { useDetail } from '../components/MediaModal'
import { useToast } from '../components/Toasts'

export default function Home() {
  const season = useAsync(() => api.season({}), [])
  const airing = useAsync(() => api.airing(), [])
  const rated = useAsync(() => api.season({ sort: 'rated' }), [])

  const seasonMedia = season.data?.media ?? []
  const airingMedia = airing.data?.media ?? []
  const ratedMedia = rated.data?.media ?? []

  const hero =
    seasonMedia.find((m) => m.banner) ?? airingMedia.find((m) => m.banner) ?? seasonMedia[0] ?? airingMedia[0]

  const error = season.error ?? airing.error

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">This Season</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {season.data
              ? `${formatSeason(season.data.season, season.data.year)}${
                  season.data.total ? ` · ${season.data.total} titles` : ''
                } · updated from official listings`
              : 'Loading the current season…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/downloads?bulk=1"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/35 transition hover:bg-accent/25"
          >
            <FolderDown size={13} />
            Bulk Download Season
          </Link>
          <Link
            to="/downloaded?upload=movie"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-white/12 transition hover:bg-white/12 hover:text-white"
          >
            <Upload size={13} className="text-accent" />
            Upload Movie
          </Link>
          <Link
            to="/browse"
            className="text-xs font-medium text-white/50 transition hover:text-accent"
          >
            Browse seasons →
          </Link>
        </div>
      </div>

      {error && !seasonMedia.length ? (
        <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
          {error}
          <button
            type="button"
            onClick={() => season.reload()}
            className="ml-3 rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-white transition hover:bg-white/20"
          >
            Retry
          </button>
        </div>
      ) : null}

      {hero ? <Hero media={hero} /> : <HeroSkeleton />}

      <ContinueWatching />

      <div className="mt-9 space-y-9">
        {season.loading && !seasonMedia.length ? (
          <CardSkeletons />
        ) : (
          <>
            <MediaRow
              title="Airing now"
              subtitle="Sorted by the next episode broadcast"
              items={airingMedia.slice(0, 18)}
              href="/schedule"
            />
            <MediaRow
              title={`Popular ${formatSeason(season.data?.season ?? null, season.data?.year ?? null)}`}
              subtitle="Most tracked shows of the season"
              items={seasonMedia.slice(0, 18)}
              href="/browse?sort=popular"
            />
            <MediaRow
              title="Top rated this season"
              subtitle="Highest community scores"
              items={ratedMedia.slice(0, 18)}
              href="/browse?sort=rated"
            />
          </>
        )}
      </div>
    </div>
  )
}

function Hero({ media }: { media: Media }) {
  const open = useDetail()
  const toast = useToast()
  const settings = useSettings()
  const artwork = useArtwork()
  const mediaArt = artworkForMedia(artwork, media)
  const heroBanner = mediaArt?.banner
    ? `${mediaArt.banner.url}?v=${mediaArt.banner.updatedAt}`
    : artwork.app?.banner
      ? `${artwork.app.banner.url}?v=${artwork.app.banner.updatedAt}`
      : media.banner
  const heroBannerFocus = mediaArt?.banner?.focus ?? artwork.app?.banner?.focus ?? 'center'
  const heroPoster = mediaArt?.poster
    ? `${mediaArt.poster.url}?v=${mediaArt.poster.updatedAt}`
    : media.cover
  const bookmarks = useBookmarks()
  const [seasonBusy, setSeasonBusy] = useState(false)
  const [imdbOpen, setImdbOpen] = useState(false)
  const saved = bookmarks.some((b) => b.mediaId === media.id)

  async function onBookmark() {
    try {
      await toggleBookmark(media)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  async function onDownloadSeason() {
    if (seasonBusy) return
    setSeasonBusy(true)
    try {
      const inferred = inferSeasonFromTitle(media.title)
      const count = media.airedEpisodes > 0 ? media.airedEpisodes : media.episodes ?? undefined
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
        toast(`Queued ${res.queuedCount} episode${res.queuedCount === 1 ? '' : 's'} of ${media.title}`)
      } else if (res.skippedDownloaded > 0) {
        toast(`Whole season of ${media.title} is already in your local library`)
      } else {
        toast(`${media.title} is already queued`)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue season', 'err')
    } finally {
      setSeasonBusy(false)
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-white/10">
      {heroBanner ? (
        <img
          src={heroBanner}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover opacity-55 ${focusObjectClass(heroBannerFocus)}`}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/75 to-ink-950/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-transparent to-transparent" />

      <div className="relative flex flex-col gap-5 p-5 pt-32 md:flex-row md:items-end md:p-9 md:pt-40">
        <div className="hidden w-36 shrink-0 sm:block md:w-44">
          <div className="aspect-2/3 overflow-hidden rounded-xl bg-ink-800 shadow-2xl ring-1 ring-white/10">
            {heroPoster ? (
              <img
                src={heroPoster}
                alt={media.title}
                className={`h-full w-full object-cover ${focusObjectClass(mediaArt?.poster?.focus)}`}
              />
            ) : null}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-accent/15 px-2 py-0.5 font-semibold tracking-wide text-accent uppercase">
              {media.status === 'RELEASING' ? 'Airing now' : 'Season spotlight'}
            </span>
            {media.score ? (
              <span className="inline-flex items-center gap-1 font-medium text-amber-300">
                <Star size={11} className="fill-amber-300" />
                {media.score}%
              </span>
            ) : null}
            <span className="text-white/50">
              {formatMediaType(media.format)} · {formatSeason(media.season, media.seasonYear)}
            </span>
            {media.nextEpisode ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-white/70">
                <CalendarClock size={11} />
                EP {media.nextEpisode.episode} {relativeTime(media.nextEpisode.airingAt)}
              </span>
            ) : null}
          </div>

          <h2 className="mt-2 text-2xl leading-tight font-semibold text-white md:text-4xl">{media.title}</h2>

          {media.description ? (
            <p className="mt-2.5 line-clamp-3 max-w-2xl text-sm leading-relaxed text-white/60">
              {media.description}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => open(media, { watch: true })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition hover:bg-accent-600"
            >
              <Play size={16} />
              Watch episode
            </button>
            <button
              type="button"
              onClick={() => void onDownloadSeason()}
              disabled={seasonBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent/18 px-4 py-2.5 text-sm font-semibold text-accent ring-1 ring-accent/45 backdrop-blur transition hover:bg-accent/28 disabled:opacity-50"
            >
              {seasonBusy ? <Loader2 size={15} className="animate-spin" /> : <FolderDown size={15} />}
              Download Season
            </button>
            <button
              type="button"
              onClick={() => open(media)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-white/15"
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => void onBookmark()}
              aria-label={saved ? 'Remove bookmark' : 'Add bookmark'}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium ring-1 backdrop-blur transition ${
                saved
                  ? 'bg-accent/15 text-accent ring-accent/40'
                  : 'bg-black/30 text-white/80 ring-white/15 hover:text-white'
              }`}
            >
              {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
              {saved ? 'Saved' : 'Bookmark'}
            </button>
            <button
              type="button"
              onClick={() => setImdbOpen(true)}
              title="Claim banner, poster, or app icon from IMDb (e.g. tt0234144)"
              className="inline-flex items-center gap-1.5 rounded-lg bg-black/35 px-3 py-2.5 text-sm font-medium text-amber-200 ring-1 ring-amber-400/30 backdrop-blur transition hover:bg-amber-400/18"
            >
              <ImagePlus size={15} className="text-amber-300" />
              IMDb Photo
            </button>
          </div>
        </div>
      </div>

      {imdbOpen ? (
        <ImdbArtworkModal
          open
          onClose={() => setImdbOpen(false)}
          targetLabel={media.title}
          targetType="media"
          targetKey={String(media.id)}
          initialImdbId={mediaArt?.imdbId}
          searchHint={media.title}
        />
      ) : null}
    </section>
  )
}

function HeroSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-ink-900 p-5 pt-32 ring-1 ring-white/5 md:p-9 md:pt-40">
      <div className="h-3 w-24 rounded bg-ink-800" />
      <div className="mt-4 h-8 w-2/3 rounded bg-ink-800" />
      <div className="mt-3 h-3 w-1/2 rounded bg-ink-800/70" />
      <div className="mt-6 flex gap-2">
        <div className="h-10 w-40 rounded-lg bg-ink-800" />
        <div className="h-10 w-24 rounded-lg bg-ink-800/70" />
      </div>
    </div>
  )
}
