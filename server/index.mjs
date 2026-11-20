import crypto from 'node:crypto'
import express from 'express'
import path from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { existsSync, lstatSync, createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as anilist from './anilist.mjs'
import * as browse from './browse.mjs'
import * as explore from './explore.mjs'
import * as searchEngine from './search.mjs'
import * as detailEngine from './detail.mjs'
import * as kv from './kv.mjs'
import * as listStore from './listStore.mjs'
import { exportListJson, exportListCsv } from './listExport.mjs'
import { pickListEntry } from './listRandom.mjs'
import { sortListEntries } from './listSort.mjs'
import * as store from './store.mjs'
import * as settings from './settings.mjs'
import * as resolver from './resolver.mjs'
import * as playback from './playback.mjs'
import * as library from './library.mjs'
import * as downloads from './downloads.mjs'
import * as imdb from './imdb.mjs'
import * as users from './users.mjs'
import * as sessions from './sessions.mjs'
import { sanitizeErrorMessage, validateRemoteUrl, verifyRegularLibraryFile, hashPassword, verifyPassword, generateToken, sha256Hex } from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.PORT)
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535 ? requestedPort : 5173
const HOST = process.env.HOST || '127.0.0.1'
const isProd = process.env.NODE_ENV === 'production'
const API_TOKEN = String(process.env.ANIMEVAULT_API_TOKEN ?? '').trim()
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS ?? '')
    .split(/[\s,]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
)
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_SSE_CLIENTS = 64
let activeSseClients = 0

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

await Promise.all([store.init(), settings.init(), resolver.init(), imdb.init(), kv.init(), listStore.init(), users.init(), sessions.init()])
await library.init()
await downloads.init()

const app = express()
app.disable('x-powered-by')

// Baseline HTTP security headers across all API and static responses.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  next()
})

function isLoopbackHostHeader(hostHeader) {
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(hostHeader)
}

function isAllowedSameOriginRequest(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] ?? '').trim().toLowerCase()
  const rawOrigin = String(req.headers.origin ?? '').trim()

  if (rawOrigin) {
    if (rawOrigin.toLowerCase() === 'null') return false
    let parsedOrigin
    try {
      parsedOrigin = new URL(rawOrigin)
    } catch {
      return false
    }
    if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') return false
    const normalizedOrigin = parsedOrigin.origin.toLowerCase()
    if (ALLOWED_ORIGINS.has(normalizedOrigin)) return true
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false

    const originHost = parsedOrigin.host.toLowerCase()
    const hostHeader = String(req.headers.host ?? '').trim().toLowerCase()
    const fwdHost = String(req.headers['x-forwarded-host'] ?? '')
      .split(',')[0]
      .trim()
      .toLowerCase()
    if (originHost === hostHeader || (fwdHost && originHost === fwdHost)) return true

    // Support local reverse proxies (`proxy_pass http://127.0.0.1:5173`) that
    // omit `Host`/`X-Forwarded-Host` forwarding when the browser attests same-origin.
    if (fetchSite === 'same-origin' && !fwdHost && isLoopbackHostHeader(hostHeader)) {
      return true
    }
    return false
  }

  // Block browser requests explicitly marked cross-site/same-site even without Origin.
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false
  return true
}

function timingSafeTokenMatch(provided, expected) {
  const a = Buffer.from(String(provided ?? ''), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Same-origin CSRF protection on all state-changing API endpoints + optional
// bearer/header API token auth when ANIMEVAULT_API_TOKEN is set.
app.use('/api', (req, res, next) => {
  if (MUTATING_METHODS.has(req.method) && !isAllowedSameOriginRequest(req)) {
    res.status(403).json({ error: 'Cross-origin state-changing requests are not allowed' })
    return
  }
  if (API_TOKEN && req.path !== '/health') {
    const authHeader = String(req.headers.authorization ?? '')
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    const headerToken = String(req.headers['x-api-token'] ?? '').trim()
    const candidate = bearer || headerToken
    if (!candidate || !timingSafeTokenMatch(candidate, API_TOKEN)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }
  next()
})

// Session-based authentication middleware. Public auth routes (/api/auth/*)
// are exempt; all other API routes require either a valid API token (when
// ANIMEVAULT_API_TOKEN is set) or a valid session token via
// Authorization: Bearer <token> or the session-token cookie.
const PUBLIC_AUTH_ROUTES = new Set(['/api/auth/register', '/api/auth/login'])
app.use('/api', (req, res, next) => {
  if (PUBLIC_AUTH_ROUTES.has(req.path)) return next()
  // API token auth (ANIMEVAULT_API_TOKEN) takes precedence over sessions.
  if (API_TOKEN) {
    const authHeader = String(req.headers.authorization ?? '')
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    const headerToken = String(req.headers['x-api-token'] ?? '').trim()
    const candidate = bearer || headerToken
    if (candidate && timingSafeTokenMatch(candidate, API_TOKEN)) {
      req.apiTokenAuth = true
      return next()
    }
  }
  const authHeader = String(req.headers.authorization ?? '')
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  const cookieMatch = String(req.headers.cookie ?? '').match(/(?:^|;\s*)session-token=([^;]+)/)
  const cookieToken = cookieMatch ? cookieMatch[1] : ''
  const token = bearer || cookieToken
  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  sessions.getSession(token).then((session) => {
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return
    }
    const user = users.getUser(session.userId)
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }
    req.user = user
    next()
  }).catch((err) => {
    res.status(500).json({ error: sanitizeErrorMessage(err) })
  })
})

/** Lightweight bounded in-memory sliding-window rate limiter per client IP. */
function rateLimit({ windowMs = 60_000, max = 90, name = 'default' } = {}) {
  const buckets = new Map()
  const MAX_KEYS = 4_096
  return (req, res, next) => {
    const now = Date.now()
    const key = `${name}:${req.ip || req.socket?.remoteAddress || 'local'}`
    let entry = buckets.get(key)
    if (!entry || now >= entry.resetAt) {
      if (!entry && buckets.size >= MAX_KEYS) {
        // Prune expired buckets first, then evict oldest key.
        for (const [k, v] of buckets) {
          if (now >= v.resetAt) buckets.delete(k)
          if (buckets.size < MAX_KEYS) break
        }
        if (buckets.size >= MAX_KEYS) {
          buckets.delete(buckets.keys().next().value)
        }
      }
      entry = { count: 0, resetAt: now + windowMs }
      buckets.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      res.status(429).json({ error: 'Too many requests; please wait a moment and try again' })
      return
    }
    next()
  }
}

const limitOutbound = rateLimit({ windowMs: 60_000, max: 120, name: 'outbound' })
const limitPreview = rateLimit({ windowMs: 60_000, max: 300, name: 'preview' })
const limitMutations = rateLimit({ windowMs: 60_000, max: 90, name: 'mutate' })

const jsonParser = express.json({ limit: '512kb' })
app.use((req, res, next) => {
  if (
    req.path === '/api/library/import' ||
    /^\/api\/library\/uploads\/[^/]+(\/chunk)?$/.test(req.path) ||
    (req.method === 'POST' && /^\/api\/library\/[^/]+\/subtitle$/.test(req.path))
  ) {
    return next()
  }
  return jsonParser(req, res, next)
})

// Compress JSON API responses >= 512 bytes for gzip-capable clients.
// Streaming routes (video, subtitle proxy, artwork) write directly and are untouched.
const BROTLI_JSON_OPTIONS = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
    [zlibConstants.BROTLI_PARAM_LGWIN]: 20,
  },
}
app.use((req, res, next) => {
  const acceptEncoding = String(req.headers['accept-encoding'] ?? '')
  const wantsBrotli = /\bbr\b/.test(acceptEncoding)
  const wantsGzip = /\bgzip\b/.test(acceptEncoding)
  if (!wantsBrotli && !wantsGzip) return next()
  const origJson = res.json.bind(res)
  res.json = (payload) => {
    const serialized = JSON.stringify(payload === undefined ? null : payload)
    if (Buffer.byteLength(serialized, 'utf8') < 512) {
      res.set('Vary', 'Accept-Encoding')
      return origJson(payload)
    }
    const raw = Buffer.from(serialized, 'utf8')
    let body = null
    let encoding = null
    if (wantsBrotli) {
      try {
        body = brotliCompressSync(raw, {
          ...BROTLI_JSON_OPTIONS,
          params: { ...BROTLI_JSON_OPTIONS.params, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length },
        })
        encoding = 'br'
      } catch {
        /* fall through to gzip */
      }
    }
    if (!body && wantsGzip) {
      body = gzipSync(raw, { level: 6 })
      encoding = 'gzip'
    }
    if (!body) {
      res.set('Vary', 'Accept-Encoding')
      return origJson(payload)
    }
    res.set('Content-Encoding', encoding)
    res.set('Content-Type', 'application/json; charset=utf-8')
    res.set('Vary', 'Accept-Encoding')
    res.setHeader('Content-Length', String(body.length))
    res.end(body)
    return res
  }
  next()
})

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function disableTimeouts(req, res) {
  req.setTimeout?.(0)
  res.setTimeout?.(0)
  req.socket?.setTimeout?.(0)
}

