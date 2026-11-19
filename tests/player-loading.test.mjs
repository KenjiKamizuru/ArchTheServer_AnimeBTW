import { test } from 'node:test'
import assert from 'node:assert/strict'

import { playerLoadingPhase, readinessLabels } from '../src/lib/playerLoading.ts'

test('loading phases keep metadata and media readiness separate (AV-176)', () => {
  // resolving outranks every readiness signal (pre-element phase)
  assert.equal(playerLoadingPhase(true, false, false, false), 'resolving')
  assert.equal(playerLoadingPhase(true, true, true, true), 'resolving')
  // metadata readiness is its own phase — not blurred into media
  assert.equal(playerLoadingPhase(false, false, true, false), 'metadata')
  assert.equal(playerLoadingPhase(false, false, true, true), 'metadata')
  // media: before the first canplay, and again on a stall
  assert.equal(playerLoadingPhase(false, true, false, false), 'media')
  assert.equal(playerLoadingPhase(false, true, true, true), 'media', 'a stall moves media back to not-ready')
  // ready only when all signals agree
  assert.equal(playerLoadingPhase(false, true, true, false), 'ready')
  assert.equal(playerLoadingPhase(false, true, true, true), 'media', 'a stall keeps media not-ready')
})

test('readiness labels render the two signals independently (AV-176)', () => {
  assert.deepEqual(readinessLabels(false, false, false), {
    metadata: 'Loading metadata…',
    media: 'Loading media…',
  })
  assert.deepEqual(readinessLabels(true, false, false), {
    metadata: 'Metadata ready',
    media: 'Loading media…',
  })
  assert.deepEqual(readinessLabels(true, true, true), {
    metadata: 'Metadata ready',
    media: 'Buffering…',
  })
  assert.deepEqual(readinessLabels(true, true, false), {
    metadata: 'Metadata ready',
    media: 'Media ready',
  })
})
