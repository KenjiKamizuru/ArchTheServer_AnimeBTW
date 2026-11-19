// Tests for the passkey authentication flow (AV-105b): single-use challenges,
// registration (attestation 'none'), assertion + counter backstop, credential
// storage ownership. Real P-256 keys and real signatures throughout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as cryptoSign, createHash, randomBytes } from 'node:crypto'
import {
  issuePasskeyChallenge,
  registerPasskey,
  authenticatePasskey,
  listPasskeys,
  removePasskey,
} from '../server/passkeyAuth.mjs'

const RP_ID = 'example.test'
const ORIGIN = 'https://example.test'
const rpIdHash = createHash('sha256').update(RP_ID).digest()

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwk = publicKey.export({ format: 'jwk' })
const coseKey = Buffer.concat([
  Buffer.from('a50102 0326 2001 215820'.replace(/\s/g, ''), 'hex'),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from('225820', 'hex'),
  Buffer.from(jwk.y, 'base64url'),
])

// --- Tiny CBOR encoder (ints, text, bytes, maps) for the attestationObject. ---
function cborHead(major, argument) {
  if (argument < 24) return Buffer.from([(major << 5) | argument])
  if (argument < 256) return Buffer.from([(major << 5) | 24, argument])
  const head = Buffer.alloc(3)
  head[0] = (major << 5) | 25
  head.writeUInt16BE(argument, 1)
  return head
}
function cborEncode(value) {
  if (typeof value === 'number') {
    if (value >= 0) return cborHead(0, value)
    return cborHead(1, -1 - value)
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8')
    return Buffer.concat([cborHead(3, bytes.length), bytes])
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value])
  if (value instanceof Map) {
    const parts = [cborHead(5, value.size)]
    for (const [key, entry] of value) {
      parts.push(cborEncode(key), cborEncode(entry))
    }
    return Buffer.concat(parts)
  }
  throw new Error('unsupported CBOR value')
}

function makeKv() {
  const data = new Map()
  return {
    data,
    get: async (key, fallback = null) => (data.has(key) ? data.get(key) : fallback),
    set: async (key, value) => {
      data.set(key, value)
    },
    remove: async (key) => {
      data.delete(key)
    },
    list: async (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix)),
  }
}

function attestationAuthData({ counter = 5, flags = 0x41, credentialId = randomBytes(16) } = {}) {
  const counterBuf = Buffer.alloc(4)
  counterBuf.writeUInt32BE(counter)
  return {
    credentialId,
    authData: Buffer.concat([
      rpIdHash,
      Buffer.from([flags]),
      counterBuf,
      Buffer.alloc(16), // aaguid
      (() => {
        const len = Buffer.alloc(2)
        len.writeUInt16BE(credentialId.length)
        return len
      })(),
      credentialId,
      coseKey,
    ]),
  }
}

function assertionAuthData({ counter = 6, flags = 0x05, hash = rpIdHash } = {}) {
  const counterBuf = Buffer.alloc(4)
  counterBuf.writeUInt32BE(counter)
  return Buffer.concat([hash, Buffer.from([flags]), counterBuf])
}

function attestationObject(authData) {
  return cborEncode(
    new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]),
  )
}

function clientData(type, challenge) {
  return JSON.stringify({ type, challenge, origin: ORIGIN })
}

function signAssertion(authData, clientDataJSON) {
  const message = Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()])
  return cryptoSign('sha256', message, privateKey)
}

async function register(kvs, { now = 1_000, userId = 'u1', counter = 5, flags = 0x41, name = 'My laptop' } = {}) {
  const { challenge } = await issuePasskeyChallenge('register', { kv: kvs, userId, now })
  const att = attestationAuthData({ counter, flags })
  const result = await registerPasskey(
    {
      userId,
      credentialName: name,
      clientDataJSON: clientData('webauthn.create', challenge),
      attestationObject: attestationObject(att.authData),
    },
    { kv: kvs, rpId: RP_ID, origin: ORIGIN, now },
  )
  return { ...result, credentialId: att.credentialId.toString('base64url'), authData: att.authData }
}

