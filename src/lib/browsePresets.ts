import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'animevault.browse.presets.v1'
const MAX_PRESETS = 30

export interface BrowsePreset {
  id: string
  name: string
  /** Raw query string (without leading `?`). */
  query: string
  createdAt: number
}

function readPresets(): BrowsePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (p): p is BrowsePreset =>
          p &&
          typeof p.id === 'string' &&
          typeof p.name === 'string' &&
          typeof p.query === 'string' &&
          typeof p.createdAt === 'number',
      )
      .slice(0, MAX_PRESETS)
  } catch {
    return []
  }
}

function writePresets(presets: BrowsePreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)))
  } catch {
    /* storage unavailable — presets stay in memory for this session */
  }
}

/**
 * Saved browse filter presets, persisted to localStorage.
 *
 * Presets store the raw query string so they stay forward compatible with new
 * filter params, and are capped so a long-lived browser cannot grow unbounded.
 */
export function useBrowsePresets() {
  const [presets, setPresets] = useState<BrowsePreset[]>(() => readPresets())

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setPresets(readPresets())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const save = useCallback((name: string, query: string) => {
    const trimmed = name.trim().slice(0, 60)
    if (!trimmed || !query) return null
    const preset: BrowsePreset = {
      id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      query,
      createdAt: Date.now(),
    }
    setPresets((prev) => {
      // Replacing a same-named preset keeps the list tidy.
      const without = prev.filter((p) => p.name.toLowerCase() !== trimmed.toLowerCase())
      const next = [preset, ...without].slice(0, MAX_PRESETS)
      writePresets(next)
      return next
    })
    return preset
  }, [])

  const remove = useCallback((id: string) => {
    setPresets((prev) => {
      const next = prev.filter((p) => p.id !== id)
      writePresets(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setPresets([])
    writePresets([])
  }, [])

  return useMemo(() => ({ presets, save, remove, clear }), [presets, save, remove, clear])
}
