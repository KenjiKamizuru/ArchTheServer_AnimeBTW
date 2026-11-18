export function formatSeason(season: string | null, year: number | null): string {
  if (!season) return year ? String(year) : ''
  const label = season.charAt(0) + season.slice(1).toLowerCase()
  return year ? `${label} ${year}` : label
}

export function formatMediaType(format: string | null): string {
  if (!format) return 'Anime'
  const map: Record<string, string> = {
    TV: 'TV',
    TV_SHORT: 'Short',
    MOVIE: 'Movie',
    SPECIAL: 'Special',
    OVA: 'OVA',
    ONA: 'ONA',
    MUSIC: 'Music',
  }
  return map[format] ?? format.replace(/_/g, ' ')
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

const SEASON_TITLE_RES = [
  /^(.*?)[\s:–—-]+season\s+(\d{1,2})\s*$/i,
  /^(.*?)[\s:–—-]+(\d{1,2})(?:st|nd|rd|th)\s+season\s*$/i,
  /^(.*?)[\s:–—-]+s(\d{1,2})\s*$/i,
]

export function inferSeasonFromTitle(title: string | null | undefined): { seriesTitle: string; season: number } {
  const clean = String(title ?? '').trim()
  for (const re of SEASON_TITLE_RES) {
    const match = clean.match(re)
    if (match && match[1]?.trim()) {
      const n = Number(match[2])
      if (n >= 1 && n <= 99) return { seriesTitle: match[1].trim(), season: n }
    }
  }
  return { seriesTitle: clean, season: 1 }
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
