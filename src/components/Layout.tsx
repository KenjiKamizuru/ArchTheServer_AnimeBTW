import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bookmark,
  CalendarClock,
  LayoutGrid,
  Play,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react'

const NAV = [
  { to: '/', label: 'This Season', short: 'Season', icon: Sparkles, end: true },
  { to: '/browse', label: 'Browse', short: 'Browse', icon: LayoutGrid },
  { to: '/schedule', label: 'Airing', short: 'Airing', icon: CalendarClock },
  { to: '/bookmarks', label: 'Bookmarks', short: 'Saved', icon: Bookmark },
]

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-black shadow-lg shadow-accent/20">
        <Play size={17} className="translate-x-px fill-black" />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-white">AnimeVault</span>
        <span className="block text-[10px] tracking-wider text-white/35 uppercase">watch anime</span>
      </span>
    </Link>
  )
}

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [term, setTerm] = useState('')

  useEffect(() => {
    if (location.pathname === '/search') {
      setTerm(new URLSearchParams(location.search).get('q') ?? '')
    }
  }, [location.pathname, location.search])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const q = term.trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/5 bg-ink-900/70 px-3 py-5 md:flex">
        <Brand />

        <nav className="mt-7 space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  isActive
                    ? 'bg-accent/12 font-medium text-accent'
                    : 'text-white/55 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={17} className="shrink-0" />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-2">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
                isActive ? 'bg-white/5 text-accent' : 'text-white/45 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <Settings2 size={15} />
            Settings
          </NavLink>
          <div className="rounded-xl bg-ink-850 p-3 ring-1 ring-white/5">
            <p className="text-[11px] leading-relaxed text-white/40">
              Metadata from AniList &amp; AniDB. Episodes stream from provider sites through{' '}
              <span className="text-white/60">the built-in resolver</span>.
            </p>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/85 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-3 md:px-8">
            <div className="md:hidden">
              <Brand />
            </div>

            <form onSubmit={onSubmit} className="ml-auto w-full max-w-md md:ml-auto">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/35"
                />
                <input
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search anime…"
                  aria-label="Search anime"
                  className="w-full rounded-lg bg-ink-850 py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/30 ring-1 ring-white/10 outline-none transition focus:bg-ink-800 focus:ring-accent/60"
                />
              </div>
            </form>

            <NavLink
              to="/settings"
              className="shrink-0 rounded-lg bg-ink-850 p-2 text-white/60 ring-1 ring-white/10 transition hover:text-white"
              aria-label="Settings"
            >
              <Settings2 size={17} />
            </NavLink>
          </div>
        </header>

        <main className="px-4 pt-5 pb-28 md:px-8 md:pt-7 md:pb-14">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="flex items-stretch justify-around">
          {NAV.map(({ to, short, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition ${
                  isActive ? 'text-accent' : 'text-white/45'
                }`
              }
            >
              <Icon size={18} />
              {short}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
