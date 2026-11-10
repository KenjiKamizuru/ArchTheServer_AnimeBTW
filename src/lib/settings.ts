import { useSyncExternalStore } from 'react'
import type { AppSettings } from '../types'
import { api } from './api'

let state: AppSettings = {
  anicliBin: 'ani-cli',
  anicliQuality: 'best',
  anicliDub: false,
  anicliResultIndex: 1,
  playerTarget: 'mpv',
  updatedAt: 0,
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
