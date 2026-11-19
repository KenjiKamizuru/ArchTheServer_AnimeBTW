// Tests for guest profiles (AV-122a): name rules, household caps, unique
// names, owner-scoped add/remove.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeGuestName,
  listGuests,
  addGuest,
  removeGuest,
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
