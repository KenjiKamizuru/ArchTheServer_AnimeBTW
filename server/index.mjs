import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as anilist from './anilist.mjs'
import * as store from './store.mjs'
import * as downloads from './downloads.mjs'
import * as settings from './settings.mjs'
import * as anicli from './anicli.mjs'
import * as playback from './playback.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.PORT)
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 5173
const HOST = process.env.HOST || '127.0.0.1'
const isProd = process.env.NODE_ENV === 'production'

await Promise.all([store.init(), downloads.init(), settings.init(), anicli.init()])

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

app.get('/api/health', (req, res) => {
  res.json({ ok: true, season: anilist.currentSeason(), library: downloads.libraryDir() })
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

/** Compact lookup used by the Downloaded tab to put posters on local files. */
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
  res.json({ ...settings.get(), libraryDir: downloads.libraryDir() })
})

app.put(
  '/api/settings',
  wrap(async (req, res) => {
    const next = await settings.save(req.body ?? {})
    res.json({ ...next, libraryDir: downloads.libraryDir() })
  }),
)

/** Whether the configured ani-cli binary and its helpers are usable. */
app.get(
  '/api/anicli/status',
  wrap(async (req, res) => {
    res.json(await anicli.status(settings.get().anicliBin))
  }),
)

/** Live hianime search — indices match `ani-cli -S`. */
app.get(
  '/api/anicli/search',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 120)
    res.json({ q, results: await anicli.search(q) })
  }),
)

app.get('/api/anicli/matches/:mediaId', (req, res) => {
  const mediaId = Number(req.params.mediaId)
  res.json({ match: Number.isInteger(mediaId) ? anicli.getMatch(mediaId) : null })
})