test('passkey register + authenticate round trip with a real P-256 key', async () => {
  const kv = makeKv()
  const registered = await register(kv, { now: 1_000 })
  assert.equal(registered.credential.name, 'My laptop')
  assert.equal(registered.credential.counter, 5)

  const { challenge } = await issuePasskeyChallenge('authenticate', { kv, now: 2_000 })
  const authData = assertionAuthData({ counter: 6 })
  const clientDataJSON = clientData('webauthn.get', challenge)
  const signature = signAssertion(authData, clientDataJSON)
  const result = await authenticatePasskey(
    {
      credentialId: registered.credentialId,
      clientDataJSON,
      authenticatorData: authData.toString('base64url'),
      signature: signature.toString('base64url'),
    },
    { kv, rpId: RP_ID, origin: ORIGIN, now: 2_500 },
  )
  assert.equal(result.userId, 'u1')
  assert.equal(result.credential.counter, 6, 'counter advanced')

  // Replay of the same assertion is rejected by the counter backstop.
  const replayChallenge = await issuePasskeyChallenge('authenticate', { kv, now: 3_000 })
  const replayData = clientData('webauthn.get', replayChallenge.challenge)
  await assert.rejects(
    authenticatePasskey(
      {
        credentialId: registered.credentialId,
        clientDataJSON: replayData,
        authenticatorData: authData.toString('base64url'),
        signature: signAssertion(authData, replayData).toString('base64url'),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: 3_500 },
    ),
    /authentication failed/i,
    'assertion replay must be rejected',
  )
})

test('challenges are single-use, purpose-bound, and expire', async () => {
  const kv = makeKv()
  const { challenge } = await issuePasskeyChallenge('register', { kv, userId: 'u1', now: 1_000 })
  const att = attestationAuthData({})
  const body = {
    userId: 'u1',
    clientDataJSON: clientData('webauthn.create', challenge),
    attestationObject: attestationObject(att.authData),
  }
  // Wrong ceremony type (authenticate ceremony against a register challenge):
  // rejected, and the challenge is consumed even on failure.
  await assert.rejects(
    registerPasskey({ ...body, clientDataJSON: clientData('webauthn.get', challenge) }, { kv, rpId: RP_ID, origin: ORIGIN, now: 1_500 }),
    /ceremony type/i,
    'wrong ceremony type still consumes and rejects',
  )
  // Single-use: the same challenge cannot be consumed again.
  await assert.rejects(registerPasskey(body, { kv, rpId: RP_ID, origin: ORIGIN, now: 1_500 }), /challenge is invalid/i)
  // Expiry (2-minute TTL).
  const fresh = await issuePasskeyChallenge('register', { kv, userId: 'u1', now: 10_000 })
  await assert.rejects(
    registerPasskey(
      {
        userId: 'u1',
        clientDataJSON: clientData('webauthn.create', fresh.challenge),
        attestationObject: attestationObject(attestationAuthData({}).authData),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: 10_000 + 3 * 60 * 1000 },
    ),
    /challenge is invalid/i,
  )
})

