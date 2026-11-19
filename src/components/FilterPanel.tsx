import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react'

export interface FilterOption {
  value: string
  label: string
}

export interface FilterGroupSpec {
  key: string
  label: string
  options: FilterOption[]
  /** Multi-select groups keep arrays; single groups keep one value. */
  multi?: boolean
  hint?: string
}

export interface RangeSpec {
  key: string
  label: string
  minPlaceholder: string
  maxPlaceholder: string
  min?: number
  max?: number
  step?: number
  suffix?: string
}

interface FilterPanelProps {
  groups: FilterGroupSpec[]
  ranges: RangeSpec[]
  selected: Record<string, string[]>
  rangeValues: Record<string, { min?: number; max?: number }>
  excludeSelected?: Record<string, string[]>
  onToggle: (groupKey: string, value: string) => void
  onToggleExclude?: (groupKey: string, value: string) => void
  onRange: (rangeKey: string, bound: 'min' | 'max', value: number | undefined) => void
  onClear: () => void
  activeCount: number
  children?: ReactNode
}

/**
 * Collapsible filter panel. Renders as a grid of toggle chips plus numeric range
 * inputs, with a live count of active filters and a single reset action.
 */
export function FilterPanel({
  groups,
  ranges,
  selected,
  rangeValues,
  excludeSelected,
  onToggle,
  onToggleExclude,
  onRange,
  onClear,
  activeCount,
  children,
}: FilterPanelProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Close on Escape without trapping focus.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const activeSummary = useMemo(
    () => (activeCount > 0 ? `${activeCount} active` : 'none'),
    [activeCount],
  )

  return (
    <div className="rounded-xl bg-ink-900 ring-1 ring-white/6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="browse-filter-panel"
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-white/75 transition hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
      >
        <SlidersHorizontal size={14} className="text-accent" />
        Filters
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
            activeCount > 0 ? 'bg-accent/20 text-accent' : 'bg-white/6 text-white/40'
          }`}
        >
          {activeSummary}
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          id="browse-filter-panel"
          ref={panelRef}
          className="space-y-4 border-t border-white/6 px-3.5 py-3.5"
        >
          {groups.map((group) => {
            const picked = selected[group.key] ?? []
            const excluded = excludeSelected?.[group.key] ?? []
            return (
              <div key={group.key}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                    {group.label}
                  </span>
                  {group.hint ? <span className="text-[10px] text-white/25">{group.hint}</span> : null}
                  {picked.length > 0 || excluded.length > 0 ? (
                    <span className="ml-auto text-[10px] text-white/30 tabular-nums">
                      {picked.length + excluded.length} selected
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.options.map((option) => {
                    const isExcluded = excluded.includes(option.value)
                    const isPicked = picked.includes(option.value)
                    const supportsExclude = Boolean(onToggleExclude) && group.key === 'genres'
                    return (
                      <span
                        key={option.value}
                        className={`inline-flex items-center rounded-full ring-1 transition ${
                          isExcluded
                            ? 'bg-red-500/15 text-red-200 ring-red-400/40'
                            : isPicked
                              ? 'bg-accent text-black ring-accent'
                              : 'bg-white/5 text-white/60 ring-white/10'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onToggle(group.key, option.value)}
                          aria-pressed={isPicked}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition hover:opacity-90 focus-visible:outline-none ${
                            supportsExclude ? 'pr-1' : ''
                          }`}
                        >
                          {isExcluded ? `not ${option.label}` : option.label}
                        </button>
                        {supportsExclude ? (
                          <button
                            type="button"
                            onClick={() => onToggleExclude?.(group.key, option.value)}
                            aria-pressed={isExcluded}
                            aria-label={
                              isExcluded
                                ? `Stop excluding ${option.label}`
                                : `Exclude ${option.label}`
                            }
                            title={isExcluded ? `Stop excluding ${option.label}` : `Exclude ${option.label}`}
                            className={`mr-1 rounded-full px-1 text-[10px] font-bold leading-none transition hover:bg-black/20 ${
                              isExcluded ? 'text-red-200' : 'text-white/30 hover:text-red-300'
                            }`}
                          >
                            ⊘
                          </button>
                        ) : null}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {ranges.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ranges.map((range) => {
                const value = rangeValues[range.key] ?? {}
                return (
                  <label key={range.key} className="block">
                    <span className="mb-1 block text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                      {range.label}
                      {range.suffix ? <span className="ml-1 font-normal text-white/25 normal-case">{range.suffix}</span> : null}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={range.min}
                        max={range.max}
                        step={range.step ?? 1}
                        placeholder={range.minPlaceholder}
                        value={value.min ?? ''}
                        onChange={(e) => onRange(range.key, 'min', e.target.value === '' ? undefined : Number(e.target.value))}
                        aria-label={`${range.label} minimum`}
                        className="w-full rounded-lg bg-ink-800 px-2 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      />
                      <span className="text-white/25">–</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={range.min}
                        max={range.max}
                        step={range.step ?? 1}
                        placeholder={range.maxPlaceholder}
                        value={value.max ?? ''}
                        onChange={(e) => onRange(range.key, 'max', e.target.value === '' ? undefined : Number(e.target.value))}
                        aria-label={`${range.label} maximum`}
                        className="w-full rounded-lg bg-ink-800 px-2 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      />
                    </div>
                  </label>
                )
              })}
            </div>
          ) : null}

          {children}

          <div className="flex items-center justify-between gap-2 border-t border-white/6 pt-3">
            <span className="text-[11px] text-white/35">
              Filters are stored in the URL, so you can share or bookmark this view.
            </span>
            <button
              type="button"
              onClick={onClear}
              disabled={activeCount === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1.5 text-[11px] font-medium text-white/70 ring-1 ring-white/10 transition hover:text-white disabled:opacity-40"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Dismissible row of active-filter chips. */
export function ActiveFilterChips({
  labels,
  onRemove,
  onClearAll,
}: {
  labels: { key: string; label: string }[]
  onRemove: (key: string) => void
  onClearAll: () => void
}) {
  if (labels.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((item) => (
        <span
          key={item.key}
          className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] text-accent ring-1 ring-accent/25"
        >
          {item.label}
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={`Remove filter ${item.label}`}
            className="rounded-full p-0.5 transition hover:bg-accent/25"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-[11px] text-white/35 underline decoration-dotted transition hover:text-white/70"
      >
        clear all
      </button>
    </div>
  )
}
