// Studio/producer browsing, franchise grouping, and alphabetical indexes.
//
// All helpers here are pure: they take already-fetched AniList payloads (or a
// caller-supplied fetch function) and return deterministic, testable shapes.

import { classifyEdge } from './relations.mjs'

/** Verified kinds that connect a franchise (AV-117d1). 'other'/'character'/
 * 'adaptation'/'source' (e.g. crossovers) deliberately do NOT union groups. */
const FRANCHISE_CONNECTING_KINDS = new Set([
  'sequel', 'prequel', 'next-season', 'split-cour', 'parent-story',
  'side-story', 'spin-off', 'special', 'ova', 'ona', 'movie',
])

/** Main-line kinds — everything else is a branch (spin-off/special/movie…). */
const SEASON_KINDS = new Set(['main', 'sequel', 'prequel', 'next-season', 'split-cour'])

/** Buckets used by the A–Z index: Latin letters, digits, and kana rows. */
export const LATIN_BUCKETS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
export const KANA_ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']

const KANA_ROW_MAP = [
  [/^[\u3041-\u304A\u30A1-\u30AA]/, 'あ'],
  [/^[\u304B-\u3054\u30AB-\u30B4]/, 'か'],
  [/^[\u3055-\u305E\u30B5-\u30BE]/, 'さ'],
  [/^[\u305F-\u3069\u30BF-\u30C9]/, 'た'],
  [/^[\u306A-\u306E\u30CA-\u30CE]/, 'な'],
  [/^[\u306F-\u307D\u30CF-\u30DD]/, 'は'],
  [/^[\u307E-\u3082\u30DE-\u30E2]/, 'ま'],
  [/^[\u3083-\u3088\u30E3-\u30E8]/, 'や'],
  [/^[\u3089-\u308D\u30E9-\u30ED]/, 'ら'],
  [/^[\u308E-\u3093\u30EE-\u30F3\u30F0-\u30F8]/, 'わ'],
]

/**
 * Maps a title to its index bucket. Latin titles are upper-cased and reduced to
 * their first alphanumeric character; Japanese titles map to a kana row so a
 * single index can serve both scripts.
 */
export function indexBucket(title) {
  const text = String(title ?? '').trim()
  if (!text) return '#'
  for (const [re, row] of KANA_ROW_MAP) {
    if (re.test(text)) return row
  }
  // Skip leading punctuation/brackets so "「Monogatari」" still files under M.
  const first = text.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0)
  if (!first) return '#'
  if (/[0-9０-９]/.test(first)) return '#'
  const upper = first.toUpperCase()
  if (/[A-Z]/.test(upper)) return upper
  // Remaining Latin-diacritic characters fold to their base letter.
  const folded = upper.normalize('NFD').replace(/[\u0300-\u036F]/g, '')
  if (/[A-Z]/.test(folded)) return folded
  return '#'
}

/**
 * Groups media into alphabetical buckets in a stable bucket order, with each
 * bucket sorted by title. Empty buckets are omitted.
 */
export function buildAlphabetIndex(media, { kana = true } = {}) {
  const buckets = new Map()
  for (const item of Array.isArray(media) ? media : []) {
    if (!item || typeof item.title !== 'string') continue
    const bucket = indexBucket(item.title)
    if (!kana && KANA_ROWS.includes(bucket)) {
      // Callers showing a Latin-only index still need the entry, just parked
      // under '#'.
      const list = buckets.get('#') ?? []
      list.push(item)
      buckets.set('#', list)
      continue
    }
    const list = buckets.get(bucket) ?? []
    list.push(item)
    buckets.set(bucket, list)
  }
  const order = kana ? [...LATIN_BUCKETS, ...KANA_ROWS] : LATIN_BUCKETS
  const rank = new Map(order.map((key, i) => [key, i]))
  return [...buckets.entries()]
    .sort((a, b) => (rank.get(a[0]) ?? 999) - (rank.get(b[0]) ?? 999))
    .map(([bucket, items]) => ({
      bucket,
      count: items.length,
      items: items.slice().sort((a, b) => a.title.localeCompare(b.title, 'en')),
    }))
}

/** Trims a raw AniList Studio node into the shape the UI needs. */
export function normalizeStudio(node) {
  if (!node || typeof node.name !== 'string') return null
  const name = node.name.trim().slice(0, 120)
  if (!name) return null
  return {
    id: Number.isInteger(node.id) ? node.id : null,
    name,
    isAnimationStudio: Boolean(node.isAnimationStudio ?? node.isAnimation),
    favourites: Number.isFinite(node.favourites) ? node.favourites : null,
    siteUrl: typeof node.siteUrl === 'string' && /^https:\/\//.test(node.siteUrl) ? node.siteUrl : null,
    bucket: indexBucket(name),
  }
}

/**
 * Splits a media list by main studio and aggregates per-studio counts, so a
 * studio page can show its filmography grouped by year.
 */
