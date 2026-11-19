// Player click interaction (AV-178): clicking the picture area toggles
// play/pause. The element uses NATIVE controls, whose bar is part of the
// video element's box — a click there already acts (play/pause button,
// seek bar), so treating it as a toggle would double-toggle and cancel the
// user's action. The gate therefore excludes the bottom controls strip.

export const NATIVE_CONTROLS_ZONE_PX = 48

// AV-188: the playback-speed ladder. Selection is from this list in both
// UIs; values arriving from elsewhere snap to the nearest entry.
export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

/** Clamp to the 0.25–4 range, then snap to the nearest ladder entry. */
export function normalizePlaybackSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1
  const clamped = Math.min(4, Math.max(0.25, value))
  let best: number = PLAYBACK_SPEEDS[0]
  for (const speed of PLAYBACK_SPEEDS) {
    if (Math.abs(speed - clamped) < Math.abs(best - clamped)) best = speed
  }
  return best
}

/**
 * AV-189: picture-in-picture is offered only where the browser allows it
 * — the API exists AND the document-level toggle is on. Anything else
 * (older engines, disabled-by-policy embeds) hides the control entirely.
 */
export function canUsePictureInPicture(env: {
  pictureInPictureEnabled?: boolean
}): boolean {
  return env.pictureInPictureEnabled === true
}

/**
 * AV-190: what the Escape key means. While fullscreen is active it exits
 * fullscreen FIRST — closing the player instead would be the classic
 * unreliable-exit trap (the user's one escape hatch nuking the session).
 */
export function escapeAction(fullscreenActive: boolean): 'exit-fullscreen' | 'close' {
  return fullscreenActive ? 'exit-fullscreen' : 'close'
}

// AV-180: the custom control bar's pure bits — clock formatting and the
// seek-bar mapping. The bar replaces the native controls (see TODO's
// subtask split) and keeps every function they provided.

/** m:ss clock, h:mm:ss past an hour; non-finite → '0:00'. */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const seconds = Math.floor(totalSeconds % 60)
  const minutes = Math.floor((totalSeconds / 60) % 60)
  const hours = Math.floor(totalSeconds / 3600)
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Map a seek-bar fraction (0..1) to a playback time. Non-finite inputs
 * and unknown/zero durations fall back to 0; the result is clamped to
 * [0, duration].
 */
export function seekFractionToTime(fraction: number, durationSeconds: number): number {
  if (!Number.isFinite(fraction) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  return Math.min(durationSeconds, Math.max(0, fraction * durationSeconds))
}

// AV-182: tap-to-seek on touch — map a pointer position along the seek
// track to a playback time. Positions outside the track clamp to its
// ends; degenerate tracks (non-finite or zero width) refuse to 0.
export function trackTapToTime(clientX: number, trackLeft: number, trackWidth: number, durationSeconds: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(trackLeft) || !Number.isFinite(trackWidth) || trackWidth <= 0) return 0
  return seekFractionToTime((clientX - trackLeft) / trackWidth, durationSeconds)
}

// AV-186: the central play/pause fades when idle. Paused always shows it
// (the obvious affordance); while playing it follows recent activity.
export const CENTER_BUTTON_IDLE_MS = 2000

export function centerButtonVisible(paused: boolean, idle: boolean): boolean {
  return paused || !idle
}

// AV-187: the control bar follows the SAME chrome-visibility policy —
// 186 and 187 are one shared surface that fades together on idle and
// reappears on pointer movement (paused always keeps the chrome up).
export function controlBarVisible(paused: boolean, idle: boolean): boolean {
  return centerButtonVisible(paused, idle)
}

// AV-191: single/double-click arbitration on the picture. A click
// arriving within the double-click window of the previous one is a
// double-click (fullscreen); otherwise it is a single click (the deferred
// play/pause toggle). Non-finite or negative gaps refuse to single.
export const DOUBLE_CLICK_MS = 250

export function classifyClickGap(gapMs: number, doubleClickMs = DOUBLE_CLICK_MS): 'single' | 'double' {
  if (!Number.isFinite(gapMs) || gapMs < 0) return 'single'
  return gapMs <= doubleClickMs ? 'double' : 'single'
}

/**
 * Whether a click at `offsetY` (relative to the video element's top edge,
 * in CSS pixels) should toggle play/pause. False inside the bottom
 * controls strip, outside the element, and for degenerate heights where
 * the strip covers everything.
 */
export function shouldTogglePlayback(
  offsetY: number,
  height: number,
  controlsZone: number = NATIVE_CONTROLS_ZONE_PX,
): boolean {
  if (!Number.isFinite(offsetY) || !Number.isFinite(height) || !Number.isFinite(controlsZone)) return false
  if (height <= 0 || controlsZone < 0) return false
  if (offsetY < 0 || offsetY > height) return false
  return offsetY <= height - controlsZone
}
