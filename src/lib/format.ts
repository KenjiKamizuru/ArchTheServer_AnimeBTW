export function bytes(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const size = n / 1024 ** i
  return `${size >= 100 || i === 0 ? Math.round(size) : size.toFixed(1)} ${units[i]}`
}

export function speed(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  return n > 0 ? `${bytes(n)}/s` : '—'
}

export function percent(received: number, total: number): number {
  if (!total) return 0
  return Math.min(100, Math.max(0, (received / total) * 100))
}

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
