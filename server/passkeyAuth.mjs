// Passkey authentication flow (AV-105b) on top of the WebAuthn data layer
// (passkeys.mjs). Handles single-use challenges, registration (attestation
// 'none' — scope decision below), assertion verification with the counter
// backstop, and credential storage.
//
// Scope decisions (recorded per task rules):
// - Attestation format 'none' only: the server verifies the ceremony itself
//   (single-use challenge + origin + rpIdHash + user presence) and trusts the
//   returned credential blob. Certificate-chain attestation verification is
//   out of scope; it adds nothing for consumer authentication here.
// - Counter backstop (WebAuthn §6.1.2): a replayed assertion is rejected when
//   the new counter is <= the stored counter, EXCEPT the 0→0 case (platform
//   authenticators without counters). This is stricter than the TODO's draft
//   "reject non-increasing" only in that it tolerates 0→0 as the spec allows.

import {
  createChallenge,
  challengeRecord,
  isChallengeValid,
  parseClientData,
  validateClientData,
  parseAuthenticatorData,
  parseAttestationObject,
  coseEs256ToSpki,
  verifyAssertionSignature,
  validateRpIdHash,
} from './passkeys.mjs'
import { randomBytes } from 'node:crypto'

const CHALLENGE_TTL_MS = 2 * 60 * 1000
const challengeKey = (challenge) => `passkey-challenge:${challenge}`
const credentialKey = (credentialId) => `passkey:${credentialId}`

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

/** Issue a single-use challenge for 'register' | 'authenticate'. */
export async function issuePasskeyChallenge(purpose, { kv, userId = null, now = Date.now() } = {}) {
  if (purpose !== 'register' && purpose !== 'authenticate') throw fail('Invalid passkey challenge purpose', 400)
  const challenge = createChallenge()
  await kv.set(challengeKey(challenge), { ...challengeRecord(challenge, { now, ttlMs: CHALLENGE_TTL_MS }), purpose, userId })
  return { challenge }
}

/** Consume a stored challenge (single-use: always removed). */
async function consumeChallenge(challenge, purpose, { kv, userId = null, now = Date.now() } = {}) {
  const raw = String(challenge ?? '')
  const record = raw ? await kv.get(challengeKey(raw), null) : null
  if (record) await kv.remove(challengeKey(raw))
  if (!record || !isChallengeValid(record, { now }) || record.purpose !== purpose) {
    throw fail('This passkey challenge is invalid or has expired')
  }
  if (userId != null && record.userId != null && record.userId !== userId) {
    throw fail('This passkey challenge is invalid or has expired')
  }
  return { challenge: raw, record }
}

/** Register a credential (session user id supplied by the route). */
export async function registerPasskey({ userId, credentialName = null, clientDataJSON, attestationObject }, { kv, rpId, origin, now = Date.now() } = {}) {
  if (!userId) throw fail('Sign in to register a passkey', 401)
  const attestation = parseAttestationObject(attestationObject)
  if (!attestation.ok) throw fail(attestation.error)
  if (attestation.value.fmt !== 'none') {
    throw fail("Only 'none' attestation is accepted")
  }
  const authData = attestation.value.authData
  const parsed = parseAuthenticatorData(authData)
  if (!parsed.ok) throw fail(parsed.error)
  const data = parsed.value
  if (!validateRpIdHash(data.rpIdHash, rpId)) throw fail('Authenticator is for a different site')
  if (!data.flags.userPresent) throw fail('User presence was not confirmed')
  if (!data.flags.attestedCredentialData || !data.credentialId || !data.cosePublicKey) {
    throw fail('Attestation is missing the credential public key')
  }
  const clientData = parseClientData(clientDataJSON)
  if (!clientData.ok) throw fail(clientData.error)
  const { challenge } = await consumeChallenge(clientData.value?.challenge, 'register', { kv, userId, now })
  const check = validateClientData(clientData.value, { type: 'webauthn.create', challenge, origin })
  if (!check.ok) throw fail(check.error)
  const spki = coseEs256ToSpki(data.cosePublicKey)
  if (!spki.ok) throw fail(spki.error)
  const credentialId = data.credentialId.toString('base64url')
  if (await kv.get(credentialKey(credentialId), null)) throw fail('This passkey is already registered', 409)
  const record = {
    credentialId,
    spki: spki.value.toString('base64'),
    counter: data.counter,
    userId,
    name: String(credentialName ?? '').slice(0, 60) || null,
    createdAt: now,
    lastUsedAt: null,
  }
  await kv.set(credentialKey(credentialId), record)
  return { credential: publicCredential(record) }
}

/** Verify an assertion and return the owning userId (the route issues the session). */
export async function authenticatePasskey({ credentialId, clientDataJSON, authenticatorData, signature }, { kv, rpId, origin, now = Date.now() } = {}) {
  const clientData = parseClientData(clientDataJSON)
  if (!clientData.ok) throw fail(clientData.error)
  const { challenge } = await consumeChallenge(clientData.value?.challenge, 'authenticate', { kv, now })
  const key = credentialKey(String(credentialId ?? ''))
  const record = (await kv.get(key, null)) ?? null
  // Generic error: never reveal whether the credential exists.
  const invalid = () => fail('Passkey authentication failed', 401)
  if (!record) throw invalid()
  const data = parseAuthenticatorData(authenticatorData)
  if (!data.ok) throw invalid()
  if (!validateRpIdHash(data.value.rpIdHash, rpId)) throw invalid()
  if (!data.value.flags.userPresent) throw invalid()
  const check = validateClientData(clientData.value, { type: 'webauthn.get', challenge, origin })
  if (!check.ok) throw invalid()
  const verified = verifyAssertionSignature({
    authenticatorData,
    clientDataJSON,
    signature,
    publicKeySpkiDer: Buffer.from(record.spki, 'base64'),
  })
  if (!verified) throw invalid()
  // Counter backstop (WebAuthn §6.1.2): reject replays; tolerate 0→0.
  const previous = Number(record.counter) || 0
  const current = data.value.counter
  if (!(previous === 0 && current === 0) && current <= previous) throw invalid()
  await kv.set(key, { ...record, counter: current, lastUsedAt: now })
  return { userId: record.userId, credential: publicCredential({ ...record, counter: current, lastUsedAt: now }) }
}

function publicCredential(record) {
  return {
    credentialId: record.credentialId,
    name: record.name,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    counter: record.counter,
  }
}

/** List a user's passkeys (owner-scoped). */
export async function listPasskeys(userId, { kv }) {
  const keys = await kv.list('passkey:', { limit: 1_000 })
  const out = []
  for (const key of keys) {
    const record = await kv.get(key, null)
    if (record?.userId === userId) out.push(publicCredential(record))
  }
  return out
}

/** Remove one of the user's passkeys (owner-checked). */
export async function removePasskey(userId, credentialId, { kv }) {
  const key = credentialKey(String(credentialId ?? ''))
  const record = (await kv.get(key, null)) ?? null
  if (!record || record.userId !== userId) throw fail('Passkey not found', 404)
  await kv.remove(key)
  return { ok: true }
}
