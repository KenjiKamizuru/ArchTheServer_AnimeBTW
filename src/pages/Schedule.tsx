import { Bookmark, BookmarkCheck, CalendarClock, Play } from 'lucide-react'
import type { Media } from '../types'
import { api } from '../lib/api'
import { useAsync, useNow } from '../lib/hooks'
import { toggleBookmark, useBookmarks } from '../lib/bookmarks'
import { dayLabel, formatMediaType, relativeTime } from '../lib/format'
import { useDetail } from '../components/MediaModal'
import { useToast } from '../components/Toasts'

export default function Schedule() {
  const { data, error, loading } = useAsync(() => api.airing(), [])
  const now = useNow(30_000)
  const media = (data?.media ?? []).filter((m) => m.nextEpisode)

  const groups: { label: string; items: Media[] }[] = []
  for (const item of media) {
    const label = dayLabel(item.nextEpisode!.airingAt)
    const existing = groups.find((g) => g.label === label)
    if (existing) existing.items.push(item)
    else groups.push({ label, items: [item] })
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Airing now</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Next broadcasts in your local time · refreshed from official schedules
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-850 px-2.5 py-1 text-[11px] text-white/45 ring-1 ring-white/5">
          <CalendarClock size={12} />
          {media.length} shows tracked
        </span>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">
          {error}
        </div>
      ) : null}

      {loading && !media.length ? (
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-ink-900" />
          ))}
        </div>
      ) : null}

      <div className="mt-6 space-y-7">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-white/35 uppercase">
              {group.label}
            </h2>
            <div className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-white/5">
              {group.items.map((item) => (
                <ScheduleRow key={item.id} media={item} now={now} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function ScheduleRow({ media, now }: { media: Media; now: number }) {
  const open = useDetail()
  const toast = useToast()
  const bookmarks = useBookmarks()
  const saved = bookmarks.some((b) => b.mediaId === media.id)
  const next = media.nextEpisode!

  async function onBookmark() {
    try {
      await toggleBookmark(media)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update bookmarks', 'err')
    }
  }

  return (
    <div className="group flex items-center gap-3 border-b border-white/5 px-3 py-2.5 transition last:border-0 hover:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => open(media)}
        className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-ink-800 ring-1 ring-white/5"
        aria-label={`View ${media.title}`}
      >
        {media.cover ? (
          <img src={media.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : null}
      </button>

      <button type="button" onClick={() => open(media)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-white/90 transition group-hover:text-accent">
          {media.title}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-white/40">
          EP {next.episode} · {formatMediaType(media.format)} ·{' '}
          {new Date(next.airingAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </p>
      </button>

      <span
        className={`hidden shrink-0 rounded-md px-2 py-1 text-[11px] font-medium tabular-nums sm:block ${
          next.airingAt * 1000 <= now ? 'bg-white/5 text-white/40' : 'bg-accent/12 text-accent'
        }`}
      >
        {next.airingAt * 1000 <= now ? 'Airing now' : relativeTime(next.airingAt * 1000)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void onBookmark()}
          aria-label={saved ? 'Remove bookmark' : 'Add bookmark'}
          className="rounded-md p-2 text-white/40 transition hover:bg-white/5 hover:text-accent"
        >
          {saved ? <BookmarkCheck size={15} className="text-accent" /> : <Bookmark size={15} />}
        </button>
        <button
          type="button"
          onClick={() => open(media, { watch: true })}
          aria-label={`Watch ${media.title}`}
          className="rounded-md p-2 text-white/40 transition hover:bg-white/5 hover:text-accent"
        >
          <Play size={15} />
        </button>
      </div>
    </div>
  )
}