function pipeFileSafely(req, res, filePath) {
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(filePath)
  const onClose = () => stream.destroy()
  res.once('close', onClose)
  stream.once('end', () => res.off('close', onClose))
  stream.once('error', () => {
    res.off('close', onClose)
    if (!res.headersSent) res.status(404).end()
    else res.destroy()
  })
  stream.pipe(res)
}

function readStreamToBuffer(readable, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      chunks.length = 0
      reject(err)
    }
    readable.on('data', (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > maxBytes) {
        fail(Object.assign(new Error('Payload too large'), { status: 413 }))
        readable.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    readable.once('aborted', () => fail(Object.assign(new Error('Upload aborted'), { status: 499 })))
    readable.once('error', fail)
    readable.once('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
  })
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, season: anilist.currentSeason() })
})

app.get(
  '/api/season',
  wrap(async (req, res) => {
    const { season, year } = anilist.resolveSeason(req.query.season, req.query.year)
    const sort = anilist.resolveSort(req.query.sort)
    const page = clamp(Number(req.query.page) || 1, 1, 25)
    const data = await anilist.getSeason({ season, year, sort, page })
    res.json({ season, year, sort, page, hasNextPage: data.hasNextPage, total: data.total, media: data.media })
  }),
)

// Rich browse: server-side filtering that AniList cannot express is applied
// locally, and the response carries shareable params for the current filters.
app.get(
  '/api/browse',
  limitOutbound,
  wrap(async (req, res) => {
    const filters = browse.parseBrowseFilters(req.query)
    const data = await anilist.browse(filters, browse)
    res.json({ ...data, activeFilters: browse.activeFilterCount(filters) })
  }),
)

app.get(
  '/api/browse/options',
  wrap(async (_req, res) => {
    res.json({
      formats: browse.BROWSE_FORMATS,
      statuses: browse.BROWSE_STATUSES,
      sorts: Object.keys(browse.BROWSE_SORTS),
      sources: browse.BROWSE_SOURCES,
      countries: browse.BROWSE_COUNTRIES,
    })
  }),
)

// Spotlight / random / hidden-gems discovery picks.
app.get(
  '/api/discover/:kind',
  limitOutbound,
  wrap(async (req, res) => {
    const kind = String(req.params.kind ?? '')
    const filters = browse.parseBrowseFilters(req.query)
    const data = await anilist.discover(kind, filters, browse)
    res.json(data)
  }),
)

// ── Studio / producer browsing, alphabetical index, franchises ──────────────

app.get(
  '/api/studios',
  limitOutbound,
  wrap(async (req, res) => {
    const page = clamp(Number(req.query.page) || 1, 1, 10)
    const search = String(req.query.q ?? '').trim().slice(0, 60)
    const sort = String(req.query.sort ?? '')
    const data = await anilist.studios({ page, search, sort })
    res.json(data)
  }),
)

app.get(
  '/api/studios/:id',
  limitOutbound,
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid studio id'), { status: 400 })
    const page = clamp(Number(req.query.page) || 1, 1, 20)
    const sort = browse.BROWSE_SORTS[String(req.query.sort ?? '')] ? String(req.query.sort) : 'popular'
    const data = await anilist.studioFilmography(id, { page, sort })
    res.json({
      ...data,
      byYear: explore.groupByYear(data.media),
      decades: explore.decadesPresent(data.media),
    })
  }),
)

// Alphabetical catalog index (AV-046). Buckets are computed server-side so
// clients do not need to reimplement the kana row mapping.
app.get(
  '/api/index',
  limitOutbound,
  wrap(async (req, res) => {
    const sort = ['title', 'popular', 'rated'].includes(String(req.query.sort)) ? String(req.query.sort) : 'title'
    const kana = String(req.query.kana ?? '1') !== '0'
    const page = clamp(Number(req.query.page) || 1, 1, 10)
    const data = await anilist.catalogIndex({ page, sort })
    res.json({
      buckets: explore.buildAlphabetIndex(data.media, { kana }),
      bucketsAvailable: kana ? [...explore.LATIN_BUCKETS, ...explore.KANA_ROWS] : explore.LATIN_BUCKETS,
      page,
      hasNextPage: data.hasNextPage,
      total: data.total,
    })
  }),
)

// Franchise grouping for the current season (AV-045).
app.get(
  '/api/franchises',
  limitOutbound,
  wrap(async (req, res) => {
    const season = String(req.query.season ?? '')
    const year = Number(req.query.year) || undefined
    const data = await anilist.seasonFranchises({ season, year })
    res.json({
      season: data.season,
      year: data.year,
      groups: explore.buildFranchiseGroups(data.media),
      considered: data.media.length,
    })
  }),
)

