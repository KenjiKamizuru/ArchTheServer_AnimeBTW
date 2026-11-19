// Profile visibility policy (AV-111a). Pure; no I/O.
//
// Three modes on the user record (`profileVisibility`):
//   'public'    — anyone may view the public profile (preserves the pre-AV-111
//                 behavior; also the default for existing accounts)
//   'private'   — only the owner
//   'link-only' — the owner, or anyone presenting the exact profile link token
//
// Scope decisions (recorded per task rules):
// - Default 'public' (not 'private'): AV-111 must not change what existing
//   accounts expose unless the user opts in.
// - The link token is a shareable slug for PROFILE VISIBILITY only — it grants
//   no account powers and the profile view exposes only publicUser fields —
//   so it is stored plainly on the record (unlike session/reset tokens). It
//   can be rotated to revoke an old link.

import { randomBytes } from 'node:crypto'

export const PROFILE_VISIBILITIES = ['public', 'private', 'link-only']

export function normalizeProfileVisibility(value) {
  const clean = String(value ?? '').trim().toLowerCase()
  if (!clean) return { ok: true, value: 'public' }
  if (PROFILE_VISIBILITIES.includes(clean)) return { ok: true, value: clean }
  return { ok: false, error: 'Visibility must be public, private, or link-only' }
}

/** Can this viewer see the profile? `token` is the presented link token, if any. */
export function canViewProfile(user, { viewerId = null, token = null } = {}) {
  const visibility = user?.profileVisibility ?? 'public'
  if (viewerId != null && String(viewerId) === String(user?.id)) return { ok: true, via: 'owner' }
  if (visibility === 'public') return { ok: true, via: 'public' }
  if (visibility === 'link-only') {
    const expected = user?.profileLinkToken ?? null
    if (expected && token && timingSafeStringEqual(expected, token)) return { ok: true, via: 'link' }
    return { ok: false, error: 'This profile is link-only' }
  }
  return { ok: false, error: 'This profile is private' }
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8')
  const right = Buffer.from(String(b), 'utf8')
  if (left.length !== right.length || left.length === 0) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

/** Get (or create) the owner's shareable link token. */
export function getOrCreateProfileLink(user) {
  if (!user.profileLinkToken) user.profileLinkToken = randomBytes(16).toString('hex')
  return { token: user.profileLinkToken }
}

/** Rotate: the old link stops working immediately. */
export function rotateProfileLink(user) {
  user.profileLinkToken = randomBytes(16).toString('hex')
  return { token: user.profileLinkToken }
}
