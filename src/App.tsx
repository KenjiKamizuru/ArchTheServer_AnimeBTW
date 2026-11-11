import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { DetailProvider } from './components/MediaModal'
import { PlayerProvider } from './components/Player'
import { ToastProvider } from './components/Toasts'
import Home from './pages/Home'
import Browse from './pages/Browse'

// Pages behind navigation load as their own chunks, keeping the first paint
// bundle small.
const Schedule = lazy(() => import('./pages/Schedule'))
const Search = lazy(() => import('./pages/Search'))
const Bookmarks = lazy(() => import('./pages/Bookmarks'))
const SettingsPage = lazy(() => import('./pages/Settings'))

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="grid min-h-64 place-items-center text-sm text-white/40">Loading…</div>}>{children}</Suspense>
}

export default function App() {
  return (
    <ToastProvider>
      <PlayerProvider>
        <DetailProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="browse" element={<Browse />} />
              <Route path="schedule" element={<LazyPage><Schedule /></LazyPage>} />
              <Route path="search" element={<LazyPage><Search /></LazyPage>} />
              <Route path="bookmarks" element={<LazyPage><Bookmarks /></LazyPage>} />
              <Route path="settings" element={<LazyPage><SettingsPage /></LazyPage>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </DetailProvider>
      </PlayerProvider>
    </ToastProvider>
  )
}
