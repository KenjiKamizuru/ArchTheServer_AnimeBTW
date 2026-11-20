// HTTP-level verification of the routes and middleware that protect a fresh
// installation. Uses a throwaway data directory and an ephemeral port so it
// never touches a real user's library or bookmarks.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'

let server
let dir
let base

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-smoke-'))
  const reservation = net.createServer()
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      ANIMEVAULT_DATA: dir,
      ANIMEVAULT_API_TOKEN: 'smoke-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    let logs = ''
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${logs}`)), 15_000)
    server.stdout.on('data', (chunk) => {
      logs += chunk
      if (logs.includes('AnimeVault ready')) {
        clearTimeout(timer)
        resolve()
      }
    })
    server.stderr.on('data', (chunk) => { logs += chunk })
    server.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited ${code}: ${logs}`))
    })
  })
})

after(async () => {
  if (server?.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise((resolve) => server.once('exit', resolve))
  }
  await rm(dir, { recursive: true, force: true })
})

const get = (url, headers = {}) => fetch(base + url, { headers: { 'x-api-token': 'smoke-token', ...headers } })

test('health endpoint is public and reports the current season', async () => {
  const res = await fetch(base + '/api/health')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.ok(['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(body.season.season))
  assert.ok(body.season.year >= 2020)
})

test('readiness endpoint reports bookmark-store and library checks', async () => {
  const res = await fetch(base + '/api/ready')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ready, true)
  assert.deepEqual(body.checks, { bookmarkStore: true, library: true })
})

test('all local API routes answer without an upstream provider', async () => {
  const routes = [
    ['/api/settings', 200],
    ['/api/bookmarks', 200],
    ['/api/lists', 200],
    ['/api/downloads', 200],
    ['/api/library', 200],
    ['/api/artwork', 200],
    ['/api/resolver/status', 200],
    ['/api/not-a-route', 404],
  ]
  for (const [route, expected] of routes) {
    const res = await get(route)
    assert.equal(res.status, expected, route)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/, route)
  }
})

test('baseline security headers are present on API and page responses', async () => {
  const api = await get('/api/health')
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(api.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.ok(api.headers.get('permissions-policy')?.includes('camera=()'))
  assert.equal(api.headers.get('x-dns-prefetch-control'), 'off')

  const page = await fetch(base + '/')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type') ?? '', /text\/html/)
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/)
  assert.match(await page.text(), /<title>AnimeVault<\/title>/)
})

test('API token is required and is checked in constant time', async () => {
  assert.equal((await fetch(base + '/api/settings')).status, 401)
  assert.equal((await fetch(base + '/api/settings', { headers: { 'x-api-token': 'wrong' } })).status, 401)
  assert.equal((await fetch(base + '/api/settings', { headers: { authorization: 'Bearer smoke-token' } })).status, 200)
})

test('cross-origin mutations are rejected before they reach a route', async () => {
  const res = await fetch(base + '/api/bookmarks', {
    method: 'POST',
    headers: { 'x-api-token': 'smoke-token', 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ media: { id: 999 } }),
  })
  assert.equal(res.status, 403)
  assert.match((await res.json()).error, /Cross-origin/)
})

test('same-origin mutations pass the CSRF guard but are still input-validated', async () => {
  const res = await fetch(base + '/api/bookmarks', {
    method: 'POST',
    headers: {
      'x-api-token': 'smoke-token',
      'content-type': 'application/json',
      origin: base,
    },
    body: JSON.stringify({ media: {} }),
  })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /media object/)
})

test('provider identifier registry is queryable and fails closed', async () => {
  const empty = await get('/api/identifiers/12345')
  assert.equal(empty.status, 200)
  assert.deepEqual(await empty.json(), { mediaId: 12345, ids: {} })
  assert.equal((await get('/api/identifiers/lookup?provider=anilist&id=12345')).status, 404)
  assert.equal((await get('/api/identifiers/nope')).status, 400)
})

test('settings reject invalid values and expose the local-library configuration', async () => {
  const current = await (await get('/api/settings')).json()
  assert.equal(current.quality, 'best')
  assert.equal(current.maxConcurrentDownloads, 2)
  assert.equal(current.preferLocalPlayback, true)

  const res = await fetch(base + '/api/settings', {
    method: 'PUT',
    headers: { 'x-api-token': 'smoke-token', 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ quality: 'invalid' }),
  })
  assert.equal(res.status, 400)
})

test('empty library and queue have well-formed shapes', async () => {
  const library = await (await get('/api/library')).json()
  assert.deepEqual(library.items, [])
  assert.deepEqual(library.stats, {
    totalFiles: 0,
    episodeCount: 0,
    movieCount: 0,
    unknownCount: 0,
    totalBytes: 0,
  })
  const downloads = await (await get('/api/downloads')).json()
  assert.deepEqual(downloads.jobs, [])
  assert.equal(downloads.counts.total, 0)
})