// Recently added to catalog (AV-047): newest IDs are the closest signal.
app.get(
  '/api/recent',
  limitOutbound,
  wrap(async (req, res) => {
    const limit = clamp(Number(req.query.limit) || 24, 1, 50)
    const media = await anilist.recentlyAdded(limit)
    res.json({ media, count: media.length })
  }),
)

// Recently updated metadata (AV-048).
app.get(
  '/api/updated',
  limitOutbound,
  wrap(async (req, res) => {
    const limit = clamp(Number(req.query.limit) || 24, 1, 50)
    const media = await anilist.recentlyUpdated(limit)
    res.json({ media, count: media.length })
  }),
)

// ── Search intelligence ─────────────────────────────────────────────────────

// Instant suggestions for the type-ahead dropdown (AV-051).
app.get(
  '/api/search/suggest',
  limitOutbound,
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '')
    const data = await anilist.suggest(q, searchEngine)
    // Typing is bursty: let the browser reuse a suggestion list briefly.
    res.setHeader('Cache-Control', 'private, max-age=20')
    res.json(data)
  }),
)

// Structured search with field filters live here rather than on /api/search so
// the plain title endpoint keeps its simple response shape.
app.get(
  '/api/search/advanced',
  limitOutbound,
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '')
    const page = clamp(Number(req.query.page) || 1, 1, 25)
    const perPage = searchEngine.clampResultCap(req.query.perPage)
    const data = await anilist.searchAdvanced(q, page, searchEngine)
    res.json({
      ...data,
      page,
      perPage,
      cappedAt: perPage,
      groups: searchEngine.groupResults(data.media),
      alternatives: data.media.length === 0 ? searchEngine.alternativeQueries(data.text || q) : [],
    })
  }),
)

// Search only the local library (AV-063).
app.get(
  '/api/search/library',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim()
    const { items } = await library.list()
    const needle = searchEngine.normalizeForSearch(q)
    const matches = needle
      ? items.filter((item) => {
          const haystack = searchEngine.normalizeForSearch(
            [item.animeTitle, item.seriesTitle, item.fileName, item.folder, item.quality].filter(Boolean).join(' '),
          )
          return haystack.includes(needle)
        })
      : []
    res.json({
      query: q,
      count: matches.length,
      // Pre-computed fragments so the client can highlight without shipping the
      // matcher (and without a second pass over every row).
      items: matches.slice(0, 200).map((item) => ({
        ...item,
        highlight: searchEngine.highlightSegments(item.animeTitle || item.seriesTitle || item.fileName || '', q),
      })),
      totalLibrary: items.length,
    })
  }),
)

app.get(
  '/api/search/options',
  wrap(async (_req, res) => {
    res.json({
      fields: Object.keys(searchEngine.SEARCH_FIELDS),
      aliases: Object.keys(searchEngine.SEARCH_FIELDS).length,
      resultCap: searchEngine.RESULT_CAP,
      statuses: ['airing', 'finished', 'upcoming', 'cancelled', 'hiatus'],
      formats: ['tv', 'movie', 'ova', 'ona', 'special', 'music', 'tv_short'],
    })
  }),
)

app.get(
  '/api/airing',
  wrap(async (req, res) => {
    const page = clamp(Number(req.query.page) || 1, 1, 10)
    const data = await anilist.getAiring({ page })
    res.json({ page, hasNextPage: data.hasNextPage, media: data.media })
  }),
)

app.get(
  '/api/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 120)
    const page = clamp(Number(req.query.page) || 1, 1, 10)
    const data = await anilist.searchAnime(q, page)
    res.json({ q, page, hasNextPage: data.hasNextPage, media: data.media })
  }),
)

/** Compact lookup used to put posters on bookmark rows. */
app.get(
  '/api/media',
  wrap(async (req, res) => {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 60)
    res.json({ media: await anilist.getMany(ids) })
  }),
)

app.get(
  '/api/anime/:id',
  wrap(async (req, res) => {
    const media = await anilist.getDetail(req.params.id)
    const reveal = String(req.query.spoilers ?? '') === '1'
    const synopsis = detailEngine.redactSpoilers(media.description, { reveal })
    res.json({
      ...media,
      // Pre-computed sections keep the client free of ranking/grouping logic.
      episodes: detailEngine.buildEpisodeGuide(media, media.streamingEpisodes),
      relations: detailEngine.groupRelations(
        (media.rawRelations ?? media.relations ?? []),
      ),
      timeline: detailEngine.buildTimeline(media.timelineNodes ?? [], String(req.query.order ?? 'release')),
      scores: detailEngine.scoreDistribution(media.scoreBuckets),
      scoreMean: detailEngine.distributionMean(media.scoreBuckets),
      scoreMode: detailEngine.distributionMode(media.scoreBuckets),
      statusTimeline: detailEngine.buildStatusTimeline(media),
      synopsis,
      overview: detailEngine.spoilerFreeOverview(media.description),
      hasSpoilers: detailEngine.hasSpoilers(media.description),
      sections: detailEngine.DETAIL_SECTIONS,
    })
  }),
)

// Per-anime private notes (AV-099). Notes live in the settings store so they
// survive restarts without a database, and are namespaced by media id.
app.get(
  '/api/anime/:id/notes',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid anime id'), { status: 400 })
    const notes = await kv.get(`notes:${id}`, null)
    res.json({ mediaId: id, note: typeof notes?.note === 'string' ? notes.note : '', updatedAt: notes?.updatedAt ?? null })
  }),
)

app.put(
  '/api/anime/:id/notes',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid anime id'), { status: 400 })
    const note = String(req.body?.note ?? '').slice(0, 4000)
    const payload = note.trim() ? { note, updatedAt: Date.now() } : null
    if (payload) await kv.set(`notes:${id}`, payload)
    else await kv.remove(`notes:${id}`)
    res.json({ mediaId: id, note: payload?.note ?? '', updatedAt: payload?.updatedAt ?? null })
  }),
)

// Metadata correction suggestions (AV-096), queued for review.
app.post(
  '/api/anime/:id/report',
  wrap(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid anime id'), { status: 400 })
    const field = String(req.body?.field ?? '').slice(0, 40)
    const message = String(req.body?.message ?? '').trim().slice(0, 1000)
    const kind = req.body?.kind === 'episode-order' ? 'episode-order' : 'metadata'
    if (!message) throw Object.assign(new Error('Please describe the problem'), { status: 400 })
    const allowed = new Set([
      'title', 'episodes', 'season', 'year', 'format', 'status', 'score',
      'synopsis', 'studio', 'relations', 'episode-order', 'other',
    ])
    const report = {
      id: `r_${crypto.randomBytes(8).toString('hex')}`,
      mediaId: id,
      kind,
      field: allowed.has(field) ? field : 'other',
      message,
      createdAt: Date.now(),
      status: 'open',
    }
    const existing = (await kv.get('reports', [])) ?? []
    const reports = [report, ...(Array.isArray(existing) ? existing : [])].slice(0, 500)
    await kv.set('reports', reports)
    res.status(201).json({ report, pending: reports.length })
  }),
)

