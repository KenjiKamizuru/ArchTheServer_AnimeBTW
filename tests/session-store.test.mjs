// Tests for playback-session records (AV-166 slice 1): validation, the
// watched-duration contract, per-profile isolation, FIFO bounds, and the
// scoped clears that keep sessions from outliving history entries.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir = await mkdtemp(path.join(os.tmpdir(), 'animevault-sessions-'))
process.env.ANIMEVAULT_DATA = dir
const store = await import('../server/sessionStore.mjs')
await store.init()

after(async () => {
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

const at = (iso) => Date.parse(iso)
const session = (over = {}) => ({
  mediaId: 10,
  season: 'winter-2024',
  episode: 3,
  startedAt: at('2024-03-05T10:00:00Z'),
  endedAt: at('2024-03-05T10:24:00Z'),
  watchedSeconds: 1400,
  ...over,
})

test('sessions record start, end, and watched duration per profile (AV-166)', async () => {
  const saved = await store.saveSession('u_kenji', session())
  assert.match(saved.id, /^s_[0-9a-f]{16}$/)
  assert.equal(saved.watchedSeconds, 1400)
  assert.equal(saved.startedAt, at('2024-03-05T10:00:00Z'))
  assert.equal(saved.endedAt, at('2024-03-05T10:24:00Z'))
  await store.saveSession('u_kenji', session({ episode: 4, startedAt: at('2024-03-06T10:00:00Z'), endedAt: at('2024-03-06T10:10:00Z'), watchedSeconds: 600 }))
  await store.saveSession('u_aki', session({ episode: 1 }))
  const mine = store.listSessions('u_kenji')
  assert.deepEqual(mine.map((entry) => entry.episode), [4, 3], 'newest first')
  assert.equal(store.listSessions('u_aki').length, 1, 'profiles are isolated')
  assert.equal(store.listSessions('nobody').length, 0)
})

test('watched duration must fit inside the session wall time (AV-166)', async () => {
  await assert.rejects(
    () => store.saveSession('u_val', session({ endedAt: at('2024-03-05T09:59:00Z') })),
    /endedAt must not precede startedAt/,
  )
  await assert.rejects(() => store.saveSession('u_val', session({ watchedSeconds: -1 })), /watchedSeconds/)
  // 24 min wall = 1440 s: 1400 is fine, 2000 is not (pause time is not watched time)
  await assert.rejects(() => store.saveSession('u_val', session({ watchedSeconds: 2000 })), /watchedSeconds/)
  await assert.rejects(() => store.saveSession('u_val', session({ episode: 0 })), /Invalid episode/)
  await assert.rejects(
    () => store.saveSession('u_val', session({ endedAt: at('2024-03-07T10:00:00Z') })),
    /wall time is out of range/,
  )
  assert.equal(store.listSessions('u_val').length, 0, 'rejected sessions are never stored')
})

test('sessions are bounded FIFO and scoped-cleared with history (AV-166)', async () => {
  const base = at('2024-01-01T00:00:00Z')
  for (let i = 0; i < store.MAX_SESSIONS_PER_PROFILE + 3; i += 1) {
    await store.saveSession('u_trim', session({
      mediaId: 20,
      episode: 1 + i,
      startedAt: base + i * 60_000,
      endedAt: base + i * 60_000 + 30_000,
      watchedSeconds: 30,
    }))
  }
  const kept = store.listSessions('u_trim')
  assert.equal(kept.length, store.MAX_SESSIONS_PER_PROFILE, 'FIFO keeps the newest sessions')
  assert.equal(kept[kept.length - 1].episode, 4, 'the OLDEST sessions were dropped')

  // exact target, per-anime, and whole-profile clears (history-deletion paths)
  await store.saveSession('u_clear', session({ mediaId: 30, episode: 1 }))
  await store.saveSession('u_clear', session({ mediaId: 30, episode: 2 }))
  await store.saveSession('u_clear', session({ mediaId: 31, episode: 1 }))
  assert.deepEqual(await store.clearSessions('u_clear', { mediaId: 30, season: 'winter-2024', episode: 1 }), { removed: 1 })
  assert.deepEqual(await store.clearSessionsEntries('u_clear', [
    { mediaId: 30, season: 'winter-2024', episode: 2 },
    { mediaId: 30, season: 'winter-2024', episode: 2 }, // dupe once
    { mediaId: 999, season: 'winter-2024', episode: 1 }, // unknown ignored
  ]), { removed: 1 })
  assert.deepEqual(store.listSessions('u_clear').map((entry) => entry.mediaId), [31])
  assert.deepEqual(await store.clearSessions('u_clear', { mediaId: 31 }), { removed: 1 })
  assert.deepEqual(await store.clearSessions('u_clear'), { removed: 0 })
  assert.equal(store.listSessions('u_kenji').length >= 2, true, 'other profiles never touched')
})
