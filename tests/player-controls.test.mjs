import { test } from 'node:test'
import assert from 'node:assert/strict'

import { canUsePictureInPicture, CENTER_BUTTON_IDLE_MS, centerButtonVisible, classifyClickGap, controlBarVisible, DOUBLE_CLICK_MS, escapeAction, formatClock, NATIVE_CONTROLS_ZONE_PX, normalizePlaybackSpeed, seekFractionToTime, shouldTogglePlayback, trackTapToTime } from '../src/lib/playerControls.ts'

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

test('playback speeds snap to the ladder within range (AV-188)', () => {
  assert.equal(normalizePlaybackSpeed(1), 1)
  assert.equal(normalizePlaybackSpeed(1.1), 1, 'snaps to the nearest entry')
  assert.equal(normalizePlaybackSpeed(1.3), 1.25)
  assert.equal(normalizePlaybackSpeed(99), 2, 'clamped to the range first')
  assert.equal(normalizePlaybackSpeed(-5), 0.25)
  assert.equal(normalizePlaybackSpeed(Number.NaN), 1, 'non-finite falls back to normal speed')
})

test('picture-in-picture is offered only where allowed (AV-189)', () => {
  assert.equal(canUsePictureInPicture({ pictureInPictureEnabled: true }), true)
  assert.equal(canUsePictureInPicture({ pictureInPictureEnabled: false }), false, 'disabled by policy — hidden')
  assert.equal(canUsePictureInPicture({}), false, 'no API — hidden')
  assert.equal(canUsePictureInPicture({ pictureInPictureEnabled: undefined }), false)
})

test('escape exits fullscreen before closing the player (AV-190)', () => {
  assert.equal(escapeAction(true), 'exit-fullscreen', 'the one escape hatch must not close the player')
  assert.equal(escapeAction(false), 'close')
})

test('clock formatting and seek mapping are total (AV-180)', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(75), '1:15')
  assert.equal(formatClock(3600), '1:00:00')
  assert.equal(formatClock(3661), '1:01:01')
  assert.equal(formatClock(-5), '0:00')
  assert.equal(formatClock(Number.NaN), '0:00')
  assert.equal(seekFractionToTime(0.5, 120), 60)
  assert.equal(seekFractionToTime(0, 120), 0)
  assert.equal(seekFractionToTime(1, 120), 120)
  assert.equal(seekFractionToTime(1.5, 120), 120, 'clamped to the duration')
  assert.equal(seekFractionToTime(-1, 120), 0)
  assert.equal(seekFractionToTime(0.5, 0), 0, 'unknown duration seeks nowhere')
  assert.equal(seekFractionToTime(Number.NaN, 120), 0)
})

test('the central button shows when paused and fades when idle (AV-186)', () => {
  assert.equal(centerButtonVisible(true, false), true, 'paused — always the affordance')
  assert.equal(centerButtonVisible(true, true), true, 'paused beats idle')
  assert.equal(centerButtonVisible(false, false), true, 'playing with recent activity')
  assert.equal(centerButtonVisible(false, true), false, 'playing and idle — fades out')
  assert.equal(CENTER_BUTTON_IDLE_MS, 2000, 'the idle window is a shared constant')
})

test('the bar and centre button share one chrome policy (AV-187)', () => {
  for (const paused of [true, false]) {
    for (const idle of [true, false]) {
      assert.equal(controlBarVisible(paused, idle), centerButtonVisible(paused, idle), `paused=${paused} idle=${idle} — one surface, one policy`)
    }
  }
  assert.equal(controlBarVisible(false, true), false, 'bar hides when idle while playing')
  assert.equal(controlBarVisible(false, false), true, 'bar reappears on pointer movement')
  assert.equal(controlBarVisible(true, true), true, 'paused keeps the bar up')
})

test('touch taps map track positions to seek times (AV-182)', () => {
  assert.equal(trackTapToTime(50, 0, 100, 200), 100, 'centre of the track')
  assert.equal(trackTapToTime(25, 10, 100, 200), 30, 'offset track')
  assert.equal(trackTapToTime(-10, 0, 100, 200), 0, 'left of the track clamps to 0')
  assert.equal(trackTapToTime(500, 0, 100, 200), 200, 'right of the track clamps to duration')
  assert.equal(trackTapToTime(50, 0, 0, 200), 0, 'degenerate track refuses')
  assert.equal(trackTapToTime(50, 0, 100, 0), 0, 'unknown duration refuses')
  assert.equal(trackTapToTime(Number.NaN, 0, 100, 200), 0, 'non-finite position refuses')
})

test('click gaps classify single vs double (AV-191)', () => {
  assert.equal(classifyClickGap(0), 'double', 'instant partner is a double')
  assert.equal(classifyClickGap(250), 'double', 'the window edge is inclusive')
  assert.equal(classifyClickGap(251), 'single', 'past the default window is a single')
  assert.equal(classifyClickGap(251, 300), 'double', 'a wider custom window keeps it a double')
  assert.equal(classifyClickGap(-5), 'single', 'negative gaps refuse to single')
  assert.equal(classifyClickGap(Number.NaN), 'single', 'non-finite gaps refuse to single')
})
