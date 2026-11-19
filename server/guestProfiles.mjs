// Guest profiles for household visitors (AV-122a). Pure; no I/O.
//
// Scope decisions (recorded per task rules):
// - Guests are NAMED PROFILES ON AN ACCOUNT record (`guests` array), created
//   and removed only by the owner: [{id, name, createdAt}]. They are
//   selection labels for shared devices (AV-123 profile switching / AV-124
//   PIN lock build on them), NOT accounts: no credentials, no sessions of
//   their own in this slice.
// - Limits: max 6 guests (household-sized), names ≤24 chars (trimmed,
//   control characters rejected — same rule family as bios), names unique
//   case-insensitively within the account.
// - Ids are random hex — never derived from the name (renaming-safe, no
//   enumeration ordering).

import { randomBytes } from 'node:crypto'

export const MAX_GUESTS = 6
export const MAX_GUEST_NAME = 24

export function normalizeGuestName(input) {
  const raw = String(input ?? '')
  const name = raw.trim().slice(0, MAX_GUEST_NAME)
  if (!name) return { ok: false, error: 'A guest name is required' }
  if (name.length > MAX_GUEST_NAME) return { ok: false, error: `Guest names are at most ${MAX_GUEST_NAME} characters` }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: 'Guest names cannot contain control characters' }
  return { ok: true, value: name }
}

function publicGuest(record) {
  return { id: record?.id ?? null, name: record?.name ?? null, createdAt: record?.createdAt ?? null }
}

export function listGuests(user) {
  return (Array.isArray(user?.guests) ? user.guests : []).map(publicGuest)
}

/** Add a guest; enforces the count cap and name uniqueness. */
export function addGuest(user, input, { now = Date.now(), makeId = () => randomBytes(8).toString('hex') } = {}) {
  const guests = Array.isArray(user.guests) ? user.guests : []
  if (guests.length >= MAX_GUESTS) {
    return { ok: false, error: `A household can have at most ${MAX_GUESTS} guest profiles` }
  }
  const parsed = normalizeGuestName(input)
  if (!parsed.ok) return parsed
  const lower = parsed.value.toLowerCase()
  if (guests.some((entry) => String(entry?.name ?? '').toLowerCase() === lower)) {
    return { ok: false, error: 'A guest with that name already exists' }
  }
  const record = { id: makeId(), name: parsed.value, createdAt: now }
  user.guests = [...guests, record]
  return { ok: true, value: publicGuest(record) }
}

/** Remove a guest by id. */
export function removeGuest(user, guestId) {
  const guests = Array.isArray(user.guests) ? user.guests : []
  const id = String(guestId ?? '')
  if (!guests.some((entry) => entry?.id === id)) return { ok: false, error: 'Guest not found' }
  user.guests = guests.filter((entry) => entry?.id !== id)
  return { ok: true }
}
