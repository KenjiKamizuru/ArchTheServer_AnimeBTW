// Anime title → (series, season) normalization.
//
// Release names are messy: `Show Season 2`, `Show 2nd Season`, `Show S02`,
// `Show II`, `Show Part 2`, `Show: Season Two (2023)`, `Show Final Season`,
// `Show Cour 2`, and combinations of those. Historically only three strict
// suffix patterns were recognised, so anything else collapsed into "Season 1"
// and split one show into several library folders.
//
// This module parses a title once and returns a stable series key plus a season
// number, a human label, and a confidence score. It is pure and synchronous so
// it can be unit-tested and reused by the scanner, upload path and downloader.

const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const ROMAN_NUMERALS = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
}

const MAX_SEASON = 99

// Ordered: the first rule that matches wins, so put the most specific first.
// Every rule captures the base title in group 1 and the season token in group 2.
const SEASON_RULES = [
  // "Show Season 2", "Show: Season 02", "Show - Season Two"
  { re: /^(.*?)[\s:–—\-]+season[\s._-]*([0-9]{1,2}|[a-z]+)\b.*$/i, kind: 'season' },
  // "Show 2nd Season", "Show 3rd season"
  { re: /^(.*?)[\s:–—\-]+([0-9]{1,2})(?:st|nd|rd|th)[\s._-]*season\b.*$/i, kind: 'season' },
  // "Show Final Season"
  { re: /^(.*?)[\s:–—\-]+final[\s._-]*season\b.*$/i, kind: 'final' },
  // "Show Cour 2", "Show Part 2", "Show 2nd Cour"
  { re: /^(.*?)[\s:–—\-]+(?:cour|part)[\s._-]*([0-9]{1,2})\b.*$/i, kind: 'part' },
  // "Show S02", "Show S2E05" (episode suffix stripped later)
  { re: /^(.*?)[\s:–—\-]+s(?:eason)?[\s._-]*([0-9]{1,2})\s*$/i, kind: 'season' },
  // "Show S2E5" style remains: handle trailing episode code separately below.
  // "Show II", "Show IV" — require a space so "Dr. Stone" keeps "Dr." intact,
  // and require the numeral to be the entire remainder of the title.
  { re: /^(.*\S)\s+([ivx]{1,4})$/i, kind: 'roman' },
  // "Show 2", "Show 3" — a bare trailing number is a very common sequel naming
  // scheme, but it also collides with titles containing numbers ("86", "7 Seeds").
  // Only treat it as a season when the base part is at least 3 chars and contains
  // a letter, so bare-numbered titles are preserved.
  { re: /^(.*[a-z][^0-9]*?)[\s:–—\-]+([0-9]{1,2})$/i, kind: 'bare' },
]

const TRAILING_EPISODE_RE = /^(.*?)[\s._-]*s([0-9]{1,2})[\s._-]*e([0-9]{1,4})\b.*$/i
const EPISODE_ONLY_RE = /^(.*?)[\s._-]+(?:e|ep|episode)[\s._-]*([0-9]{1,4})$/i
const YEAR_SUFFIX_RE = /[\s._-]*\(?(19|20)[0-9]{2}\)?$/
// Fansub / release-group noise that should never be part of a series key.
const RELEASE_NOISE_RE =
  /[\s._-]+(?:1080p|720p|480p|2160p|4k|bluray|bd|bdrip|web-?dl|webrip|hdrip|dvdrip|x264|x265|h\.?264|h\.?265|hevc|av1|aac|flac|dual[.\s-]?audio|multi[.\s-]?sub|uncensored|batch|complete)\b.*$/i

function toSeasonNumber(token) {
  const raw = String(token ?? '').trim().toLowerCase()
  if (!raw) return null
  if (/^[0-9]{1,2}$/.test(raw)) {
    const n = Number(raw)
    return n >= 1 && n <= MAX_SEASON ? n : null
  }
  if (Object.hasOwn(WORD_NUMBERS, raw)) return WORD_NUMBERS[raw]
  return null
}

/** True when the string contains at least one letter (not just digits/punctuation). */
function hasLetter(value) {
  return /[a-z\u00c0-\uffff]/i.test(value)
}

