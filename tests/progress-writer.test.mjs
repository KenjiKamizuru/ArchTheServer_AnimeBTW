// Tests for the playback-position writer (AV-153): interval semantics are
// exercised with injected save/now — this imports the TypeScript module
// directly (Node type stripping).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProgressWriter, clampFlushInterval, isValidRecord, DEFAULT_FLUSH_INTERVAL_SECONDS } from '../src/lib/progressWriter.ts'

const rec = (over = {}) => ({ mediaId: 10, season: 'winter-2024', episode: 3, positionSeconds: 60, ...over })

function fixture(intervalSeconds = 15) {
  const saved = []
  let clock = 1_000_000
  const writer = createProgressWriter({
    intervalSeconds,
    now: () => clock,
    save: async (record) => { saved.push({ ...record }) },
  })
  return { writer, saved, tick: (ms) => { clock += ms } }
}

test('reports within the interval never save; the first report saves (AV-153)', async () => {
  const { writer, saved, tick } = fixture(15)
  writer.report(rec({ positionSeconds: 10 }))
  await writer.flush()
  assert.equal(saved.length, 1, 'the first pending report saves immediately')
  writer.report(rec({ positionSeconds: 20 }))
  tick(14_999)
  writer.report(rec({ positionSeconds: 30 }))
  assert.equal(saved.length, 1, 'inside the interval nothing new is saved')
  tick(1)
  writer.report(rec({ positionSeconds: 40 }))
  await writer.flush()
  assert.equal(saved.length, 2, 'crossing the interval saves the LATEST position')
  assert.equal(saved[1].positionSeconds, 40, 'the newest position wins; intermediate reports are dropped')
})
test('the interval is configurable', async () => {
  const { writer, saved, tick } = fixture(60)
  writer.report(rec())
  await writer.flush()
  tick(30_000)
  writer.report(rec({ positionSeconds: 70 }))
  assert.equal(saved.length, 1, '30s does not satisfy a 60s interval')
  tick(30_000)
  writer.report(rec({ positionSeconds: 80 }))
  await writer.flush()
  assert.equal(saved.length, 2)
  const short = fixture(5)
  short.writer.report(rec())
  await short.writer.flush()
  short.tick(5_000)
  short.writer.report(rec({ positionSeconds: 90 }))
  await short.writer.flush()
  assert.equal(short.saved.length, 2, 'a 5s interval saves more eagerly')
})
test('stop flushes what is pending', async () => {
  const { writer, saved, tick } = fixture(30)
  writer.report(rec())
  await writer.flush()
  tick(1_000)
  writer.report(rec({ positionSeconds: 500 }))
  assert.equal(saved.length, 1, 'not yet saved — inside the interval')
  await writer.stop()
  assert.equal(saved.length, 2, 'stop() flushes the pending position')
  assert.equal(saved[1].positionSeconds, 500)
  await writer.stop()
  assert.equal(saved.length, 2, 'an idle stop is a no-op')
})
test('invalid records are never stored', async () => {
  const { writer, saved } = fixture()
  for (const bad of [
    null,
    undefined,
    rec({ mediaId: 0 }),
    rec({ mediaId: -3 }),
    rec({ mediaId: 'x' }),
    rec({ season: '' }),
    rec({ season: 'x'.repeat(41) }),
    rec({ episode: 0 }),
    rec({ episode: 2.5 }),
    rec({ positionSeconds: -1 }),
    rec({ positionSeconds: NaN }),
  ]) {
    writer.report(bad)
    await writer.flush()
  }
  assert.equal(saved.length, 0)
  assert.equal(isValidRecord(rec()), true)
  assert.equal(isValidRecord(rec({ runtimeSeconds: 1440 })), true, 'runtime is optional passthrough')
})
test('records carry the full identity and runtime through', async () => {
  const { writer, saved } = fixture()
  writer.report(rec({ positionSeconds: 321, runtimeSeconds: 1440 }))
  await writer.flush()
  assert.deepEqual(saved[0], { mediaId: 10, season: 'winter-2024', episode: 3, positionSeconds: 321, runtimeSeconds: 1440 })
})
test('saves are serialized so an earlier slow request cannot regress the position', async () => {
  const order = []
  let releaseFirst
  const first = new Promise((resolve) => { releaseFirst = resolve })
  const writer = createProgressWriter({
    intervalSeconds: 5,
    now: (() => { let clock = 0; return () => (clock += 10_000) })(),
    save: async (record) => {
      if (!order.length) { await first; order.push(record.positionSeconds) }
      else order.push(record.positionSeconds)
    },
  })
  writer.report(rec({ positionSeconds: 100 }))
  writer.report(rec({ positionSeconds: 200 }))
  releaseFirst()
  await writer.flush()
  assert.deepEqual(order, [100, 200], 'writes land in report order')
})
test('the interval clamps to 5–300 seconds', () => {
  assert.equal(clampFlushInterval(5), 5)
  assert.equal(clampFlushInterval(300), 300)
  assert.equal(clampFlushInterval(15), 15)
  for (const bad of [0, 4, 301, -10, 2.5, 'x', null, undefined, NaN]) {
    assert.equal(clampFlushInterval(bad), DEFAULT_FLUSH_INTERVAL_SECONDS, `${String(bad)} → default`)
  }
  assert.equal(clampFlushInterval('30'), 30, 'numeric strings count')
})