app.get(
  '/api/reports',
  wrap(async (_req, res) => {
    const reports = (await kv.get('reports', [])) ?? []
    res.json({ reports: Array.isArray(reports) ? reports : [] })
  }),
)


// Installation-wide lists. These are not individual user accounts.
app.get('/api/lists', wrap(async (_req, res) => res.json(listStore.summary())))
app.post('/api/lists', limitMutations, wrap(async (req, res) => {
  res.status(201).json({ list: await listStore.createList(req.body) })
}))
app.post('/api/lists/import', limitMutations, wrap(async (req, res) => {
  res.status(201).json(await listStore.importList(req.body))
}))
app.post('/api/lists/migrate', limitMutations, wrap(async (_req, res) => {
  res.json(await listStore.migrateBookmarks(store.list()))
}))
app.get('/api/lists/:id/random', wrap(async (req, res) => {
  const list = listStore.readList(req.params.id, { order: req.query.order })
  res.setHeader('Cache-Control', 'no-store')
  res.json({ pick: pickListEntry(list.entries) })
}))
app.get('/api/lists/:id/export', wrap(async (req, res) => {
  const format = String(req.query.format ?? 'json').toLowerCase()
  if (format !== 'json' && format !== 'csv') throw Object.assign(new Error('Unsupported export format'), { status: 400 })
  const list = listStore.readList(req.params.id, { order: req.query.order })
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Disposition', `attachment; filename="animevault-list.${format}"`)
  res.type(format === 'csv' ? 'text/csv' : 'application/json')
  res.send(format === 'csv' ? exportListCsv(list) : exportListJson(list))
}))
app.get('/api/lists/:id', wrap(async (req, res) => {
  const list = listStore.readList(req.params.id, { order: req.query.order })
  const sort = String(req.query.sort ?? 'added')
  res.json({ ...list, entries: sortListEntries(list.entries, sort), sort })
}))
app.delete('/api/lists/:id', limitMutations, wrap(async (req, res) => {
  res.json(await listStore.deleteList(req.params.id))
}))
app.post('/api/lists/:id/entries', limitMutations, wrap(async (req, res) => {
  res.json({ entry: await listStore.add(req.params.id, req.body?.media) })
}))
app.put('/api/lists/:id/entries/:mediaId/rating', limitMutations, wrap(async (req, res) => {
  res.json(await listStore.setRating(req.params.id, req.params.mediaId, req.body))
}))
app.put('/api/lists/:id/entries/:mediaId/note', limitMutations, wrap(async (req, res) => {
  res.json(await listStore.setNote(req.params.id, req.params.mediaId, req.body?.note))
}))
app.delete('/api/lists/:id/entries/:mediaId', limitMutations, wrap(async (req, res) => {
  res.json(await listStore.remove(req.params.id, req.params.mediaId))
}))
app.put('/api/lists/:id/order', limitMutations, wrap(async (req, res) => {
  const result = await listStore.setOrder(req.params.id, req.body?.order)
  res.json(result)
}))
app.put('/api/lists/:id/cover', limitMutations, wrap(async (req, res) => {
  const result = await listStore.setCover(req.params.id, req.body?.cover)
  res.json(result)
}))
app.put('/api/lists/:id/visibility', limitMutations, wrap(async (req, res) => {
  const result = await listStore.setVisibility(req.params.id, req.body?.visibility)
  res.json(result)
}))

app.get('/api/settings', (req, res) => {
  res.json(settings.get())
})

app.put(
  '/api/settings',
  limitMutations,
  wrap(async (req, res) => {
    const next = await settings.save(req.body ?? {})
    await library.ensureLibraryDir()
    library.invalidateCache()
    downloads.schedulePump()
    res.json(next)
  }),
)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Authentication routes (AV-101 through AV-125)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** POST /api/auth/register — create a new account (AV-101). */
app.post(
  '/api/auth/register',
  limitMutations,
  wrap(async (req, res) => {
    const config = settings.get()
    if (!config.allowRegistration) {
      res.status(403).json({ error: 'Registration is disabled on this installation' })
      return
    }
    const { username, email, password } = req.body ?? {}
    const user = await users.createUser({ username, email, password })
    const requiresVerification = config.requireEmailVerification && user.email
    res.status(201).json({
      user,
      requiresEmailVerification: requiresVerification,
      message: requiresVerification
        ? 'Account created. Please verify your email before signing in.'
        : 'Account created. You can now sign in.',
    })
  }),
)

/** POST /api/auth/login — sign in and create a session (AV-102). */
app.post(
  '/api/auth/login',
  limitMutations,
  wrap(async (req, res) => {
    const { username, password } = req.body ?? {}
    const user = await users.authenticateUser(username, password)
    const config = settings.get()
    const session = await sessions.createSession(user.id, config.sessionTimeoutMs)
    res.cookie('session-token', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: config.sessionTimeoutMs,
      path: '/',
    })
    res.json({ user, session })
  }),
)

/** POST /api/auth/logout — destroy the current session (AV-102). */
app.post(
  '/api/auth/logout',
  limitMutations,
  wrap(async (req, res) => {
    const authHeader = String(req.headers.authorization ?? '')
    const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    const cookieMatch = String(req.headers.cookie ?? '').match(/(?:^|;\s*)session-token=([^;]+)/)
    const cookieToken = cookieMatch ? cookieMatch[1] : ''
    const token = bearer || cookieToken
    if (token) await sessions.destroySession(token)
    res.clearCookie('session-token', { path: '/' })
    res.json({ ok: true })
  }),
)

/** GET /api/auth/me — return the current authenticated user. */
app.get(
  '/api/auth/me',
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    res.json({ user: req.user })
  }),
)

/** POST /api/auth/change-password — change the current user's password. */
app.post(
  '/api/auth/change-password',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { currentPassword, newPassword } = req.body ?? {}
    await users.changePassword(req.user.id, currentPassword, newPassword)
    await sessions.destroyUserSessions(req.user.id)
    res.json({ ok: true, message: 'Password changed. Please sign in again.' })
  }),
)

/** POST /api/auth/totp/setup — generate TOTP secret + recovery codes (AV-106/107). */
app.post(
  '/api/auth/totp/setup',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const result = await users.setupTOTP(req.user.id)
    res.json(result)
  })
),

/** POST /api/auth/totp/enable — enable TOTP after verifying a code (AV-106). */
app.post(
  '/api/auth/totp/enable',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { token } = req.body ?? {}
    await users.enableTOTP(req.user.id, token)
    res.json({ ok: true })
  })
),

/** POST /api/auth/totp/disable — disable TOTP with password confirmation (AV-106). */
app.post(
  '/api/auth/totp/disable',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { password } = req.body ?? {}
    await users.disableTOTP(req.user.id, password)
    res.json({ ok: true })
  })
),

/** POST /api/auth/totp/verify — verify a TOTP or recovery code (AV-106/107). */
app.post(
  '/api/auth/totp/verify',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { token } = req.body ?? {}
    const result = await users.verifyTOTPForUser(req.user.id, token)
    res.json(result)
  }),
)

