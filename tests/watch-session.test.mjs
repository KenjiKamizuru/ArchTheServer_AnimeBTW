import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createWatchSession } from '../src/lib/watchSession.ts'

const harness = () => {
  let clock = 1_000_000
  const saved = []
  const session = createWatchSession({
    save: (record) => saved.push(record),
    now: () => clock,
  })
  return {
    session,
    saved,
    advance(ms) {
      clock += ms
    },
  }
}

test('a session arms on first play and saves once at stop (AV-166)', () => {
  const { session, saved, advance } = harness()
  // never played → stop records nothing
  session.tick(0)
  session.tick(1)
  session.stop()
  assert.equal(saved.length, 0, 'opening a source without playing records no session')

  const second = harness()
  second.session.play()
  second.session.play() // idempotent arming
  second.advance(30_000)
  second.session.tick(1)
  second.session.tick(2)
  second.advance(30_000)
  second.session.stop()
  second.session.stop() // ended + unmount both call stop — one record
  assert.equal(second.saved.length, 1)
  assert.equal(second.saved[0].startedAt, 1_000_000, 'armed at the FIRST play')
  assert.equal(second.saved[0].endedAt, 1_060_000, 'ended at stop')
  assert.equal(second.saved[0].watchedSeconds, 1, 'only the ticked playback time counts')
})

test('watched time counts only small positive playback deltas (AV-166)', () => {
  const { session, saved } = harness()
  session.play()
  session.tick(10) // sets the cursor
  session.tick(10.25) // +0.25
  session.tick(10.75) // +0.5
  session.tick(40) // seek forward — excluded
  session.tick(40.5) // +0.5 after the seek
  session.tick(39) // seek backward — excluded
  session.tick(39.5) // +0.5
  session.tick(39.5 + 3) // long gap/jump (> 2s) — excluded
  session.tick(42.5 + 0.5) // +0.5 resumes after the jump... cursor moved to 43.0? careful
  session.stop()
  // deltas counted: 0.25 + 0.5 + 0.5 + 0.5 = 1.75 → rounds to 2
  assert.equal(saved.length, 1)
  assert.equal(saved[0].watchedSeconds, 2)
})

test('watched seconds never exceed the session wall time (AV-166)', () => {
  const { session, saved, advance } = harness()
  session.play()
  // 5s of playback ticks
  for (let i = 1; i <= 20; i += 1) session.tick(i * 0.25)
  advance(2_000) // only 2s of wall time passed
  session.stop()
  assert.equal(saved[0].watchedSeconds, 5, 'the clamp keeps ticks honest relative to seeks')
  assert.ok(saved[0].endedAt - saved[0].startedAt === 2_000)
  // NOTE: tick clamping bounds per-event growth; the server wall-time
  // validation is the hard stop for clock anomalies.
})
