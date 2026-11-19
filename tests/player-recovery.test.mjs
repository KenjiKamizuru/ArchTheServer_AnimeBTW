import { test } from 'node:test'
import assert from 'node:assert/strict'

import { recoveryActions, recoveryActionLabel } from '../src/lib/playerRecovery.ts'

test('recovery actions are ordered and path-aware (AV-177)', () => {
  // the baseline: retry then close, nothing invented in between
  assert.deepEqual(
    recoveryActions({ sourceKind: 'live', onPrimaryPath: false, downloadAvailable: false }),
    ['retry', 'close'],
  )
  assert.deepEqual(
    recoveryActions({ sourceKind: 'local', onPrimaryPath: false, downloadAvailable: true }),
    ['retry', 'download', 'close'],
  )
  // the path switch appears only while the primary path is in use
  assert.deepEqual(
    recoveryActions({ sourceKind: 'live', onPrimaryPath: true, downloadAvailable: false }),
    ['retry', 'alternative', 'close'],
  )
  assert.deepEqual(
    recoveryActions({ sourceKind: 'local', onPrimaryPath: true, downloadAvailable: true }),
    ['retry', 'alternative', 'download', 'close'],
  )
})

test('recovery labels explain the action per source kind (AV-177)', () => {
  assert.equal(recoveryActionLabel('retry', 'live'), 'Try again')
  assert.equal(recoveryActionLabel('alternative', 'live'), 'Use standard loading')
  assert.equal(recoveryActionLabel('alternative', 'local'), 'Remux the file')
  assert.equal(recoveryActionLabel('download', 'local'), 'Save file to device')
  assert.equal(recoveryActionLabel('close', 'live'), 'Close player')
})
