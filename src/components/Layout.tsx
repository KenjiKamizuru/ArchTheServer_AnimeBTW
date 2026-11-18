import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { prefetchProps } from '../lib/routePrefetch'
import {
  Bookmark,
  CalendarClock,
  Download,
  HardDrive,
  ImagePlus,
  LayoutGrid,
  Play,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { artworkForTarget, focusObjectClass, useArtwork } from '../lib/artwork'
import { useDownloads, useLibrary } from '../lib/downloads'
import { useUploads } from '../lib/uploads'

const DESKTOP_NAV = [
  { to: '/', label: 'This Season', icon: Sparkles, end: true, badgeKey: null },
  { to: '/browse', label: 'Browse', icon: LayoutGrid, end: false, badgeKey: null },
  { to: '/schedule', label: 'Airing', icon: CalendarClock, end: false, badgeKey: null },
  { to: '/downloads', label: 'Downloads', icon: Download, end: false, badgeKey: 'queue' as const },
  { to: '/downloaded', label: 'Downloaded', icon: HardDrive, end: false, badgeKey: 'library' as const },
  { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark, end: false, badgeKey: null },
]

const MOBILE_NAV = [
  { to: '/', short: 'Season', icon: Sparkles, end: true, matchLibrary: false },
  { to: '/browse', short: 'Browse', icon: LayoutGrid, end: false, matchLibrary: false },
  { to: '/schedule', short: 'Airing', icon: CalendarClock, end: false, matchLibrary: false },
  { to: '/downloads', short: 'Downloads', icon: Download, end: false, matchLibrary: true },
  { to: '/bookmarks', short: 'Saved', icon: Bookmark, end: false, matchLibrary: false },
]

function Brand() {
  const artwork = useArtwork()
  const appIcon = artwork.app?.icon ?? null
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      {appIcon ? (
        <img
          src={`${appIcon.url}?v=${appIcon.updatedAt}`}
          alt="App icon"
          className={`h-9 w-9 shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-white/15 ${focusObjectClass(appIcon.focus)}`}
        />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-black shadow-lg shadow-accent/20">
          <Play size={17} className="translate-x-px fill-black" />
        </span>
      )}
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
  const artwork = useArtwork()
  const appArt = artworkForTarget(artwork, 'app', 'global')
  const { counts } = useDownloads()
  const { stats } = useLibrary()
  const { activeCount: activeUploads } = useUploads()
  const activeQueue = counts.active + counts.queued + activeUploads

  // Keep browser tab favicon in sync whenever an IMDb App Icon is claimed or reset.
  useEffect(() => {
    if (typeof document === 'undefined') return
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-app-icon="1"]')
    if (appArt?.icon) {
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        link.dataset.appIcon = '1'
        document.head.appendChild(link)
      }
      link.href = `${appArt.icon.url}?v=${appArt.icon.updatedAt}`
    } else if (link) {
      link.remove()
    }
  }, [appArt?.icon?.url, appArt?.icon?.updatedAt])

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

        {appArt?.banner ? (
          <Link
            to="/settings"
            title={
              appArt.imdbTitle
                ? `Banner from ${appArt.imdbTitle} (${appArt.imdbId}) — click to customize`
                : 'Customize app banner & icon'
            }
            className="group relative mt-4 block h-20 overflow-hidden rounded-xl bg-ink-850 ring-1 ring-white/10 transition hover:ring-accent/50"
          >
            <img
              src={`${appArt.banner.url}?v=${appArt.banner.updatedAt}`}
              alt=""
              className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${focusObjectClass(appArt.banner.focus)}`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
            <span className="absolute right-2 bottom-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white/80 opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
              <ImagePlus size={10} className="text-accent" />
              Edit
            </span>
          </Link>
        ) : null}

        <nav className={`${appArt?.banner ? 'mt-4' : 'mt-7'} space-y-1`}>
          {DESKTOP_NAV.map(({ to, label, icon: Icon, end, badgeKey }) => {
            const count =
              badgeKey === 'queue'
                ? activeQueue
                : badgeKey === 'library'
                  ? stats.totalFiles
                  : 0
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                {...prefetchProps(to)}
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
                {count > 0 ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      badgeKey === 'queue'
                        ? 'bg-accent/20 text-accent'
                        : 'bg-white/8 text-white/55'
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </NavLink>
            )
          })}
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
              Downloaded episodes play directly from the{' '}
              <span className="text-white/60">shared local library</span>, with automatic live
              streaming fallback.
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
          {MOBILE_NAV.map(({ to, short, icon: Icon, end, matchLibrary }) => {
            const extraActive = matchLibrary && location.pathname === '/downloaded'
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                {...prefetchProps(to)}
                className={({ isActive }) =>
                  `relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition ${
                    isActive || extraActive ? 'text-accent' : 'text-white/45'
                  }`
                }
              >
                <span className="relative">
                  <Icon size={18} />
                  {matchLibrary && activeQueue > 0 ? (
                    <span className="absolute -top-1 -right-2 rounded-full bg-accent px-1 text-[9px] leading-tight font-bold text-black tabular-nums">
                      {activeQueue}
                    </span>
                  ) : null}
                </span>
                {short}
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