test('registration rejects foreign rpId, wrong origin, duplicates, and bad attestation', async () => {
  const kv = makeKv()
  // Foreign rpIdHash.
  const foreign = await issuePasskeyChallenge('register', { kv, userId: 'u1', now: 1_000 })
  await assert.rejects(
    registerPasskey(
      {
        userId: 'u1',
        clientDataJSON: clientData('webauthn.create', foreign.challenge),
        attestationObject: attestationObject(assertionAuthData({ hash: Buffer.alloc(32, 7) })),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: 1_100 },
    ),
    /different site/,
  )
  // Wrong origin.
  const wrongOrigin = await issuePasskeyChallenge('register', { kv, userId: 'u1', now: 2_000 })
  await assert.rejects(
    registerPasskey(
      {
        userId: 'u1',
        clientDataJSON: JSON.stringify({ type: 'webauthn.create', challenge: wrongOrigin.challenge, origin: 'https://evil.test' }),
        attestationObject: attestationObject(attestationAuthData({}).authData),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: 2_100 },
    ),
    /origin/i,
  )
  // Duplicate credential registration.
  const registered = await register(kv, { now: 3_000 })
  const dup = await issuePasskeyChallenge('register', { kv, userId: 'u1', now: 4_000 })
  await assert.rejects(
    registerPasskey(
      {
        userId: 'u1',
        clientDataJSON: clientData('webauthn.create', dup.challenge),
        attestationObject: attestationObject(registered.authData),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: 4_100 },
    ),
    /already registered/,
  )
  // Non-'none' attestation formats are refused (scope decision).
  const packed = await issuePasskeyChallenge('register', { kv, userId: 'u1', now: 5_000 })
  await assert.rejects(
    registerPasskey(
      {
        userId: 'u1',
        clientDataJSON: clientData('webauthn.create', packed.challenge),
        attestationObject: cborEncode(
          new Map([
            ['fmt', 'packed'],
            ['attStmt', new Map()],
            ['authData', attestationAuthData({}).authData],
          ]),
        ),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: 5_100 },
    ),
    /'none' attestation/,
  )
})

test('counter backstop: strict except the 0→0 no-counter authenticators', async () => {
  const kv = makeKv()
  // A 0-counter platform authenticator: 0→0 assertions are accepted twice.
  const zero = await register(kv, { now: 1_000, counter: 0, flags: 0x41 })
  for (const at of [2_000, 3_000]) {
    const { challenge } = await issuePasskeyChallenge('authenticate', { kv, now: at })
    const authData = assertionAuthData({ counter: 0 })
    const clientDataJSON = clientData('webauthn.get', challenge)
    const result = await authenticatePasskey(
      {
        credentialId: zero.credentialId,
        clientDataJSON,
        authenticatorData: authData.toString('base64url'),
        signature: signAssertion(authData, clientDataJSON).toString('base64url'),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: at + 100 },
    )
    assert.equal(result.userId, 'u1')
  }
  // A non-increasing counter on a counting authenticator is rejected.
  const counting = await register(kv, { now: 5_000, counter: 5 })
  const { challenge } = await issuePasskeyChallenge('authenticate', { kv, now: 6_000 })
  const stale = assertionAuthData({ counter: 5 })
  const staleClient = clientData('webauthn.get', challenge)
  await assert.rejects(
    authenticatePasskey(
      {
        credentialId: counting.credentialId,
        clientDataJSON: staleClient,
        authenticatorData: stale.toString('base64url'),
        signature: signAssertion(stale, staleClient).toString('base64url'),
      },
      { kv, rpId: RP_ID, origin: ORIGIN, now: 6_100 },
    ),
    /authentication failed/i,
  )
})

test('credential listing and removal are owner-scoped', async () => {
  const kv = makeKv()
  const registered = await register(kv, { now: 1_000, userId: 'u1' })
  await register(kv, { now: 2_000, userId: 'u2', name: 'Other user key' })

  const mine = await listPasskeys('u1', { kv })
  assert.equal(mine.length, 1)
  assert.equal(mine[0].name, 'My laptop')
  assert.deepEqual(Object.keys(mine[0]).sort(), ['counter', 'createdAt', 'credentialId', 'lastUsedAt', 'name'])

  await assert.rejects(removePasskey('u2', registered.credentialId, { kv }), /not found/i, 'cannot remove a foreign passkey')
  await removePasskey('u1', registered.credentialId, { kv })
  assert.deepEqual(await listPasskeys('u1', { kv }), [])
})
