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
import * as library from './library.mjs'
import * as downloads from './downloads.mjs'
import { verifyRegularLibraryFile } from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.PORT)
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 5173
const HOST = process.env.HOST || '127.0.0.1'
const isProd = process.env.NODE_ENV === 'production'

await Promise.all([store.init(), settings.init(), resolver.init()])
await library.init()
await downloads.init()

const app = express()
app.disable('x-powered-by')
const jsonParser = express.json({ limit: '2mb' })
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

function disableTimeouts(req, res) {
  req.setTimeout?.(0)
  res.setTimeout?.(0)
  req.socket?.setTimeout?.(0)
}

function readStreamToBuffer(readable, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    readable.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }))
        readable.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    readable.once('aborted', () => reject(Object.assign(new Error('Upload aborted'), { status: 499 })))
    readable.once('error', reject)
    readable.once('end', () => resolve(Buffer.concat(chunks)))
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
    await library.ensureLibraryDir()
    library.invalidateCache()
    downloads.schedulePump()
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

/** Available episode numbers for a search query + result index (used for season/series queuing). */
app.get(
  '/api/resolver/episodes',
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

function resolveDubParam(raw, fallback) {
  if (raw === undefined) return Boolean(fallback)
  const value = String(raw).trim().toLowerCase()
  return value === '1' || value === 'true'
}

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
      dub: resolveDubParam(req.query.dub, config.dub),
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
    disableTimeouts(req, res)
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
      dub: resolveDubParam(req.query.dub, config.dub),
    })
    playback.remux(req, res, {
      url: stream.videoUrl,
      audioUrl: stream.audioUrl,
      referer: stream.referer,
      hls: Boolean(stream.hls || stream.videoUrl.includes('.m3u8') || stream.audioUrl?.includes('.m3u8')),
      realtime: true,
    })
  }),
)

// ── Persistent Download Manager ──────────────────────────────────────────────

app.get('/api/downloads', (req, res) => {
  res.json(downloads.snapshot())
})

app.get('/api/downloads/events', (req, res) => {
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

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return
    res.write(': keepalive\n\n')
  }, 20_000)
  heartbeat.unref?.()

  const cleanup = () => {
    clearInterval(heartbeat)
    unsubscribe()
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
})

app.post(
  '/api/downloads',
  wrap(async (req, res) => {
    const result = await downloads.enqueue(req.body ?? {})
    res.status(result.status === 'queued' ? 201 : 200).json(result)
  }),
)

app.post(
  '/api/downloads/bulk',
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

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api')) return next(err)
  const status = err.status && err.status < 600 ? err.status : 500
  if (status >= 500) console.error('[api]', err)
  const payload = { error: err.message || 'Server error' }
  if (typeof err.code === 'string') payload.code = err.code
  if (typeof err.uploadedBytes === 'number') payload.uploadedBytes = err.uploadedBytes
  if (typeof err.fileId === 'string') payload.fileId = err.fileId
  res.status(status).json(payload)
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
    server: {
      middlewareMode: true,
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
httpServer.headersTimeout = 120_000

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void downloads.shutdown().finally(() => process.exit(0))
  })
}
