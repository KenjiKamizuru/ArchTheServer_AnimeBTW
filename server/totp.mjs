// TOTP (RFC 6238) over HMAC-SHA1 (RFC 4226), node:crypto only (AV-106a).
//
// Compatible with Google Authenticator / Aegis / 1Password etc. The shared
// secret lives server-side in the user record (inherent to TOTP — the server
// must be able to compute expected codes); it is revealed once to the user as
// an otpauth:// provisioning URI at enrollment. Default parameters are the
// interoperable defaults: 6 digits, 30-second step, SHA-1.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text) {
  const clean = String(text ?? '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  if (!clean || /[^A-Z2-7]/.test(clean)) return null
  let bits = 0
  let value = 0
  const out = []
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A fresh 160-bit (20-byte) shared secret as base32. */
export function generateTotpSecret() {
  return base32Encode(randomBytes(20))
}

function hotp(key, counter, digits) {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    (((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]) %
    10 ** digits
  return String(code).padStart(digits, '0')
}

/** The code for a base32 secret at `time` (seconds since epoch; default now). */
export function totpCode(secretBase32, { time = Math.floor(Date.now() / 1000), step = 30, digits = 6 } = {}) {
  const key = base32Decode(secretBase32)
  if (!key) return null
  return hotp(key, Math.floor(time / step), digits)
}

/** Constant-time code check with ±`window` steps of drift tolerance. */
export function verifyTotp(secretBase32, code, { time = Math.floor(Date.now() / 1000), step = 30, digits = 6, window = 1 } = {}) {
  const clean = String(code ?? '').replace(/\s+/g, '')
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return false
  const key = base32Decode(secretBase32)
  if (!key) return false
  const counter = Math.floor(time / step)
  const expected = Buffer.from(clean, 'ascii')
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = Buffer.from(hotp(key, counter + offset, digits), 'ascii')
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true
  }
  return false
}

/** otpauth:// provisioning URI for authenticator apps. */
export function otpauthUrl({ secretBase32, account, issuer = 'AnimeVault' }) {
  const label = encodeURIComponent(`${issuer}:${account ?? 'account'}`)
  const params = new URLSearchParams({
    secret: String(secretBase32 ?? ''),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
