// Tests for the account data export (AV-118a): credential material is never
// exported even to its owner; the rest of the record round-trips.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAccountExport } from '../server/accountExport.mjs'

test('export includes profile data and lists withheld fields by name', () => {
  const user = {
    id: 'u1',
    username: 'kenji',
    displayName: 'Kenji',
    email: 'kenji@example.test',
    emailVerified: true,
    bio: 'hello',
    createdAt: 1_000,
    profileVisibility: 'link-only',
    showActivity: true,
    preferredLanguage: 'ja',
    locale: 'ja-jp',
    defaultSubtitle: 'en',
    defaultAudio: 'ja',
    defaultQuality: '1080p',
    maxContentRating: 'pg-13',
    theme: 'system',
    preferLocalPlayback: true,
    // Credential material that must never leave:
    passwordHash: 'HASH',
    passwordSalt: 'SALT',
    twoFactorSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    recoveryCodes: [{ hash: 'deadbeef', usedAt: null }],
    profileLinkToken: 'aabbccdd',
  }
  const { export: data, excluded } = buildAccountExport(user, {
    passkeys: [{ credentialId: 'cred1', name: 'My laptop', counter: 5, spki: 'PUBLICKEY', createdAt: 2, lastUsedAt: 3 }],
    activeSessions: 2,
    now: 42,
  })

  assert.equal(data.exportedAt, 42)
  assert.equal(data.account.username, 'kenji')
  assert.equal(data.account.preferredLanguage, 'ja')
  assert.equal(data.account.maxContentRating, 'pg-13')
  assert.equal(data.account.showActivity, true)
  assert.equal(data.activeSessions, 2)
  assert.deepEqual(data.passkeys, [{ credentialId: 'cred1', name: 'My laptop', createdAt: 2, lastUsedAt: 3, counter: 5 }])

  const serialized = JSON.stringify(data)
  for (const secret of ['HASH', 'SALT', 'GEZDGNBVGY3TQOJQ', 'deadbeef', 'aabbccdd', 'PUBLICKEY']) {
    assert.ok(!serialized.includes(secret), `export must never contain ${secret}`)
  }
  assert.deepEqual(excluded, [
    'passwordHash',
    'passwordSalt',
    'twoFactorSecret',
    'recoveryCodes',
    'profileLinkToken',
    'sessions',
  ])
})

test('export handles sparse inputs without inventing data', () => {
  const { export: data } = buildAccountExport({}, {})
  assert.deepEqual(data.account, {})
  assert.deepEqual(data.passkeys, [])
  assert.equal(data.activeSessions, 0)
  assert.equal(data.exportedAt, Date.now() > 0 ? data.exportedAt : null, 'a timestamp is stamped')
  const neg = buildAccountExport({}, { activeSessions: -3 }).export
  assert.equal(neg.activeSessions, 0, 'counters clamp to zero')
})
