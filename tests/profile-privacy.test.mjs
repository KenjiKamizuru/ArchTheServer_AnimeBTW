// Tests for profile visibility policy (AV-111a): normalization, the
// public/private/link-only decision matrix, and link-token behavior.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProfileVisibility,
  canViewProfile,
  getOrCreateProfileLink,
  rotateProfileLink,
  PROFILE_VISIBILITIES,
} from '../server/profilePrivacy.mjs'

test('visibility normalization: default public, strict values, invalid rejected', () => {
  assert.deepEqual(normalizeProfileVisibility(undefined), { ok: true, value: 'public' })
  assert.deepEqual(normalizeProfileVisibility(''), { ok: true, value: 'public' })
  assert.deepEqual(normalizeProfileVisibility(' LINK-ONLY '), { ok: true, value: 'link-only' })
  assert.deepEqual(normalizeProfileVisibility('Private'), { ok: true, value: 'private' })
  const bad = normalizeProfileVisibility('friends-only')
  assert.equal(bad.ok, false)
  assert.match(bad.error, /public, private, or link-only/)
  assert.deepEqual([...PROFILE_VISIBILITIES], ['public', 'private', 'link-only'])
})

test('visibility decision matrix', () => {
  const owner = { id: 'u1', profileVisibility: 'private' }
  assert.equal(canViewProfile(owner, { viewerId: 'u1' }).ok, true, 'the owner always sees their profile')
  assert.equal(canViewProfile(owner, { viewerId: 'u2' }).ok, false, 'private blocks others')
  assert.equal(canViewProfile(owner, {}).ok, false, 'private blocks anonymous viewers')
  assert.equal(canViewProfile(owner, { viewerId: 'u2', token: 'whatever' }).ok, false, 'a token does not bypass private')

  const open = { id: 'u2', profileVisibility: 'public' }
  assert.equal(canViewProfile(open, {}).ok, true)
  assert.equal(canViewProfile(open, { viewerId: 'u9' }).ok, true)

  const linkOnly = { id: 'u3', profileVisibility: 'link-only' }
  assert.equal(canViewProfile(linkOnly, {}).ok, false, 'link-only blocks anonymous viewers')
  const { token } = getOrCreateProfileLink(linkOnly)
  assert.equal(canViewProfile(linkOnly, { token }).ok, true, 'the exact link token grants view')
  assert.equal(canViewProfile(linkOnly, { token: `${token}x` }).ok, false, 'near-miss tokens fail')
  assert.equal(canViewProfile(linkOnly, { token }).via, 'link')
  assert.equal(canViewProfile({ ...linkOnly, profileVisibility: undefined }, {}).ok, true, 'accounts without a setting stay public')
})

test('link tokens: created once, rotated to revoke', () => {
  const user = { id: 'u1', profileVisibility: 'link-only' }
  const first = getOrCreateProfileLink(user)
  const again = getOrCreateProfileLink(user)
  assert.equal(first.token, again.token, 'stable until rotated')
  assert.match(first.token, /^[0-9a-f]{32}$/)
  const next = rotateProfileLink(user)
  assert.notEqual(next.token, first.token)
  assert.equal(canViewProfile(user, { token: first.token }).ok, false, 'the old link stops working')
  assert.equal(canViewProfile(user, { token: next.token }).ok, true)
})
