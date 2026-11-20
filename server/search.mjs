// Search intelligence: query parsing, typo tolerance, ranking and highlighting.
//
// Everything in this module is pure so it can be verified without a network or
// a browser. AniList does the actual title lookup; these helpers (a) clean up
// what the user typed, (b) make ranking/typo decisions the API cannot express,
// and (c) explain results back to the UI.

/** Tokens the user can type to target a specific field (AV-065). */
export const SEARCH_FIELDS = {
  title: 't',
  studio: 'studio',
  genre: 'genre',
  tag: 'tag',
  year: 'year',
  status: 'status',
  format: 'format',
  score: 'score',
  episodes: 'ep',
}

const FIELD_ALIASES = {
  t: 'title',
  title: 'title',
  name: 'title',
  studio: 'studio',
  studios: 'studio',
  staff: 'staff',
  voiceactor: 'voiceActor',
  va: 'voiceActor',
  voice: 'voiceActor',
  character: 'character',
  char: 'character',
  relation: 'relation',
  rel: 'relation',
  franchise: 'relation',
  genre: 'genre',
  genres: 'genre',
  tag: 'tag',
  tags: 'tag',
  year: 'year',
  season: 'year',
  status: 'status',
  format: 'format',
  type: 'format',
  score: 'score',
  rating: 'score',
  ep: 'episodes',
  eps: 'episodes',
  episodes: 'episodes',
}

const STATUS_VALUES = new Set(['airing', 'finished', 'upcoming', 'cancelled', 'hiatus'])
const FORMAT_VALUES = new Set(['tv', 'movie', 'ova', 'ona', 'special', 'music', 'tv_short'])

/**
 * Parses a raw search box value into free text plus structured filters.
 *
 *   `monogatari studio:shaft genre:comedy year:2009-2015 score:>80`
 *
 * Unknown `field:value` tokens are kept in the free text (people search for
 * "Fate: Zero"), which is why the field must be in the alias table first.
 */
export function parseSearchQuery(raw) {
  const text = String(raw ?? '').slice(0, 200)
  const free = []
  const filters = {
    studio: [],
    staff: [],
    voiceActor: [],
    character: [],
    relation: [],
    genre: [],
    tag: [],
    year: null,
    status: [],
    format: [],
    score: null,
    episodes: null,
  }
  const tokens = text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []

  for (const token of tokens) {
    const match = token.match(/^([a-z]+):(.+)$/i)
    const field = match ? FIELD_ALIASES[match[1].toLowerCase()] : null
    if (!match || !field) {
      free.push(token.replace(/^"|"$/g, ''))
      continue
    }
    const value = match[2].replace(/^"|"$/g, '').trim()
    if (!value) {
      free.push(token)
      continue
    }
    if (field === 'title') {
      free.push(value)
    } else if (field === 'studio' || field === 'staff' || field === 'voiceActor' || field === 'character' || field === 'relation' || field === 'genre' || field === 'tag') {
      filters[field].push(value.toLowerCase().replace(/\s+/g, ' ').slice(0, 60))
    } else if (field === 'status') {
      const normal = value.toLowerCase()
      if (STATUS_VALUES.has(normal)) filters.status.push(normal)
      else free.push(token)
    } else if (field === 'format') {
      const normal = value.toLowerCase().replace(/[\s-]/g, '_')
      if (FORMAT_VALUES.has(normal)) filters.format.push(normal)
      else free.push(token)
    } else if (field === 'year') {
      const range = value.match(/^(\d{4})(?:\s*[-–.]{1,2}\s*(\d{4}))?$/)
      if (range) {
        const min = Number(range[1])
        const max = range[2] ? Number(range[2]) : min
        if (min >= 1900 && max <= 2200 && min <= max) filters.year = { min, max }
        else free.push(token)
      } else {
        free.push(token)
      }
    } else if (field === 'score') {
      const score = value.match(/^(>=|<=|>|<|=)?\s*(\d{1,3})$/)
      const n = score ? Number(score[2]) : NaN
      if (Number.isFinite(n) && n >= 0 && n <= 100) {
        const op = score[1] || '>='
        if (op === '>') filters.score = { min: Math.min(100, n + 1) }
        else if (op === '>=' || op === '=') filters.score = { min: n }
        else if (op === '<') filters.score = { max: Math.max(0, n - 1) }
        else filters.score = { max: n }
      } else {
        free.push(token)
      }
    } else if (field === 'episodes') {
      const eps = value.match(/^(>=|<=|>|<|=)?\s*(\d{1,4})$/)
      const n = eps ? Number(eps[2]) : NaN
      if (Number.isFinite(n) && n > 0) {
        const op = eps[1] || '='
        if (op === '>') filters.episodes = { min: n + 1 }
        else if (op === '>=') filters.episodes = { min: n }
        else if (op === '<') filters.episodes = { max: Math.max(1, n - 1) }
        else if (op === '<=') filters.episodes = { max: n }
        else filters.episodes = { min: n, max: n }
      } else {
        free.push(token)
      }
    }
  }

  return {
    text: free.join(' ').replace(/\s+/g, ' ').trim(),
    filters,
  }
}

