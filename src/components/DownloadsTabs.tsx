import { NavLink } from 'react-router-dom'
import { useDownloads, useLibrary } from '../lib/downloads'

export function DownloadsTabs() {
  const { counts } = useDownloads()
  const { stats } = useLibrary()
  const pending = counts.active + counts.queued + counts.paused

  const base = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition'
  const active = 'bg-accent text-black font-semibold'
  const idle = 'text-white/55 hover:bg-white/5 hover:text-white'

  return (
    <div className="mb-5 inline-flex items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
      <NavLink to="/downloads" className={({ isActive }) => `${base} ${isActive ? active : idle}`}>
        Downloads Queue
        {pending > 0 ? (
          <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] tabular-nums">
            {pending}
          </span>
        ) : null}
      </NavLink>
      <NavLink to="/downloaded" className={({ isActive }) => `${base} ${isActive ? active : idle}`}>
        Downloaded Library
        {stats.totalFiles > 0 ? (
          <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] tabular-nums">
            {stats.totalFiles}
          </span>
        ) : null}
      </NavLink>
    </div>
  )
}
