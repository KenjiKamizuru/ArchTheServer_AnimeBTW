// End-to-end test for the AV-139 "stalled shows" route over real HTTP:
// session auth (register → login → av_session cookie), status-list entries,
// per-profile progress, and the computed smart list. Staleness thresholds
// are proven in tests/smart-lists.test.mjs (the progress API stamps
// updatedAt server-side, so records cannot be backdated here).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
let server, dir, base, cookie
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-smart-http-'))
  const reservation = net.createServer()
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), ANIMEVAULT_DATA: dir, ANIMEVAULT_API_TOKEN: 'test-token' }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    let logs = ''
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${logs}`)), 15000)
    server.stdout.on('data', (chunk) => { logs += chunk; if (logs.includes('AnimeVault ready')) { clearTimeout(timer); resolve() } })
    server.stderr.on('data', (chunk) => { logs += chunk })
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${logs}`)) })
  })
})
after(async () => { if (server?.exitCode === null) { server.kill('SIGTERM'); await new Promise((resolve) => server.once('exit', resolve)) }; await rm(dir, { recursive: true, force: true }) })
async function req(url, method = 'GET', body, headers = {}) {
  const response = await fetch(base + url, { method, headers: { 'x-api-token': 'test-token', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json(), setCookie: response.headers.get('set-cookie') ?? '' }
}
const media = (id, title) => ({ id, title, cover: null })
test('sign-in flows work against the running server', async () => {
  // Registration is closed by default; the installation opens it through
  // the settings route (this also exercises the AV-139 restart-persistence
  // fix — settings.load now keeps registrationOpen).
  assert.equal((await req('/api/settings', 'PUT', { registrationOpen: true })).status, 200)
  const registered = await req('/api/auth/register', 'POST', { username: 'stalled_tester', password: 'stalling is hard 1', displayName: 'Staller' })
  assert.equal(registered.status, 201)
  const login = await req('/api/auth/login', 'POST', { username: 'stalled_tester', password: 'stalling is hard 1' })
  assert.equal(login.status, 200)
  const match = login.setCookie.match(/av_session=([^;]+)/)
  assert.ok(match, 'login sets the av_session cookie')
  cookie = `av_session=${match[1]}`
})
test('seed: watching entries with and without progress, plus a planned entry', async () => {
  assert.equal((await req('/api/lists/status:watching/entries', 'POST', { media: media(501, 'Never progressed') })).status, 200)
  assert.equal((await req('/api/lists/status:watching/entries', 'POST', { media: media(502, 'Freshly watched') })).status, 200)
  assert.equal((await req('/api/lists/status:paused/entries', 'POST', { media: media(503, 'Paused and stale') })).status, 200)
  assert.equal((await req('/api/lists/status:planned/entries', 'POST', { media: media(504, 'Planned untouched') })).status, 200)
  const saved = await req('/api/progress', 'PUT', { mediaId: 502, season: 's1', episode: 1, positionSeconds: 300 })
  assert.equal(saved.status, 200)
})
test('the stalled list reports unfinished entries without recent progress', async () => {
  const r = await req('/api/lists/smart/stalled')
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'Stalled shows')
  assert.equal(r.body.days, 14, 'default idle window')
  const ids = r.body.entries.map((entry) => entry.mediaId)
  assert.ok(ids.includes(501), 'never-progressed watching entry is stalled')
  assert.ok(ids.includes(503), 'paused entry with no progress is stalled')
  assert.ok(!ids.includes(502), 'fresh progress is not stalled')
  assert.ok(!ids.includes(504), 'planned (never started) is excluded')
  const row = r.body.entries.find((entry) => entry.mediaId === 501)
  assert.equal(row.lastProgressAt, null)
  assert.equal(row.status, 'watching')
  assert.equal(row.media.title, 'Never progressed')
  assert.equal(r.body.count, r.body.entries.length)
})
test('the idle window is configurable and falls back when invalid', async () => {
  assert.equal((await req('/api/lists/smart/stalled?days=30')).body.days, 30)
  assert.equal((await req('/api/lists/smart/stalled?days=0')).body.days, 14, 'out of range falls back to the default')
  assert.equal((await req('/api/lists/smart/stalled?days=abc')).body.days, 14)
})
test('the stalled list requires sign-in with a friendly error', async () => {
  const saved = cookie
  cookie = ''
  const r = await req('/api/lists/smart/stalled')
  assert.equal(r.status, 401)
  assert.equal(r.body.error, 'Sign in to see stalled shows')
  cookie = saved
})
test('the returning-soon route answers with its payload shape (AV-138)', async () => {
  // Relationship data comes from AniList over the network; in an offline
  // environment the route degrades to unavailable:true with empty entries —
  // either way it must answer 200 with a consistent payload (semantics are
  // pinned in tests/smart-lists.test.mjs).
  const r = await req('/api/lists/smart/returning')
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'Returning soon')
  assert.ok(Array.isArray(r.body.entries))
  assert.equal(r.body.count, r.body.entries.length)
  assert.equal(typeof r.body.unavailable, 'boolean')
  if (r.body.unavailable) assert.equal(r.body.entries.length, 0, 'an upstream failure yields an empty list, not junk')
})
test('the new-episodes route requires sign-in and answers with its payload shape (AV-137)', async () => {
  const anonymous = cookie
  cookie = ''
  const unauth = await req('/api/lists/smart/new-episodes')
  assert.equal(unauth.status, 401)
  assert.equal(unauth.body.error, 'Sign in to see new episodes')
  cookie = anonymous
  // Airing data comes from AniList; offline the route degrades to
  // unavailable:true with empty entries — either way it must answer 200
  // with a consistent payload (semantics are pinned in smart-lists.test.mjs).
  const r = await req('/api/lists/smart/new-episodes')
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'New episodes')
  assert.ok(Array.isArray(r.body.entries))
  assert.equal(r.body.count, r.body.entries.length)
  assert.equal(typeof r.body.unavailable, 'boolean')
  if (r.body.unavailable) assert.equal(r.body.entries.length, 0)
})
test('episode state stores over the progress API (AV-154)', async () => {
  const saved = await req('/api/progress', 'PUT', { mediaId: 502, season: 's1', episode: 2, positionSeconds: 0, state: 'manual' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.entry.state, 'manual')
  const kept = await req('/api/progress', 'PUT', { mediaId: 502, season: 's1', episode: 2, positionSeconds: 30 })
  assert.equal(kept.body.entry.state, 'manual', 'positional updates preserve the state')
  const bad = await req('/api/progress', 'PUT', { mediaId: 502, season: 's1', episode: 2, positionSeconds: 30, state: 'finished' })
  assert.equal(bad.status, 400)
  const entries = (await req('/api/progress')).body.entries
  assert.ok(entries.some((entry) => entry.mediaId === 502 && entry.episode === 2 && entry.state === 'manual'))
})
test('the completion threshold auto-finishes episodes over the progress API (AV-155)', async () => {
  const done = await req('/api/progress', 'PUT', { mediaId: 505, season: 's1', episode: 1, positionSeconds: 950, runtimeSeconds: 1000 })
  assert.equal(done.status, 200)
  assert.equal(done.body.entry.state, 'completed', '95% of runtime crosses the default 90% threshold')
  assert.equal(done.body.entry.runtimeSeconds, 1000)
  const partial = await req('/api/progress', 'PUT', { mediaId: 505, season: 's1', episode: 2, positionSeconds: 100, runtimeSeconds: 1000 })
  assert.equal(partial.body.entry.state, 'started', 'below the threshold')
  const noRuntime = await req('/api/progress', 'PUT', { mediaId: 505, season: 's1', episode: 3, positionSeconds: 99_999 })
  assert.equal(noRuntime.body.entry.state, 'started', 'an unknown runtime never auto-completes')
  const kept = await req('/api/progress', 'PUT', { mediaId: 505, season: 's1', episode: 1, positionSeconds: 10 })
  assert.equal(kept.body.entry.state, 'completed', 'a later position never downgrades')
})
test('mark-as-watched and mark-as-unwatched payloads land correctly (AV-156)', async () => {
  // The exact contract src/lib/progress.ts builds for the episode-row
  // controls: watched = manual at position 0 (runtime rides along);
  // unwatched = started at position 0 (the record is kept — AV-157 owns
  // destructive resets).
  const watched = await req('/api/progress', 'PUT', { mediaId: 506, season: 'fall-2026', episode: 3, positionSeconds: 0, state: 'manual', runtimeSeconds: 1440 })
  assert.equal(watched.status, 200)
  assert.equal(watched.body.entry.state, 'manual')
  assert.equal(watched.body.entry.positionSeconds, 0)
  assert.equal(watched.body.entry.runtimeSeconds, 1440)
  const unwatched = await req('/api/progress', 'PUT', { mediaId: 506, season: 'fall-2026', episode: 3, positionSeconds: 0, state: 'started' })
  assert.equal(unwatched.body.entry.state, 'started')
  assert.equal(unwatched.body.entry.positionSeconds, 0)
  assert.equal(unwatched.body.entry.runtimeSeconds, 1440, 'marking unwatched keeps the known runtime')
  const entries = (await req('/api/progress')).body.entries
  assert.equal(entries.filter((entry) => entry.mediaId === 506 && entry.season === 'fall-2026' && entry.episode === 3).length, 1, 'marks upsert, never duplicate')
})
