// Tests for the WebAuthn passkey data layer (server/passkeys.mjs, AV-105a).
// Fixtures are REAL P-256 crypto generated in-test: a keypair is created, the
// public key hand-assembled into its COSE form, and real signatures verified.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as cryptoSign, createPublicKey, createHash } from 'node:crypto'
import {
  createChallenge,
  challengeRecord,
  isChallengeValid,
  parseClientData,
  validateClientData,
  parseAuthenticatorData,
  coseEs256ToSpki,
  verifyAssertionSignature,
  validateRpIdHash,
} from '../server/passkeys.mjs'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwk = publicKey.export({ format: 'jwk' })
const x = Buffer.from(jwk.x, 'base64url')
const y = Buffer.from(jwk.y, 'base64url')

/** Hand-assemble the fixed COSE ES256 layout: {1:2, 3:-7, -1:1, -2:x, -3:y}. */
const coseKey = Buffer.concat([
  Buffer.from('a5', 'hex'),
  Buffer.from('0102', 'hex'),
  Buffer.from('0326', 'hex'),
  Buffer.from('2001', 'hex'),
  Buffer.from('215820', 'hex'),
  x,
  Buffer.from('225820', 'hex'),
  y,
])

function authDataFixture({ counter = 7, flags = 0x05 } = {}) {
  return Buffer.concat([
    Buffer.alloc(32, 0xab), // rpIdHash stand-in
    Buffer.from([flags]),
    (() => {
      const buf = Buffer.alloc(4)
      buf.writeUInt32BE(counter)
      return buf
    })(),
  ])
}

test('challenges are random, single-use and short-lived', () => {
  const challenge = createChallenge()
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(challenge, createChallenge())
  const record = challengeRecord(challenge, { now: 1_000, ttlMs: 500 })
  assert.ok(isChallengeValid(record, { now: 1_499 }))
  assert.ok(!isChallengeValid(record, { now: 1_500 }), 'expired at the boundary')
  assert.ok(!isChallengeValid({ ...record, usedAt: 1_100 }, { now: 1_200 }), 'single-use')
  assert.ok(!isChallengeValid({ challenge: '', expiresAt: 9_999, usedAt: null, createdAt: 1 }), 'empty challenge invalid')
})

test('clientDataJSON is parsed and validated', () => {
  const text = JSON.stringify({ type: 'webauthn.get', challenge: 'abc', origin: 'https://app.example' })
  const parsed = parseClientData(text)
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.value, { type: 'webauthn.get', challenge: 'abc', origin: 'https://app.example' })
  assert.equal(validateClientData(parsed.value, { type: 'webauthn.get', challenge: 'abc' }).ok, true)
  assert.equal(validateClientData(parsed.value, { type: 'webauthn.create' }).error, 'Unexpected ceremony type')
  assert.equal(validateClientData(parsed.value, { challenge: 'zzz' }).error, 'Challenge mismatch')
  assert.equal(validateClientData(parsed.value, { origin: 'https://evil.example' }).error, 'Origin mismatch')
  assert.equal(parseClientData('not json').ok, false)
  assert.equal(parseClientData(JSON.stringify({ type: 'webauthn.get' })).ok, false, 'missing challenge rejected')
})

test('authenticatorData is parsed (assertion and registration shapes)', () => {
  const assertion = parseAuthenticatorData(authDataFixture())
  assert.equal(assertion.ok, true)
  assert.equal(assertion.value.counter, 7)
  assert.equal(assertion.value.flags.userPresent, true)
  assert.equal(assertion.value.flags.userVerified, true)
  assert.equal(assertion.value.flags.attestedCredentialData, false)
  assert.equal(assertion.value.credentialId, null)

  // Registration shape: flags AT + aaguid(16) + idLen(2) + id + COSE key.
  const credId = Buffer.from('1122334455', 'hex')
  const registration = Buffer.concat([
    authDataFixture({ flags: 0x45 }),
    Buffer.alloc(16),
    (() => {
      const len = Buffer.alloc(2)
      len.writeUInt16BE(credId.length)
      return len
    })(),
    credId,
    coseKey,
  ])
  const parsed = parseAuthenticatorData(registration.toString('base64url'))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.flags.attestedCredentialData, true)
  assert.deepEqual(Buffer.from(parsed.value.credentialId), credId)
  assert.deepEqual(Buffer.from(parsed.value.cosePublicKey), coseKey)
  assert.equal(parseAuthenticatorData('AAAA').ok, false, 'too-short data rejected')
})

test('COSE ES256 keys convert to SPKI and bad keys are rejected', () => {
  const converted = coseEs256ToSpki(coseKey)
  assert.equal(converted.ok, true)
  // The conversion must produce a key identical to the generated one.
  const roundTripped = createPublicKey({ key: converted.value, format: 'der', type: 'spki' })
  assert.deepEqual(roundTripped.export({ format: 'jwk' }), jwk)
  assert.equal(coseEs256ToSpki(Buffer.from('a101 02', 'hex').toString('base64url')).ok, false, 'missing coordinates')
  assert.equal(coseEs256ToSpki('not-cbor!!').ok, false)
  const rs256 = Buffer.concat([Buffer.from('a3', 'hex'), Buffer.from('0102', 'hex'), Buffer.from('03390100', 'hex'), Buffer.from('2001', 'hex')])
  assert.equal(coseEs256ToSpki(rs256).ok, false, 'non-ES256 algorithms rejected')
})

test('ES256 assertion signatures verify and tampering fails', () => {
  const authData = authDataFixture()
  const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge: 'abc', origin: 'https://app.example' })
  const message = Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()])
  const signature = cryptoSign('sha256', message, privateKey)
  const spki = coseEs256ToSpki(coseKey).value
  assert.ok(
    verifyAssertionSignature({
      authenticatorData: authData.toString('base64url'),
      clientDataJSON,
      signature: signature.toString('base64url'),
      publicKeySpkiDer: spki,
    }),
  )
  assert.ok(
    !verifyAssertionSignature({
      authenticatorData: authData.toString('base64url'),
      clientDataJSON: clientDataJSON.replace('abc', 'abd'),
      signature: signature.toString('base64url'),
      publicKeySpkiDer: spki,
    }),
    'tampered clientData fails',
  )
  assert.ok(
    !verifyAssertionSignature({
      authenticatorData: authData.toString('base64url'),
      clientDataJSON,
      signature: Buffer.alloc(64, 1).toString('base64url'),
      publicKeySpkiDer: spki,
    }),
    'garbage signature fails',
  )
  assert.equal(validateRpIdHash(Buffer.alloc(32, 0xab), 'example.test'), false, 'rpIdHash mismatch detected')
  assert.ok(validateRpIdHash(createHash('sha256').update('example.test').digest(), 'example.test'))
})
