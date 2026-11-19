import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
let server, dir, base, custom
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-http-'))
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
  const response = await fetch(base + url, { method, headers: { 'x-api-token': 'test-token', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const media = { id: 123, title: 'HTTP test', cover: 'https://example.com/x.jpg' }
test('list API requires configured token', async () => { const r = await fetch(base + '/api/lists'); assert.equal(r.status, 401) })
test('overview returns five statuses', async () => { const r = await req('/api/lists'); assert.equal(r.status, 200); assert.equal(r.body.statuses.length, 5) })
test('cross-origin mutation blocked', async () => assert.equal((await req('/api/lists', 'POST', { name: 'bad' }, { origin: 'https://evil.example' })).status, 403))
test('empty name rejected', async () => assert.equal((await req('/api/lists', 'POST', { name: '' })).status, 400))
test('create custom list', async () => { const r = await req('/api/lists', 'POST', { name: 'Test list', description: 'A description' }); assert.equal(r.status, 201); custom = r.body.list.id })
test('created list visible in overview', async () => assert.ok((await req('/api/lists')).body.lists.some((l) => l.id === custom)))
test('unknown list returns 404', async () => assert.equal((await req('/api/lists/not-found')).status, 404))
test('add media to custom list', async () => assert.equal((await req(`/api/lists/${custom}/entries`, 'POST', { media })).status, 200))
test('custom list contains media', async () => assert.equal((await req(`/api/lists/${custom}`)).body.entries[0].mediaId, 123))
test('duplicate add does not create duplicate', async () => { await req(`/api/lists/${custom}/entries`, 'POST', { media }); assert.equal((await req(`/api/lists/${custom}`)).body.count, 1) })
test('custom add also appears in planned', async () => assert.equal((await req('/api/lists/status%3Aplanned')).body.count, 1))
test('invalid media rejected', async () => assert.equal((await req(`/api/lists/${custom}/entries`, 'POST', { media: { id: 0 } })).status, 400))
test('move to watching', async () => assert.equal((await req('/api/lists/status%3Awatching/entries', 'POST', { media })).body.entry.status, 'watching'))
test('watching count updated', async () => assert.equal((await req('/api/lists/status%3Awatching')).body.count, 1))
test('planned count updated', async () => assert.equal((await req('/api/lists/status%3Aplanned')).body.count, 0))
test('custom list retained after status change', async () => assert.equal((await req(`/api/lists/${custom}`)).body.count, 1))
test('list accepts sorting', async () => { const r = await req(`/api/lists/${custom}?sort=title`); assert.equal(r.status, 200); assert.equal(r.body.sort, 'title'); assert.equal(r.body.entries[0].mediaId, 123) })
test('invalid sort returns 400', async () => assert.equal((await req(`/api/lists/${custom}?sort=invalid`)).status, 400))
test('note endpoint saves note for selected list', async () => { const r = await req(`/api/lists/${custom}/entries/123/note`, 'PUT', { note: 'Remember this' }); assert.equal(r.status, 200); assert.equal(r.body.note, 'Remember this') })
test('note is returned in selected list', async () => assert.equal((await req(`/api/lists/${custom}`)).body.entries[0].note, 'Remember this'))
test('note does not leak into status list', async () => assert.equal((await req('/api/lists/status%3Awatching')).body.entries[0].note, ''))
test('note rejects oversized input', async () => assert.equal((await req(`/api/lists/${custom}/entries/123/note`, 'PUT', { note: 'x'.repeat(1001) })).status, 400))
test('note rejects missing entry', async () => assert.equal((await req(`/api/lists/${custom}/entries/999/note`, 'PUT', { note: 'x' })).status, 404))
test('random pick is from selected list', async () => { const r = await req(`/api/lists/${custom}/random`); assert.equal(r.status, 200); assert.equal(r.body.pick.mediaId, 123) })
test('random pick for empty list returns null', async () => { const r = await req('/api/lists/status%3Adropped/random'); assert.equal(r.body.pick, null) })
test('random pick for unknown list returns 404', async () => assert.equal((await req('/api/lists/missing/random')).status, 404))
test('JSON export returns attachment and expected data', async () => {
  const r = await fetch(`${base}/api/lists/${custom}/export?format=json`, { headers: { 'x-api-token': 'test-token' } })
  assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment/); assert.equal(r.headers.get('cache-control'), 'no-store')
  const data = await r.json(); assert.equal(data.format, 'animevault-list'); assert.equal(data.list.entries[0].mediaId, 123)
})
test('CSV export returns content type and title', async () => {
  const r = await fetch(`${base}/api/lists/${custom}/export?format=csv`, { headers: { 'x-api-token': 'test-token' } })
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(await r.text(), /HTTP test/)
})
test('unknown export format rejected', async () => assert.equal((await req(`/api/lists/${custom}/export?format=xml`)).status, 400))
test('unknown list export rejected', async () => assert.equal((await req('/api/lists/missing/export')).status, 404))
test('remove missing member', async () => assert.equal((await req(`/api/lists/${custom}/entries/999`, 'DELETE')).body.removed, false))
test('invalid removal id rejected', async () => assert.equal((await req(`/api/lists/${custom}/entries/no`, 'DELETE')).status, 400))
test('remove custom member', async () => assert.equal((await req(`/api/lists/${custom}/entries/123`, 'DELETE')).body.removed, true))
test('status remains after custom removal', async () => assert.equal((await req('/api/lists/status%3Awatching')).body.count, 1))
test('built-in deletion rejected', async () => assert.equal((await req('/api/lists/status%3Awatching', 'DELETE')).status, 400))
test('custom deletion succeeds', async () => assert.equal((await req(`/api/lists/${custom}`, 'DELETE')).body.deleted, true))
test('deleted list is unavailable', async () => assert.equal((await req(`/api/lists/${custom}`)).status, 404))
test('remove status entry', async () => assert.equal((await req('/api/lists/status%3Awatching/entries/123', 'DELETE')).body.removed, true))
test('removed status no longer visible', async () => assert.equal((await req('/api/lists/status%3Awatching')).body.count, 0))
