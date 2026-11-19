// Tests for optional account registration (server/accounts.mjs, AV-101a).
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRegistration, hashPassword, verifyPassword, publicUser } from '../server/accounts.mjs'
import { normalizeEmail, findUserByIdentifier, setPassword, normalizeBio } from '../server/accounts.mjs'

test('normalizeRegistration enforces the registration contract', () => {
  const parsed = normalizeRegistration({ username: '  Frieren_Fan-1 ', password: 'elven magic 123', displayName: '  Frieren  ' })
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.value, { username: 'Frieren_Fan-1', password: 'elven magic 123', displayName: 'Frieren', email: null })
  assert.equal(normalizeRegistration({ username: 'ab', password: '12345678' }).error, 'Username must be 3-32 letters, numbers, underscores or hyphens')
  assert.equal(normalizeRegistration({ username: 'has space', password: '12345678' }).ok, false)
  assert.equal(normalizeRegistration({ username: 'good_name', password: 'short' }).error, 'Password must be at least 8 characters')
  assert.equal(normalizeRegistration({ username: 'good_name', password: 'x'.repeat(201) }).error, 'Password must be at most 200 characters')
  assert.equal(normalizeRegistration({ username: 'solo' }).ok, false, 'missing password rejected')
  assert.equal(normalizeRegistration({ username: 'solo', password: '12345678' }).value.displayName, null)
})

test('password hashing is salted and verifiable', () => {
  const hash = hashPassword('elven magic 123', 'aabbcc')
  assert.equal(hash, hashPassword('elven magic 123', 'aabbcc'), 'deterministic for the same salt')
  assert.notEqual(hash, hashPassword('elven magic 123', 'ddeeff'), 'different salts give different hashes')
  assert.notEqual(hash, hashPassword('wrong password', 'aabbcc'))
  assert.ok(verifyPassword('elven magic 123', 'aabbcc', hash))
  assert.ok(!verifyPassword('wrong password', 'aabbcc', hash))
  assert.ok(!verifyPassword('elven magic 123', 'aabbcc', 'not-hex'), 'malformed stored hashes never verify')
  assert.ok(hash.length >= 128, '64-byte hex digest')
})

test('publicUser never leaks credentials', () => {
  const user = { id: 'u_1', username: 'fan', displayName: 'Fan', createdAt: 5, emailVerified: true, email: 'a@b.co', passwordHash: 'SECRET', passwordSalt: 'SECRET' }
  const view = publicUser(user)
  assert.deepEqual(view, { id: 'u_1', username: 'fan', displayName: 'Fan', emailVerified: true, bio: null, createdAt: 5 })
  assert.ok(!JSON.stringify(view).includes('SECRET'))
  assert.ok(!JSON.stringify(view).includes('a@b.co'), 'the email address itself is never public')
  assert.equal(publicUser({ id: 'u_2' }).emailVerified, false)
})

test('display names are cosmetic and separate from login identifiers (AV-109)', () => {
  // Display names are free-form text (spaces allowed); usernames are the
  // charset-restricted identity used for login.
  const parsed = normalizeRegistration({
    username: 'slayer_1',
    password: '12345678',
    displayName: 'Frieren the Slayer',
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.displayName, 'Frieren the Slayer')
  assert.equal(normalizeRegistration({ username: 'Frieren the Slayer', password: '12345678' }).ok, false, 'the display name is not a valid login identifier')
  // A display name may imitate someone's username — identity is the username.
  const impersonation = normalizeRegistration({ username: 'harmless', password: '12345678', displayName: 'Admin' })
  assert.equal(impersonation.value.displayName, 'Admin')
  assert.equal(impersonation.value.username, 'harmless')
  assert.notEqual(impersonation.value.displayName, impersonation.value.username)
})

test('emails are optional unless the installation requires them (AV-103)', () => {
  assert.deepEqual(normalizeEmail('  Frieren@Example.COM '), { ok: true, value: 'frieren@example.com' }, 'lowercased + trimmed')
  assert.deepEqual(normalizeEmail(''), { ok: true, value: null })
  assert.deepEqual(normalizeEmail(undefined), { ok: true, value: null })
  assert.equal(normalizeEmail('not-an-email').error, 'Enter a valid email address')
  assert.equal(normalizeEmail('a@b').ok, false)
  assert.equal(normalizeEmail(`${'x'.repeat(250)}@example.com`).ok, false)
  const withEmail = normalizeRegistration({ username: 'fan_1', password: '12345678', email: 'Fan@Example.com' })
  assert.equal(withEmail.value.email, 'fan@example.com')
  assert.equal(normalizeRegistration({ username: 'fan_1', password: '12345678' }, { requireEmail: true }).error, 'Email is required on this installation')
  assert.equal(normalizeRegistration({ username: 'fan_1', password: '12345678', email: 'bad' }, { requireEmail: true }).ok, false)
})

test('reset lookup and password replacement (AV-104)', () => {
  const users = [
    { id: 'u_1', username: 'Frieren', email: 'a@b.co' },
    { id: 'u_2', username: 'fern', email: 'C@D.EF' },
  ]
  assert.equal(findUserByIdentifier(users, 'frieren')?.id, 'u_1', 'username match is case-insensitive')
  assert.equal(findUserByIdentifier(users, '  c@D.ef ')?.id, 'u_2', 'email match is case-insensitive')
  assert.equal(findUserByIdentifier(users, 'nobody'), null)
  assert.equal(findUserByIdentifier(users, ''), null)
  assert.equal(findUserByIdentifier(users, undefined), null)
  assert.equal(findUserByIdentifier(users, 'u_1'), null, 'ids are not lookup identifiers')

  const user = { id: 'u_1', passwordHash: hashPassword('old password', 'salt-a'), passwordSalt: 'salt-a' }
  Object.assign(user, setPassword(user, 'new password', { saltHex: 'salt-b' }))
  assert.equal(user.passwordSalt, 'salt-b')
  assert.ok(verifyPassword('new password', 'salt-b', user.passwordHash))
  assert.ok(!verifyPassword('old password', 'salt-b', user.passwordHash), 'the old password no longer verifies')
  assert.notEqual(user.passwordHash, hashPassword('new password', 'salt-a'), 'the hash is salt-specific')
})

test('bios have length and content limits (AV-110)', () => {
  assert.deepEqual(normalizeBio('  Hello there.  '), { ok: true, value: 'Hello there.' })
  assert.deepEqual(normalizeBio(''), { ok: true, value: null })
  assert.deepEqual(normalizeBio('   '), { ok: true, value: null })
  assert.deepEqual(normalizeBio(undefined), { ok: true, value: null })
  assert.deepEqual(normalizeBio('line one\nline two'), { ok: true, value: 'line one\nline two' }, 'newlines allowed')
  assert.equal(normalizeBio('x'.repeat(600)).value.length, 500, 'long bios are truncated, not rejected')
  assert.equal(normalizeBio('bad\u0000bio').error, 'Bios cannot contain control characters')
  assert.equal(normalizeBio('bad\u001bbio').ok, false)
  const user = { id: 'u_1', bio: 'A short bio' }
  assert.equal(publicUser(user).bio, 'A short bio')
})
