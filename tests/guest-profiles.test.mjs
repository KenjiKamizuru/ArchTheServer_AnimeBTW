// Tests for guest profiles (AV-122a): name rules, household caps, unique
// names, owner-scoped add/remove.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeGuestName,
  listGuests,
  addGuest,
  removeGuest,
  resolveActiveGuest,
  guestPreferencesView,
  setGuestPreferences,
  resolveDeviceProfile,
  normalizePin,
  setGuestPin,
  clearGuestPin,
  hasGuestPin,
  verifyGuestPin,
  findGuest,
  authorizeGuestSelection,
  MAX_GUESTS,
  MAX_GUEST_NAME,
} from '../server/guestProfiles.mjs'
import { hashPassword, verifyPassword } from '../server/accounts.mjs'

test('guest names: trimmed, bounded, no control characters', () => {
  assert.deepEqual(normalizeGuestName('  Aki  '), { ok: true, value: 'Aki' })
  assert.deepEqual(normalizeGuestName('Living Room'), { ok: true, value: 'Living Room' })
  const long = normalizeGuestName('x'.repeat(50))
  assert.equal(long.ok, true)
  assert.equal(long.value.length, MAX_GUEST_NAME, 'names are truncated to the cap')
  for (const bad of ['', '   ', null, undefined, 'bad\u0000name', 'bad\u001bname']) {
    const result = normalizeGuestName(bad)
    assert.equal(result.ok, false, `should reject ${JSON.stringify(bad)}`)
    assert.match(result.error, /required|control/)
  }
})

test('add/remove guests: caps, case-insensitive uniqueness, owner-scoped ids', () => {
  const user = { username: 'kenji' }
  let counter = 0
  const makeId = () => `g${(counter += 1)}`
  assert.deepEqual(listGuests(user), [], 'no guests before any are added')

  const first = addGuest(user, 'Aki', { now: 1_000, makeId })
  assert.deepEqual(first.value, { id: 'g1', name: 'Aki', createdAt: 1_000, pinProtected: false })
  const dup = addGuest(user, ' aki ', { makeId })
  assert.equal(dup.ok, false, 'names are unique case-insensitively')
  assert.match(dup.error, /already exists/)
  assert.deepEqual(addGuest(user, 'Rin', { makeId }).value.name, 'Rin')

  for (let i = 0; i < MAX_GUESTS - 2; i += 1) addGuest(user, `Guest ${i}`, { makeId })
  const over = addGuest(user, 'Overflow', { makeId })
  assert.equal(over.ok, false)
  assert.match(over.error, new RegExp(String(MAX_GUESTS)))
  assert.equal(listGuests(user).length, MAX_GUESTS)

  assert.equal(removeGuest(user, 'g1').ok, true)
  assert.equal(listGuests(user).some((entry) => entry.id === 'g1'), false)
  assert.equal(removeGuest(user, 'g1').ok, false, 'removing twice fails')
  assert.match(removeGuest(user, '../etc').error, /not found/, 'unknown ids never match')
  assert.equal(listGuests(user).length, MAX_GUESTS - 1)
})

test('guest usage: selection validation + per-guest preferences (AV-122b)', () => {
  let counter = 0
  const user = { username: 'kenji' }
  addGuest(user, 'Aki', { now: 1, makeId: () => `g${(counter += 1)}` })

  // The selection cookie value is only meaningful against THIS account's list.
  const active = resolveActiveGuest(user, 'g1')
  assert.equal(active.name, 'Aki')
  assert.equal(active.prefs.theme, null, 'guest prefs start unset')
  assert.equal(resolveActiveGuest(user, 'g999'), null, 'unknown ids resolve to nothing')
  assert.equal(resolveActiveGuest(user, '../../etc'), null)
  assert.equal(resolveActiveGuest({}, 'g1'), null, 'an account without guests resolves nothing')

  // Per-guest preferences: the shared strict rules apply; partial updates.
  const record = user.guests[0]
  const updated = setGuestPreferences(record, { theme: 'dark', defaultSubtitle: 'off' })
  assert.equal(updated.ok, true)
  assert.equal(updated.value.theme, 'dark')
  assert.equal(updated.value.defaultSubtitle, 'off')
  assert.equal(guestPreferencesView(record).loginNotifications, null, 'guests never receive account mail')
  assert.equal(setGuestPreferences(record, { defaultQuality: 'ultra' }).ok, false, 'invalid prefs rejected')
  assert.equal(user.prefs, undefined, "the owner's preferences are untouched")
  const second = setGuestPreferences(record, { theme: 'light' })
  assert.equal(second.value.theme, 'light')
  assert.equal(second.value.defaultSubtitle, 'off', 'untouched fields survive partial updates')
  // Removing the guest revokes the selection entirely.
  removeGuest(user, 'g1')
  assert.equal(resolveActiveGuest(user, 'g1'), null, 'a removed guest resolves to nothing')
})

