// Detail-page enrichment: episode guides, relationship grouping, franchise
// timelines and score distribution histograms.
//
// Pure functions only. The shapes here are what the detail route returns, so
// each one is verifiable without touching the network.

import { normalizeFuzzyDate, normalizeNextEpisode } from './catalog.mjs'

/** Relationship groups the detail page renders, in display order. */
export const RELATION_GROUPS = [
  { key: 'SEQUEL', label: 'Sequel', order: 1 },
  { key: 'PREQUEL', label: 'Prequel', order: 2 },
  { key: 'PARENT', label: 'Parent story', order: 3 },
  { key: 'SIDE_STORY', label: 'Side story', order: 4 },
  { key: 'SPIN_OFF', label: 'Spin-off', order: 5 },
  { key: 'ALTERNATIVE', label: 'Alternative version', order: 6 },
  { key: 'SUMMARY', label: 'Summary', order: 7 },
  { key: 'CHARACTER', label: 'Shared characters', order: 8 },
  { key: 'ADAPTATION', label: 'Adaptation', order: 9 },
  { key: 'SOURCE', label: 'Source material', order: 10 },
  { key: 'OTHER', label: 'Other', order: 20 },
]

const GROUP_KEYS = new Set(RELATION_GROUPS.map((group) => group.key))

/** Canonicalises a raw relation type, mapping unknown values into OTHER. */
export function relationGroupKey(relationType) {
  const key = String(relationType ?? '').toUpperCase()
  return GROUP_KEYS.has(key) ? key : 'OTHER'
}

/**
 * Groups related media by relationship type, keeping a stable order and
 * emphasising the entries that actually matter for watching order (sequels and
 * prequels first).
 */
export function groupRelations(edges) {
  const buckets = new Map()
  // A title is often reachable by several relation types (SEQUEL *and*
  // SPIN_OFF). Keep only its first — most specific — appearance so the same
  // card never shows up under two headings.
  const placed = new Set()
  for (const edge of Array.isArray(edges) ? edges : []) {
    const node = edge?.node
    if (!node || !Number.isInteger(node.id)) continue
    if (node.type && node.type !== 'ANIME' && node.type !== 'MANGA') continue
    if (placed.has(node.id)) continue
    placed.add(node.id)
    const key = relationGroupKey(edge.relationType)
    const list = buckets.get(key) ?? []
    list.push({
      id: node.id,
      type: node.type ?? 'ANIME',
      title: node.title?.english || node.title?.romaji || node.title?.native || `#${node.id}`,
      romaji: node.title?.romaji ?? null,
      native: node.title?.native ?? null,
      format: node.format ?? null,
      status: node.status ?? 'UNKNOWN',
      episodes: node.episodes ?? null,
      chapters: node.chapters ?? null,
      season: node.season ?? null,
      seasonYear: node.seasonYear ?? null,
      startDate: normalizeFuzzyDate(node.startDate),
      cover: node.coverImage?.large ?? node.coverImage?.extraLarge ?? null,
      averageScore: node.averageScore ?? null,
      relationType: key,
    })
    buckets.set(key, list)
  }
  return RELATION_GROUPS.filter((group) => buckets.has(group.key)).map((group) => ({
    key: group.key,
    label: group.label,
    items: buckets
      .get(group.key)
      .slice()
      .sort(
        (a, b) =>
          (a.seasonYear ?? 9999) - (b.seasonYear ?? 9999) ||
          (a.startDate?.month ?? 13) - (b.startDate?.month ?? 13) ||
          a.id - b.id,
      ),
  }))
}

const seasonIndex = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 }

/** Sortable key for a media start date; undated entries sort last. */
function chronologicalKey(item, startDate = normalizeFuzzyDate(item?.startDate)) {
  const year = item?.seasonYear ?? startDate?.year ?? null
  const month = startDate?.month ?? (item?.season ? seasonIndex[item.season] * 3 + 1 : null)
  const day = startDate?.day ?? 1
  if (!Number.isFinite(year)) return { sortable: false, value: Number.MAX_SAFE_INTEGER }
  return { sortable: true, value: year * 10_000 + (month ?? 1) * 100 + (day ?? 1) }
}

