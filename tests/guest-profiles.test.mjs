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
  MAX_GUESTS,
  MAX_GUEST_NAME,
} from '../server/guestProfiles.mjs'

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
  assert.deepEqual(first.value, { id: 'g1', name: 'Aki', createdAt: 1_000 })
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
