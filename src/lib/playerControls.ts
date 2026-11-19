// Player click interaction (AV-178): clicking the picture area toggles
// play/pause. The element uses NATIVE controls, whose bar is part of the
// video element's box — a click there already acts (play/pause button,
// seek bar), so treating it as a toggle would double-toggle and cancel the
// user's action. The gate therefore excludes the bottom controls strip.

export const NATIVE_CONTROLS_ZONE_PX = 48

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