/** True when any structured filter was supplied. */
export function hasStructuredFilters(filters) {
  if (!filters) return false
  return (
    filters.studio.length > 0 ||
    filters.staff.length > 0 ||
    filters.voiceActor.length > 0 ||
    filters.character.length > 0 ||
    filters.relation.length > 0 ||
    filters.genre.length > 0 ||
    filters.tag.length > 0 ||
    filters.status.length > 0 ||
    filters.format.length > 0 ||
    filters.year !== null ||
    filters.score !== null ||
    filters.episodes !== null
  )
}

/** Normalizes a string for comparison: lowercase, accents stripped, punctuation → space. */
export function normalizeForSearch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Hepburn romaji map for hiragana and katakana. Kanji is left unchanged. */
const ROMAJI_MAP = new Map([
  // Hiragana
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['を', 'o'], ['ん', 'n'],
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji'], ['づ', 'zu'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
  // Katakana
  ['ア', 'a'], ['イ', 'i'], ['ウ', 'u'], ['エ', 'e'], ['オ', 'o'],
  ['カ', 'ka'], ['キ', 'ki'], ['ク', 'ku'], ['ケ', 'ke'], ['コ', 'ko'],
  ['サ', 'sa'], ['シ', 'shi'], ['ス', 'su'], ['セ', 'se'], ['ソ', 'so'],
  ['タ', 'ta'], ['チ', 'chi'], ['ツ', 'tsu'], ['テ', 'te'], ['ト', 'to'],
  ['ナ', 'na'], ['ニ', 'ni'], ['ヌ', 'nu'], ['ネ', 'ne'], ['ノ', 'no'],
  ['ハ', 'ha'], ['ヒ', 'hi'], ['フ', 'fu'], ['ヘ', 'he'], ['ホ', 'ho'],
  ['マ', 'ma'], ['ミ', 'mi'], ['ム', 'mu'], ['メ', 'me'], ['モ', 'mo'],
  ['ヤ', 'ya'], ['ユ', 'yu'], ['ヨ', 'yo'],
  ['ラ', 'ra'], ['リ', 'ri'], ['ル', 'ru'], ['レ', 're'], ['ロ', 'ro'],
  ['ワ', 'wa'], ['ヲ', 'o'], ['ン', 'n'],
  ['ガ', 'ga'], ['ギ', 'gi'], ['グ', 'gu'], ['ゲ', 'ge'], ['ゴ', 'go'],
  ['ザ', 'za'], ['ジ', 'ji'], ['ズ', 'zu'], ['ゼ', 'ze'], ['ゾ', 'zo'],
  ['ダ', 'da'], ['ヂ', 'ji'], ['ヅ', 'zu'], ['デ', 'de'], ['ド', 'do'],
  ['バ', 'ba'], ['ビ', 'bi'], ['ブ', 'bu'], ['ベ', 'be'], ['ボ', 'bo'],
  ['パ', 'pa'], ['ピ', 'pi'], ['プ', 'pu'], ['ペ', 'pe'], ['ポ', 'po'],
])

/**
 * Converts Japanese hiragana and katakana to Hepburn romaji. Kanji and
 * non-Japanese characters are passed through unchanged. Small kana (ゃ, ゅ, ょ,
 * っ, ャ, ュ, ョ, ッ) combine with the preceding character to form digraphs.
 */
