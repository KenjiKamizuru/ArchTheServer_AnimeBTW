import { Link } from 'react-router-dom'
import { Bookmark, BookmarkCheck, CalendarClock, Play, Star } from 'lucide-react'
import type { Media } from '../types'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { toggleBookmark, useBookmarks } from '../lib/bookmarks'
import { formatMediaType, formatSeason, relativeTime } from '../lib/format'
import { CardSkeletons } from '../components/MediaCard'
import { MediaRow } from '../components/MediaRow'
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
        <Link
          to="/browse"
          className="text-xs font-medium text-white/50 transition hover:text-accent"
        >
          Browse other seasons →
        </Link>
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
  const bookmarks = useBookmarks()
  const saved = bookmarks.some((b) => b.mediaId === media.id)

  async function onBookmark() {
    try {
      await toggleBookmark(media)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-white/10">
      {media.banner ? (
        <img
          src={media.banner}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center opacity-55"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/75 to-ink-950/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-transparent to-transparent" />

      <div className="relative flex flex-col gap-5 p-5 pt-32 md:flex-row md:items-end md:p-9 md:pt-40">
        <div className="hidden w-36 shrink-0 sm:block md:w-44">
          <div className="aspect-2/3 overflow-hidden rounded-xl bg-ink-800 shadow-2xl ring-1 ring-white/10">
            {media.cover ? (
              <img src={media.cover} alt={media.title} className="h-full w-full object-cover" />
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
          </div>
        </div>
      </div>
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
