import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SHORTCUTS,
  actionForKey,
  detectConflicts,
  effectiveShortcuts,
  normalizeKey,
} from '../src/lib/playerShortcuts.ts'

test('key normalization is stable and space-safe (AV-179)', () => {
  assert.equal(normalizeKey(' '), ' ', 'space survives — never trimmed')
  assert.equal(normalizeKey('Space'), ' ')
  assert.equal(normalizeKey('spacebar'), ' ')
  assert.equal(normalizeKey('P'), 'p', 'single characters lowercased')
  assert.equal(normalizeKey('m'), 'm')
  assert.equal(normalizeKey('ArrowLeft'), 'ArrowLeft', 'named keys verbatim')
  assert.equal(normalizeKey('Escape'), 'Escape')
})

test('effective shortcuts overlay defaults without inventing keys (AV-179)', () => {
  assert.deepEqual(effectiveShortcuts({}), DEFAULT_SHORTCUTS)
  assert.deepEqual(effectiveShortcuts({ mute: 'x' }), { ...DEFAULT_SHORTCUTS, mute: 'x' })
  // unknown actions and empty strings are ignored, never applied
  assert.deepEqual(effectiveShortcuts({ bogus: 'q', mute: '' }), DEFAULT_SHORTCUTS)
  // overrides are normalized on the way in
  assert.equal(effectiveShortcuts({ mute: 'M' }).mute, 'm')
  assert.equal(effectiveShortcuts({ 'play-pause': 'Space' })['play-pause'], ' ')
})

test('conflict detection finds double-bound keys; resolution is deterministic (AV-179)', () => {
  assert.deepEqual(detectConflicts(DEFAULT_SHORTCUTS), [], 'the defaults do not conflict')
  assert.deepEqual(detectConflicts({ mute: 'p', 'next-episode': 'P' }), [
    { key: 'p', actions: ['mute', 'next-episode'] },
  ], 'normalization happens before comparison')
  assert.deepEqual(detectConflicts({ 'play-pause': ' ', 'seek-back': 'Space' }), [
    { key: ' ', actions: ['play-pause', 'seek-back'] },
  ])
  // resolution: known keys map back to their action, unknowns are null
  assert.equal(actionForKey({}, 'Escape'), 'close')
  assert.equal(actionForKey({}, 'n'), 'next-episode')
  assert.equal(actionForKey({ mute: 'q' }, 'q'), 'mute')
  assert.equal(actionForKey({}, 'z'), null)
  assert.equal(actionForKey({}, 'M'), 'mute', 'lookup normalizes too')
})