/** POST /api/auth/passkeys/add — register a new passkey (AV-105). */
app.post(
  '/api/auth/passkeys/add',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { credentialId, publicKey, counter, label } = req.body ?? {}
    await users.addPasskey(req.user.id, { credentialId, publicKey, counter, label })
    res.json({ ok: true })
  })
),

/** DELETE /api/auth/passkeys/:credentialId — remove a passkey (AV-105). */
app.delete(
  '/api/auth/passkeys/:credentialId',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    await users.removePasskey(req.user.id, req.params.credentialId)
    res.json({ ok: true })
  })
),

/** GET /api/auth/passkeys — list user's passkeys (AV-105). */
app.get(
  '/api/auth/passkeys',
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    res.json({ passkeys: users.listPasskeys(req.user.id) })
  })
),

/** POST /api/auth/passkeys/verify — verify a passkey assertion (AV-105). */
app.post(
  '/api/auth/passkeys/verify',
  limitMutations,
  wrap(async (req, res) => {
    const { credentialId, authenticatorData, clientDataJSON, signature } =
      req.body ?? {}
    const result = await users.verifyPasskeyAssertion(
      credentialId,
      authenticatorData,
      clientDataJSON,
      signature
    )
    const user = users.getUser(result.userId)
    const config = settings.get()
    const session = await sessions.createSession(user.id, config.sessionTimeoutMs)
    res.cookie('session-token', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: config.sessionTimeoutMs,
      path: '/',
    })
    res.json({ user, session })
  }),
)

/** GET /api/auth/activity — activity log for the current user (AV-117). */
app.get(
  '/api/auth/activity',
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const limit = Number(req.query.limit ?? 50)
    res.json({ activity: users.getActivityLog(req.user.id, limit) })
  })
),

/** POST /api/auth/pin — set or update profile PIN (AV-124). */
app.post(
  '/api/auth/pin',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { password, pin } = req.body ?? {}
    await users.setPin(req.user.id, password, pin)
    res.json({ ok: true })
  })
),

/** POST /api/auth/pin/verify — verify profile PIN (AV-124). */
app.post(
  '/api/auth/pin/verify',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { pin } = req.body ?? {}
    const ok = await users.verifyPin(req.user.id, pin)
    res.json({ ok })
  })
),

/** DELETE /api/auth/pin — remove profile PIN (AV-124). */
app.delete(
  '/api/auth/pin',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { password } = req.body ?? {}
    await users.removePin(req.user.id, password)
    res.json({ ok: true })
  })
),

/** POST /api/auth/guests — create a guest profile (AV-122). */
app.post(
  '/api/auth/guests',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    const { displayName } = req.body ?? {}
    const guest = await users.createGuest(displayName)
    res.status(201).json({ user: guest })
  })
),

/** POST /api/auth/switch-profile — switch active profile (AV-123). */
app.post(
  '/api/auth/switch-profile',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const { targetUserId } = req.body ?? {}
    const user = await users.switchProfile(req.user.id, Number(targetUserId))
    res.json({ user })
  })
),

/** GET /api/auth/feature-flags — get feature flags for current user (AV-125). */
app.get(
  '/api/auth/feature-flags',
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    res.json({ featureFlags: users.getFeatureFlags(req.user.id) })
  })
),

/** PUT /api/auth/feature-flags — set feature flags for current user (AV-125). */
app.put(
  '/api/auth/feature-flags',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const flags = req.body ?? {}
    const result = await users.setFeatureFlags(req.user.id, flags, req.user.id)
    res.json(result)

  })
),


/** POST /api/auth/request-password-reset — generate a password reset token (AV-104). */
app.post(
  '/api/auth/request-password-reset',
  limitMutations,
  wrap(async (req, res) => {
    const { email } = req.body ?? {}
    const result = await users.requestPasswordReset(email)
    // In production, deliver result.token via email. Here we return it so
    // installations can wire up their own email transport.
    res.json(result)
  }),
)

/** POST /api/auth/reset-password — reset password using a reset token (AV-104). */
app.post(
  '/api/auth/reset-password',
  limitMutations,
  wrap(async (req, res) => {
    const { token, newPassword } = req.body ?? {}
    await users.resetPassword(token, newPassword)
    res.json({ ok: true })
  }),
)

/** POST /api/auth/verify-email — verify email using a verification token (AV-103). */
app.post(
  '/api/auth/verify-email',
  limitMutations,
  wrap(async (req, res) => {
    const { token } = req.body ?? {}
    await users.verifyEmail(token)
    res.json({ ok: true })
  }),
)

/** GET /api/auth/users — list all users (admin only). */
app.get(
  '/api/auth/users',
  wrap(async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    res.json({ users: users.listUsers() })
  }),
)

/** PUT /api/auth/users/:id — update a user profile (self or admin). */
app.put(
  '/api/auth/users/:id',
  limitMutations,
  wrap(async (req, res) => {
    const targetId = Number(req.params.id)
    if (!req.user || (req.user.id !== targetId && req.user.role !== 'admin')) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    const updated = await users.updateUser(targetId, req.body ?? {})
    res.json({ user: updated })
  }),
)

/** DELETE /api/auth/users/:id — delete a user account (self or admin). */
app.delete(
  '/api/auth/users/:id',
  limitMutations,
  wrap(async (req, res) => {
    const targetId = Number(req.params.id)
    if (!req.user || (req.user.id !== targetId && req.user.role !== 'admin')) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    await users.deleteUser(targetId)
    res.clearCookie('session-token', { path: '/' })
    res.json({ ok: true })
  }),
)

/** GET /api/auth/sessions — list active sessions for the current user (AV-119). */
app.get(
  '/api/auth/sessions',
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    const userSessions = await sessions.listUserSessions(req.user.id)
    res.json({ sessions: userSessions })
  }),
)

/** DELETE /api/auth/sessions/:token — destroy a specific session (AV-119). */
app.delete(
  '/api/auth/sessions/:token',
  limitMutations,
  wrap(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    await sessions.destroySession(req.params.token)
    res.json({ ok: true })
  }),
)

/** Whether the provider site is reachable and ffmpeg is available. */
app.get(
  '/api/resolver/status',
  limitOutbound,
  wrap(async (req, res) => {
    res.json({ ...(await resolver.status()), ffmpeg: Boolean(playback.resolveFfmpeg()) })
  }),
)

/** Live hianime search — indices pick the result to play. */
app.get(
  '/api/resolver/search',
  limitOutbound,
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 120)
    res.json({ q, results: await resolver.search(q) })
  }),
)

/** Available episode numbers for a search query + result index (used for season/series queuing). */
app.get(
  '/api/resolver/episodes',
  limitOutbound,
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 120)
    if (!q) {
      res.status(400).json({ error: 'A title to search for is required' })
      return
    }
    const config = settings.get()
    const data = await resolver.episodesForQuery(q, {
      resultIndex: req.query.resultIndex ?? config.resultIndex,
    })
    res.json(data)
  }),
)

