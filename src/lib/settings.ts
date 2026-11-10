import { useSyncExternalStore } from 'react'
import type { AppSettings } from '../types'
import { api } from './api'

let state: AppSettings = {
  downloadProvider: 'anicli',
  sourceTemplate: '',
  anicliBin: 'ani-cli',
  anicliQuality: 'best',
  anicliDub: false,
  anicliResultIndex: 1,
  updatedAt: 0,
  libraryDir: '',
}
let started = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

async function ensureLoaded() {
  if (started) return
  started = true
  try {
    state = await api.settings()
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
  return state
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  state = await api.saveSettings(patch)
  emit()
  return state
}

/** Mirrors the server-side placeholder replacement so the form can preview it. */
export function resolveSource(
  template: string,
  media: { id: number; title: string; romaji?: string | null },
  episode: number,
): string {
  const ep = Number(episode) || 1
  return String(template)
    .replace(/\{id\}/g, String(media.id))
    .replace(/\{title\}/g, encodeURIComponent(media.title ?? ''))
    .replace(/\{romaji\}/g, encodeURIComponent(media.romaji ?? ''))
    .replace(/\{episode\}/g, String(ep))
    .replace(/\{ep2\}/g, String(ep).padStart(2, '0'))
    .replace(/\{ep3\}/g, String(ep).padStart(3, '0'))
}
