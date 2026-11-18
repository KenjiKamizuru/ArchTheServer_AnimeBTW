import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'animevault.downloaded.collapsed.v1'

function readStored(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string').slice(0, 2000))
  } catch {
    return new Set()
  }
}

/**
 * Tracks collapsed series/season rows in the Downloaded page.
 *
 * Key format: `series:<groupKey>` for a whole show, `season:<groupKey>:<n>`
 * for one season. State is persisted to localStorage so a 24-episode season
 * stays collapsed across reloads.
 */
export function useCollapseState() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readStored())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]))
      } catch {
        /* storage full or disabled — collapsing still works in-session */
      }
    }, 250)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [collapsed])

  // Keep multiple tabs consistent.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      setCollapsed(readStored())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const isCollapsed = useCallback(
    (key: string) => collapsed.has(key),
    [collapsed],
  )

  /** True when the series is collapsed, or this season is collapsed. */
  const isHidden = useCallback(
    (groupKey: string, season?: number) =>
      collapsed.has(`series:${groupKey}`) ||
      (season != null && collapsed.has(`season:${groupKey}:${season}`)),
    [collapsed],
  )

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const collapseAll = useCallback((groupKeys: string[]) => {
    setCollapsed(new Set(groupKeys.flatMap((k) => [`series:${k}`])))
  }, [])

  const expandAll = useCallback(() => setCollapsed(new Set()), [])

  const count = collapsed.size
  return useMemo(
    () => ({ isCollapsed, isHidden, toggle, collapseAll, expandAll, count }),
    [isCollapsed, isHidden, toggle, collapseAll, expandAll, count],
  )
}