test('device profile resolution: mode, precedence, owner fallback (AV-123)', () => {
  const owner = {
    username: 'kenji',
    displayName: 'Kenji',
    theme: 'dark',
    defaultSubtitle: 'en',
    defaultAudio: null,
    loginNotifications: true,
  }
  // No selection → owner mode with the owner's own preferences.
  const ownerMode = resolveDeviceProfile(owner, null)
  assert.equal(ownerMode.mode, 'owner')
  assert.equal(ownerMode.name, 'Kenji')
  assert.equal(ownerMode.prefs.theme, 'dark')
  assert.equal(ownerMode.prefs.loginNotifications, null, 'the device profile view never exposes mail prefs')

  // A removed/unknown selection falls back to owner mode (never errors).
  assert.equal(resolveDeviceProfile(owner, 'g404').mode, 'owner')

  // Guest mode: SET guest fields win; UNSET fields inherit the owner's.
  const user = { ...owner, guests: [] }
  addGuest(user, 'Aki', { makeId: () => 'g1' })
  setGuestPreferences(user.guests[0], { theme: 'light', defaultQuality: '720p' })
  const guestMode = resolveDeviceProfile(user, 'g1')
  assert.equal(guestMode.mode, 'guest')
  assert.equal(guestMode.name, 'Aki')
  assert.equal(guestMode.guestId, 'g1')
  assert.equal(guestMode.prefs.theme, 'light', 'set guest fields win')
  assert.equal(guestMode.prefs.defaultSubtitle, 'en', 'unset guest fields inherit the owner')
  assert.equal(guestMode.prefs.defaultQuality, '720p')
  assert.equal(guestMode.prefs.defaultAudio, null, 'owner-unset stays null (app default)')
  assert.equal(guestMode.prefs.loginNotifications, null, 'guests never inherit login notifications')

  // Clearing the selection (the switch back) is pure owner-mode again.
  assert.equal(resolveDeviceProfile(user, null).mode, 'owner')
})