/**
 * Franchise timeline in either viewing order (AV-083).
 *
 * `chronological` sorts by in-universe start date; `release` sorts by air date.
 * Both fall back to id ordering for undated entries so the list is stable.
 */
export function buildTimeline(nodes, mode = 'release') {
  const items = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => node && Number.isInteger(node.id))
    .map((node) => {
      const startDate = normalizeFuzzyDate(node.startDate)
      const { sortable, value } = chronologicalKey(node, startDate)
      const releaseYear = node.seasonYear ?? startDate?.year ?? null
      return {
        id: node.id,
        title: node.title?.english || node.title?.romaji || node.title?.native || `#${node.id}`,
        format: node.format ?? null,
        episodes: node.episodes ?? null,
        year: releaseYear,
        season: node.season ?? null,
        cover: node.coverImage?.large ?? null,
        sortable,
        key: value,
        releaseKey: Number.isFinite(releaseYear)
          ? releaseYear * 10_000 + (startDate?.month ?? 6) * 100 + (startDate?.day ?? 15)
          : Number.MAX_SAFE_INTEGER,
      }
    })
  const sorted = items.sort((a, b) => {
    if (mode === 'release') return a.releaseKey - b.releaseKey || a.id - b.id
    return a.key - b.key || a.id - b.id
  })
  return sorted.map((item, index) => ({
    ...item,
    position: index + 1,
    /** Undated entries are flagged so the UI can mark them as uncertain. */
    uncertain: !item.sortable,
  }))
}

/**
 * Splits AniList's 10-bucket `scoreDistribution` into a chart-ready shape with
 * percentages (AV-094). Returns null when no votes exist.
 */
export function scoreDistribution(distribution) {
  const buckets = []
  let total = 0
  for (const entry of Array.isArray(distribution) ? distribution : []) {
    const score = Number(entry?.score)
    const amount = Number(entry?.amount)
    if (!Number.isFinite(score) || score < 0 || score > 100) continue
    if (!Number.isFinite(amount) || amount <= 0) continue
    buckets.push({ score, amount })
    total += amount
  }
  if (total === 0) return null
  buckets.sort((a, b) => b.score - a.score)
  return {
    total,
    buckets: buckets.map((bucket) => ({
      score: bucket.score,
      amount: bucket.amount,
      percent: Number(((bucket.amount / total) * 100).toFixed(1)),
    })),
  }
}

/** Weighted mean of a score histogram, matching AniList's own average. */
export function distributionMean(distribution) {
  const normalised = scoreDistribution(distribution)
  if (!normalised) return null
  const sum = normalised.buckets.reduce((acc, bucket) => acc + bucket.score * bucket.amount, 0)
  return Math.round(sum / normalised.total)
}

/** The score bucket with the most votes — the "consensus" score. */
export function distributionMode(distribution) {
  const normalised = scoreDistribution(distribution)
  if (!normalised) return null
  const best = normalised.buckets.reduce((a, b) => (b.amount > a.amount ? b : a))
  return { score: best.score, amount: best.amount, percent: best.percent }
}

/**
 * Builds numbered episode entries (AV-077/078).
 *
 * AniList exposes per-episode titles/thumbnails only for a subset of titles
 * (`streamingEpisodes`). Those rows are matched to episode numbers by parsing
 * the leading number from their title; everything else falls back to a
 * synthesised entry with the air date derived from the broadcast schedule when
 * available.
 */