function cleanBaseTitle(value) {
  let out = String(value ?? '')
    .replace(/[\s._-]+$/g, '')
    .replace(/[\s._-]*[([{]\s*[)\]}]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Drop an empty/dangling separator or parenthetical left behind by a suffix.
  out = out.replace(/[\s:–—,\-]+$/g, '').replace(/[([{]+$/g, '').trim()
  return out
}

/**
 * Normalizes a release title for matching/deduplication:
 * lowercase, latin-folded, punctuation removed. Keeps non-latin scripts so
 * Japanese/native titles do not all collapse to the same empty key.
 */
export function normalizeSeriesKey(rawTitle) {
  return String(rawTitle ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, '')
    .slice(0, 160)
}

/** Strips release-group/quality noise so `Show S02 1080p BluRay` parses as S02. */
export function stripReleaseNoise(rawTitle) {
  return String(rawTitle ?? '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/_/g, ' ')
    .replace(RELEASE_NOISE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Parses a release name into series information.
 *
 * @param {string} rawTitle release/anime title, e.g. "Demon Slayer: Season 2"
 * @param {number|string} [explicitSeason] caller-supplied season that wins
 * @returns {{seriesTitle: string, season: number, label: string, confidence: number, episode: number|null, matched: string|null}}
 */
export function parseSeasonInfo(rawTitle, explicitSeason) {
  const original = String(rawTitle ?? '').trim() || 'Anime'
  let working = stripReleaseNoise(original)
  if (!working) working = original

  // An explicit SxxExx code in the title is the strongest signal available.
  const epMatch = working.match(TRAILING_EPISODE_RE)
  let detectedEpisode = null
  let codeSeason = null
  if (epMatch && hasLetter(epMatch[1] ?? '')) {
    detectedEpisode = Number(epMatch[3])
    codeSeason = Number(epMatch[2])
    working = epMatch[1].trim()
  } else {
    const epOnly = working.match(EPISODE_ONLY_RE)
    if (epOnly && hasLetter(epOnly[1] ?? '')) {
      detectedEpisode = Number(epOnly[2])
      working = epOnly[1].trim()
    }
  }

  // Years are metadata, not part of the series name; drop them wherever they
  // appear as a standalone parenthetical or trailing token.
  const withoutYear = working
    .replace(/[([{]\s*(?:19|20)[0-9]{2}\s*[)\]}]/g, ' ')
    .replace(YEAR_SUFFIX_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (withoutYear.length >= 2) working = withoutYear

  let seriesTitle = cleanBaseTitle(working) || 'Anime'
  let detectedSeason = 1
  let confidence = 0.35
  let matched = null

  // An `SxxExx` code already told us the season; trust it unless a rule finds
  // something even more explicit.
  if (Number.isFinite(codeSeason) && codeSeason >= 1 && codeSeason <= MAX_SEASON) {
    detectedSeason = codeSeason
    confidence = 0.95
    matched = 'sxxexx'
  }

  // Run the rule list on the progressively cleaned title until one applies.
  for (let pass = 0; pass < 2; pass++) {
    let applied = false
    for (const rule of SEASON_RULES) {
      const m = seriesTitle.match(rule.re)
      if (!m) continue
      const base = cleanBaseTitle(m[1] ?? '')
      if (!base || !hasLetter(base) || base.length < 2) continue

      let season = null
      if (rule.kind === 'final') {
        // "Final Season" implies the last one; we cannot know the number, so
        // treat it as a distinct season slot rather than folding into S01.
        season = MAX_SEASON
        confidence = Math.max(confidence, 0.6)
      } else if (rule.kind === 'roman') {
        season = ROMAN_NUMERALS[String(m[2]).toLowerCase()] ?? null
        confidence = Math.max(confidence, season ? 0.8 : 0.35)
      } else if (rule.kind === 'part') {
        // "Part 2"/"Cour 2" usually splits one season, not a new season. Keep the
        // season unchanged but strip the token so the series key still matches.
        seriesTitle = base
        applied = true
        matched = m[0]
        confidence = Math.max(confidence, 0.55)
        break
      } else {
        season = toSeasonNumber(m[2])
        confidence = Math.max(confidence, rule.kind === 'season' ? 0.9 : 0.7)
      }

      if (season != null && season >= 1 && season <= MAX_SEASON) {
        seriesTitle = base
        detectedSeason = season
        matched = m[0]
        applied = true
        break
      }
    }
    if (applied) break
    break
  }

  const parsedExplicit = Number(explicitSeason)
  if (Number.isFinite(parsedExplicit) && parsedExplicit >= 1) {
    const season = Math.min(MAX_SEASON, Math.floor(parsedExplicit))
    return {
      seriesTitle: cleanBaseTitle(seriesTitle) || 'Anime',
      season,
      label: seasonLabel(season),
      confidence: 1,
      episode: detectedEpisode,
      matched: 'explicit',
    }
  }

  seriesTitle = cleanBaseTitle(seriesTitle) || 'Anime'
  return {
    seriesTitle,
    season: detectedSeason,
    label: seasonLabel(detectedSeason),
    confidence,
    episode: detectedEpisode,
    matched,
  }
}

/** Human-facing season label used by the UI. */
export function seasonLabel(season) {
  const n = Math.max(1, Math.floor(Number(season) || 1))
  if (n >= MAX_SEASON) return 'Final Season'
  return `Season ${String(n).padStart(2, '0')}`
}

/**
 * Orders season rows so an unknown "Final Season" (`99`) still sorts last
 * without breaking numeric comparison elsewhere.
 */
export function compareSeasons(a, b) {
  const norm = (n) => (Number(n) >= MAX_SEASON ? Number.MAX_SAFE_INTEGER - 1 : Number(n) || 1)
  return norm(a) - norm(b)
}

export const FINAL_SEASON = MAX_SEASON
