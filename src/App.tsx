import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { DetailProvider } from './components/MediaModal'
import { PlayerProvider } from './components/Player'
import { ToastProvider } from './components/Toasts'
import {
  BookmarksPage,
  BrowsePage,
  DownloadedPage,
  DownloadsPage,
  HomePage,
  SchedulePage,
  SearchPage,
  SettingsPage,
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

export default function App() {
  return (
    <ToastProvider>
      <PlayerProvider>
        <DetailProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<LazyPage><HomePage /></LazyPage>} />
              <Route path="browse" element={<LazyPage><BrowsePage /></LazyPage>} />
              <Route path="schedule" element={<LazyPage><SchedulePage /></LazyPage>} />
              <Route path="search" element={<LazyPage><SearchPage /></LazyPage>} />
              <Route path="downloads" element={<LazyPage><DownloadsPage /></LazyPage>} />
              <Route path="downloaded" element={<LazyPage><DownloadedPage /></LazyPage>} />
              <Route path="bookmarks" element={<LazyPage><BookmarksPage /></LazyPage>} />
              <Route path="settings" element={<LazyPage><SettingsPage /></LazyPage>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </DetailProvider>
      </PlayerProvider>
    </ToastProvider>
  )
}
