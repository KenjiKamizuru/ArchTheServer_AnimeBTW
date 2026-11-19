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