app.put(
  '/api/anicli/matches/:mediaId',
  wrap(async (req, res) => {
    const match = await anicli.saveMatch(Number(req.params.mediaId), req.body ?? {})
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

app.get('/api/downloads', (req, res) => {
  res.json(downloads.list())
})

app.post(
  '/api/downloads',
  wrap(async (req, res) => {
    const { mediaId, title, episode, url, filename } = req.body ?? {}
    const job = downloads.start({ mediaId, title, episode, url, filename })
    res.status(201).json(job)
  }),
)

/** Bulk queue: every episode through ani-cli or the configured URL template. */
app.post(
  '/api/downloads/bulk',
  wrap(async (req, res) => {
    const { media, episodes, template, source, anicli: options } = req.body ?? {}
    if (!media?.id) {
      res.status(400).json({ error: 'A media object is required' })
      return
    }

    const config = settings.get()
    const engine = source === 'anicli' || (!source && config.downloadProvider === 'anicli') ? 'anicli' : 'template'

    if (engine === 'anicli') {
      const query = String(options?.query ?? media.title ?? media.romaji ?? '').trim()
      if (!query) {
        res.status(400).json({ error: 'A title to search for on ani-cli is required' })
        return
      }
      const resultIndex = Math.min(
        100,
        Math.max(1, Math.floor(Number(options?.resultIndex ?? config.anicliResultIndex) || 1)),
      )
      const result = downloads.startMany({
        media,
        episodes,
        source: 'anicli',
        anicli: {
          query,
          resultIndex,
          quality: options?.quality ?? config.anicliQuality,
          dub: options?.dub ?? config.anicliDub,
          bin: config.anicliBin,
        },
      })
      // Remember which hianime entry this show maps to, so re-opening the sheet
      // preselects the same match.
      await anicli.saveMatch(media.id, { query, index: resultIndex, title: options?.title })
      res.status(201).json(result)
      return
    }

    const chosen = String(template ?? config.sourceTemplate ?? '').trim()
    if (!chosen) {
      res.status(400).json({ error: 'No default source is set. Add one in Settings, then try again.' })
      return
    }
    const verdict = settings.validateTemplate(chosen)
    if (!verdict.ok) {
      res.status(400).json({ error: verdict.error })
      return
    }
    res.status(201).json(downloads.startMany({ media, episodes, template: chosen, source: 'template' }))
  }),
)

app.post('/api/downloads/:id/cancel', (req, res) => {
  const job = downloads.cancel(req.params.id)
  if (!job) {
    res.status(404).json({ error: 'Download not found' })
    return
  }
  res.json(job)
})

app.delete(
  '/api/downloads/:id',
  wrap(async (req, res) => {
    const removed = await downloads.remove(req.params.id)
    res.json({ removed })
  }),
)

app.get('/api/downloads/:id/file', (req, res, next) => {
  const job = downloads.list().find((j) => j.id === req.params.id)
  if (!job?.path) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  if (req.query.stream === '1' || req.headers.range) {
    playback.sendFileWithRange(req, res, job.path, job.filename)
    return
  }
  res.download(job.path, job.filename, (err) => {
    if (err && !res.headersSent) next(err)
  })
})

app.get('/api/downloads/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  send('snapshot', downloads.list())

  const onJob = (job) => send('job', job)
  const onRemoved = (payload) => send('removed', payload)
  downloads.bus.on('job', onJob)
  downloads.bus.on('removed', onRemoved)

  const ping = setInterval(() => res.write(': ping\n\n'), 20_000)

  req.on('close', () => {
    clearInterval(ping)
    downloads.bus.off('job', onJob)
    downloads.bus.off('removed', onRemoved)
    res.end()
  })
})

app.get(
  '/api/library',
  wrap(async (req, res) => {
    res.json({ items: await downloads.library(), dir: downloads.libraryDir() })
  }),
)

/** Stream a downloaded job's file with range support for playback. */
app.get('/api/stream/:id', (req, res) => {
  const job = downloads.list().find((j) => j.id === req.params.id)
  if (!job?.path || !fs.existsSync(job.path)) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  playback.sendFileWithRange(req, res, job.path, job.filename)
})

/** Stream a library file by relative path with range support. */
app.get('/api/stream', (req, res) => {
  const target = downloads.resolveLibraryPath(String(req.query.path ?? ''))
  if (!target) {
    res.status(400).json({ error: 'Invalid library path' })
    return
  }
  if (!fs.existsSync(target)) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  playback.sendFileWithRange(req, res, target, path.basename(target))
})

/** Remux a local file the browser cannot play (mkv, ts, …) to fragmented MP4. */
app.get('/api/transcode/:id', (req, res) => {
  const job = downloads.list().find((j) => j.id === req.params.id)
  if (!job?.path || !fs.existsSync(job.path)) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  if (playback.directPlayable(job.path)) {
    playback.sendFileWithRange(req, res, job.path, job.filename)
    return
  }
  playback.remux(req, res, { filePath: job.path })
})

app.get('/api/transcode', (req, res) => {
  const target = downloads.resolveLibraryPath(String(req.query.path ?? ''))
  if (!target) {
    res.status(400).json({ error: 'Invalid library path' })
    return
  }
  if (!fs.existsSync(target)) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  if (playback.directPlayable(target)) {
    playback.sendFileWithRange(req, res, target, path.basename(target))
    return
  }
  playback.remux(req, res, { filePath: target })
})

/** Live stream for an active job (or a completed one if the client asks). */
function liveParams(job) {
  const config = settings.get()
  return {
    query: job.query || job.title,
    resultIndex: job.resultIndex ?? config.anicliResultIndex ?? 1,
    episode: job.episode ?? 1,
    quality: job.quality || config.anicliQuality,
    dub: job.dub ?? config.anicliDub,
    bin: job.bin || config.anicliBin,
  }
}

app.get(
  '/api/live/job/:id/subtitle',
  wrap(async (req, res) => {
    const job = downloads.list().find((j) => j.id === req.params.id)
    if (!job) {
      res.status(404).json({ error: 'Download not found' })
      return
    }
    if (job.provider !== 'anicli') {
      res.status(404).json({ error: 'No live subtitle for this source' })
      return
    }
    const stream = await anicli.resolveStream(liveParams(job))
    if (!stream.subtitleUrl) {
      res.status(404).json({ error: 'Subtitle not found' })
      return
    }
    await playback.proxySubtitle(res, stream.subtitleUrl, stream.referer)
  }),
)

app.get(
  '/api/live/job/:id',
  wrap(async (req, res) => {
    const job = downloads.list().find((j) => j.id === req.params.id)
    if (!job) {
      res.status(404).json({ error: 'Download not found' })
      return
    }
    if (job.provider === 'anicli') {
      const stream = await anicli.resolveStream(liveParams(job))
      playback.remux(req, res, {
        url: stream.url,
        audioUrl: stream.audioUrl,
        referer: stream.referer,
        hls: true,
        realtime: true,
      })
      return
    }
    playback.remux(req, res, { url: job.url, realtime: true })
  }),
)

app.get(
  '/api/live/subtitle',
  wrap(async (req, res) => {
    const query = String(req.query.query ?? '').trim()
    if (!query) {
      res.status(400).json({ error: 'A title to search for on ani-cli is required' })
      return
    }
    const config = settings.get()
    const stream = await anicli.resolveStream({
      query,
      resultIndex: req.query.resultIndex ?? config.anicliResultIndex,
      episode: req.query.episode ?? 1,
      quality: req.query.quality ?? config.anicliQuality,
      dub: req.query.dub === '1' || req.query.dub === 'true',
      bin: config.anicliBin,
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
      res.status(400).json({ error: 'A title to search for on ani-cli is required' })
      return
    }
    const config = settings.get()
    const stream = await anicli.resolveStream({
      query,
      resultIndex: req.query.resultIndex ?? config.anicliResultIndex,
      episode: req.query.episode ?? 1,
      quality: req.query.quality ?? config.anicliQuality,
      dub: req.query.dub === '1' || req.query.dub === 'true',
      bin: config.anicliBin,
    })
    playback.remux(req, res, {
      url: stream.url,
      audioUrl: stream.audioUrl,
      referer: stream.referer,
      hls: true,
      realtime: true,
    })
  }),
)

/** Serve subtitle sidecar for a tracked job. */
app.get('/api/subtitle/:id', (req, res) => {
  const job = downloads.list().find((j) => j.id === req.params.id)
  if (!job?.path) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const subPath = playback.findSubtitle(job.path)
  if (!subPath) {
    res.status(404).json({ error: 'Subtitle not found' })
    return
  }
  void playback.sendSubtitleFile(res, subPath)
})

/** Serve subtitle sidecar for a library file by path. */
app.get('/api/subtitle', (req, res) => {
  const target = downloads.resolveLibraryPath(String(req.query.path ?? ''))
  if (!target) {
    res.status(400).json({ error: 'Invalid library path' })
    return
  }
  const subPath = playback.findSubtitle(target)
  if (!subPath) {
    res.status(404).json({ error: 'Subtitle not found' })
    return
  }
  void playback.sendSubtitleFile(res, subPath)
})

/** Saves a hand-dropped file from ./library back to the browser. */
app.get('/api/library/file', (req, res, next) => {
  const target = downloads.resolveLibraryPath(String(req.query.path ?? ''))
  if (!target) {
    res.status(400).json({ error: 'Invalid library path' })
    return
  }
  res.download(target, path.basename(target), (err) => {
    if (err && !res.headersSent) next(err)
  })
})

app.delete(
  '/api/library',
  wrap(async (req, res) => {
    const relPath = String(req.query.path ?? '')
    if (!relPath) {
      res.status(400).json({ error: 'A path is required' })
      return
    }
    await downloads.removeExtraFile(relPath)
    res.json({ removed: true })
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
  app.use(express.static(dist, { index: false, maxAge: '1h' }))
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))
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
  console.log(`  Library folder   → ${downloads.libraryDir()}\n`)
})

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    downloads.shutdown()
    // Give ani-cli/yt-dlp a moment to receive the signal and clean up.
    setTimeout(() => process.exit(0), 500).unref()
  })
}