app.get('/api/resolver/matches/:mediaId', (req, res) => {
  const mediaId = Number(req.params.mediaId)
  res.json({ match: Number.isInteger(mediaId) ? resolver.getMatch(mediaId) : null })
})

app.put(
  '/api/resolver/matches/:mediaId',
  wrap(async (req, res) => {
    const match = await resolver.saveMatch(Number(req.params.mediaId), req.body ?? {})
    if (!match) {
      res.status(400).json({ error: 'A query is required' })
      return
    }
    res.json({ match })
  }),
)

app.get('/api/bookmarks', (req, res) => {
  res.json({ items: store.list() })
})

app.post(
  '/api/bookmarks',
  wrap(async (req, res) => {
    const media = req.body?.media
    if (!media?.id) {
      res.status(400).json({ error: 'A media object is required' })
      return
    }
    const entry = store.add(media)
    res.status(201).json({ item: entry, items: store.list() })
  }),
)

app.delete('/api/bookmarks/:id', (req, res) => {
  const removed = store.remove(req.params.id)
  res.json({ removed, items: store.list() })
})

/**
 * Streams one episode: the resolver picks the hianime source, ffmpeg remuxes
 * it to fragmented MP4, and the browser plays it.
 */
app.post(
  '/api/watch',
  limitOutbound,
  wrap(async (req, res) => {
    const config = settings.get()
    const query = String(req.body?.query ?? '').trim().slice(0, 200)
    if (!query) {
      res.status(400).json({ error: 'A title to search for is required' })
      return
    }
    const result = await resolver.resolve(query, {
      resultIndex: req.body?.resultIndex ?? config.resultIndex,
      episode: req.body?.episode ?? 1,
      quality: req.body?.quality ?? config.quality,
      dub: req.body?.dub ?? config.dub,
    })
    // Validate resolved stream URLs against SSRF before confirming playable.
    await validateRemoteUrl(result.videoUrl, { requireApprovedHost: false })
    if (result.audioUrl) {
      await validateRemoteUrl(result.audioUrl, { requireApprovedHost: false })
    }
    // Remember which hianime entry this show maps to, so re-opening the sheet
    // preselects the same match.
    if (req.body?.mediaId && query) {
      await resolver.saveMatch(req.body.mediaId, {
        query,
        index: req.body?.resultIndex ?? config.resultIndex,
        title: req.body?.title,
      })
    }
    res.json({
      resolved: true,
      title: result.title,
      slug: result.slug,
      height: result.height,
      hls: Boolean(result.hls),
      hasSubtitle: Boolean(result.subtitleUrl),
    })
  }),
)

function resolveDubParam(raw, fallback) {
  if (raw === undefined) return Boolean(fallback)
  const value = String(raw).trim().toLowerCase()
  return value === '1' || value === 'true'
}

app.get(
  '/api/live/subtitle',
  limitOutbound,
  wrap(async (req, res) => {
    const query = String(req.query.query ?? '').trim().slice(0, 200)
    if (!query) {
      res.status(400).json({ error: 'A title to search for is required' })
      return
    }
    const config = settings.get()
    const stream = await resolver.resolve(query, {
      resultIndex: req.query.resultIndex ?? config.resultIndex,
      episode: req.query.episode ?? 1,
      quality: req.query.quality ?? config.quality,
      dub: resolveDubParam(req.query.dub, config.dub),
    })
    if (!stream.subtitleUrl) {
      res.status(404).json({ error: 'Subtitle not found' })
      return
    }
    const safeSub = await validateRemoteUrl(stream.subtitleUrl, { requireApprovedHost: false })
    await playback.proxySubtitle(res, safeSub.href, stream.referer)
  }),
)

app.get(
  '/api/live/stream',
  limitOutbound,
  wrap(async (req, res) => {
    disableTimeouts(req, res)
    const query = String(req.query.query ?? '').trim().slice(0, 200)
    if (!query) {
      res.status(400).json({ error: 'A title to search for is required' })
      return
    }
    const config = settings.get()
    const stream = await resolver.resolve(query, {
      resultIndex: req.query.resultIndex ?? config.resultIndex,
      episode: req.query.episode ?? 1,
      quality: req.query.quality ?? config.quality,
      dub: resolveDubParam(req.query.dub, config.dub),
    })
    const safeVideo = await validateRemoteUrl(stream.videoUrl, { requireApprovedHost: false })
    const safeAudio = stream.audioUrl
      ? (await validateRemoteUrl(stream.audioUrl, { requireApprovedHost: false })).href
      : null
    playback.remux(req, res, {
      url: safeVideo.href,
      audioUrl: safeAudio,
      referer: stream.referer,
      hls: Boolean(stream.hls || safeVideo.href.includes('.m3u8') || safeAudio?.includes('.m3u8')),
      realtime: true,
    })
  }),
)

// ── Persistent Download Manager ──────────────────────────────────────────────

app.get('/api/downloads', (req, res) => {
  res.json(downloads.snapshot())
})

app.get('/api/downloads/events', (req, res) => {
  if (activeSseClients >= MAX_SSE_CLIENTS) {
    res.status(429).json({ error: 'Too many open event streams' })
    return
  }
  activeSseClients += 1
  disableTimeouts(req, res)
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const sendEvent = (event, data) => {
    if (res.writableEnded || res.destroyed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  sendEvent('jobs', downloads.snapshot())

  const unsubscribe = downloads.subscribe((event, payload) => {
    if (event === 'jobs') sendEvent('jobs', payload)
    else if (event === 'library') sendEvent('library', { at: Date.now() })
  })
  const unsubscribeArtwork = imdb.onChange(() => {
    sendEvent('artwork', imdb.snapshot())
  })

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return
    res.write(': keepalive\n\n')
  }, 20_000)
  heartbeat.unref?.()

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    activeSseClients = Math.max(0, activeSseClients - 1)
    clearInterval(heartbeat)
    unsubscribe()
    unsubscribeArtwork()
  }
  req.once('close', cleanup)
  res.once('close', cleanup)
})

app.post(
  '/api/downloads',
  limitMutations,
  wrap(async (req, res) => {
    const result = await downloads.enqueue(req.body ?? {})
    res.status(result.status === 'queued' ? 201 : 200).json(result)
  }),
)

app.post(
  '/api/downloads/bulk',
  limitMutations,
  wrap(async (req, res) => {
    const result = await downloads.enqueueBulk(req.body ?? {})
    res.status(result.queuedCount > 0 ? 201 : 200).json(result)
  }),
)

app.post(
  '/api/downloads/actions',
  wrap(async (req, res) => {
    const result = await downloads.bulkAction(req.body ?? {})
    res.json({ ...result, snapshot: downloads.snapshot() })
  }),
)

app.post(
  '/api/downloads/:id/pause',
  wrap(async (req, res) => {
    res.json({ job: await downloads.pause(req.params.id) })
  }),
)

app.post(
  '/api/downloads/:id/resume',
  wrap(async (req, res) => {
    res.json({ job: await downloads.resume(req.params.id) })
  }),
)

