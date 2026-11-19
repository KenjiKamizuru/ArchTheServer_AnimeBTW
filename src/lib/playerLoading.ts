// Player loading phases (AV-176): the readiness signals are kept SEPARATE —
// metadata (the element's `loadedmetadata`: duration/track info) and media
// (`canplay` + no active stall). `resolving` is the pre-element phase (the
// stream lookup / local open), which outranks both. Pure logic the
// PlayerOverlay renders; buffered stalls move media back to not-ready even
// after the first canplay.

export type PlayerLoadingPhase = 'resolving' | 'metadata' | 'media' | 'ready'

export function playerLoadingPhase(
  resolving: boolean,
  metadataReady: boolean,
  mediaReady: boolean,
  buffering: boolean,
): PlayerLoadingPhase {
  if (resolving) return 'resolving'
  if (!metadataReady) return 'metadata'
  if (!mediaReady || buffering) return 'media'
  return 'ready'
}

export interface ReadinessLabels {
  metadata: string
  media: string
}

/** The two readiness lines the loading surface shows, never merged. */
export function readinessLabels(
  metadataReady: boolean,
  mediaReady: boolean,
  buffering: boolean,
): ReadinessLabels {
  return {
    metadata: metadataReady ? 'Metadata ready' : 'Loading metadata…',
    media: buffering ? 'Buffering…' : mediaReady ? 'Media ready' : 'Loading media…',
  }
}
