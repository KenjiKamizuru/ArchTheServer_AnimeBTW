import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { DetailProvider } from './components/MediaModal'
import { PlayerProvider } from './components/Player'
import { ToastProvider } from './components/Toasts'
import Home from './pages/Home'
import Browse from './pages/Browse'
import Schedule from './pages/Schedule'
import Search from './pages/Search'
import Bookmarks from './pages/Bookmarks'
import SettingsPage from './pages/Settings'

export default function App() {
  return (
    <ToastProvider>
      <PlayerProvider>
        <DetailProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="browse" element={<Browse />} />
              <Route path="schedule" element={<Schedule />} />
              <Route path="search" element={<Search />} />
              <Route path="bookmarks" element={<Bookmarks />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </DetailProvider>
      </PlayerProvider>
    </ToastProvider>
  )
}