app.post(
  '/api/downloads/:id/cancel',
  wrap(async (req, res) => {
    res.json({ job: await downloads.cancel(req.params.id) })
  }),
)

app.post(
  '/api/downloads/:id/retry',
  wrap(async (req, res) => {
    res.json({ job: await downloads.retry(req.params.id) })
  }),
)

app.delete(
  '/api/downloads/:id',
  wrap(async (req, res) => {
    const deleteFile = resolveDubParam(req.query.deleteFile, false)
    const result = await downloads.remove(req.params.id, { deleteFile })
    if (!result.removed) {
      res.status(404).json({ error: 'Download job not found' })
      return
    }
    res.json(result)
  }),
)

// ── Shared Local Media Library ───────────────────────────────────────────────

app.get(
  '/api/library',
  wrap(async (req, res) => {
    const fresh = resolveDubParam(req.query.fresh, false)
    res.json(await library.list({ fresh }))
  }),
)

app.get(
  '/api/library/anime/:mediaId',
  wrap(async (req, res) => {
    const mediaId = Number(req.params.mediaId)
    if (!Number.isInteger(mediaId) || mediaId <= 0) {
      res.status(400).json({ error: 'Invalid anime id' })
      return
    }
    const items = await library.listForAnime({
      mediaId,
      title: req.query.title ? String(req.query.title).slice(0, 200) : undefined,
      romaji: req.query.romaji ? String(req.query.romaji).slice(0, 200) : undefined,
      english: req.query.english ? String(req.query.english).slice(0, 200) : undefined,
    })
    res.json({ items })
  }),
)

// Resumable chunked video upload sessions (movies, episodes, and standalone videos).
// Keeps individual requests small (default 900 KB, auto-scaling up to 8 MB or down
// to 96 KB) so uploads never hit HTTP 413 behind Nginx/Cloudflare/Caddy proxies
// and never reset on slow networks or brief disconnects.
app.post(
  '/api/library/uploads',
  limitMutations,
  wrap(async (req, res) => {
    const session = await library.createUploadSession(req.body ?? {})
    res.status(session.resumed ? 200 : 201).json(session)
  }),
)

app.get(
  '/api/library/uploads/:uploadId',
  wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json(await library.getUploadSession(req.params.uploadId))
  }),
)

const handleUploadChunk = wrap(async (req, res) => {
  disableTimeouts(req, res)
  const rawOffset = req.query.offset ?? req.headers['x-upload-offset'] ?? 0
  const result = await library.appendUploadChunk(req.params.uploadId, rawOffset, req)
  res.json(result)
})

// Accept both POST (works through every proxy/WAF) and PATCH.
app.post('/api/library/uploads/:uploadId/chunk', handleUploadChunk)
app.patch('/api/library/uploads/:uploadId', handleUploadChunk)

app.post(
  '/api/library/uploads/:uploadId/complete',
  wrap(async (req, res) => {
    disableTimeouts(req, res)
    const item = await library.completeUploadSession(req.params.uploadId)
    res.status(201).json({ item })
  }),
)

app.delete(
  '/api/library/uploads/:uploadId',
  wrap(async (req, res) => {
    res.json(await library.cancelUploadSession(req.params.uploadId))
  }),
)

app.post(
  '/api/library/import',
  wrap(async (req, res) => {
    disableTimeouts(req, res)
    const rawName = String(req.query.filename ?? req.headers['x-file-name'] ?? '').trim()
    if (!rawName) {
      res.status(400).json({ error: 'A filename query parameter is required' })
      return
    }
    const item = await library.importVideoStream(req, rawName, {
      category: req.query.category ? String(req.query.category) : 'unknown',
      title: req.query.title ? String(req.query.title).slice(0, 160) : undefined,
      season: req.query.season ? Number(req.query.season) : undefined,
      episode: req.query.episode ? Number(req.query.episode) : undefined,
      quality: req.query.quality ? String(req.query.quality) : undefined,
      dub: req.query.dub !== undefined ? resolveDubParam(req.query.dub, false) : undefined,
      keepBoth: resolveDubParam(req.query.keepBoth, false),
    })
    res.status(201).json({ item })
  }),
)

app.post(
  '/api/library/bulk-delete',
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
    if (ids.length === 0) {
      res.status(400).json({ error: 'Select at least one file to delete' })
      return
    }
    const result = await library.bulkRemove(ids)
    await downloads.unlinkDeletedFileIds(result.deleted)
    res.json(result)
  }),
)

app.get(
  '/api/library/:id/stream',
  wrap(async (req, res) => {
    disableTimeouts(req, res)
    const resolved = await library.resolveById(req.params.id)
    if (!resolved) {
      res.status(404).json({ error: 'Local episode not found' })
      return
    }
    const forceRemux = resolveDubParam(req.query.remux, false)
    if (resolved.entry.directPlayable && !forceRemux) {
      playback.sendFileWithRange(req, res, resolved.realPath, {
        downloadName: resolved.entry.fileName,
        attachment: false,
      })
      return
    }
    playback.remux(req, res, {
      filePath: resolved.realPath,
      realtime: false,
    })
  }),
)

app.get(
  '/api/library/:id/download',
  wrap(async (req, res) => {
    disableTimeouts(req, res)
    const resolved = await library.resolveById(req.params.id)
    if (!resolved) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    playback.sendFileWithRange(req, res, resolved.realPath, {
      downloadName: resolved.entry.fileName,
      attachment: true,
    })
  }),
)

app.get(
  '/api/library/:id/subtitle',
  wrap(async (req, res) => {
    const resolved = await library.resolveById(req.params.id)
    if (!resolved) {
      res.status(404).json({ error: 'Subtitle not found' })
      return
    }
    const subCandidate = playback.findSubtitle(resolved.realPath)
    if (!subCandidate) {
      res.status(404).json({ error: 'Subtitle not found' })
      return
    }
    const verified = await verifyRegularLibraryFile(resolved.libraryDir, subCandidate)
    if (!verified) {
      res.status(404).json({ error: 'Subtitle not found' })
      return
    }
    await playback.sendSubtitleFile(res, verified.realPath)
  }),
)

app.post(
  '/api/library/:id/subtitle',
  wrap(async (req, res) => {
    disableTimeouts(req, res)
    const rawName = String(req.query.filename ?? req.headers['x-file-name'] ?? 'subtitle.vtt').trim()
    const offset = Number(req.query.offset ?? req.headers['x-upload-offset'] ?? 0)
    const final = req.query.final === undefined ? true : resolveDubParam(req.query.final, true)
    const buf = await readStreamToBuffer(req, 32 * 1024 * 1024)
    const result = await library.attachSubtitleFile(req.params.id, rawName, buf, { offset, final })
    res.status(result.saved ? 201 : 200).json(result)
  }),
)

app.delete(
  '/api/library/:id',
  wrap(async (req, res) => {
    const result = await library.removeById(req.params.id)
    if (!result.removed) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    await downloads.unlinkDeletedFileIds([result.id])
    res.json({ removed: true, id: result.id })
  }),
)