export function buildEpisodeGuide(media, streamingEpisodes = []) {
  const total = Number.isFinite(media?.episodes) && media.episodes > 0
    ? media.episodes
    : media?.airedEpisodes ?? 0
  if (!total) return []

  const byNumber = new Map()
  for (const entry of Array.isArray(streamingEpisodes) ? streamingEpisodes : []) {
    const match = String(entry?.title ?? '').match(/(?:episode|ep\.?|e)\s*(\d{1,4})/i) ?? String(entry?.title ?? '').match(/^(\d{1,4})\b/)
    const number = match ? Number(match[1]) : null
    if (!number || number < 1 || number > total) continue
    if (byNumber.has(number)) continue
    byNumber.set(number, entry)
  }

  const duration = Number.isFinite(media?.duration) && media.duration > 0 ? media.duration : null
  const next = normalizeNextEpisode(media?.nextEpisode)
  const episodes = []
  for (let number = 1; number <= total; number += 1) {
    const streamed = byNumber.get(number)
    const aired =
      next && next.episode > number
        ? // Weekly cadence, one week apart, ending at the next unscheduled episode.
          new Date((next.airingAt - (next.episode - number) * 604_800) * 1000).toISOString()
        : next && next.episode === number
          ? new Date(next.airingAt * 1000).toISOString()
          : null
    episodes.push({
      number,
      title: streamed ? cleanEpisodeTitle(streamed.title) : null,
      thumbnail: streamed?.thumbnail ?? null,
      url: streamed?.url ?? null,
      site: streamed?.site ?? null,
      runtimeMinutes: duration,
      airDate: aired,
      /** True when AniList supplied real titles/artwork for this episode. */
      hasMetadata: Boolean(streamed),
      synopsis: null,
    })
  }
  return episodes
}

/** Strips the "Episode 12 - " style prefix AniList puts on streaming titles. */
export function cleanEpisodeTitle(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  return (
    text
      .replace(/^(?:episode|ep\.?|e)\s*\d{1,4}\s*[-–—:.]?\s*/i, '')
      .replace(/^\d{1,4}\s*[-–—:.]\s*/, '')
      .trim() || null
  )
}

/**
 * Spoiler-safe synopsis handling (AV-091/092).
 *
 * AniList marks spoiler spans with `~!...!~`. In spoiler-free mode those spans
 * are replaced by a placeholder so the surrounding text still reads naturally.
 */
export function redactSpoilers(text, { reveal = false, placeholder = '[spoiler hidden]' } = {}) {
  const source = String(text ?? '')
  if (reveal) {
    return { text: source.replace(/~!([\s\S]*?)!~/g, '$1'), hiddenCount: 0 }
  }
  let hiddenCount = 0
  const text2 = source.replace(/~!([\s\S]*?)!~/g, () => {
    hiddenCount += 1
    return placeholder
  })
  return { text: text2, hiddenCount }
}

/** True when a synopsis contains any spoiler-marked region. */
export function hasSpoilers(text) {
  return /~![\s\S]*?!~/.test(String(text ?? ''))
}

/**
 * A short, spoiler-free overview: the first sentence, capped in length, with
 * spoiler spans removed. Used by the compact "new visitor" mode.
 */
