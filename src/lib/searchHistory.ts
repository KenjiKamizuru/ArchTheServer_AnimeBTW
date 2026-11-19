import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'animevault.search.history.v1'
const SETTINGS_KEY = 'animevault.search.historySettings.v1'
const MAX_ENTRIES = 50

export interface SearchHistoryEntry {
  query: string
  at: number
  /** How many results the search produced, when known. */
  count?: number
}

export interface SearchHistorySettings {
  enabled: boolean
  /** Days before an entry expires; 0 disables expiry. */
  expiryDays: number
}

const DEFAULT_SETTINGS: SearchHistorySettings = { enabled: true, expiryDays: 30 }

function readSettings(): SearchHistorySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      enabled: parsed?.enabled !== false,
      expiryDays: Number.isFinite(parsed?.expiryDays)
        ? Math.min(3650, Math.max(0, Math.trunc(parsed.expiryDays)))
        : DEFAULT_SETTINGS.expiryDays,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function isEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as SearchHistoryEntry
  return typeof entry.query === 'string' && entry.query.length > 0 && Number.isFinite(entry.at)
}

/** Drops expired entries; exported so the rules can be verified directly. */
export function pruneHistory(
  entries: SearchHistoryEntry[],
  settings: SearchHistorySettings,
  now = Date.now(),
): SearchHistoryEntry[] {
  const list = entries.filter(isEntry)
  if (settings.expiryDays <= 0) return list.slice(0, MAX_ENTRIES)
  const cutoff = now - settings.expiryDays * 86_400_000
  return list.filter((entry) => entry.at >= cutoff).slice(0, MAX_ENTRIES)
}

function readHistory(settings: SearchHistorySettings): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return pruneHistory(parsed, settings)
  } catch {
    return []
  }
}

function writeHistory(entries: SearchHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    /* storage full or unavailable — history simply stays in memory */
  }
}

/**
 * Local search history with per-entry deletion, a global off switch and an
 * optional expiry window (AV-066, AV-067).
 */
export function useSearchHistory() {
  const [settings, setSettings] = useState<SearchHistorySettings>(() => readSettings())
  const [entries, setEntries] = useState<SearchHistoryEntry[]>(() => readHistory(readSettings()))

  const persistSettings = useCallback((next: SearchHistorySettings) => {
    setSettings(next)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  const add = useCallback(
    (query: string, count?: number) => {
      const clean = query.trim().slice(0, 120)
      if (!clean || !settings.enabled) return
      setEntries((prev) => {
        // Re-searching an existing term moves it to the top rather than duping.
        const without = prev.filter((entry) => entry.query.toLowerCase() !== clean.toLowerCase())
        const next = pruneHistory([{ query: clean, at: Date.now(), count }, ...without], settings)
        writeHistory(next)
        return next
      })
    },
    [settings],
  )

  const remove = useCallback((query: string) => {
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.query !== query)
      writeHistory(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setEntries([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const setEnabled = useCallback(
    (enabled: boolean) => {
      persistSettings({ ...settings, enabled })
      if (!enabled) clear()
    },
    [settings, persistSettings, clear],
  )

  const setExpiryDays = useCallback(
    (expiryDays: number) => {
      const next = {
        ...settings,
        expiryDays: Math.min(3650, Math.max(0, Math.trunc(expiryDays) || 0)),
      }
      persistSettings(next)
      // Applying a shorter window immediately trims what is already stored.
      setEntries((prev) => {
        const pruned = pruneHistory(prev, next)
        writeHistory(pruned)
        return pruned
      })
    },
    [settings, persistSettings],
  )

  // Another tab changing history should be reflected here too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setEntries(readHistory(readSettings()))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return useMemo(
    () => ({ entries, add, remove, clear, settings, setEnabled, setExpiryDays }),
    [entries, add, remove, clear, settings, setEnabled, setExpiryDays],
  )
}
