import { NavLink } from 'react-router-dom'
import { useJobs } from '../lib/downloads'

export function DownloadsTabs() {
  const jobs = useJobs()
  const queued = jobs.filter((j) => j.status !== 'completed').length

  const base = 'rounded-md px-3 py-1.5 text-xs font-medium transition'
  const active = 'bg-accent text-black'
  const idle = 'text-white/55 hover:bg-white/5 hover:text-white'

  return (
    <div className="mb-5 inline-flex items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
      <NavLink to="/downloads" className={({ isActive }) => `${base} ${isActive ? active : idle}`}>
        Queue
        {queued > 0 ? <span className="ml-1.5 text-[10px] opacity-70">{queued}</span> : null}
      </NavLink>
      <NavLink to="/downloaded" className={({ isActive }) => `${base} ${isActive ? active : idle}`}>
        Downloaded
      </NavLink>
    </div>
  )
}
