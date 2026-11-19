// Tests for avatar image validation (AV-108a): header sniffing over real
// minimal PNG/JPEG/GIF fixtures, size/dimension caps, and filename safety.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateAvatarImage,
  avatarFileName,
  AVATAR_MAX_BYTES,
  AVATAR_MAX_DIMENSION,
} from '../server/avatars.mjs'

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngImage({ width = 16, height = 16 } = {}) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex')
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type
  const makeChunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
    return Buffer.concat([len, typeBuf, data, crc])
  }
  return Buffer.concat([signature, makeChunk('IHDR', ihdrData), makeChunk('IEND', Buffer.alloc(0))])
}

function gifImage({ width = 32, height = 24 } = {}) {
  const header = Buffer.alloc(13)
  header.write('GIF89a', 0, 'ascii')
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  return Buffer.concat([header, Buffer.from('01000000003b', 'hex')])
}

function jpegImage({ width = 20, height = 10 } = {}) {
  const sof = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 1 + 3)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(sof.length - 2, 2)
  sof[4] = 8 // precision
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 1 // components
  return Buffer.concat([
    Buffer.from('ffd8', 'hex'), // SOI
    Buffer.from('ffe000104a46494600010100000100010000', 'hex'), // APP0/JFIF
    sof,
    Buffer.from('ffd9', 'hex'), // EOI
  ])
}

test('valid PNG/JPEG/GIF avatars are sniffed with their real dimensions', () => {
  const png = validateAvatarImage(pngImage({ width: 64, height: 48 }))
  assert.deepEqual(png, { ok: true, mime: 'image/png', ext: 'png', width: 64, height: 48 })
  const jpeg = validateAvatarImage(jpegImage({ width: 20, height: 10 }))
  assert.deepEqual(jpeg, { ok: true, mime: 'image/jpeg', ext: 'jpg', width: 20, height: 10 })
  const gif = validateAvatarImage(gifImage({ width: 32, height: 24 }))
  assert.deepEqual(gif, { ok: true, mime: 'image/gif', ext: 'gif', width: 32, height: 24 })
})

test('unsafe images are rejected: wrong types, malformed headers, bombs', () => {
  // Non-image content never passes — regardless of what a client claims.
  for (const bytes of [
    Buffer.from('<html><script>alert(1)</script></html>'),
    Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from('GIF89a but then garbage that is way too short'),
    Buffer.alloc(0),
  ]) {
    assert.equal(validateAvatarImage(bytes).ok, false, JSON.stringify(bytes.slice(0, 12)))
  }
  // Magic-byte mismatch: PNG signature then a truncated header.
  assert.equal(validateAvatarImage(Buffer.from('89504e470d0a1a0a0000', 'hex')).ok, false, 'truncated PNG header')
  // Size cap.
  const oversize = Buffer.concat([pngImage(), Buffer.alloc(AVATAR_MAX_BYTES)])
  const sizeResult = validateAvatarImage(oversize)
  assert.equal(sizeResult.ok, false)
  assert.match(sizeResult.error, /larger than/)
  // Dimension bombs from the real headers.
  const bomb = validateAvatarImage(pngImage({ width: 10000, height: 10000 }))
  assert.equal(bomb.ok, false)
  assert.match(bomb.error, new RegExp(String(AVATAR_MAX_DIMENSION)))
  assert.equal(validateAvatarImage(gifImage({ width: 1, height: 65535 })).ok, false, 'GIF height bomb')
  assert.equal(validateAvatarImage(jpegImage({ width: 4097, height: 1 })).ok, false, 'JPEG width bomb')
  // A zero-dimension header is malformed.
  assert.equal(validateAvatarImage(pngImage({ width: 0, height: 10 })).ok, false)
})

test('storage filenames cannot traverse paths', () => {
  assert.equal(avatarFileName('u_abc123', 'png'), 'u_abc123.png')
  assert.equal(avatarFileName('../../etc/passwd', 'png'), 'etcpasswd.png')
  assert.equal(avatarFileName('u_abc/123', 'jpg'), 'u_abc123.jpg')
  assert.equal(avatarFileName('u_abc', 'html'), null, 'unknown extensions are refused')
  assert.equal(avatarFileName('', 'png'), null)
  assert.equal(avatarFileName('u_abc', '../../x'), null)
})
