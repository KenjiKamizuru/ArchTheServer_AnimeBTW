import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dices,
  Bookmark,
  BookmarkPlus,
  FolderDown,
  Gem,
  Loader2,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import type { Media } from '../types'
import { api, type BrowseResponse } from '../lib/api'
import { enqueueBulkDownload } from '../lib/downloads'
import { useSettings } from '../lib/settings'
import { formatSeason, inferSeasonFromTitle } from '../lib/format'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'
import { ActiveFilterChips, FilterPanel, type FilterGroupSpec, type RangeSpec } from '../components/FilterPanel'
import { useBrowsePresets, type BrowsePreset } from '../lib/browsePresets'
import { useToast } from '../components/Toasts'

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
const SEASON_LABEL: Record<string, string> = {
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
}

const SORT_OPTIONS = [
  { id: 'popular', label: 'Popular' },
  { id: 'trending', label: 'Trending' },
  { id: 'rated', label: 'Top rated' },
  { id: 'favourites', label: 'Most favourited' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'A–Z' },
  { id: 'episodes', label: 'Most episodes' },
] as const

const FORMAT_OPTIONS = [
  { value: 'TV', label: 'TV' },
  { value: 'TV_SHORT', label: 'TV short' },
  { value: 'MOVIE', label: 'Movie' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'SPECIAL', label: 'Special' },
  { value: 'MUSIC', label: 'Music' },
]

const STATUS_OPTIONS = [
  { value: 'RELEASING', label: 'Airing' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'NOT_YET_RELEASED', label: 'Upcoming' },
  { value: 'HIATUS', label: 'Hiatus' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const GENRE_OPTIONS = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror',
  'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance',
  'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
].map((g) => ({ value: g, label: g }))

const SOURCE_OPTIONS = [
  { value: 'ORIGINAL', label: 'Original' },
  { value: 'MANGA', label: 'Manga' },
  { value: 'LIGHT_NOVEL', label: 'Light novel' },
  { value: 'VISUAL_NOVEL', label: 'Visual novel' },
  { value: 'VIDEO_GAME', label: 'Game' },
  { value: 'NOVEL', label: 'Novel' },
  { value: 'OTHER', label: 'Other' },
]

const COUNTRY_OPTIONS = [
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'Korea' },
  { value: 'CN', label: 'China' },
  { value: 'TW', label: 'Taiwan' },
]

const FILTER_GROUPS: FilterGroupSpec[] = [
  { key: 'formats', label: 'Format', options: FORMAT_OPTIONS, multi: true },
  { key: 'statuses', label: 'Status', options: STATUS_OPTIONS, multi: true },
  { key: 'genres', label: 'Genres', options: GENRE_OPTIONS, multi: true, hint: 'include' },
  { key: 'sources', label: 'Source material', options: SOURCE_OPTIONS, multi: true },
  { key: 'countries', label: 'Country', options: COUNTRY_OPTIONS, multi: true },
]

const DECADES = ['2020', '2010', '2000', '1990', '1980', '1970']

function listParam(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key)
  if (!raw) return []
  return raw.split(',').map((v) => v.trim()).filter(Boolean).slice(0, 12)
}

function numParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function currentSeason() {
  const month = new Date().getMonth()
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL'
  return { season: season as (typeof SEASONS)[number], year: new Date().getFullYear() }
}

