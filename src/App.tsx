import { Suspense, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { DetailProvider } from './components/MediaModal'
import { PlayerProvider } from './components/Player'
import { ToastProvider, useToast } from './components/Toasts'
import { api } from './lib/api'
import {
  AdminInspectPage,
  AnimeDetailPage,
  BookmarksPage,
  BrowsePage,
  CharacterDetailPage,
  DiscoverPage,
  DownloadedPage,
  DownloadsPage,
  HomePage,
  IndexPage,
  SchedulePage,
  SearchPage,
  SettingsPage,
  StaffDetailPage,
  StudioPage,
  StudiosPage,
} from './lib/routePrefetch'

// Every page is its own chunk; hover/focus/idle prefetching (see
// `lib/routePrefetch.ts`) keeps navigation instant without growing the
// first-paint bundle.
function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-64 place-items-center text-sm text-white/40" role="status" aria-live="polite">
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

/** Email verification links (AV-103): mail.mjs links carry ?verify-email=<token>
 * and land on any app route, so the handler lives at the app root. */
function VerifyEmailHandler() {
  const toast = useToast()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('verify-email')
    if (!token) return
    params.delete('verify-email')
    const rest = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
    api.verifyEmail(token).then(
      (res) => toast(`Email verified for ${res.user?.username ?? 'account'}`),
      (err) => toast(err instanceof Error ? err.message : 'Verification failed', 'err'),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export default function App() {
  return (
    <ToastProvider>
      <VerifyEmailHandler />
      <PlayerProvider>
        <DetailProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<LazyPage><HomePage /></LazyPage>} />
              <Route path="browse" element={<LazyPage><BrowsePage /></LazyPage>} />
              <Route path="anime/:id" element={<LazyPage><AnimeDetailPage /></LazyPage>} />
              <Route path="characters/:id" element={<LazyPage><CharacterDetailPage /></LazyPage>} />
              <Route path="staff/:id" element={<LazyPage><StaffDetailPage /></LazyPage>} />
              <Route path="discover" element={<LazyPage><DiscoverPage /></LazyPage>} />
              <Route path="schedule" element={<LazyPage><SchedulePage /></LazyPage>} />
              <Route path="studios" element={<LazyPage><StudiosPage /></LazyPage>} />
              <Route path="studios/:id" element={<LazyPage><StudioPage /></LazyPage>} />
              <Route path="index" element={<LazyPage><IndexPage /></LazyPage>} />
              <Route path="search" element={<LazyPage><SearchPage /></LazyPage>} />
              <Route path="downloads" element={<LazyPage><DownloadsPage /></LazyPage>} />
              <Route path="downloaded" element={<LazyPage><DownloadedPage /></LazyPage>} />
              <Route path="bookmarks" element={<LazyPage><BookmarksPage /></LazyPage>} />
              <Route path="settings" element={<LazyPage><SettingsPage /></LazyPage>} />
              <Route path="admin/inspect" element={<LazyPage><AdminInspectPage /></LazyPage>} />
              <Route path="admin/inspect/:id" element={<LazyPage><AdminInspectPage /></LazyPage>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </DetailProvider>
      </PlayerProvider>
    </ToastProvider>
  )
}
