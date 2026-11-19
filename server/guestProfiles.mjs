// Guest profiles for household visitors (AV-122a: model + owner CRUD;
// AV-122b: usage semantics). Pure; no I/O.
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
// - Usage (AV-122b): a shared device carries a `av_guest` cookie with the
//   guest id — a NON-SECRET MARKER, never an access credential (recorded:
//   forging a guest id grants nothing; the value is always validated against
//   the signed-in account's guest list and the account session is what
//   authorizes). It is revocable two ways: removing the guest, or clearing
//   the cookie. Each guest carries its own `prefs` object validated by the
//   shared userPreferences rules (theme/subtitles/audio/quality/…), kept
//   separate from the owner's preferences.

import { randomBytes } from 'node:crypto'
import { verifyPassword } from './accounts.mjs'
import { normalizePreferencesUpdate } from './userPreferences.mjs'

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
  return {
    id: record?.id ?? null,
    name: record?.name ?? null,
    createdAt: record?.createdAt ?? null,
    pinProtected: hasGuestPin(record),
  }
}

// ---------------------------------------------------------------------------
// Profile PIN lock (AV-124a) — for shared living-room devices.
//
// Scope decisions (recorded per task rules):
// - A PIN is 4–6 DIGITS (trimmed input), stored HASH-ONLY per guest
//   (`pin: { salt, hash }`, scrypt via the shared password primitives) —
//   exactly the account-password storage pattern. The hash NEVER appears in
//   any guest view; views expose only `pinProtected: boolean`.
// - The PIN gates SELECTING a locked profile on a device that already has a
//   signed-in account session (household members on a shared screen). It is
//   owner-managed (set/change/remove via session-authenticated routes), and
//   it is NOT an account credential: it never authorizes anything on its own.
// - Attempted brute force is bounded by the existing per-account mutation
//   rate limit on the select route.
// ---------------------------------------------------------------------------

export const PIN_PATTERN = /^\d{4,6}$/

export function normalizePin(input) {
  const raw = String(input ?? '').trim()
  if (!PIN_PATTERN.test(raw)) return { ok: false, error: 'A PIN is 4 to 6 digits' }
  return { ok: true, value: raw }
}

export function hasGuestPin(record) {
  return Boolean(record?.pin?.salt && record?.pin?.hash)
}

/** Store a PIN from pre-computed salt+hash (hash-only; the raw PIN never reaches storage). */
export function setGuestPin(record, { salt, hash } = {}) {
  if (!salt || !hash) return { ok: false, error: 'PIN salt and hash are required' }
  record.pin = { salt: String(salt), hash: String(hash) }
  return { ok: true }
}

export function clearGuestPin(record) {
  delete record.pin
  return { ok: true }
}

/** Timing-safe PIN check (scrypt). Fails closed: a guest without a PIN never "verifies". */
export function verifyGuestPin(record, pin, { verify = verifyPassword } = {}) {
  if (!hasGuestPin(record)) return false
  return Boolean(verify(String(pin ?? ''), record.pin.salt, record.pin.hash))
}

/** Raw guest record lookup (for owner-side management routes). */
export function findGuest(user, guestId) {
  const id = String(guestId ?? '')
  return (Array.isArray(user?.guests) ? user.guests : []).find((entry) => entry?.id === id) ?? null
}

/** Gate for SELECTING a profile (AV-124): resolves the guest and enforces its PIN.
 * Returns { ok: true, value: record } or { ok: false, status, error }. */
export function authorizeGuestSelection(user, guestId, pin, { verify = verifyPassword } = {}) {
  const record = findGuest(user, guestId)
  if (!record) return { ok: false, status: 404, error: 'Guest not found' }
  if (!hasGuestPin(record)) return { ok: true, value: record }
  const provided = pin === undefined || pin === null ? '' : String(pin)
  if (!provided) return { ok: false, status: 403, error: 'This profile requires a PIN' }
  if (!verifyGuestPin(record, provided, { verify })) return { ok: false, status: 403, error: 'Incorrect PIN' }
  return { ok: true, value: record }
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

/** Resolve the selection cookie value against the account's guest list. */
export function resolveActiveGuest(user, guestId) {
  const id = String(guestId ?? '')
  const record = (Array.isArray(user?.guests) ? user.guests : []).find((entry) => entry?.id === id)
  return record ? { ...publicGuest(record), prefs: guestPreferencesView(record) } : null
}

export function guestPreferencesView(record) {
  const prefs = record?.prefs ?? {}
  return {
    preferredLanguage: prefs.preferredLanguage ?? null,
    locale: prefs.locale ?? null,
    defaultSubtitle: prefs.defaultSubtitle ?? null,
    defaultAudio: prefs.defaultAudio ?? null,
    defaultQuality: prefs.defaultQuality ?? null,
    maxContentRating: prefs.maxContentRating ?? null,
    theme: prefs.theme ?? null,
    preferLocalPlayback: prefs.preferLocalPlayback ?? null,
    loginNotifications: null, // guests never receive account mail
  }
}

/** Update a guest's preferences with the shared strict rules. */
export function setGuestPreferences(record, body) {
  const parsed = normalizePreferencesUpdate(body)
  if (!parsed.ok) return parsed
  record.prefs = { ...(record.prefs ?? {}), ...parsed.value }
  return { ok: true, value: guestPreferencesView(record) }
}

/** Which profile is using this device right now (AV-123), and with which
 * preferences. Switching NEVER touches the account session — it only changes
 * the `av_guest` marker (see the routes); this function makes the RESULT of
 * switching explicit and testable.
 *
 * Preference precedence (recorded decision — household inheritance): a
 * guest's SET fields win; its unset (null) fields fall back to the owner's
 * preference; owner fields unset fall back to null (the app default).
 */
export function resolveDeviceProfile(user, guestId) {
  const ownerPrefs = {
    preferredLanguage: user?.preferredLanguage ?? null,
    locale: user?.locale ?? null,
    defaultSubtitle: user?.defaultSubtitle ?? null,
    defaultAudio: user?.defaultAudio ?? null,
    defaultQuality: user?.defaultQuality ?? null,
    maxContentRating: user?.maxContentRating ?? null,
    theme: user?.theme ?? null,
    preferLocalPlayback: user?.preferLocalPlayback ?? null,
    loginNotifications: null, // never active for a guest
  }
  const guest = guestId ? resolveActiveGuest(user, guestId) : null
  if (!guest) {
    return {
      mode: 'owner',
      name: user?.displayName || user?.username || null,
      prefs: ownerPrefs,
    }
  }
  const merged = {}
  for (const key of Object.keys(ownerPrefs)) {
    merged[key] = guest.prefs[key] !== null && guest.prefs[key] !== undefined ? guest.prefs[key] : ownerPrefs[key]
  }
  // A guest never inherits the owner's login notifications.
  merged.loginNotifications = null
  return { mode: 'guest', name: guest.name, guestId: guest.id, prefs: merged }
}