export function toRomaji(text) {
  const s = String(text ?? '')
  const out = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    const next = s[i + 1]
    // Digraphs: small kana after i-column consonants.
    if ((next === 'ゃ' || next === 'ャ') && 'きぎしじちにひびぴみり'.includes(ch)) {
      const base = ROMAJI_MAP.get(ch)
      if (base === 'shi') out.push('sha')
      else if (base === 'chi') out.push('cha')
      else if (base === 'ji') out.push('ja')
      else out.push(base.replace(/i$/, '') + 'ya')
      i += 2
      continue
    }
    if ((next === 'ゅ' || next === 'ュ') && 'きぎしじちにひびぴみり'.includes(ch)) {
      const base = ROMAJI_MAP.get(ch)
      if (base === 'shi') out.push('shu')
      else if (base === 'chi') out.push('chu')
      else if (base === 'ji') out.push('ju')
      else out.push(base.replace(/i$/, '') + 'yu')
      i += 2
      continue
    }
    if ((next === 'ょ' || next === 'ョ') && 'きぎしじちにひびぴみり'.includes(ch)) {
      const base = ROMAJI_MAP.get(ch)
      if (base === 'shi') out.push('sho')
      else if (base === 'chi') out.push('cho')
      else if (base === 'ji') out.push('jo')
      else out.push(base.replace(/i$/, '') + 'yo')
      i += 2
      continue
    }
    // Sokuon (っ/ッ) geminates the next consonant.
    if ((ch === 'っ' || ch === 'ッ') && next && ROMAJI_MAP.has(next)) {
      const base = ROMAJI_MAP.get(next)
      out.push(base.charAt(0) + base)
      i += 2
      continue
    }
    if (ROMAJI_MAP.has(ch)) {
      out.push(ROMAJI_MAP.get(ch))
    } else {
      out.push(ch)
    }
    i += 1
  }
  return out.join('')
}

/**
 * Normalizes a string and converts Japanese kana to romaji, so a romaji query
 * can match Japanese titles and vice versa.
 */
export function normalizeForSearchRomaji(value) {
  return toRomaji(normalizeForSearch(value))
}

function bigrams(value) {
  const s = value.replace(/\s+/g, '')
  const grams = new Map()
  for (let i = 0; i < s.length - 1; i += 1) {
    const gram = s.slice(i, i + 2)
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }
  return grams
}

/** Sørensen–Dice similarity in [0,1]; robust to transposed characters (AV-054). */
export function similarity(a, b) {
  const x = normalizeForSearch(a)
  const y = normalizeForSearch(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return x.startsWith(y) || y.startsWith(x) ? 0.75 : 0
  const ga = bigrams(x)
  const gb = bigrams(y)
  let overlap = 0
  for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0)
  const total = Math.max(1, x.length - 1 + (y.length - 1))
  const dice = (2 * overlap) / total

  // Bigrams break on transposed characters ("nartuo" shares almost none with
  // "naruto"), so blend in a character-level ratio derived from edit distance.
  // The mix keeps exact/near-exact pairs high without rewarding unrelated
  // strings, which have both a high distance and low overlap.
  const distance = editDistance(x, y)
  const charRatio = 1 - distance / Math.max(x.length, y.length)
  return Math.max(0, Math.min(1, 0.45 * dice + 0.55 * charRatio))
}

/** Optimal string alignment distance (Levenshtein + transposition). */
export function editDistance(a, b) {
  const x = normalizeForSearch(a)
  const y = normalizeForSearch(b)
  if (x === y) return 0
  if (!x.length) return y.length
  if (!y.length) return x.length
  const rows = x.length + 1
  const cols = y.length + 1
  const d = Array.from({ length: rows }, () => new Uint16Array(cols))
  for (let i = 0; i < rows; i += 1) d[i][0] = i
  for (let j = 0; j < cols; j += 1) d[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      // Transposed adjacent characters are one mistake, not two.
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        best = Math.min(best, d[i - 2][j - 2] + 1)
      }
      d[i][j] = best
    }
  }
  return d[x.length][y.length]
}

/** Maximum edit budget allowed for a query of this length. */
export function typoTolerance(query) {
  const len = normalizeForSearch(query).length
  if (len <= 3) return 0
  if (len <= 6) return 1
  return 2
}

/**
 * Ranks candidate titles against a query and explains the score (AV-072).
 * Returns entries sorted best-first; non-matches are dropped.
 */
