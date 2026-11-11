import express from 'express'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as anilist from './anilist.mjs'
import * as store from './store.mjs'
import * as settings from './settings.mjs'
import * as resolver from './resolver.mjs'
import * as playback from './playback.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.PORT)
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 5173
const HOST = process.env.HOST || '127.0.0.1'
const isProd = process.env.NODE_ENV === 'production'

await Promise.all([store.init(), settings.init(), resolver.init()])

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

// All API responses are JSON; gzip the string payloads for capable clients.
// Streaming routes (video, subtitle proxy) write directly and are untouched.
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return next()
  res.json = (payload) => {
    const gz = gzipSync(JSON.stringify(payload), { level: 6 })
    res.set('Content-Encoding', 'gzip')
    res.set('Content-Type', 'application/json; charset=utf-8')
    res.set('Vary', 'Accept-Encoding')
    res.setHeader('Content-Length', String(gz.length))
    res.end(gz)
    return res
  }
  next()
})

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

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
    res.json(media)
  }),
)

app.get('/api/settings', (req, res) => {
  res.json(settings.get())
})

app.put(
  '/api/settings',
  wrap(async (req, res) => {
    const next = await settings.save(req.body ?? {})
    res.json(next)
  }),
)

/** Whether the provider site is reachable and ffmpeg is available. */
app.get(
  '/api/resolver/status',
  wrap(async (req, res) => {
    res.json({ ...(await resolver.status()), ffmpeg: Boolean(playback.resolveFfmpeg()) })
  }),
)

/** Live hianime search — indices pick the result to play. */
app.get(
  '/api/resolver/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 120)
    res.json({ q, results: await resolver.search(q) })
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
  wrap(async (req, res) => {
    const config = settings.get()
    const query = String(req.body?.query ?? '').trim()
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
    // Remember which hianime entry this show maps to, so re-opening the sheet
    // preselects the same match.
    if (req.body?.mediaId && query) {
      await resolver.saveMatch(req.body.mediaId, {
        query,
        index: req.body?.resultIndex ?? config.resultIndex,
        title: req.body?.title,
      })
    }
    res.json({ resolved: true, ...result })
  }),
)

app.get(
  '/api/live/subtitle',
  wrap(async (req, res) => {
    const query = String(req.query.query ?? '').trim()
    if (!query) {
      res.status(400).json({ error: 'A title to search for is required' })
      return
    }
    const config = settings.get()
    const stream = await resolver.resolve(query, {
      resultIndex: req.query.resultIndex ?? config.resultIndex,
      episode: req.query.episode ?? 1,
      quality: req.query.quality ?? config.quality,
      dub: req.query.dub === '1' || req.query.dub === 'true',
    })
    if (!stream.subtitleUrl) {
      res.status(404).json({ error: 'Subtitle not found' })
      return
    }
    await playback.proxySubtitle(res, stream.subtitleUrl, stream.referer)
  }),
)

app.get(
  '/api/live/stream',
  wrap(async (req, res) => {
    const query = String(req.query.query ?? '').trim()
    if (!query) {
      res.status(400).json({ error: 'A title to search for is required' })
      return
    }
    const config = settings.get()
    const stream = await resolver.resolve(query, {
      resultIndex: req.query.resultIndex ?? config.resultIndex,
      episode: req.query.episode ?? 1,
      quality: req.query.quality ?? config.quality,
      dub: req.query.dub === '1' || req.query.dub === 'true',
    })
    playback.remux(req, res, {
      url: stream.videoUrl,
      referer: stream.referer,
      hls: stream.videoUrl.includes('.m3u8'),
      realtime: true,
    })
  }),
)

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api')) return next(err)
  const status = err.status && err.status < 600 ? err.status : 500
  if (status >= 500) console.error('[api]', err)
  res.status(status).json({ error: err.message || 'Server error' })
})

if (isProd) {
  const dist = path.join(ROOT, 'dist')
  const MIME = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
  // Hashed asset names never change, so gzip them at build time and cache forever.
  app.use((req, res, next) => {
    const ext = path.extname(req.path)
    if (
      (ext === '.js' || ext === '.css') &&
      req.path.startsWith('/assets/') &&
      /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    ) {
      const gz = path.join(dist, 'assets', path.basename(req.path) + '.gz')
      if (existsSync(gz)) {
        // Set every header ourselves and pipe: sendFile would sniff the .gz twin
        // as application/gzip and overwrite Content-Type.
        res.setHeader('Content-Type', MIME[ext])
        res.setHeader('Content-Encoding', 'gzip')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.setHeader('Vary', 'Accept-Encoding')
        res.setHeader('Content-Length', String(statSync(gz).size))
        createReadStream(gz).pipe(res)
        return
      }
    }
    next()
  })
  app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true }))
  app.use((req, res) => {
    res.set('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.listen(PORT, HOST, () => {
  console.log(`\n  AnimeVault ready → http://${HOST}:${PORT}`)
  console.log(`  pid ${process.pid}`)
  console.log(`  Streaming: built-in resolver (hianime.at) · ffmpeg ${playback.resolveFfmpeg() ?? 'NOT FOUND'}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.exit(0)
  })
}