// ── IMDb Photo Lookup & Persistent Local Artwork (Banner / Poster / Icon) ───

app.get('/api/artwork', (req, res) => {
  res.json(imdb.snapshot())
})

app.get(
  '/api/artwork/:artId',
  wrap(async (req, res) => {
    const resolved = await imdb.resolveArtworkFile(req.params.artId)
    if (!resolved) {
      res.status(404).json({ error: 'Artwork not found' })
      return
    }
    res.setHeader('Content-Type', resolved.mime)
    res.setHeader('Content-Length', String(resolved.size))
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    pipeFileSafely(req, res, resolved.absPath)
  }),
)

app.get(
  '/api/imdb/search',
  limitOutbound,
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100)
    res.json(await imdb.searchTitles(q))
  }),
)

app.get(
  '/api/imdb/lookup',
  limitOutbound,
  wrap(async (req, res) => {
    const raw = String(req.query.id ?? '').slice(0, 300)
    res.json(await imdb.lookupTitle(raw))
  }),
)

app.get(
  '/api/imdb/title/:imdbId',
  limitOutbound,
  wrap(async (req, res) => {
    const data = await imdb.lookupTitle(String(req.params.imdbId ?? '').slice(0, 64))
    res.json(data)
  }),
)

app.get(
  '/api/imdb/preview',
  limitPreview,
  wrap(async (req, res) => {
    const rawUrl = String(req.query.u ?? '').trim()
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing preview URL' })
      return
    }
    const { buffer, mime } = await imdb.fetchPreviewThumbnail(rawUrl)
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.end(buffer)
  }),
)

app.post(
  '/api/imdb/claim',
  limitMutations,
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const result = await imdb.claimArtwork(body)
    if (body.targetType === 'file' && body.targetKey) {
      await library.annotateItem(String(body.targetKey), {
        imdbId: result.record?.imdbId ?? undefined,
        title: body.applyTitle ? body.imdbTitle : undefined,
        asMovie: Boolean(body.asMovie),
      })
    }
    res.status(201).json(result)
  }),
)

app.post(
  '/api/imdb/claim-bundle',
  limitMutations,
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const result = await imdb.claimArtworkBundle(body)
    if (body.targetType === 'file' && body.targetKey) {
      await library.annotateItem(String(body.targetKey), {
        imdbId: result.record?.imdbId ?? undefined,
        title: body.applyTitle ? body.imdbTitle : undefined,
        asMovie: Boolean(body.asMovie),
      })
    }
    res.status(201).json(result)
  }),
)

app.patch(
  '/api/artwork/focus',
  limitMutations,
  wrap(async (req, res) => {
    res.json(await imdb.updateArtworkFocus(req.body ?? {}))
  }),
)

app.delete(
  '/api/artwork',
  limitMutations,
  wrap(async (req, res) => {
    res.json(await imdb.clearArtwork(req.body ?? {}))
  }),
)

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (!req.path.startsWith('/api')) return next(err)
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON request body' })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request payload too large' })
    return
  }
  const rawStatus = Number(err?.status ?? err?.statusCode)
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500
  if (status >= 500) console.error('[api]', err)
  const message =
    status === 500
      ? 'Internal server error'
      : sanitizeErrorMessage(err?.message, 'Request failed')
  const payload = { error: message }
  if (typeof err?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(err.code)) payload.code = err.code
  if (typeof err?.uploadedBytes === 'number' && Number.isFinite(err.uploadedBytes)) {
    payload.uploadedBytes = err.uploadedBytes
  }
  if (typeof err?.fileId === 'string' && /^f_[0-9a-f]{20}$/.test(err.fileId)) {
    payload.fileId = err.fileId
  }
  res.status(status).json(payload)
})

if (isProd) {
  const dist = path.join(ROOT, 'dist')
  const assetsDir = path.join(dist, 'assets')
  const MIME = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
  /** Picks the smallest precompressed twin the client actually accepts. */
  const precompressedVariants = (baseName, acceptEncoding) => {
    const accepts = String(acceptEncoding ?? '').toLowerCase()
    const variants = []
    if (/\bbr\b/.test(accepts)) variants.push({ file: `${baseName}.br`, enc: 'br' })
    if (/\bgzip\b/.test(accepts)) variants.push({ file: `${baseName}.gz`, enc: 'gzip' })
    return variants
  }
  // Hashed asset names never change, so serve precompressed twins and cache forever.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    // Never expose compression twins as directly addressable files.
    if (req.path.endsWith('.gz') || req.path.endsWith('.br')) {
      res.status(404).end()
      return
    }
    const ext = path.extname(req.path)
    if ((ext === '.js' || ext === '.css') && req.path.startsWith('/assets/')) {
      const baseName = path.basename(req.path)
      for (const variant of precompressedVariants(baseName, req.headers['accept-encoding'])) {
        const target = path.join(assetsDir, variant.file)
        if (path.dirname(target) !== assetsDir || !existsSync(target)) continue
        try {
          const st = lstatSync(target)
          if (st.isFile() && !st.isSymbolicLink()) {
            res.setHeader('Content-Type', MIME[ext])
            res.setHeader('Content-Encoding', variant.enc)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            res.setHeader('Vary', 'Accept-Encoding')
            res.setHeader('Content-Length', String(st.size))
            pipeFileSafely(req, res, target)
            return
          }
        } catch {
          /* try the next variant / fall through to static */
        }
      }
    }
    next()
  })
  app.use(express.static(dist, { index: false, dotfiles: 'deny', maxAge: '1y', immutable: true }))
  app.use((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).end()
      return
    }
    res.set('Cache-Control', 'no-cache')
    res.setHeader('Content-Security-Policy', APP_CSP)
    res.sendFile(path.join(dist, 'index.html'))
  })
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: ROOT,
    server: {
      middlewareMode: true,
      fs: {
        strict: true,
        deny: ['.env', '.env.*', '*.{crt,pem}', 'data/**', 'library/**', 'server/**'],
      },
      watch: {
        ignored: ['**/library/**', '**/data/**', '**/.incomplete/**'],
      },
    },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`\n  AnimeVault ready → http://${HOST}:${PORT}`)
  console.log(`  pid ${process.pid}`)
  console.log(`  Library:   ${settings.resolveLibraryDir()}`)
  console.log(`  Streaming: built-in resolver (hianime.at) · ffmpeg ${playback.resolveFfmpeg() ?? 'NOT FOUND'}\n`)
})
// Never kill long-running local video streams, SSE feeds, or multi-GB uploads
// after Node's default 5-minute requestTimeout.
httpServer.requestTimeout = 0
httpServer.headersTimeout = 60_000

let shuttingDownServer = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDownServer) return
    shuttingDownServer = true
    void Promise.allSettled([downloads.shutdown(), store.flush(), listStore.flush(), users.flush(), sessions.flush()]).finally(() => process.exit(0))
  })
}