export function spoilerFreeOverview(text, { maxLength = 240 } = {}) {
  const { text: clean } = redactSpoilers(text, { reveal: false, placeholder: '' })
  const flat = clean.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const sentenceEnd = flat.search(/[.!?](\s|$)/)
  const firstSentence = sentenceEnd > 40 ? flat.slice(0, sentenceEnd + 1) : flat
  if (firstSentence.length <= maxLength) return firstSentence
  const cut = firstSentence.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Production/status timeline (AV-093): a compact ordered list of the dated
 * milestones we actually know about.
 */
export function buildStatusTimeline(media) {
  const events = []
  const push = (date, label, detail) => {
    if (!date?.year) return
    events.push({
      label,
      detail,
      sort: date.year * 10_000 + (date.month ?? 1) * 100 + (date.day ?? 1),
      display: formatDate(date),
    })
  }
  const startDate = normalizeFuzzyDate(media?.startDate)
  const endDate = normalizeFuzzyDate(media?.endDate)
  const nextEpisode = normalizeNextEpisode(media?.nextEpisode)
  push(startDate, 'Premiered', media?.season ? `${media.season} ${media.seasonYear ?? ''}`.trim() : null)
  push(endDate, 'Finished airing', null)
  if (media?.status === 'NOT_YET_RELEASED') {
    events.push({ label: 'Announced', detail: null, sort: -1, display: 'TBA' })
  }
  if (nextEpisode) {
    const when = new Date(nextEpisode.airingAt * 1000)
    events.push({
      label: `Episode ${nextEpisode.episode}`,
      detail: 'next broadcast',
      // Sort by the real air date so it interleaves correctly with premieres;
      // the previous sentinel (9_999_999) was below any YYYYMMDD value and
      // therefore sorted *first*.
      sort: when.getUTCFullYear() * 10_000 + (when.getUTCMonth() + 1) * 100 + when.getUTCDate(),
      display: when.toISOString().slice(0, 10),
    })
  }
  return events.sort((a, b) => a.sort - b.sort)
}

export function formatDate(date) {
  const normalized = normalizeFuzzyDate(date)
  if (!normalized?.year) return 'TBA'
  const month = normalized.month === null ? null : String(normalized.month).padStart(2, '0')
  const day = normalized.day === null ? null : String(normalized.day).padStart(2, '0')
  if (month && day) return `${normalized.year}-${month}-${day}`
  if (month) return `${normalized.year}-${month}`
  return String(normalized.year)
}

/** Section ids the detail page can reorder (AV-098). */
export const DETAIL_SECTIONS = [
  { id: 'overview', label: 'Overview', always: true },
  { id: 'episodes', label: 'Episode guide' },
  { id: 'characters', label: 'Characters' },
  { id: 'staff', label: 'Staff' },
  { id: 'relations', label: 'Related' },
  { id: 'timeline', label: 'Franchise timeline' },
  { id: 'scores', label: 'Score distribution' },
  { id: 'links', label: 'External links' },
  { id: 'notes', label: 'My notes' },
]

/**
 * Applies a user's saved section order, dropping unknown/duplicate ids and
 * appending anything they did not mention. `always` sections stay pinned first.
 */
export function applySectionOrder(order) {
  const known = new Map(DETAIL_SECTIONS.map((section) => [section.id, section]))
  const seen = new Set()
  const out = []
  for (const section of DETAIL_SECTIONS) {
    if (section.always) {
      out.push(section)
      seen.add(section.id)
    }
  }
  for (const id of Array.isArray(order) ? order : []) {
    if (!known.has(id) || seen.has(id)) continue
    out.push(known.get(id))
    seen.add(id)
  }
  for (const section of DETAIL_SECTIONS) {
    if (!seen.has(section.id)) out.push(section)
  }
  return out
}

/** Printable information sheet (AV-100) as plain markdown-ish lines. */
export function informationSheet(detail) {
  if (!detail) return ''
  const lines = [`# ${detail.title}`, '']
  const meta = [
    detail.format ? `Format: ${detail.format}` : null,
    detail.season ? `Season: ${detail.season} ${detail.seasonYear ?? ''}`.trim() : null,
    detail.status ? `Status: ${detail.status}` : null,
    detail.episodes ? `Episodes: ${detail.episodes}` : null,
    detail.duration ? `Runtime: ${detail.duration} min` : null,
    detail.score ? `Score: ${detail.score}/100` : null,
    detail.studios?.length ? `Studios: ${detail.studios.join(', ')}` : null,
    detail.genres?.length ? `Genres: ${detail.genres.join(', ')}` : null,
  ].filter(Boolean)
  lines.push(...meta, '')
  if (detail.description) {
    lines.push(redactSpoilers(detail.description, { reveal: false }).text, '')
  }
  if (detail.relatedSeasons?.length) {
    lines.push('## Watch order', '')
    detail.relatedSeasons.forEach((season, index) => {
      lines.push(`${index + 1}. ${season.title} (${season.relationType.toLowerCase()})`)
    })
    lines.push('')
  }
  if (detail.links?.length) {
    lines.push('## Links', '')
    for (const link of detail.links) lines.push(`- ${link.site}: ${link.url}`)
  }
  return lines.join('\n')
}