export function groupByStudio(media) {
  const map = new Map()
  for (const item of Array.isArray(media) ? media : []) {
    for (const name of item?.studios ?? []) {
      const key = String(name)
      const entry = map.get(key) ?? { name: key, count: 0, years: new Set(), media: [] }
      entry.count += 1
      if (Number.isFinite(item.seasonYear)) entry.years.add(item.seasonYear)
      entry.media.push(item)
      map.set(key, entry)
    }
  }
  return [...map.values()]
    .map((entry) => ({
      name: entry.name,
      count: entry.count,
      yearRange: entry.years.size
        ? [Math.min(...entry.years), Math.max(...entry.years)]
        : null,
      media: entry.media,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Groups a filmography into descending year sections. */
export function groupByYear(media) {
  const map = new Map()
  for (const item of Array.isArray(media) ? media : []) {
    const year = Number.isFinite(item?.seasonYear) ? item.seasonYear : null
    const key = year ?? 'Unknown'
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort((a, b) => {
      if (a[0] === 'Unknown') return 1
      if (b[0] === 'Unknown') return -1
      return Number(b[0]) - Number(a[0])
    })
    .map(([year, items]) => ({
      year,
      count: items.length,
      items: items.slice().sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)),
    }))
}

/**
 * Detects franchise membership from AniList relations. Titles are linked when
 * they are an explicit PREQUEL/SEQUEL/PARENT of one another; an undirected
 * union-find keeps chains ("S1 → S2 → S3") in one group even when a middle
 * entry is missing from the input.
 *
 * AV-117d1: edges join on VERIFIED relationship kinds (relations.mjs) instead
 * of raw type names — spin-offs/side stories connect to their franchise — and
 * every member is annotated with its `relationKind`, partitioned into
 * `seasons` (main line) and `branches` (spin-offs/specials/movies/OVAs), so a
 * franchise group is never presented as one season list.
 */
export function buildFranchiseGroups(media) {
  const byId = new Map()
  for (const item of Array.isArray(media) ? media : []) {
    if (item && Number.isInteger(item.id)) byId.set(item.id, item)
  }
  const parent = new Map([...byId.keys()].map((id) => [id, id]))
  const find = (id) => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)
    // Path compression keeps repeated lookups cheap on long franchises.
    let cursor = id
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const item of byId.values()) {
    for (const rel of item.relations ?? []) {
      // Verified franchise-connecting kinds (AV-117d1): continuations and
      // branches connect; 'other'/'character'/'adaptation'/'source' edges
      // (e.g. crossovers) deliberately do NOT union franchises.
      if (!FRANCHISE_CONNECTING_KINDS.has(classifyEdge(rel))) continue
      const target = rel?.node?.id
      if (Number.isInteger(target) && byId.has(target)) union(item.id, target)
    }
  }

  const groups = new Map()
  for (const id of byId.keys()) {
    const root = find(id)
    const list = groups.get(root) ?? []
    list.push(byId.get(id))
    groups.set(root, list)
  }
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      const sorted = list.slice().sort(
        (a, b) => (a.seasonYear ?? 9999) - (b.seasonYear ?? 9999) || (a.id ?? 0) - (b.id ?? 0),
      )
      const memberIds = new Set(sorted.map((member) => member.id))
      const relationKindFor = (member) => {
        for (const rel of member.relations ?? []) {
          const target = rel?.node?.id
          if (target === member.id || !memberIds.has(target)) continue
          const kind = classifyEdge(rel)
          if (kind !== 'unknown') return kind
        }
        return 'main'
      }
      const annotated = sorted.map((member) => ({ ...member, relationKind: relationKindFor(member) }))
      // The earliest main-line member is the franchise head.
      const head = annotated.find((member) => SEASON_KINDS.has(member.relationKind))
      if (head) head.relationKind = 'main'
      return {
        key: `franchise-${sorted[0].id}`,
        count: sorted.length,
        title: sorted[0].title,
        media: annotated,
        seasons: annotated.filter((member) => SEASON_KINDS.has(member.relationKind)),
        branches: annotated.filter((member) => !SEASON_KINDS.has(member.relationKind)),
      }
    })
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
}

/** Compact franchise group cards for list grouping (AV-133b). */
export function franchiseGroupSummaries(media, allIds = []) {
  const groups = buildFranchiseGroups(media).map((group) => ({
    key: group.key,
    title: group.title,
    count: group.count,
    mediaIds: group.media.map((member) => member.id),
  }))
  const grouped = new Set(groups.flatMap((group) => group.mediaIds))
  return { groups, ungrouped: allIds.filter((id) => !grouped.has(id)) }
}

/** Human label for a decade chip, e.g. 1990 → "1990s". */
export function decadeLabel(year) {
  // `Number(null) === 0` and `Number('') === 0`, so guard those before coercing
  // — otherwise a missing year silently labels itself "0s".
  if (year === null || year === undefined || year === '') return 'Unknown'
  const n = Number(year)
  if (!Number.isFinite(n) || n < 1000 || n > 2200) return 'Unknown'
  return `${Math.floor(n / 10) * 10}s`
}

/** Every decade present in a media list, newest first. */
export function decadesPresent(media) {
  const set = new Set()
  for (const item of Array.isArray(media) ? media : []) {
    if (Number.isFinite(item?.seasonYear)) set.add(Math.floor(item.seasonYear / 10) * 10)
  }
  return [...set].sort((a, b) => b - a)
}
