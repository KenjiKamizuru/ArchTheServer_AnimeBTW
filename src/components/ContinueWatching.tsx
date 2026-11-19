import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'

// Continue-watching rail (AV-158): in-progress episodes (started with a
// real position), most recently touched first. Signed-out viewers, empty
// progress, and unavailable metadata all render NOTHING — the rail is
// ambient, never an error surface.

function stamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function ContinueWatching() {
  const state = useAsync(() => api.continueWatching(), [])
  const entries = state.data?.entries ?? []
  if (state.loading || state.error || entries.length === 0) return null

  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold tracking-wide text-white/90 md:text-lg">Continue watching</h2>
        <p className="mt-0.5 text-xs text-white/40">Pick up where you left off</p>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {entries.map((row) => (
          <Link key={row.mediaId} to={`/anime/${row.mediaId}`} className="group w-40 shrink-0 snap-start">
            <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
              {row.media.cover ? (
                <img src={row.media.cover} alt="" loading="lazy" className="aspect-[2/3] w-40 object-cover transition group-hover:scale-[1.03]" />
              ) : (
                <div className="grid aspect-[2/3] w-40 place-items-center bg-white/5 text-white/15">
                  <Play size={20} />
                </div>
              )}
            </div>
            <p className="mt-1.5 truncate text-xs font-medium text-white/90 transition group-hover:text-accent">{row.media.title}</p>
            <p className="mt-0.5 text-[10px] text-white/40">
              EP {row.episode} · {stamp(row.positionSeconds)} in
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
