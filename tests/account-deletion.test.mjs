// Tests for account deletion policy (AV-118b): typed-confirmation rules and
// the documented removed/retained artifact contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDeletionConfirmation, DELETION_ARTIFACTS } from '../server/accountDeletion.mjs'

test('deletion requires typing your own username', () => {
  const user = { username: 'Kenji' }
  assert.deepEqual(validateDeletionConfirmation(user, 'kenji'), { ok: true }, 'case-insensitive')
  assert.deepEqual(validateDeletionConfirmation(user, '  KENJI  '), { ok: true }, 'surrounding space tolerated')
  for (const bad of ['', '   ', 'delete', 'Kenji ', 'kenj', 'kenjii', null, undefined, 'DROP TABLE']) {
    if (typeof bad === 'string' && bad.trim().toLowerCase() === 'kenji') continue
    const result = validateDeletionConfirmation(user, bad)
    assert.equal(result.ok, false, `should reject ${JSON.stringify(bad)}`)
    assert.match(result.error, /Type your username/)
  }
  assert.equal(validateDeletionConfirmation({}, 'anything').ok, false, 'a user without a username can never confirm')
  assert.equal(validateDeletionConfirmation(null, '').ok, false)
})

test('the artifact contract is explicit about removed vs retained', () => {
  assert.ok(DELETION_ARTIFACTS.removed.some((item) => item.includes('sessions')))
  assert.ok(DELETION_ARTIFACTS.removed.some((item) => item.includes('passkey')))
  assert.ok(DELETION_ARTIFACTS.removed.some((item) => item.includes('avatar')))
  assert.ok(DELETION_ARTIFACTS.retained.some((item) => item.includes('notes') && item.includes('not user-scoped')))
  assert.ok(DELETION_ARTIFACTS.retained.some((item) => item.includes('lists') && item.includes('not user-scoped')))
  assert.ok(Object.isFrozen(DELETION_ARTIFACTS), 'the contract is immutable')
})
