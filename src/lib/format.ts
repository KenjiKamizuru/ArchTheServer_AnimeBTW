export function formatSeason(season: string | null, year: number | null): string {
  if (!season) return year ? String(year) : ''
  const label = season.charAt(0) + season.slice(1).toLowerCase()
  return year ? `${label} ${year}` : label
}

const MEDIA_TYPE_LABELS: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'Short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
}

export function formatMediaType(format: string | null): string {
  if (!format) return 'Anime'
  return Object.prototype.hasOwnProperty.call(MEDIA_TYPE_LABELS, format)
    ? MEDIA_TYPE_LABELS[format]
    : format.replace(/_/g, ' ')
}

/** Ensures an external `<a href>` uses `https:` or `http:` (blocks `javascript:` / `data:`). */
export function safeExternalHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.href
  } catch {
    return null
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  const decimals = idx >= 3 ? 2 : idx >= 2 ? 1 : 0
  return `${value.toFixed(decimals)} ${units[idx]}`
}

export function formatSpeed(bps: number | null | undefined): string | null {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return null
  return `${formatBytes(bps)}/s`
}

export function formatEpisodeCode(season: number | null | undefined, episode: number | null | undefined): string {
  if (episode == null) return ''
  const s = String(Math.max(1, Math.floor(season ?? 1))).padStart(2, '0')
  const e = String(Math.max(1, Math.floor(episode))).padStart(2, '0')
  return `S${s}E${e}`
}

export function formatQualityLabel(quality: string | null | undefined, resolvedHeight?: number | null): string {
  if (resolvedHeight && resolvedHeight > 0) return `${resolvedHeight}p`
  if (!quality) return 'Auto'
  if (/^\d+$/.test(quality)) return `${quality}p`
  if (/^\d+p$/i.test(quality)) return quality.toLowerCase()
  if (quality === 'best') return 'Best'
  if (quality === 'worst') return 'Lowest'
  return quality
}

// Mirrors `server/seasons.mjs` so the client and server agree on which folder a
// title belongs to. Keep both in sync when adding rules.
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}
const ROMAN_NUMERALS: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
}
const FINAL_SEASON = 99

interface SeasonRule {
  re: RegExp
  kind: 'season' | 'final' | 'part' | 'roman'
}

const SEASON_RULES: SeasonRule[] = [
  { re: /^(.*?)[\s:–—-]+season[\s._-]*([0-9]{1,2}|[a-z]+)\b.*$/i, kind: 'season' },
  { re: /^(.*?)[\s:–—-]+([0-9]{1,2})(?:st|nd|rd|th)[\s._-]*season\b.*$/i, kind: 'season' },
  { re: /^(.*?)[\s:–—-]+final[\s._-]*season\b.*$/i, kind: 'final' },
  { re: /^(.*?)[\s:–—-]+(?:cour|part)[\s._-]*([0-9]{1,2})\b.*$/i, kind: 'part' },
  { re: /^(.*?)[\s:–—-]+s(?:eason)?[\s._-]*([0-9]{1,2})\s*$/i, kind: 'season' },
  { re: /^(.*\S)\s+([ivx]{1,4})$/i, kind: 'roman' },
  { re: /^(.*[a-z][^0-9]*?)[\s:–—-]+([0-9]{1,2})$/i, kind: 'season' },
]

const SXXEXX_RE = /^(.*?)[\s._-]*s([0-9]{1,2})[\s._-]*e([0-9]{1,4})\b.*$/i
const RELEASE_NOISE_RE =
  /[\s._-]+(?:1080p|720p|480p|2160p|4k|bluray|bd|bdrip|web-?dl|webrip|hdrip|dvdrip|x264|x265|h\.?264|h\.?265|hevc|av1|aac|flac|dual[.\s-]?audio|multi[.\s-]?sub|uncensored|batch|complete)\b.*$/i

