// Player error recovery (AV-177): the ordered, understandable recovery
// actions for the error screen. Pure selection logic the PlayerOverlay
// renders as labeled buttons.
//
// The `alternative` action switches the loading path and is offered only
// when the PRIMARY path was in use and a different one exists:
// - live: primary is the MSE path → alternative is plain (non-MSE) loading
// - local: primary is native playback of a direct-playable file →
//   alternative is the remux path
// It is deliberately absent when the alternative path is already active —
// the error already reflects it, and offering it again would loop.

export type RecoveryAction = 'retry' | 'alternative' | 'download' | 'close'

export interface RecoveryContext {
  sourceKind: 'live' | 'local'
  /** The primary loading path is in use and an alternative exists. */
  onPrimaryPath: boolean
  downloadAvailable: boolean
}

/** Retry first, then the path switch, then escape hatches; close last. */
export function recoveryActions({ sourceKind, onPrimaryPath, downloadAvailable }: RecoveryContext): RecoveryAction[] {
  const actions: RecoveryAction[] = ['retry']
  if (onPrimaryPath && (sourceKind === 'live' || sourceKind === 'local')) actions.push('alternative')
  if (downloadAvailable) actions.push('download')
  actions.push('close')
  return actions
}

export function recoveryActionLabel(action: RecoveryAction, sourceKind: 'live' | 'local'): string {
  if (action === 'retry') return 'Try again'
  if (action === 'alternative') return sourceKind === 'live' ? 'Use standard loading' : 'Remux the file'
  if (action === 'download') return 'Save file to device'
  return 'Close player'
}
