// Avatar image validation (AV-108a). Pure; node builtins only.
//
// Safety model ("safe image validation"): bytes are TRUSTED ONLY AFTER
// sniffing — the client's Content-Type is ignored. Accepted: PNG, JPEG, GIF
// (decision recorded: WebP excluded to keep the dimension parsers minimal;
// these three render everywhere). Enforced: 512 KiB size cap, ≤4096px on both
// axes (dimension bombs rejected from the actual image headers), and a
// sanitized storage filename so a userId can never traverse paths.
//
// What this is NOT: a full decoder. Validation is header-level sniffing +
// dimension extraction; browsers decode only after the server serves the
// exact bytes it validated. Stored avatars are written as-is (no re-encode —
// no image-processing dependency), which is safe here because they are served
// back only as their sniffed image Content-Type (never text/html etc.).

const MAX_AVATAR_BYTES = 512 * 1024
const MAX_AVATAR_DIMENSION = 4096

function readU16BE(buf, offset) {
  return buf.readUInt16BE(offset)
}
function readU16LE(buf, offset) {
  return buf.readUInt16LE(offset)
}
function readU32BE(buf, offset) {
  return buf.readUInt32BE(offset)
}

function pngDimensions(buf) {
  // signature(8) + length(4) + 'IHDR'(4) then width/height u32be
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: readU32BE(buf, 16), height: readU32BE(buf, 20) }
}

function gifDimensions(buf) {
  if (buf.length < 10) return null
  return { width: readU16LE(buf, 6), height: readU16LE(buf, 8) }
}

function jpegDimensions(buf) {
  // Walk markers to a SOF0-SOF15 frame header (C0-CF except C4/C8/CC).
  let offset = 2
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null
    const marker = buf[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return null // reached scan data first
    const length = readU16BE(buf, offset + 2)
    if (length < 2) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: readU16BE(buf, offset + 5), width: readU16BE(buf, offset + 7) }
    }
    offset += 2 + length
  }
  return null
}

/**
 * Sniff + validate avatar bytes.
 * Returns { ok: true, mime, ext, width, height } or { ok: false, error }.
 */
export function validateAvatarImage(bytes, { maxBytes = MAX_AVATAR_BYTES, maxDimension = MAX_AVATAR_DIMENSION } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
  if (!buf.length) return { ok: false, error: 'The image is empty' }
  if (buf.length > maxBytes) return { ok: false, error: 'The image is larger than 512 KB' }

  let mime = null
  let ext = null
  let dimensions = null
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    mime = 'image/png'
    ext = 'png'
    dimensions = pngDimensions(buf)
  } else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    mime = 'image/jpeg'
    ext = 'jpg'
    dimensions = jpegDimensions(buf)
  } else if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF' && (buf.toString('ascii', 3, 6) === '87a' || buf.toString('ascii', 3, 6) === '89a')) {
    mime = 'image/gif'
    ext = 'gif'
    dimensions = gifDimensions(buf)
  } else {
    return { ok: false, error: 'Only PNG, JPEG, and GIF images are accepted' }
  }
  if (!dimensions || !(dimensions.width > 0) || !(dimensions.height > 0)) {
    return { ok: false, error: 'The image header is malformed' }
  }
  if (dimensions.width > maxDimension || dimensions.height > maxDimension) {
    return { ok: false, error: `Images may be at most ${maxDimension}×${maxDimension} pixels` }
  }
  return { ok: true, mime, ext, width: dimensions.width, height: dimensions.height }
}

/** Storage filename for a user's avatar — userId is sanitized against traversal. */
export function avatarFileName(userId, ext) {
  const safeId = String(userId ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  const safeExt = String(ext ?? '').replace(/[^a-z]/g, '')
  if (!safeId || !['png', 'jpg', 'gif'].includes(safeExt)) return null
  return `${safeId}.${safeExt}`
}

export const AVATAR_MAX_BYTES = MAX_AVATAR_BYTES
export const AVATAR_MAX_DIMENSION = MAX_AVATAR_DIMENSION
export const AVATAR_EXTENSIONS = ['png', 'jpg', 'gif']