function cleanBaseTitle(value: string): string {
  return String(value ?? '')
    .replace(/[\s._-]+$/g, '')
    .replace(/[([{]+$/g, '')
    .replace(/[\s:–—,\-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Splits a release title into base series name and season number, understanding
 * `Season 2`, `2nd Season`, `S02`, `S02E05`, `Season Two`, `Show II`,
 * `Final Season`, `Part 2`/`Cour 2`, trailing years and release-group noise.
 */
export function inferSeasonFromTitle(title: string | null | undefined): { seriesTitle: string; season: number } {
  let clean = String(title ?? '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/_/g, ' ')
    .replace(RELEASE_NOISE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!clean) clean = String(title ?? '').trim()

  let codeSeason: number | null = null
  const code = clean.match(SXXEXX_RE)
  if (code && /[a-z\u00c0-\uffff]/i.test(code[1] ?? '')) {
    codeSeason = Number(code[2])
    clean = code[1].trim()
  }

  clean = clean
    .replace(/[([{]\s*(?:19|20)[0-9]{2}\s*[)\]}]/g, ' ')
    .replace(/[\s._-]*\(?(?:19|20)[0-9]{2}\)?$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (codeSeason && codeSeason >= 1 && codeSeason <= FINAL_SEASON) {
    return { seriesTitle: cleanBaseTitle(clean) || clean, season: codeSeason }
  }

  for (const rule of SEASON_RULES) {
    const match = clean.match(rule.re)
    if (!match) continue
    const base = cleanBaseTitle(match[1] ?? '')
    if (!base || base.length < 2 || !/[a-z\u00c0-\uffff]/i.test(base)) continue

    if (rule.kind === 'part') return { seriesTitle: base, season: 1 }
    if (rule.kind === 'final') return { seriesTitle: base, season: FINAL_SEASON }
    if (rule.kind === 'roman') {
      const n = ROMAN_NUMERALS[String(match[2]).toLowerCase()]
      if (n) return { seriesTitle: base, season: n }
      continue
    }
    const token = String(match[2]).toLowerCase()
    const n = /^[0-9]{1,2}$/.test(token) ? Number(token) : WORD_NUMBERS[token]
    if (n && n >= 1 && n <= FINAL_SEASON) return { seriesTitle: base, season: n }
  }

  return { seriesTitle: clean, season: 1 }
}

/**
 * Chooses the cleanest shared base title across a franchise's known titles
 * (e.g. ["Show", "Show Season 2", "Show II"] -> "Show").
 */
export function pickSharedSeriesTitle(titles: string[]): string {
  const counts = new Map<string, number>()
  for (const title of titles) {
    const base = inferSeasonFromTitle(title).seriesTitle.trim()
    if (!base) continue
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }
  if (counts.size === 0) return ''
  // Most frequent base wins; ties break toward the shortest (least decorated) name.
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]),
  )[0][0]
}

export function relativeTime(timestamp: number): string {
  const diff = timestamp - Date.now()
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (abs < minute) return diff > 0 ? 'any moment' : 'just now'
  if (abs < hour) {
    const value = Math.round(abs / minute)
    return diff > 0 ? `in ${value}m` : `${value}m ago`
  }
  if (abs < day) {
    const value = Math.round(abs / hour)
    return diff > 0 ? `in ${value}h` : `${value}h ago`
  }
  const value = Math.round(abs / day)
  return diff > 0 ? `in ${value}d` : `${value}d ago`
}

export function exactDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const delta = Math.round((startOf(date) - startOf(today)) / 86_400_000)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function clampEpisode(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(1, Math.floor(value)), Math.max(1, max))
}

/** The next episode number, or null when there is none (AV-159). */
export function nextEpisodeNumber(current: number, max: number): number | null {
  if (!Number.isInteger(current) || current < 1) return null
  const episode = clampEpisode(current, max)
  return episode < Math.max(1, Math.floor(max)) ? episode + 1 : null
}

/**
 * The previous episode number, or null when there is none (AV-185).
 * Same strict-input contract as nextEpisodeNumber: non-integers and
 * values below 1 are refused, not coerced.
 */
export function previousEpisodeNumber(current: number, max: number): number | null {
  if (!Number.isInteger(current) || current < 1) return null
  const episode = clampEpisode(current, max)
  return episode > 1 ? episode - 1 : null
}
