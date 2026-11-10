import { useSyncExternalStore } from 'react'
import type { Bookmark, Media } from '../types'
import { api } from './api'

let items: Bookmark[] = []
let started = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

async function ensureLoaded() {
  if (started) return
  started = true
  try {
    const res = await api.bookmarks()
    items = res.items
    emit()
  } catch {
    started = false
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  void ensureLoaded()
  return () => {
    listeners.delete(listener)
  }
}

function snapshot() {
  return items
}

export function useBookmarks(): Bookmark[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export async function toggleBookmark(media: Media) {
  const previous = items
  const exists = items.some((b) => b.mediaId === media.id)
  items = exists
    ? items.filter((b) => b.mediaId !== media.id)
    : [{ mediaId: media.id, addedAt: Date.now(), media }, ...items]
  emit()
  try {
    await api.setBookmark(media, !exists)
  } catch (err) {
    items = previous
    emit()
    throw err instanceof Error ? err : new Error('Could not update bookmarks')
  }
}
