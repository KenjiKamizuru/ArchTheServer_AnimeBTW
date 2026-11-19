// Player keyboard shortcuts (AV-179, slice 1): the action set, defaults,
// key normalization, conflict detection, and deterministic resolution.
//
// Scope decisions (recorded):
// - The action set is the player's own controls: play/pause, seek ±, prev/
//   next episode, mute, close. Fullscreen is AV-190's scope; the skip
//   INTERVALS are AV-183/184's (seek step is a fixed constant here).
// - Keys are normalized KeyboardEvent.key values: single characters
//   lowercased (' ' for space survives — it is not trimmed), named keys
//   verbatim ('ArrowLeft', 'Escape'), legacy 'Space'/'spacebar' mapped to
//   ' '. Bindings are one key each (no modifier chords) — the common case,
//   and what conflict detection can keep unambiguous.
// - Conflicts (two actions on one key) are DETECTED here and REJECTED at
//   the settings boundary, so resolution is always unambiguous.

export const SEEK_STEP_SECONDS = 10

export const SHORTCUT_ACTIONS = [
  'play-pause',
  'seek-back',
  'seek-forward',
  'prev-episode',
  'next-episode',
  'mute',
  'close',
] as const

export type PlayerShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

export const DEFAULT_SHORTCUTS: Record<PlayerShortcutAction, string> = {
  'play-pause': ' ',
  'seek-back': 'ArrowLeft',
  'seek-forward': 'ArrowRight',
  'prev-episode': 'p',
  'next-episode': 'n',
  mute: 'm',
  close: 'Escape',
}

/** Normalize a raw key value into its stored form. */
export function normalizeKey(key: string): string {
  if (key === 'Space' || key === 'spacebar' || key === 'Spacebar') return ' '
  return key.length === 1 ? key.toLowerCase() : key
}

/** The effective map: defaults overlaid with the user's overrides. */
export function effectiveShortcuts(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_SHORTCUTS }
  for (const action of SHORTCUT_ACTIONS) {
    const key = overrides[action]
    if (typeof key === 'string' && key.length > 0) merged[action] = normalizeKey(key)
  }
  return merged
}

export interface ShortcutConflict {
  key: string
  actions: string[]
}

/**
 * Every key bound to more than one action. Used by the Settings UI to warn
 * while editing and by the settings boundary to reject the map.
 */
export function detectConflicts(shortcuts: Partial<Record<string, string>>): ShortcutConflict[] {
  const byKey = new Map<string, string[]>()
  for (const [action, key] of Object.entries(shortcuts)) {
    if (typeof key !== 'string' || key.length === 0) continue
    const normalized = normalizeKey(key)
    const list = byKey.get(normalized)
    if (list) list.push(action)
    else byKey.set(normalized, [action])
  }
  return [...byKey.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([key, actions]) => ({ key, actions: actions.slice().sort() }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The action a key triggers, or null. Deterministic when the map is
 * conflicted (first action in SHORTCUT_ACTIONS order) — though conflicts
 * are rejected at the boundary, so callers normally never see that case.
 */
export function actionForKey(
  shortcuts: Partial<Record<string, string>>,
  key: string,
): PlayerShortcutAction | null {
  const normalized = normalizeKey(key)
  const effective = effectiveShortcuts(shortcuts)
  for (const action of SHORTCUT_ACTIONS) {
    if (effective[action] === normalized) return action
  }
  return null
}
