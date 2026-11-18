// Reactive client store for claimed IMDb artwork (banners, posters/covers, and icons)
// across App branding, Anime/Media entries, Library Series/Movies, and standalone Files.

import { useSyncExternalStore } from 'react'
import type {
  ArtworkFocus,
  ArtworkSlot,
  ArtworkSnapshot,
  ArtworkTargetType,
  ClaimedArtworkRecord,
  ClaimedArtworkSlot,
  LibraryItem,
  Media,
} from '../types'
import { api } from './api'
import { inferSeasonFromTitle } from './format'

let state: ArtworkSnapshot = {
  app: null,
  media: {},
  series: {},
  file: {},
}

let loaded = false
let fetching = false
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

export function applyArtworkSnapshot(next: ArtworkSnapshot) {
  if (!next || typeof next !== 'object') return
  state = {
    app: next.app ?? null,
    media: next.media ?? {},
    series: next.series ?? {},
    file: next.file ?? {},
  }
  loaded = true
  emit()
}

export async function refreshArtwork() {
  if (fetching) return state
  fetching = true
  try {
    const next = await api.artwork()
    applyArtworkSnapshot(next)
  } catch {
    /* keep existing state offline */
  } finally {
    fetching = false
  }
  return state
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!loaded) void refreshArtwork()
  return () => {
    listeners.delete(listener)
  }
}

export function useArtwork(): ArtworkSnapshot {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** Matches server/imdb.mjs `normalizeSeriesKey` so keys always align identically. */
export function normalizeSeriesArtworkKey(raw: string | null | undefined): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, '')
    .slice(0, 120)
}

/** Extracts an IMDb `tt...` ID from a raw ID, bare 7–10 digits, or full IMDb URL. */
export function parseImdbIdClient(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null
  const urlMatch = input.match(/imdb\.com\/title\/tt(\d{1,12})(?:[/?#]|$)/i)
  if (urlMatch) {
    const d = urlMatch[1]
    return `tt${d.length < 7 ? d.padStart(7, '0') : d}`
  }
  const direct = input.match(/^tt\s*(\d{1,12})$/i)
  if (direct) {
    const d = direct[1]
    return `tt${d.length < 7 ? d.padStart(7, '0') : d}`
  }
  const bare = input.match(/^(\d{7,10})$/)
  if (bare) return `tt${bare[1]}`
  return null
}

/** CSS `object-position` class for a claimed artwork slot's focal setting. */
export function focusObjectClass(focus?: ArtworkFocus | null): string {
  if (focus === 'top') return 'object-top'
  if (focus === 'bottom') return 'object-bottom'
  return 'object-center'
}

function mergeRecords(
  ...records: (ClaimedArtworkRecord | null | undefined)[]
): ClaimedArtworkRecord | null {
  let banner: ClaimedArtworkSlot | null = null
  let poster: ClaimedArtworkSlot | null = null
  let icon: ClaimedArtworkSlot | null = null
  let imdbId: string | null = null
  let imdbTitle: string | null = null
  for (const r of records) {
    if (!r) continue
    banner = banner ?? r.banner
    poster = poster ?? r.poster
    icon = icon ?? r.icon
    imdbId = imdbId ?? r.imdbId
    imdbTitle = imdbTitle ?? r.imdbTitle
  }
  if (!banner && !poster && !icon && !imdbId) return null
  return { imdbId, imdbTitle, banner, poster, icon }
}

/** Returns exact artwork assigned to a specific `(targetType, targetKey)`. */
export function artworkForTarget(
  snap: ArtworkSnapshot,
  targetType: ArtworkTargetType,
  targetKey: string,
): ClaimedArtworkRecord | null {
  if (targetType === 'app') return snap.app
  if (targetType === 'media') return snap.media[String(targetKey)] ?? null
  if (targetType === 'file') return snap.file[targetKey] ?? null
  return snap.series[normalizeSeriesArtworkKey(targetKey)] ?? null
}

/** Resolves combined claimed artwork for an AniList `Media` entry (by media ID, then series title). */
export function artworkForMedia(
  snap: ArtworkSnapshot,
  media: Pick<Media, 'id' | 'title'> | null | undefined,
): ClaimedArtworkRecord | null {
  if (!media) return null
  const byId = snap.media[String(media.id)]
  const sKey = normalizeSeriesArtworkKey(media.title)
  const baseKey = normalizeSeriesArtworkKey(inferSeasonFromTitle(media.title).seriesTitle)
  return mergeRecords(byId, snap.series[sKey], snap.series[baseKey])
}

/** Resolves claimed artwork for a Shared Library series/movie group. */
export function artworkForSeriesGroup(
  snap: ArtworkSnapshot,
  title: string,
  mediaId?: number | null,
  fileIds?: string[],
): ClaimedArtworkRecord | null {
  const sKey = normalizeSeriesArtworkKey(title)
  const bySeries = snap.series[sKey]
  const byMedia = mediaId ? snap.media[String(mediaId)] : null
  const byFirstFile = fileIds?.map((id) => snap.file[id]).find(Boolean) ?? null
  return mergeRecords(bySeries, byMedia, byFirstFile)
}

/** Resolves claimed artwork for a single library file (file -> series -> media). */
export function artworkForLibraryItem(
  snap: ArtworkSnapshot,
  item: LibraryItem,
): ClaimedArtworkRecord | null {
  const byFile = snap.file[item.id]
  const sKey = normalizeSeriesArtworkKey(item.seriesTitle || item.animeTitle || '')
  const bySeries = sKey ? snap.series[sKey] : null
  const byMedia = item.mediaId ? snap.media[String(item.mediaId)] : null
  return mergeRecords(byFile, bySeries, byMedia)
}

export async function claimArtworkSlot(payload: {
  targetType: ArtworkTargetType
  targetKey: string
  slot: ArtworkSlot
  imageUrl: string
  imdbId?: string
  imdbTitle?: string
  focus?: ArtworkFocus
  applyTitle?: boolean
  asMovie?: boolean
}) {
  const res = await api.claimImdbPhoto(payload)
  applyArtworkSnapshot(res.snapshot)
  return res
}

export async function claimArtworkSlots(payload: {
  targetType: ArtworkTargetType
  targetKey: string
  slots: Partial<Record<ArtworkSlot, string>>
  focus?: Partial<Record<ArtworkSlot, ArtworkFocus>>
  imdbId?: string
  imdbTitle?: string
  applyTitle?: boolean
  asMovie?: boolean
}) {
  const res = await api.claimImdbBundle(payload)
  applyArtworkSnapshot(res.snapshot)
  return res
}

export async function setArtworkFocus(payload: {
  targetType: ArtworkTargetType
  targetKey: string
  slot: ArtworkSlot
  focus: ArtworkFocus
}) {
  const res = await api.updateArtworkFocus(payload)
  applyArtworkSnapshot(res.snapshot)
  return res
}

export async function removeArtwork(payload: {
  targetType: ArtworkTargetType
  targetKey: string
  slot?: ArtworkSlot
}) {
  const res = await api.clearArtwork(payload)
  applyArtworkSnapshot(res.snapshot)
  return res
}