test('guest selection never mutates account session records (AV-123b pin)', () => {
  // The switching invariant: select/clear only change the av_guest marker
  // (a response cookie). The account's session records — and every other
  // field of the user — must survive a switch untouched.
  const user = {
    username: 'kenji',
    displayName: 'Kenji',
    sessions: [
      { hash: 'aaa', current: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { hash: 'bbb', current: false, createdAt: '2025-12-01T00:00:00.000Z' },
    ],
    guests: [],
    preferences: { theme: 'dark' },
  }
  const sessionsBefore = JSON.stringify(user.sessions)
  const snapshot = JSON.parse(JSON.stringify(user))

  // Create + resolve a selection — neither touches session records.
  addGuest(user, 'Kenji', { makeId: () => 'g1' })
  const active = resolveActiveGuest(user, 'g1')
  assert.equal(active?.name, 'Kenji')
  assert.equal(JSON.stringify(user.sessions), sessionsBefore, 'addGuest/select resolution leaves session records untouched')

  // Guest preference writes land in user.guests[].prefs only.
  setGuestPreferences(user.guests[0], { theme: 'light' })
  assert.equal(JSON.stringify(user.sessions), sessionsBefore, 'guest preference writes leave session records untouched')

  // Device-profile resolution is pure with respect to the user.
  resolveDeviceProfile(user, 'g1')
  resolveDeviceProfile(user, undefined)
  resolveDeviceProfile(user, 'g404')
  assert.equal(JSON.stringify(user.sessions), sessionsBefore, 'device-profile resolution leaves session records untouched')

  // Even guest removal mutates only the guests list — never sessions.
  removeGuest(user, 'g1')
  assert.equal(JSON.stringify(user.sessions), sessionsBefore, 'removeGuest leaves session records untouched')
  assert.equal(user.guests.length, 0, 'guest list returns to baseline after removal')
  assert.deepEqual(user.sessions, snapshot.sessions, 'sessions identical to the pre-switch snapshot')
  assert.deepEqual(user.preferences, snapshot.preferences, 'owner preferences untouched')
})

test('profile PIN: normalization, hash-only storage, views never leak (AV-124a)', () => {
  // PINs are 4–6 digits (trimmed).
  for (const pin of ['1234', '123456', '  0042  ']) {
    const parsed = normalizePin(pin)
    assert.equal(parsed.ok, true, `accepts ${JSON.stringify(pin)}`)
  }
  assert.equal(normalizePin('  0042  ').value, '0042', 'input is trimmed')
  for (const pin of ['123', '1234567', '12a4', '', null, undefined, '12 34', '١٢٣٤']) {
    assert.equal(normalizePin(pin).ok, false, `rejects ${JSON.stringify(pin)}`)
  }

  // Lifecycle: set (from pre-computed salt+hash) → verify → clear.
  const user = { username: 'kenji', guests: [] }
  addGuest(user, 'Kenji', { makeId: () => 'g1' })
  const record = findGuest(user, 'g1')
  assert.equal(hasGuestPin(record), false)

  const salt = 'aabbcc'
  const hash = hashPassword('4242', salt)
  assert.equal(setGuestPin(record, { salt, hash }).ok, true)
  assert.equal(hasGuestPin(record), true)
  assert.deepEqual(record.pin, { salt, hash }, 'stored as salt+hash only')

  // Real scrypt round-trip (timing-safe primitive shared with passwords).
  assert.equal(verifyGuestPin(record, '4242', { verify: verifyPassword }), true)
  assert.equal(verifyGuestPin(record, '4243', { verify: verifyPassword }), false)
  assert.equal(verifyGuestPin(record, '', { verify: verifyPassword }), false)
  // Fails closed: a guest without a PIN never "verifies".
  assert.equal(verifyGuestPin({ name: 'x' }, '4242', { verify: verifyPassword }), false)

  // Views expose pinProtected only — never salt/hash (field-set pinned).
  const view = resolveActiveGuest(user, 'g1')
  assert.equal(view.pinProtected, true)
  assert.deepEqual(Object.keys(view).sort(), ['createdAt', 'id', 'name', 'pinProtected', 'prefs'])
  assert.equal(JSON.stringify(listGuests(user)).includes('aabbcc'), false, 'listGuests never leaks pin material')

  clearGuestPin(record)
  assert.equal(hasGuestPin(record), false)
  assert.equal(resolveActiveGuest(user, 'g1').pinProtected, false)
})

test('selection gate enforces the PIN lock (AV-124a)', () => {
  const user = { username: 'kenji', guests: [] }
  addGuest(user, 'Kenji', { makeId: () => 'g1' })
  addGuest(user, 'Aki', { makeId: () => 'g2' })
  setGuestPin(findGuest(user, 'g1'), { salt: 's', hash: hashPassword('9999', 's') })

  // Unknown guest → 404.
  assert.deepEqual(
    (({ ok, status }) => ({ ok, status }))(authorizeGuestSelection(user, 'g404', '9999')),
    { ok: false, status: 404 },
  )

  // Unlocked guest selects with no PIN.
  assert.equal(authorizeGuestSelection(user, 'g2', undefined).ok, true)

  // Locked guest: missing PIN and wrong PIN are 403 with distinct errors;
  // the correct PIN selects.
  const missing = authorizeGuestSelection(user, 'g1', undefined)
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 403)
  assert.equal(missing.error, 'This profile requires a PIN')
  const wrong = authorizeGuestSelection(user, 'g1', '0000')
  assert.equal(wrong.ok, false)
  assert.equal(wrong.status, 403)
  assert.equal(wrong.error, 'Incorrect PIN')
  const right = authorizeGuestSelection(user, 'g1', '9999')
  assert.equal(right.ok, true)
  assert.equal(right.value.id, 'g1')
})
