import { test } from 'node:test'
import assert from 'node:assert/strict'

import { NATIVE_CONTROLS_ZONE_PX, shouldTogglePlayback } from '../src/lib/playerControls.ts'

test('click-to-toggle covers the picture area only (AV-178)', () => {
  // a 400px-tall video: picture area is 0…352, controls strip 352…400
  assert.equal(shouldTogglePlayback(100, 400), true)
  assert.equal(shouldTogglePlayback(352, 400), true, 'the boundary pixel still counts as picture')
  assert.equal(shouldTogglePlayback(353, 400), false, 'the native controls strip must not double-toggle')
  assert.equal(shouldTogglePlayback(399, 400), false)
  // clicks outside the element are never toggles
  assert.equal(shouldTogglePlayback(-1, 400), false)
  assert.equal(shouldTogglePlayback(401, 400), false)
  // degenerate boxes: nothing to click
  assert.equal(shouldTogglePlayback(10, 0), false)
  assert.equal(shouldTogglePlayback(10, NATIVE_CONTROLS_ZONE_PX), false, 'strip covers everything')
  assert.equal(shouldTogglePlayback(10, 20), false)
  // non-finite inputs are refused, and the zone is overridable
  assert.equal(shouldTogglePlayback(Number.NaN, 400), false)
  assert.equal(shouldTogglePlayback(100, 400, 300), true)
  assert.equal(shouldTogglePlayback(150, 400, 300), false, 'custom zone respected')
})