export function rankTitles(titles, query, { limit = 12, minScore = 0.28 } = {}) {
  const needle = normalizeForSearch(query)
  const needleRomaji = normalizeForSearchRomaji(query)
  if (!needle && !needleRomaji) return []
  const tolerance = typoTolerance(query)
  const out = []
  for (const title of titles) {
    if (!title || typeof title.label !== 'string') continue
    const haystack = normalizeForSearch(title.label)
    const haystackRomaji = normalizeForSearchRomaji(title.label)
    if (!haystack && !haystackRomaji) continue
    let score = 0
    let reason = ''
    if (haystack === needle) {
      score = 1
      reason = 'exact title match'
    } else if (haystack.startsWith(needle)) {
      score = 0.92
      reason = 'title starts with your search'
    } else if (haystack.split(' ').some((word) => word === needle)) {
      score = 0.86
      reason = 'word match in title'
    } else if (haystack.includes(needle)) {
      score = 0.74
      reason = 'title contains your search'
    } else if (needleRomaji && haystackRomaji.includes(needleRomaji)) {
      score = 0.72
      reason = 'romaji title match'
    } else {
      const dice = similarity(needle, haystack)
      const dist = editDistance(needle, haystack)
      if (dist <= tolerance && tolerance > 0) {
        score = 0.62 - dist * 0.05
        reason = `close spelling (${dist} character${dist === 1 ? '' : 's'} off)`
      } else if (dice >= 0.6) {
        score = 0.5 * dice
        reason = `similar title (${Math.round(dice * 100)}% overlap)`
      } else {
        // Also allow the query to hit an alternate/romaji alias.
        const alias = (title.aliases ?? []).find((alt) => normalizeForSearch(alt).includes(needle))
        if (alias) {
          score = 0.7
          reason = `matched alternate title “${alias}”`
        }
      }
    }
    if (!reason || score < minScore) continue
    out.push({ ...title, score, reason })
  }
  return out
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
}

/**
 * Suggests a corrected query when nothing matched (AV-068). The caller keeps
 * the original text so the user can always go back to it.
 */
export function suggestCorrection(titles, query) {
  const words = String(query ?? '').trim()
  if (!words) return null
  const candidates = rankTitles(
    titles,
    words,
    { limit: 1, minScore: 0.3 },
  )
  if (candidates.length === 0) return null
  const best = candidates[0]
  if (normalizeForSearch(best.label) === normalizeForSearch(words)) return null
  return { suggestion: best.label, original: words, reason: best.reason, score: best.score }
}

/**
 * Splits a title into plain/matched segments so the UI can highlight the part
 * of the title that matched (AV-071).
 */
export function highlightSegments(text, query) {
  const source = String(text ?? '')
  const needle = String(query ?? '').trim()
  if (!needle) return [{ text: source, match: false }]
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'ig')
  const parts = source.split(re).filter((part) => part.length > 0)
  return parts.map((part) => ({
    text: part,
    match: part.toLowerCase() === needle.toLowerCase(),
  }))
}

/** Groups results into the categories the UI shows (AV-070). */
export function groupResults(media) {
  const groups = { TV: [], MOVIE: [], OVA: [], ONA: [], SPECIAL: [], OTHER: [] }
  for (const item of Array.isArray(media) ? media : []) {
    const key = Object.hasOwn(groups, item?.format ?? '') && item.format !== 'TV_SHORT' ? item.format : 'OTHER'
    groups[key].push(item)
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([format, items]) => ({ format, items }))
}

/**
 * Builds actionable alternatives for a dead-end search (AV-069): shorter
 * quoted phrases, structured filters and a browse link.
 */
export function alternativeQueries(query) {
  const clean = String(query ?? '').trim()
  const out = []
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    out.push({ label: `Just “${words[0]}”`, query: words[0], kind: 'narrow' })
    out.push({ label: `“${words.slice(0, 2).join(' ')}”`, query: words.slice(0, 2).join(' '), kind: 'narrow' })
  }
  if (clean) {
    const first = words[0] ?? clean
    out.push({ label: `Any genre, title contains “${first}”`, query: `title:${first}`, kind: 'field' })
  }
  out.push({ label: 'Browse the seasonal catalog', query: '', kind: 'browse' })
  return out.slice(0, 4)
}

/** Caps how many results the UI will ever render (AV-074). */
export const RESULT_CAP = { max: 200, defaultPerPage: 40, min: 10 }

export function clampResultCap(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return RESULT_CAP.defaultPerPage
  return Math.min(RESULT_CAP.max, Math.max(RESULT_CAP.min, Math.trunc(n)))
}
