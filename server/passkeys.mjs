// Passkey (WebAuthn) authentication (AV-105a): pure data-layer primitives.
// Slices: 105a = this module + tests; 105b = routes; 105c = browser UI.
//
// Scope notes (recorded, not spec-derived):
// - Only ES256 (P-256) is supported — the overwhelmingly common WebAuthn
//   authenticator algorithm. EdDSA/RS256 are out of scope.
// - Challenges are stored in the clear (single-use, 2-minute TTL): unlike
//   session/reset tokens they are not bearer secrets — knowing the challenge
//   is useless without an authenticator that signs over it.

import { createHash, createPublicKey, verify as cryptoVerify, randomBytes } from 'node:crypto'

export function createChallenge() {
  return randomBytes(32).toString('base64url')
}

/** Single-use short-lived challenge record (the raw challenge IS stored). */
export function challengeRecord(challenge, { now = Date.now(), ttlMs = 2 * 60 * 1000 } = {}) {
  return { challenge: String(challenge), createdAt: now, expiresAt: now + ttlMs, usedAt: null }
}

export function isChallengeValid(record, { now = Date.now() } = {}) {
  return Boolean(record && !record.usedAt && record.challenge && Number(record.expiresAt) > now)
}

/** Parse decoded (utf-8) clientDataJSON text. */
export function parseClientData(clientDataText) {
  let parsed
  try {
    parsed = JSON.parse(String(clientDataText))
  } catch {
    return { ok: false, error: 'clientDataJSON is not valid JSON' }
  }
  const value = {
    type: String(parsed?.type ?? ''),
    challenge: String(parsed?.challenge ?? ''),
    origin: String(parsed?.origin ?? ''),
  }
  if (!value.type || !value.challenge) return { ok: false, error: 'clientDataJSON is missing type or challenge' }
  return { ok: true, value }
}

/** Assert the ceremony type, echoed challenge, and (optionally) origin. */
export function validateClientData(parsed, { type, challenge, origin } = {}) {
  if (type && parsed.type !== type) return { ok: false, error: 'Unexpected ceremony type' }
  if (challenge !== undefined && parsed.challenge !== challenge) return { ok: false, error: 'Challenge mismatch' }
  if (origin && parsed.origin !== origin) return { ok: false, error: 'Origin mismatch' }
  return { ok: true }
}

/** Parse base64url authenticatorData (rpIdHash | flags | counter [| attested credential]). */
export function parseAuthenticatorData(authDataBase64url) {
  const data = Buffer.isBuffer(authDataBase64url) ? authDataBase64url : Buffer.from(String(authDataBase64url), 'base64url')
  if (data.length < 37) return { ok: false, error: 'authenticatorData is too short' }
  const flags = data[32]
  const value = {
    rpIdHash: data.subarray(0, 32),
    flags: {
      userPresent: Boolean(flags & 0x01),
      userVerified: Boolean(flags & 0x04),
      backupEligible: Boolean(flags & 0x08),
      backupState: Boolean(flags & 0x10),
      attestedCredentialData: Boolean(flags & 0x40),
      extensionData: Boolean(flags & 0x80),
    },
    counter: data.readUInt32BE(33),
    credentialId: null,
    cosePublicKey: null,
  }
  let offset = 37
  if (value.flags.attestedCredentialData) {
    if (data.length < offset + 18) return { ok: false, error: 'attested credential data is truncated' }
    const idLength = data.readUInt16BE(offset + 16)
    offset += 18
    if (data.length < offset + idLength) return { ok: false, error: 'credential id is truncated' }
    value.credentialId = data.subarray(offset, offset + idLength)
    offset += idLength
    value.cosePublicKey = data.subarray(offset)
    if (!value.cosePublicKey.length) return { ok: false, error: 'missing COSE public key' }
  }
  return { ok: true, value }
}

// --- Minimal CBOR reading for COSE ES256 keys (major types 0,1,2,5) ---

function readCborItem(buf, offset) {
  if (offset >= buf.length) throw new Error('CBOR input ended early')
  const initial = buf[offset]
  const major = initial >> 5
  let argument = initial & 0x1f
  let pos = offset + 1
  if (argument >= 24) {
    const extraBytes = argument === 24 ? 1 : argument === 25 ? 2 : argument === 26 ? 4 : 8
    if (pos + extraBytes > buf.length) throw new Error('CBOR length truncated')
    argument = extraBytes === 1 ? buf[pos] : extraBytes === 2 ? buf.readUInt16BE(pos) : buf.readUInt32BE(pos)
    pos += extraBytes
  }
  if (major === 0) return { value: argument, pos }
  if (major === 1) return { value: -1 - argument, pos }
  if (major === 2) {
    if (pos + argument > buf.length) throw new Error('CBOR bytes truncated')
    return { value: buf.subarray(pos, pos + argument), pos: pos + argument }
  }
  if (major === 5) {
    const map = new Map()
    for (let i = 0; i < argument; i += 1) {
      const key = readCborItem(buf, pos)
      const entry = readCborItem(buf, key.pos)
      map.set(key.value, entry.value)
      pos = entry.pos
    }
    return { value: map, pos }
  }
  throw new Error(`unsupported CBOR major type ${major}`)
}

const SPKI_P256_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d03010703420004', 'hex')

/** Convert a COSE ES256 public key to SPKI DER (P-256 only). */
export function coseEs256ToSpki(coseKey) {
  const bytes = Buffer.isBuffer(coseKey) ? coseKey : Buffer.from(String(coseKey), 'base64url')
  let map
  try {
    map = readCborItem(bytes, 0).value
  } catch (err) {
    return { ok: false, error: `COSE key is not valid CBOR: ${err.message}` }
  }
  if (!(map instanceof Map)) return { ok: false, error: 'COSE key is not a CBOR map' }
  if (map.get(1) !== 2) return { ok: false, error: 'COSE key is not an EC2 key' }
  if (map.get(3) !== -7) return { ok: false, error: 'COSE key is not ES256 (algorithm -7)' }
  if (map.get(-1) !== 1) return { ok: false, error: 'COSE key is not on P-256 (crv 1)' }
  const x = map.get(-2)
  const y = map.get(-3)
  if (!Buffer.isBuffer(x) || x.length !== 32 || !Buffer.isBuffer(y) || y.length !== 32) {
    return { ok: false, error: 'COSE key has malformed x/y coordinates' }
  }
  return { ok: true, value: Buffer.concat([SPKI_P256_PREFIX, x, y]) }
}

/** Verify a WebAuthn ES256 assertion/attestation signature (DER-encoded). */
export function verifyAssertionSignature({ authenticatorData, clientDataJSON, signature, publicKeySpkiDer }) {
  try {
    const authData = Buffer.isBuffer(authenticatorData)
      ? authenticatorData
      : Buffer.from(String(authenticatorData), 'base64url')
    const clientHash = createHash('sha256').update(Buffer.from(String(clientDataJSON))).digest()
    const message = Buffer.concat([authData, clientHash])
    const key = createPublicKey({ key: Buffer.from(publicKeySpkiDer), format: 'der', type: 'spki' })
    return cryptoVerify('sha256', message, key, Buffer.from(String(signature), 'base64url'))
  } catch {
    return false
  }
}

/** rpIdHash check: sha256(rpId) must equal the authenticator's rpIdHash. */
export function validateRpIdHash(rpIdHash, rpId) {
  return createHash('sha256').update(String(rpId)).digest().equals(Buffer.from(rpIdHash))
}