export default function Browse() {
  const initial = currentSeason()
  const toast = useToast()
  const settings = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── URL-backed filters (shareable / bookmarkable / back-button friendly) ──
  const selected = useMemo<Record<string, string[]>>(
    () => ({
      formats: listParam(searchParams, 'formats'),
      statuses: listParam(searchParams, 'statuses'),
      genres: listParam(searchParams, 'genres'),
      sources: listParam(searchParams, 'sources'),
      countries: listParam(searchParams, 'countries'),
    }),
    [searchParams],
  )
  const excludeGenres = useMemo(() => listParam(searchParams, 'genresExclude'), [searchParams])
  const rangeValues = useMemo(
    () => ({
      years: { min: numParam(searchParams, 'yearMin'), max: numParam(searchParams, 'yearMax') },
      episodes: { min: numParam(searchParams, 'episodesMin'), max: numParam(searchParams, 'episodesMax') },
      duration: { min: numParam(searchParams, 'durationMin'), max: numParam(searchParams, 'durationMax') },
      score: { min: numParam(searchParams, 'minScore') },
      popularity: { max: numParam(searchParams, 'maxPopularity') },
    }),
    [searchParams],
  )
  const sort = (searchParams.get('sort') as (typeof SORT_OPTIONS)[number]['id']) || 'popular'
  const season = (searchParams.get('season') as (typeof SEASONS)[number]) || initial.season
  const year = numParam(searchParams, 'year') ?? initial.year
  const includeOlder = searchParams.get('older') === '1'
  const query = searchParams.get('q') ?? ''

  const [items, setItems] = useState<Media[]>([])
  const [meta, setMeta] = useState<BrowseResponse | null>(null)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  // Bulk season download selection
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [scope, setScope] = useState<'season' | 'latest'>('season')
  const [quality, setQuality] = useState('best')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle')
  const { presets, save: savePreset, remove: removePreset, clear: clearPresets } = useBrowsePresets()
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    setQuality(settings.quality || 'best')
  }, [settings.quality])

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void, { resetPage = true } = {}) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          mutate(next)
          if (resetPage) next.delete('page')
          return next
        },
        { replace: true },
      )
      if (resetPage) {
        setPage(1)
        setItems([])
        setSelectedIds(new Set())
      }
    },
    [setSearchParams],
  )

  const toggleMulti = useCallback(
    (key: string, value: string) => {
      updateParams((params) => {
        const current = listParam(params, key)
        const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
        if (next.length) params.set(key, next.join(','))
        else params.delete(key)
      })
    },
    [updateParams],
  )

  // Alt-click a genre to exclude it; alt-click again to un-exclude.
  const toggleExclude = useCallback(
    (key: string, value: string) => {
      if (key !== 'genres') return
      updateParams((params) => {
        const excluded = listParam(params, 'genresExclude')
        const included = listParam(params, 'genres')
        if (excluded.includes(value)) {
          const next = excluded.filter((v) => v !== value)
          if (next.length) params.set('genresExclude', next.join(','))
          else params.delete('genresExclude')
          return
        }
        // Excluding supersedes including.
        const withoutIncluded = included.filter((v) => v !== value)
        if (withoutIncluded.length) params.set('genres', withoutIncluded.join(','))
        else params.delete('genres')
        params.set('genresExclude', [...excluded, value].join(','))
      })
    },
    [updateParams],
  )

  const setRange = useCallback(
    (key: string, bound: 'min' | 'max', value: number | undefined) => {
      const map: Record<string, [string, string]> = {
        years: ['yearMin', 'yearMax'],
        episodes: ['episodesMin', 'episodesMax'],
        duration: ['durationMin', 'durationMax'],
        score: ['minScore', 'minScore'],
        popularity: ['maxPopularity', 'maxPopularity'],
      }
      const keys = map[key]
      if (!keys) return
      updateParams((params) => {
        const paramKey = bound === 'min' ? keys[0] : keys[1]
        if (value === undefined || Number.isNaN(value)) params.delete(paramKey)
        else params.set(paramKey, String(Math.trunc(value)))
      })
    },
    [updateParams],
  )

  const clearFilters = useCallback(() => {
    updateParams((params) => {
      for (const key of [
        'formats', 'statuses', 'genres', 'genresExclude', 'sources', 'countries',
        'yearMin', 'yearMax', 'episodesMin', 'episodesMax', 'durationMin',
        'durationMax', 'minScore', 'maxPopularity', 'q', 'older', 'decade',
      ]) {
        params.delete(key)
      }
    })
  }, [updateParams])

  const activeCount = useMemo(() => {
    let n = 0
    for (const values of Object.values(selected)) if (values.length) n += 1
    if (excludeGenres.length) n += 1
    if (rangeValues.years.min !== undefined || rangeValues.years.max !== undefined) n += 1
    if (rangeValues.episodes.min !== undefined || rangeValues.episodes.max !== undefined) n += 1
    if (rangeValues.duration.min !== undefined || rangeValues.duration.max !== undefined) n += 1
    if (rangeValues.score.min !== undefined) n += 1
    if (rangeValues.popularity.max !== undefined) n += 1
    if (query) n += 1
    if (includeOlder) n += 1
    return n
  }, [selected, excludeGenres, rangeValues, query, includeOlder])

  // Build the request payload once per render; the URL is the source of truth.
  const requestFilters = useMemo(() => {
    const payload: Record<string, string | number | boolean | undefined> = {
      sort,
      formats: selected.formats.join(',') || undefined,
      statuses: selected.statuses.join(',') || undefined,
      genres: selected.genres.join(',') || undefined,
      genresExclude: excludeGenres.join(',') || undefined,
      sources: selected.sources.join(',') || undefined,
      countries: selected.countries.join(',') || undefined,
      yearMin: rangeValues.years.min,
      yearMax: rangeValues.years.max,
      episodesMin: rangeValues.episodes.min,
      episodesMax: rangeValues.episodes.max,
      durationMin: rangeValues.duration.min,
      durationMax: rangeValues.duration.max,
      minScore: rangeValues.score.min,
      maxPopularity: rangeValues.popularity.max,
      q: query || undefined,
    }
    // Season browsing only applies when no explicit year range was chosen.
    const hasYearRange = rangeValues.years.min !== undefined || rangeValues.years.max !== undefined
    if (!hasYearRange) {
      if (includeOlder) payload.year = year
      else {
        payload.season = season
        payload.year = year
      }
    }
    return payload
  }, [sort, selected, excludeGenres, rangeValues, query, season, year, includeOlder])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .browse({ ...requestFilters, page })
      .then((res) => {
        if (!alive) return
        setMeta(res)
        setHasNext(res.hasNextPage)
        setItems((prev) => {
          if (page === 1) return res.media
          const seen = new Set(prev.map((m) => m.id))
          return [...prev, ...res.media.filter((m) => !seen.has(m.id))]
        })
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load this season')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [requestFilters, page])

  function toggleSelect(media: Media) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(media.id)) next.delete(media.id)
      else next.add(media.id)
      return next
    })
  }

  async function queueSelectedShows(pickedOverride?: Media[]) {
    const picked = pickedOverride ?? items.filter((m) => selectedIds.has(m.id))
    if (picked.length === 0) return
    setBulkBusy(true)
    try {
      const res = await enqueueBulkDownload({
        mode: 'multi-anime',
        latestOnly: scope === 'latest',
        quality,
        dub: settings.dub,
        items: picked.map((m) => {
          const inferred = inferSeasonFromTitle(m.title)
          return {
            mediaId: m.id,
            animeTitle: m.title,
            query: m.title,
            season: inferred.season,
            episodeCount: m.airedEpisodes || m.episodes || undefined,
            discoverFromProvider: scope === 'season',
            format: m.format,
            cover: m.cover,
            durationMinutes: m.duration,
          }
        }),
      })
      const parts = [
        res.queuedCount > 0
          ? `Queued ${res.queuedCount} episode${res.queuedCount === 1 ? '' : 's'} across ${picked.length} show${picked.length === 1 ? '' : 's'}`
          : 'Nothing new to queue',
      ]
      if (res.skippedDownloaded > 0) parts.push(`${res.skippedDownloaded} already local`)
      if (res.skippedQueued > 0) parts.push(`${res.skippedQueued} already queued`)
      if (res.errors?.length) parts.push(`${res.errors.length} unmatched`)
      toast(parts.join(' · '))
      setSelectedIds(new Set())
      setSelectMode(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not queue bulk season download', 'err')
    } finally {
      setBulkBusy(false)
    }
  }

  async function discover(kind: 'spotlight' | 'random' | 'hidden-gems') {
    try {
      const res = await api.discover(kind, requestFilters)
      if (kind === 'random' || kind === 'spotlight') {
        if (!res.media) {
          toast('No match for these filters — try widening them', 'err')
          return
        }
        toast(`${kind === 'spotlight' ? '✨ Daily pick' : '🎲'} ${res.media.title}`)
        setItems((prev) => [res.media as Media, ...prev.filter((m) => m.id !== res.media!.id)])
      } else {
        if (!res.items?.length) {
          toast('No hidden gems match these filters', 'err')
          return
        }
        setItems(res.items)
        setHasNext(false)
        toast(`Found ${res.items.length} hidden gems`)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Discovery failed', 'err')
    }
  }

  async function copyShareLink() {
    const url = `${window.location.origin}/browse?${searchParams.toString()}`
    try {
      await navigator.clipboard.writeText(url)
      setShareState('copied')
      setTimeout(() => setShareState('idle'), 2000)
    } catch {
      // Clipboard is unavailable on insecure origins: fall back to the address bar.
      window.history.replaceState(null, '', `/browse?${searchParams.toString()}`)
      toast('Filters are already in the URL — copy it from the address bar')
    }
  }

  function applyPreset(preset: BrowsePreset) {
    const next = new URLSearchParams(preset.query)
    setSearchParams(next, { replace: true })
    setPage(1)
    setItems([])
    setSelectedIds(new Set())
    setPresetOpen(false)
    toast(`Applied preset “${preset.name}”`)
  }

  function handleSavePreset() {
    const created = savePreset(presetName, searchParams.toString())
    if (!created) {
      toast('Give the preset a name first', 'err')
      return
    }
    setPresetName('')
    toast(`Saved preset “${created.name}”`)
  }

  const chipLabels = useMemo(() => {
    const chips: { key: string; label: string }[] = []
    for (const [groupKey, values] of Object.entries(selected)) {
      for (const value of values) {
        chips.push({ key: `${groupKey}:${value}`, label: value.replace(/_/g, ' ').toLowerCase() })
      }
    }
    for (const value of excludeGenres) chips.push({ key: `genresExclude:${value}`, label: `not ${value}` })
    if (rangeValues.years.min !== undefined || rangeValues.years.max !== undefined) {
      chips.push({ key: 'years', label: `years ${rangeValues.years.min ?? '…'}–${rangeValues.years.max ?? '…'}` })
    }
    if (rangeValues.episodes.min !== undefined || rangeValues.episodes.max !== undefined) {
      chips.push({ key: 'episodes', label: `episodes ${rangeValues.episodes.min ?? '…'}–${rangeValues.episodes.max ?? '…'}` })
    }
    if (rangeValues.duration.min !== undefined || rangeValues.duration.max !== undefined) {
      chips.push({ key: 'duration', label: `${rangeValues.duration.min ?? '…'}–${rangeValues.duration.max ?? '…'} min` })
    }
    if (rangeValues.score.min !== undefined) chips.push({ key: 'score', label: `score ≥ ${rangeValues.score.min}` })
    if (rangeValues.popularity.max !== undefined) chips.push({ key: 'popularity', label: `popularity ≤ ${rangeValues.popularity.max}` })
    if (query) chips.push({ key: 'q', label: `"${query}"` })
    if (includeOlder) chips.push({ key: 'older', label: `any season ${year}` })
    return chips
  }, [selected, excludeGenres, rangeValues, query, includeOlder, year])

  function removeChip(key: string) {
    if (key === 'q') return updateParams((p) => p.delete('q'))
    if (key === 'older') return updateParams((p) => p.delete('older'))
    if (key === 'years') return updateParams((p) => { p.delete('yearMin'); p.delete('yearMax') })
    if (key === 'episodes') return updateParams((p) => { p.delete('episodesMin'); p.delete('episodesMax') })
    if (key === 'duration') return updateParams((p) => { p.delete('durationMin'); p.delete('durationMax') })
    if (key === 'score') return updateParams((p) => p.delete('minScore'))
    if (key === 'popularity') return updateParams((p) => p.delete('maxPopularity'))
    const [group, value] = key.split(':')
    if (!value) return
    return updateParams((p) => {
      const current = listParam(p, group)
      const next = current.filter((v) => v !== value)
      if (next.length) p.set(group, next.join(','))
      else p.delete(group)
    })
  }

  function stepYear(delta: number) {
    updateParams((params) => {
      const next = Math.max(1940, Math.min(2100, year + delta))
      params.set('year', String(next))
      params.delete('yearMin')
      params.delete('yearMax')
    })
  }

  const ranges: RangeSpec[] = [
    { key: 'years', label: 'Release years', minPlaceholder: '1940', maxPlaceholder: '2100', min: 1940, max: 2100 },
    { key: 'episodes', label: 'Episodes', minPlaceholder: '1', maxPlaceholder: '999', min: 1, max: 9999 },
    { key: 'duration', label: 'Runtime', minPlaceholder: '1', maxPlaceholder: '180', min: 1, max: 600, suffix: 'minutes' },
    { key: 'score', label: 'Minimum score', minPlaceholder: '0–100', maxPlaceholder: '—', min: 0, max: 100 },
    { key: 'popularity', label: 'Max popularity', minPlaceholder: '—', maxPlaceholder: '1M', min: 0, max: 1_000_000 },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Browse</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {activeCount > 0 ? meta?.filters && `${meta.filters}` : `${formatSeason(season, year)} · official seasonal listings`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void discover('random')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-2 text-xs font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
            title="Random pick from the current filters"
          >
            <Dices size={14} className="text-accent" />
            <span className="hidden sm:inline">Surprise me</span>
          </button>
          <button
            type="button"
            onClick={() => void discover('spotlight')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-2 text-xs font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
            title="Today's rotating catalog pick"
          >
            <Sparkles size={14} className="text-accent" />
            <span className="hidden sm:inline">Daily pick</span>
          </button>
          <button
            type="button"
            onClick={() => void discover('hidden-gems')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-2 text-xs font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
            title="Highly rated but low popularity"
          >
            <Gem size={14} className="text-accent" />
            <span className="hidden sm:inline">Hidden gems</span>
          </button>
          <button
            type="button"
            onClick={() => void copyShareLink()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/6 px-3 py-2 text-xs font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
            title="Copy a link that preserves these filters"
          >
            <Share2 size={14} className="text-accent" />
            <span className="hidden sm:inline">{shareState === 'copied' ? 'Copied!' : 'Share'}</span>
          </button>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => {
                  if (v) setSelectedIds(new Set())
                  return !v
                })
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ring-1 transition ${
                selectMode
                  ? 'bg-accent text-black ring-accent'
                  : 'bg-accent/15 text-accent ring-accent/40 hover:bg-accent/25'
              }`}
            >
              <FolderDown size={14} />
              {selectMode ? 'Exit Bulk Select' : 'Bulk Download'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
          {SEASONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() =>
                updateParams((params) => {
                  params.set('season', option)
                  params.delete('yearMin')
                  params.delete('yearMax')
                })
              }
              aria-pressed={!includeOlder && season === option}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                !includeOlder && season === option
                  ? 'bg-accent text-black'
                  : 'text-white/55 hover:bg-white/5 hover:text-white'
              }`}
            >
              {SEASON_LABEL[option]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-ink-850 px-1 py-1 ring-1 ring-white/5">
          <button
            type="button"
            aria-label="Previous year"
            onClick={() => stepYear(-1)}
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-12 text-center text-xs font-medium text-white/80 tabular-nums">{year}</span>
          <button
            type="button"
            aria-label="Next year"
            onClick={() => stepYear(1)}
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-white/50">
          <input
            type="checkbox"
            checked={includeOlder}
            onChange={(e) =>
              updateParams((params) => {
                if (e.target.checked) params.set('older', '1')
                else params.delete('older')
              })
            }
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          Any season
        </label>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => updateParams((params) => params.set('sort', option.id))}
              aria-pressed={sort === option.id}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                sort === option.id
                  ? 'bg-accent text-black'
                  : 'text-white/55 hover:bg-white/5 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {DECADES.map((decade) => (
            <button
              key={decade}
              type="button"
              onClick={() =>
                updateParams((params) => {
                  const isActive = params.get('yearMin') === decade && params.get('yearMax') === String(Number(decade) + 9)
                  if (isActive) {
                    params.delete('yearMin')
                    params.delete('yearMax')
                  } else {
                    params.set('yearMin', decade)
                    params.set('yearMax', String(Number(decade) + 9))
                  }
                })
              }
              className="rounded-md bg-white/4 px-2 py-1 text-[11px] text-white/50 ring-1 ring-white/8 transition hover:bg-white/10 hover:text-white"
            >
              {decade}s
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <FilterPanel
          groups={FILTER_GROUPS}
          ranges={ranges}
          selected={selected}
          rangeValues={rangeValues}
          excludeSelected={{ genres: excludeGenres }}
          onToggle={(groupKey, value) => {
            // Alt-click arrives via the exclude handler; plain click includes.
            toggleMulti(groupKey, value)
          }}
          onToggleExclude={toggleExclude}
          onRange={setRange}
          onClear={clearFilters}
          activeCount={activeCount}
        >
          <label className="block sm:max-w-sm">
            <span className="mb-1 block text-[11px] font-semibold tracking-wider text-white/40 uppercase">
              Title contains
            </span>
            <input
              type="search"
              value={query}
              placeholder="e.g. demon slayer"
              onChange={(e) =>
                updateParams((params) => {
                  const v = e.target.value.trim()
                  if (v) params.set('q', v)
                  else params.delete('q')
                })
              }
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
          </label>
        </FilterPanel>

        <ActiveFilterChips labels={chipLabels} onRemove={removeChip} onClearAll={clearFilters} />

        <div className="rounded-xl bg-ink-900 ring-1 ring-white/6">
          <button
            type="button"
            onClick={() => setPresetOpen((v) => !v)}
            aria-expanded={presetOpen}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-white/75 transition hover:text-white focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <Bookmark size={14} className="text-accent" />
            Saved presets
            <span className="rounded-full bg-white/6 px-1.5 py-0.5 text-[10px] tabular-nums text-white/40">
              {presets.length}
            </span>
            <ChevronDown
              size={14}
              className={`ml-auto text-white/40 transition-transform ${presetOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {presetOpen ? (
            <div className="space-y-3 border-t border-white/6 px-3.5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={presetName}
                  maxLength={60}
                  placeholder="Name this filter set…"
                  onChange={(ev) => setPresetName(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') handleSavePreset()
                  }}
                  className="min-w-40 flex-1 rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={!presetName.trim() || activeCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <BookmarkPlus size={13} />
                  Save current filters
                </button>
              </div>
              {presets.length === 0 ? (
                <p className="text-[11px] text-white/35">
                  Presets remember formats, genres, years and sort order so you can jump back into a
                  favourite view in one click.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {presets.map((preset) => (
                    <span
                      key={preset.id}
                      className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/70 ring-1 ring-white/10"
                    >
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="max-w-52 truncate transition hover:text-white"
                        title={preset.query}
                      >
                        {preset.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => removePreset(preset.id)}
                        aria-label={`Delete preset ${preset.name}`}
                        className="rounded-full p-0.5 text-white/30 transition hover:bg-white/10 hover:text-red-300"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {presets.length > 1 ? (
                    <button
                      type="button"
                      onClick={clearPresets}
                      className="text-[11px] text-white/30 underline decoration-dotted transition hover:text-white/70"
                    >
                      clear all
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {selectMode && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-900 p-3.5 ring-1 ring-accent/40">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <CheckSquare size={15} className="text-accent" />
            <span className="font-medium text-white">
              {selectedIds.size} show{selectedIds.size === 1 ? '' : 's'} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set(items.map((m) => m.id)))}
              className="rounded-md bg-white/8 px-2.5 py-1 text-white/80 transition hover:bg-white/14"
            >
              Select all ({items.length})
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-md bg-white/6 px-2.5 py-1 text-white/60 transition hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={scope}
              onChange={(ev) => setScope(ev.target.value as 'season' | 'latest')}
              className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              <option value="season">Full season (all episodes)</option>
              <option value="latest">Latest episode only</option>
            </select>
            <select
              value={quality}
              onChange={(ev) => setQuality(ev.target.value)}
              className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              <option value="best">Best</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
            <button
              type="button"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={() => void queueSelectedShows()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}
              Download Selected ({selectedIds.size})
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode(false)
                setSelectedIds(new Set())
              }}
              aria-label="Cancel selection"
              className="rounded-lg bg-white/6 p-1.5 text-white/60 transition hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {loading && page === 1 ? (
          <CardSkeletons />
        ) : error ? (
          <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">{error}</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl bg-ink-900 p-6 text-center ring-1 ring-white/5">
            <p className="text-sm text-white/60">No anime match these filters.</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/35">
              {meta?.rejectedCount
                ? `${meta.rejectedCount} result${meta.rejectedCount === 1 ? '' : 's'} were filtered out by your extra criteria.`
                : 'Try widening the year range or clearing a genre.'}
            </p>
            {activeCount > 0 ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-white/12 transition hover:bg-white/14"
              >
                <Sparkles size={13} className="text-accent" />
                Clear all filters
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <MediaGrid
              items={items}
              selectable={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
            {hasNext ? (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
