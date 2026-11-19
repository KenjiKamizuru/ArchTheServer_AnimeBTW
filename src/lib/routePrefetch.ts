// Route-level code splitting with instant, intent-based prefetching.
//
// Vite emits one chunk per page. Loading them on link hover/focus (and after
// idle on a fast connection) means navigation is usually already warm, so the
// Suspense fallback rarely appears — without inflating the initial bundle.

import { lazy } from 'react'

type PageModule = { default: React.ComponentType }

/** Lazily imports a page chunk and remembers the promise so prefetch is free. */
function lazyWithPrefetch(loader: () => Promise<PageModule>) {
  let cached: Promise<PageModule> | null = null
  const load = () => {
    if (!cached) cached = loader()
    return cached
  }
  const Component = lazy(load)
  return Object.assign(Component, { prefetch: load })
}

export const HomePage = lazyWithPrefetch(() => import('../pages/Home'))
export const BrowsePage = lazyWithPrefetch(() => import('../pages/Browse'))
export const SchedulePage = lazyWithPrefetch(() => import('../pages/Schedule'))
export const SearchPage = lazyWithPrefetch(() => import('../pages/Search'))
export const DownloadsPage = lazyWithPrefetch(() => import('../pages/Downloads'))
export const DownloadedPage = lazyWithPrefetch(() => import('../pages/Downloaded'))
export const BookmarksPage = lazyWithPrefetch(() => import('../pages/Bookmarks'))
export const SettingsPage = lazyWithPrefetch(() => import('../pages/Settings'))
export const StudiosPage = lazyWithPrefetch(() => import('../pages/Studios').then((m) => ({ default: m.StudiosPage })))
export const StudioPage = lazyWithPrefetch(() => import('../pages/Studios').then((m) => ({ default: m.StudioPage })))
export const IndexPage = lazyWithPrefetch(() => import('../pages/IndexPage'))
export const DiscoverPage = lazyWithPrefetch(() => import('../pages/Discover'))
export const AnimeDetailPage = lazyWithPrefetch(() => import('../pages/AnimeDetail'))
export const CharacterDetailPage = lazyWithPrefetch(() => import('../pages/CharacterDetail').then((m) => ({ default: m.CharacterDetailPage })))
export const StaffDetailPage = lazyWithPrefetch(() => import('../pages/StaffDetail').then((m) => ({ default: m.StaffDetailPage })))
export const AdminInspectPage = lazyWithPrefetch(() => import('../pages/AdminInspect'))

const PREFETCHERS: Record<string, (() => Promise<unknown>)[]> = {
  '/': [HomePage.prefetch],
  '/browse': [BrowsePage.prefetch],
  '/schedule': [SchedulePage.prefetch],
  '/search': [SearchPage.prefetch],
  '/downloads': [DownloadsPage.prefetch],
  '/downloaded': [DownloadedPage.prefetch],
  '/bookmarks': [BookmarksPage.prefetch],
  '/settings': [SettingsPage.prefetch],
  '/studios': [StudiosPage.prefetch, StudioPage.prefetch],
  '/index': [IndexPage.prefetch],
  '/discover': [DiscoverPage.prefetch],
  '/anime': [AnimeDetailPage.prefetch],
  '/characters': [CharacterDetailPage.prefetch],
  '/staff': [StaffDetailPage.prefetch],
}

const prefetched = new Set<string>()

/** Warms the chunk for a route path (no-op when already warm). */
export function prefetchRoute(pathname: string) {
  const key = pathname.replace(/\/+$/, '') || '/'
  if (prefetched.has(key)) return
  const loaders = PREFETCHERS[key]
  if (!loaders) return
  prefetched.add(key)
  for (const load of loaders) void load().catch(() => prefetched.delete(key))
}

/** Warms every route during idle time on fast connections only. */
export function prefetchAllRoutesOnIdle() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (conn?.saveData) return
  if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return
  const run = () => {
    for (const path of Object.keys(PREFETCHERS)) prefetchRoute(path)
  }
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback
  if (ric) ric(run, { timeout: 3000 })
  else setTimeout(run, 1200)
}

/** Props that turn any router link into a prefetching link. */
export function prefetchProps(pathname: string) {
  return {
    onMouseEnter: () => prefetchRoute(pathname),
    onFocus: () => prefetchRoute(pathname),
    onTouchStart: () => prefetchRoute(pathname),
  }
}
