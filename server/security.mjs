// Path-traversal, SSRF, header-sanitization, and container/DRM validation helpers.

import dns from 'node:dns/promises'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

let atomicWriteSeq = 0

export const RESERVED_OBJECT_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  '__definegetter__',
  '__definesetter__',
  '__lookupgetter__',
  '__lookupsetter__',
  'hasownproperty',
  'isprototypeof',
  'propertyisenumerable',
  'tolocalestring',
  'tostring',
  'valueof',
])

export function isSafeObjectKey(key) {
  if (typeof key !== 'string' || !key) return false
  return !RESERVED_OBJECT_KEYS.has(key.toLowerCase())
}

/**
 * Atomically writes a private application data file (`0o600` inside a `0o700`
 * parent dir) using a unique per-write temp filename so concurrent saves can
 * never collide or leave truncated JSON on crash.
 */
export async function atomicWriteFile(filePath, content, { dirMode = 0o700, fileMode = 0o600 } = {}) {
  const dir = path.dirname(filePath)
  await fsp.mkdir(dir, { recursive: true, mode: dirMode })
  atomicWriteSeq = (atomicWriteSeq + 1) % 1_000_000_000
  const tmp = `${filePath}.${process.pid}.${atomicWriteSeq}.tmp`
  try {
    await fsp.writeFile(tmp, content, { mode: fileMode })
    await fsp.rename(tmp, filePath)
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Strips absolute local filesystem paths from unexpected error messages so API
 * responses never disclose server directory structure.
 */
export function sanitizeErrorMessage(raw, fallback = 'Server error') {
  const msg = String(raw ?? '').trim()
  if (!msg) return fallback
  const scrubbed = msg
    .replace(/(?:\/[A-Za-z0-9._@-]+){2,}/g, '[path]')
    .replace(/[A-Za-z]:\\(?:[^\s"'<>|*?\\]+\\?)+/g, '[path]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  return scrubbed.slice(0, 400) || fallback
}

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

const PROTECTED_REPO_DIRS = new Set([
  'src',
  'server',
  'scripts',
  'dist',
  'node_modules',
  '.git',
  '.github',
  'data',
  'public',
])

const PROTECTED_SYSTEM_PREFIXES = [
  '/bin',
  '/sbin',
  '/usr',
  '/lib',
  '/lib64',
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/root',
  '/run',
  '/var/run',
  '/var/log',
  '/var/lib',
  '/var/spool',
  '/var/mail',
  '/private/etc',
  '/private/var/run',
  '/private/var/db',
  '/System',
  '/Library',
]

const PROTECTED_HOME_DIRS = ['.ssh', '.gnupg', '.aws', '.kube', '.config', '.local/share/keyrings']

// Default authorized media domains (built-in provider + common authorized CDNs).
// Administrators can extend this list via settings or ALLOWED_SOURCE_HOSTS.
export const DEFAULT_APPROVED_HOSTS = [
  'hianime.at',
  '*.hianime.at',
  'zokoanime.video',
  '*.zokoanime.video',
  'zokoanime.com',
  '*.zokoanime.com',
  'megacloud.tv',
  '*.megacloud.tv',
  'megacloud.blog',
  '*.megacloud.blog',
  'rapid-cloud.co',
  '*.rapid-cloud.co',
  'vidcloud.co',
  '*.vidcloud.co',
  'netmagcdn.com',
  '*.netmagcdn.com',
  'sunshinerays.online',
  '*.sunshinerays.online',
  'haildrop77.pro',
  '*.haildrop77.pro',
  'archive.org',
  '*.archive.org',
]

const PERMITTED_EXTERNAL_HEADERS = new Map([
  ['referer', 'Referer'],
  ['origin', 'Origin'],
  ['user-agent', 'User-Agent'],
  ['accept', 'Accept'],
  ['accept-language', 'Accept-Language'],
])

const DRM_KEYFORMAT_PATTERNS = [
  { re: /edef8ba9-79d6-4ace-a3c8-27dcd51d21ed/i, name: 'Widevine' },
  { re: /com\.apple\.streamingkeydelivery/i, name: 'FairPlay' },
  { re: /9a04f079-9840-4286-ab92-e65be0885f95|com\.microsoft\.playready/i, name: 'PlayReady' },
  { re: /1077efec-c0b2-4d02-ace3-3c1e52e2fb4b|org\.w3\.clearkey/i, name: 'ClearKey' },
  { re: /f239e769-efa3-4850-9c16-a903c6932efb/i, name: 'Adobe PrimeTime' },
]

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

/** Sanitizes a single folder or filename stem so it cannot traverse directories. */
export function sanitizeFileSegment(raw, fallback = 'Untitled', maxLen = 96) {
  let value = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[/\\]+/g, ' ')
    .replace(/[<>"|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')

  if (value.length > maxLen) {
    value = value.slice(0, maxLen).replace(/[.\s-]+$/g, '')
  }
  if (!value || value === '.' || value === '..' || WINDOWS_RESERVED.test(value)) {
    return fallback
  }
  return value
}

/** Sanitizes a filename while keeping a safe, known lowercase extension. */
export function sanitizeFileName(rawName, allowedExtensions, fallbackStem = 'video') {
  const raw = String(rawName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const base = path.posix.basename(raw.replace(/\\/g, '/'))
  const ext = path.posix.extname(base).toLowerCase()
  if (!ext || (allowedExtensions && !allowedExtensions.has(ext))) {
    throw httpError(`Unsupported file extension "${ext || '(none)'}"`, 400)
  }
  const stem = sanitizeFileSegment(base.slice(0, base.length - ext.length), fallbackStem, 110)
  return `${stem}${ext}`
}

function isSameOrInside(target, container) {
  const rel = path.relative(container, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function isSameOrInsideCaseInsensitive(target, container) {
  const rel = path.relative(container.toLowerCase(), target.toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function assertSafeResolvedLibraryPath(candidate, repoRoot) {
  if (candidate === path.parse(candidate).root) {
    throw httpError('Library path cannot be the filesystem root', 400)
  }
  if (isSameOrInside(repoRoot, candidate) || isSameOrInsideCaseInsensitive(repoRoot, candidate)) {
    throw httpError('Library path cannot be the project root or a parent of it', 400)
  }

  // Block all source-code, build, dependency, git, and app-state directories
  // (including case variations on macOS/Windows/case-insensitive filesystems).
  for (const dir of PROTECTED_REPO_DIRS) {
    const protectedPath = path.join(repoRoot, dir)
    if (
      isSameOrInside(candidate, protectedPath) ||
      isSameOrInside(protectedPath, candidate) ||
      isSameOrInsideCaseInsensitive(candidate, protectedPath) ||
      isSameOrInsideCaseInsensitive(protectedPath, candidate)
    ) {
      throw httpError(`Library path cannot be inside the project's "${dir}" directory`, 400)
    }
  }

  // Block hidden dot-directories directly inside the repository (e.g. .vscode, .env).
  if (isSameOrInside(candidate, repoRoot)) {
    const segments = path.relative(repoRoot, candidate).split(path.sep)
    if (segments.some((seg) => seg.startsWith('.'))) {
      throw httpError('Library path inside the project cannot contain hidden dot-directories', 400)
    }
  }

  // Block sensitive credential directories inside the user's home folder.
  const home = path.resolve(os.homedir())
  if (candidate === home) {
    throw httpError('Library path cannot be the home directory root itself; choose a subfolder', 400)
  }
  for (const rel of PROTECTED_HOME_DIRS) {
    const protectedHome = path.join(home, rel)
    if (isSameOrInside(candidate, protectedHome) || isSameOrInside(protectedHome, candidate)) {
      throw httpError(`Library path cannot be inside protected directory "~/${rel}"`, 400)
    }
  }

  // Block critical Unix/macOS OS system directories.
  if (process.platform !== 'win32') {
    for (const prefix of PROTECTED_SYSTEM_PREFIXES) {
      if (candidate === prefix || candidate.startsWith(`${prefix}/`)) {
        throw httpError(`Library path cannot be inside system directory "${prefix}"`, 400)
      }
    }
  }
}

/**
 * Resolves and validates a configured library directory so downloaded media can
 * never be placed inside source-code, repository metadata, credential, or OS
 * directories — including via symlinked paths.
 */
export function validateLibraryDir(rawDir, rootDir) {
  const input = String(rawDir ?? '').trim()
  if (!input) throw httpError('Library path cannot be empty', 400)
  if (/[\u0000-\u001f\u007f]/.test(input)) throw httpError('Library path contains invalid characters', 400)

  const repoRoot = path.resolve(rootDir)
  let realRepoRoot = repoRoot
  try {
    realRepoRoot = fs.realpathSync(repoRoot)
  } catch {
    /* keep resolved */
  }

  const expanded =
    input === '~'
      ? os.homedir()
      : input.startsWith('~/') || input.startsWith('~\\')
        ? path.join(os.homedir(), input.slice(2))
        : input
  const resolved = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(repoRoot, expanded)

  assertSafeResolvedLibraryPath(resolved, repoRoot)

  // Reject if the target path itself is a symlink, and resolve the deepest
  // existing ancestor with realpathSync to prevent symlink-escape attacks.
  try {
    const st = fs.lstatSync(resolved)
    if (st.isSymbolicLink()) {
      throw httpError('Library path cannot be a symbolic link', 400)
    }
    if (!st.isDirectory()) {
      throw httpError('Library path must be a directory, not a file', 400)
    }
  } catch (err) {
    if (err?.status) throw err
    if (err?.code && err.code !== 'ENOENT') throw err
  }

  let probe = resolved
  const trailing = []
  while (true) {
    try {
      const st = fs.lstatSync(probe)
      if (st.isSymbolicLink()) {
        throw httpError('Library path cannot traverse a symbolic link', 400)
      }
      const realProbe = fs.realpathSync(probe)
      const canonicalTarget = trailing.length > 0 ? path.join(realProbe, ...trailing.reverse()) : realProbe
      assertSafeResolvedLibraryPath(canonicalTarget, realRepoRoot)
      break
    } catch (err) {
      if (err?.status) throw err
      const parent = path.dirname(probe)
      if (parent === probe) break
      trailing.push(path.basename(probe))
      probe = parent
    }
  }

  return resolved
}

/**
 * Resolves a relative POSIX/OS path strictly inside `libraryDir`, rejecting any
 * traversal (`..`), null bytes, absolute paths, or hidden dot-segments.
 */
export function resolveInsideLibrary(libraryDir, relPath, { allowIncomplete = false } = {}) {
  const raw = String(relPath ?? '')
  if (!raw || raw.includes('\0')) {
    throw httpError('Invalid library path', 400)
  }
  const normalizedInput = raw.replace(/\\/g, '/')
  if (normalizedInput.startsWith('/')) {
    throw httpError('Absolute paths are not permitted', 400)
  }
  const parts = normalizedInput.split('/').filter(Boolean)
  if (parts.length === 0) throw httpError('Invalid library path', 400)

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '.' || part === '..') {
      throw httpError('Path traversal is not permitted', 400)
    }
    if (part.startsWith('.')) {
      if (allowIncomplete && i === 0 && part === '.incomplete') continue
      throw httpError('Hidden library paths are not permitted', 400)
    }
  }

  const root = path.resolve(libraryDir)
  const target = path.resolve(root, ...parts)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw httpError('Path escapes library directory', 400)
  }
  return { absPath: target, relPosix: parts.join('/') }
}

/**
 * Verifies an existing file is a regular non-symlink file whose canonical
 * `realpath` resides strictly inside `libraryDir` (and outside `.incomplete`).
 */
export async function verifyRegularLibraryFile(libraryDir, absPath) {
  let stat
  try {
    stat = await fsp.lstat(absPath)
  } catch {
    return null
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return null

  let realLib
  let realFile
  try {
    realLib = await fsp.realpath(libraryDir)
    realFile = await fsp.realpath(absPath)
  } catch {
    return null
  }

  const rel = path.relative(realLib, realFile)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  const segments = rel.split(path.sep)
  if (segments.some((seg) => seg.startsWith('.'))) return null

  return { realPath: realFile, size: stat.size, mtimeMs: stat.mtimeMs }
}

/**
 * Verifies every existing ancestor directory of `absPath` inside `libraryDir`
 * is a real directory (not a symlink escaping the library).
 */
export async function ensureSafeLibraryParentDir(libraryDir, absPath) {
  const root = path.resolve(libraryDir)
  await fsp.mkdir(root, { recursive: true })
  const rootStat = await fsp.lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw httpError('Library directory cannot be a symlink', 400)
  }
  const realLib = await fsp.realpath(root)

  const parentDir = path.dirname(path.resolve(absPath))
  const rel = path.relative(root, parentDir)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw httpError('Target directory escapes library', 400)
  }

  let current = root
  for (const segment of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const st = await fsp.lstat(current)
      if (st.isSymbolicLink() || !st.isDirectory()) {
        throw httpError('Refusing to follow symlink inside library directory', 400)
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
      await fsp.mkdir(current)
    }
  }

  const realParent = await fsp.realpath(parentDir)
  if (!isSameOrInside(realParent, realLib)) {
    throw httpError('Target directory resolves outside library', 400)
  }
  return realParent
}

function parseIpv4Octets(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return nums
}

function isPrivateIpv4Octets([a, b, c]) {
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8 RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 RFC 1918
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true // 192.88.99.0/24 6to4 relay
  if (a === 192 && b === 168) return true // 192.168.0.0/16 RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  return false
}

function expandIpv6Hextets(raw) {
  // Strip IPv6 zone id if present (%eth0).
  const clean = raw.split('%')[0].toLowerCase()
  let working = clean
  // Normalize trailing dotted IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  const lastColon = working.lastIndexOf(':')
  if (lastColon >= 0 && working.slice(lastColon + 1).includes('.')) {
    const octets = parseIpv4Octets(working.slice(lastColon + 1))
    if (!octets) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`
  }

  const halves = working.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - (left.length + right.length)
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null

  const full = [...left, ...Array(missing).fill('0'), ...right]
  if (full.length !== 8) return null
  const nums = full.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? Number.parseInt(h, 16) : NaN))
  if (nums.some((n) => Number.isNaN(n))) return null
  return nums
}

/** Returns true when an IPv4 or IPv6 literal belongs to any non-public range. */
export function isPrivateOrReservedIp(rawIp) {
  const ip = String(rawIp ?? '').replace(/^\[|\]$/g, '').trim()
  const baseIp = ip.split('%')[0]
  const version = net.isIP(baseIp)
  if (version === 4) {
    const octets = parseIpv4Octets(baseIp)
    return !octets || isPrivateIpv4Octets(octets)
  }
  if (version === 6) {
    if (ip.includes('%')) return true // scoped link-local
    const h = expandIpv6Hextets(baseIp)
    if (!h) return true
    const allZeroPrefix = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0
    // :: (unspecified) and ::1 (loopback) and IPv4-compatible ::w.x.y.z
    if (allZeroPrefix && h[5] === 0) {
      if (h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true
      return isPrivateIpv4Octets([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff])
    }
    // IPv4-mapped ::ffff:w.x.y.z
    if (allZeroPrefix && h[5] === 0xffff) {
      return isPrivateIpv4Octets([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff])
    }
    // IPv4-translated SIIT ::ffff:0:w.x.y.z (RFC 2765)
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
      return isPrivateIpv4Octets([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff])
    }
    // NAT64 64:ff9b::/96 and local-use 64:ff9b:1::/48
    if (h[0] === 0x0064 && h[1] === 0xff9b) {
      if (h[2] === 0x0001) return true
      return isPrivateIpv4Octets([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff])
    }
    // 6to4 2002::/16 embeds IPv4 in h[1], h[2]
    if (h[0] === 0x2002) {
      return isPrivateIpv4Octets([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff])
    }
    // Discard-only 100::/64
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true
    // IETF special-purpose 2001::/23 (Teredo, Benchmarking 2001:2::/48, ORCHID) & Documentation 2001:db8::/32
    if (h[0] === 0x2001 && (h[1] < 0x0200 || h[1] === 0x0db8)) return true
    // Deprecated 6bone 3ffe::/16 & Documentation 3fff::/20 (RFC 9637)
    if (h[0] === 0x3ffe || (h[0] === 0x3fff && (h[1] & 0xf000) === 0)) return true
    // Unique local fc00::/7
    if ((h[0] & 0xfe00) === 0xfc00) return true
    // Link-local fe80::/10
    if ((h[0] & 0xffc0) === 0xfe80) return true
    // Multicast ff00::/8
    if ((h[0] & 0xff00) === 0xff00) return true
    return false
  }
  return true
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.localdomain') ||
    host.endsWith('.internal') ||
    host.endsWith('.intranet') ||
    host.endsWith('.private') ||
    host.endsWith('.corp') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.lan') ||
    host.endsWith('.svc.cluster.local') ||
    host === 'kubernetes.default' ||
    host === 'kubernetes.default.svc' ||
    host === 'metadata' ||
    host === 'metadata.google.internal' ||
    host === 'metadata.azure.com' ||
    host === 'instance-data'
  ) {
    return true
  }
  return false
}

/**
 * Validates and normalizes an external hyperlink URL (rejects `javascript:`,
 * `data:`, `file:`, credentials, and private/internal hosts). Returns `null` if unsafe.
 */
export function sanitizePublicHttpUrl(rawUrl, { httpsOnly = false, maxLen = 1024 } = {}) {
  const str = String(rawUrl ?? '').trim()
  if (!str || str.length > maxLen || /[\u0000-\u001f\u007f]/.test(str)) return null
  let parsed
  try {
    parsed = new URL(str)
  } catch {
    return null
  }
  if (httpsOnly ? parsed.protocol !== 'https:' : parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  if (parsed.username || parsed.password) return null
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || isBlockedHostname(host)) return null
  if (net.isIP(host) !== 0 && isPrivateOrReservedIp(host)) return null
  return parsed.href
}

/**
 * Validates a cover/banner/thumbnail URL stored in bookmarks, downloads, or the
 * library catalog. Accepts only public `https://` URLs or opaque `/api/artwork/` IDs
 * so stored entries cannot trigger `javascript:` XSS or LAN `http://` CSRF beacons.
 */
export function sanitizeCoverUrl(rawUrl, maxLen = 500) {
  const str = String(rawUrl ?? '').trim()
  if (!str || str.length > maxLen) return null
  if (/^\/api\/artwork\/art_[0-9a-f]{20}(?:\?v=\d{1,16})?$/.test(str)) {
    return str
  }
  return sanitizePublicHttpUrl(str, { httpsOnly: true, maxLen })
}

/**
 * Reads an HTTP `fetch` Response body into a Buffer while strictly enforcing
 * `maxBytes` even when `Content-Length` is omitted or spoofed.
 */
export async function readResponseBufferLimited(res, maxBytes, label = 'Remote response') {
  const declared = Number(res.headers?.get?.('content-length') || 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel?.().catch(() => {})
    throw httpError(`${label} exceeds maximum allowed size`, 413)
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const ab = await res.arrayBuffer()
    if (ab.byteLength > maxBytes) {
      throw httpError(`${label} exceeds maximum allowed size`, 413)
    }
    return Buffer.from(ab)
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw httpError(`${label} exceeds maximum allowed size`, 413)
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
  } catch (err) {
    await reader.cancel().catch(() => {})
    throw err
  }
  return Buffer.concat(chunks)
}

/** Stream-reads a UTF-8 response body with a strict hard byte limit. */
export async function readResponseTextLimited(res, maxBytes, label = 'Remote response') {
  const buf = await readResponseBufferLimited(res, maxBytes, label)
  return buf.toString('utf8')
}

/** Normalizes and validates a list of host allowlist entries (`example.com`, `*.example.com`, or `*`). */
export function normalizeHostPatternList(rawList) {
  const items = Array.isArray(rawList)
    ? rawList
    : String(rawList ?? '')
        .split(/[\s,]+/)
        .filter(Boolean)

  const out = []
  const seen = new Set()
  for (const raw of items) {
    let entry = String(raw ?? '').trim().toLowerCase()
    if (!entry) continue
    if (entry === '*') {
      if (!seen.has('*')) {
        seen.add('*')
        out.push('*')
      }
      continue
    }
    // Accept full URLs pasted by convenience and extract just their hostname.
    if (/^https?:\/\//i.test(entry)) {
      try {
        entry = new URL(entry).hostname.toLowerCase()
      } catch {
        throw httpError(`Invalid approved host entry "${raw}"`, 400)
      }
    }
    const wildcard = entry.startsWith('*.')
    const host = (wildcard ? entry.slice(2) : entry).replace(/\.$/, '')
    if (
      !host ||
      host.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
    ) {
      throw httpError(`Invalid approved host pattern "${raw}"`, 400)
    }
    if (isBlockedHostname(host) || net.isIP(host) !== 0) {
      throw httpError(`Private or IP literal host "${raw}" cannot be added to approved hosts`, 400)
    }
    const normalized = wildcard ? `*.${host}` : host
    if (!seen.has(normalized)) {
      seen.add(normalized)
      out.push(normalized)
    }
    if (out.length >= 200) break
  }
  return out
}

export function getEnvApprovedHosts() {
  const raw = String(process.env.ALLOWED_SOURCE_HOSTS ?? '').trim()
  if (!raw) return []
  try {
    return normalizeHostPatternList(raw)
  } catch {
    return []
  }
}

export function isHostApproved(hostname, extraApprovedHosts = []) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || isBlockedHostname(host)) return false
  if (net.isIP(host) !== 0 && isPrivateOrReservedIp(host)) return false

  const patterns = [...DEFAULT_APPROVED_HOSTS, ...getEnvApprovedHosts(), ...extraApprovedHosts]
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern ?? '').trim().toLowerCase()
    if (!pattern) continue
    if (pattern === '*') return net.isIP(host) === 0 || !isPrivateOrReservedIp(host)
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // ".example.com"
      if (host.endsWith(suffix) && host.length > suffix.length) return true
    } else if (host === pattern) {
      return true
    }
  }
  return false
}

/**
 * Validates a remote media URL against scheme restrictions, credential abuse,
 * optional source-host allowlisting, and DNS-resolved SSRF checks.
 */
export async function validateRemoteUrl(
  rawUrl,
  {
    requireApprovedHost = false,
    extraApprovedHosts = [],
    dnsLookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
  } = {},
) {
  const str = String(rawUrl ?? '').trim()
  if (!str) throw httpError('A source URL is required', 400)
  if (str.length > 4096 || /[\u0000-\u001f\u007f]/.test(str) || str.startsWith('-')) {
    throw httpError('Invalid source URL', 400)
  }

  let parsed
  try {
    parsed = new URL(str)
  } catch {
    throw httpError('Malformed source URL', 400)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw httpError(`Unsupported URL protocol "${parsed.protocol}" (only http/https are allowed)`, 400)
  }
  if (parsed.username || parsed.password) {
    throw httpError('URLs with embedded credentials are not allowed', 400)
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || isBlockedHostname(hostname)) {
    throw httpError(`Blocked internal host "${parsed.hostname}"`, 403)
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw httpError(`Blocked private or reserved IP address "${hostname}"`, 403)
    }
    if (requireApprovedHost) {
      throw httpError('Direct IP URLs are not in the approved external sources list', 403)
    }
    return parsed
  }

  if (requireApprovedHost && !isHostApproved(hostname, extraApprovedHosts)) {
    throw httpError(
      `Host "${hostname}" is not in the approved external sources list. Add it in Settings → Downloads to allow it.`,
      403,
    )
  }

  let records
  try {
    records = await dnsLookup(hostname)
  } catch {
    throw httpError(`Could not resolve host "${hostname}"`, 502)
  }
  const list = Array.isArray(records) ? records : records ? [records] : []
  if (list.length === 0) {
    throw httpError(`Host "${hostname}" resolved to no addresses`, 502)
  }
  for (const rec of list) {
    const addr = typeof rec === 'string' ? rec : rec?.address
    if (!addr || isPrivateOrReservedIp(addr)) {
      throw httpError(`Blocked host "${hostname}" resolving to a private or reserved network address`, 403)
    }
  }

  return parsed
}

/**
 * Validates and normalizes caller-supplied external HTTP headers. Only safe
 * media-fetch headers are allowed; CRLF and auth/proxy/host headers are rejected.
 */
export function sanitizeExternalHeaders(rawHeaders, refererShortcut) {
  const out = {}
  const combined = {}

  if (rawHeaders != null) {
    if (typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
      throw httpError('Headers must be a key-value object', 400)
    }
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (v === undefined || v === null || String(v).trim() === '') continue
      combined[k] = String(v)
    }
  }
  if (refererShortcut !== undefined && refererShortcut !== null && String(refererShortcut).trim() !== '') {
    combined.Referer = String(refererShortcut)
  }

  for (const [rawKey, rawVal] of Object.entries(combined)) {
    const key = String(rawKey).trim().toLowerCase()
    const canonical = PERMITTED_EXTERNAL_HEADERS.get(key)
    if (!canonical) {
      throw httpError(
        `Header "${rawKey}" is not permitted. Allowed headers: Referer, Origin, User-Agent, Accept, Accept-Language.`,
        400,
      )
    }
    const val = String(rawVal).trim()
    if (/[\r\n\0]/.test(val)) {
      throw httpError(`Header "${canonical}" contains invalid control characters`, 400)
    }
    if (val.length > 1024) {
      throw httpError(`Header "${canonical}" is too long`, 400)
    }
    if (canonical === 'Referer' || canonical === 'Origin') {
      let parsed
      try {
        parsed = new URL(val)
      } catch {
        throw httpError(`${canonical} must be a valid http(s) URL`, 400)
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw httpError(`${canonical} must use http or https`, 400)
      }
      if (parsed.username || parsed.password) {
        throw httpError(`${canonical} cannot include credentials`, 400)
      }
      out[canonical] = canonical === 'Origin' ? parsed.origin : parsed.href
    } else {
      out[canonical] = val
    }
  }

  return out
}

/**
 * Performs an HTTP fetch while validating the initial URL and every redirect
 * hop against SSRF and optional host allowlisting.
 */
export async function safeFetch(
  rawUrl,
  {
    headers = {},
    method = 'GET',
    signal,
    maxRedirects = 5,
    requireApprovedHost = false,
    extraApprovedHosts = [],
    dnsLookup,
    fetchImpl = fetch,
  } = {},
) {
  let currentUrl = rawUrl
  let currentHeaders = { ...headers }
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await validateRemoteUrl(currentUrl, {
      requireApprovedHost,
      extraApprovedHosts,
      dnsLookup,
    })
    const res = await fetchImpl(validated.href, {
      method,
      headers: currentHeaders,
      redirect: 'manual',
      signal,
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      // Release body socket before following redirect.
      try {
        await res.body?.cancel()
      } catch {
        /* ignore */
      }
      if (!location) {
        throw httpError(`Redirect (${res.status}) missing Location header`, 502)
      }
      if (hop === maxRedirects) {
        throw httpError('Too many redirects from remote source', 502)
      }
      const nextParsed = new URL(location, validated.href)
      if (nextParsed.origin !== new URL(validated.href).origin) {
        const filtered = {}
        for (const [k, v] of Object.entries(currentHeaders)) {
          const lower = k.toLowerCase()
          if (lower === 'authorization' || lower === 'cookie' || lower === 'proxy-authorization') {
            continue
          }
          filtered[k] = v
        }
        currentHeaders = filtered
      }
      currentUrl = nextParsed.href
      continue
    }
    return { response: res, finalUrl: validated.href }
  }
  throw httpError('Too many redirects from remote source', 502)
}

/**
 * Inspects an HLS playlist (or misidentified DASH/HTML document) for:
 * - DRM encryption (Widevine, FairPlay, PlayReady, ClearKey, SAMPLE-AES/CENC)
 * - Unsupported manifest types (MPEG-DASH `.mpd`, SmoothStreaming, HTML pages)
 * - Unsafe segment/key/map URIs (non-http(s) schemes or private/internal hosts)
 * - Summed `#EXTINF` duration in seconds (for accurate download progress)
 */
export async function inspectHlsPlaylist(
  text,
  playlistUrl,
  { dnsLookup, extraApprovedHosts = [], requireApprovedHost = false } = {},
) {
  const body = String(text ?? '')
  if (body.length > 10 * 1024 * 1024) {
    throw httpError('Playlist response exceeds maximum allowed size', 422)
  }
  const trimmed = body.trimStart()

  if (!trimmed) {
    throw httpError('Remote playlist is empty', 502)
  }
  if (/^<!doctype\s+html|^<html[\s>]/i.test(trimmed)) {
    throw httpError('Remote source returned an HTML page instead of a playable video or M3U8 playlist', 422)
  }
  if (/^(?:<\?xml[^>]*>\s*)?<MPD[\s>]/i.test(trimmed) || /<MPD\s+xmlns=/i.test(trimmed.slice(0, 1024))) {
    if (/<ContentProtection\b/i.test(body)) {
      throw httpError('DRM-protected MPEG-DASH stream detected; cannot download encrypted media', 422)
    }
    throw httpError('Unsupported MPEG-DASH (.mpd) manifest; only direct MP4 and HLS (.m3u8) streams are supported', 422)
  }
  if (!/^#EXTM3U\b/i.test(trimmed)) {
    throw httpError('Unsupported or invalid HLS playlist (missing #EXTM3U header)', 422)
  }

  let durationSec = 0
  let segmentCount = 0
  let isMaster = false
  let isLive = false
  let hasEndList = false
  const hostsToVerify = new Set()

  const registerUri = (rawUri) => {
    const clean = String(rawUri ?? '').trim()
    if (!clean) return
    if (/[\u0000-\u001f\u007f]/.test(clean)) {
      throw httpError('Playlist contains malformed URI', 422)
    }
    let resolved
    try {
      resolved = new URL(clean, playlistUrl)
    } catch {
      throw httpError('Playlist contains invalid URI', 422)
    }
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') {
      throw httpError(`Playlist references disallowed URI protocol "${resolved.protocol}"`, 403)
    }
    if (resolved.username || resolved.password) {
      throw httpError('Playlist references URI with embedded credentials', 403)
    }
    const host = resolved.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (!host || isBlockedHostname(host)) {
      throw httpError(`Playlist references blocked internal host "${resolved.hostname}"`, 403)
    }
    if (net.isIP(host) !== 0) {
      if (isPrivateOrReservedIp(host)) {
        throw httpError(`Playlist references blocked private IP "${host}"`, 403)
      }
      if (requireApprovedHost) {
        throw httpError('Playlist references unapproved direct IP host', 403)
      }
    } else {
      hostsToVerify.add(resolved.origin)
    }
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^#EXT-X-(?:SESSION-)?KEY:/i.test(line)) {
      const method = (line.match(/\bMETHOD=([^,\s"]+|"[^"]*")/i)?.[1] ?? '')
        .replace(/^"|"$/g, '')
        .toUpperCase()
      for (const drm of DRM_KEYFORMAT_PATTERNS) {
        if (drm.re.test(line)) {
          throw httpError(`DRM-protected stream detected (${drm.name}); cannot download encrypted media`, 422)
        }
      }
      if (method && method !== 'NONE' && method !== 'AES-128') {
        throw httpError(`DRM or unsupported HLS encryption detected (METHOD=${method})`, 422)
      }
      const keyFormat = (line.match(/\bKEYFORMAT="([^"]+)"/i)?.[1] ?? '').trim()
      if (keyFormat && keyFormat.toLowerCase() !== 'identity') {
        throw httpError(`DRM-protected HLS stream detected (KEYFORMAT=${keyFormat})`, 422)
      }
    }

    // Validate EVERY URI / X-ASSET-URI / X-ASSET-LIST attribute across all #EXT-X-* tags
    // (KEY, SESSION-KEY, MAP, MEDIA, I-FRAME-STREAM-INF, PART, PRELOAD-HINT, DATERANGE, etc.),
    // covering both quoted URI="..." and unquoted URI=... syntax.
    if (/^#EXT-X-/i.test(line)) {
      for (const m of line.matchAll(/\b(?:X-ASSET-(?:URI|LIST)|URI)=(?:"([^"]*)"|([^,\s]+))/gi)) {
        const candidateUri = (m[1] ?? m[2] ?? '').trim()
        if (candidateUri) registerUri(candidateUri)
      }
    }

    if (/^#EXT-X-STREAM-INF:/i.test(line)) {
      isMaster = true
      continue
    }

    if (/^#EXTINF:/i.test(line)) {
      const dur = Number.parseFloat(line.slice(line.indexOf(':') + 1))
      if (Number.isFinite(dur) && dur > 0) durationSec += dur
      segmentCount += 1
      continue
    }

    if (/^#EXT-X-ENDLIST\b/i.test(line)) {
      hasEndList = true
      continue
    }

    if (/^#EXT-X-PLAYLIST-TYPE:EVENT\b/i.test(line)) {
      isLive = true
      continue
    }

    if (!line.startsWith('#')) {
      registerUri(line)
    }
  }

  if (hostsToVerify.size > 32) {
    throw httpError('Playlist references too many distinct external hosts', 422)
  }

  // Validate every unique host referenced in playlist URIs against DNS SSRF.
  // Note: segment CDNs commonly live on a separate domain from the playlist host,
  // so we always enforce public-IP SSRF checks on segment/key hosts and check
  // allowlist on the primary playlist URL (already verified by safeFetch).
  for (const origin of hostsToVerify) {
    await validateRemoteUrl(origin, {
      requireApprovedHost: false,
      extraApprovedHosts,
      dnsLookup,
    })
  }

  if (!isMaster && segmentCount > 0 && !hasEndList && isLive) {
    throw httpError('Live/unbounded HLS streams cannot be downloaded as an episode file', 422)
  }

  return {
    isMaster,
    segmentCount,
    durationSec: durationSec > 0 ? Math.round(durationSec * 100) / 100 : null,
    hasEndList,
  }
}

function scanMp4BufferForDrm(buf, start = 0, end = buf.length, depth = 0, state = { count: 0 }) {
  if (depth > 8 || state.count > 50_000) return null
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'udta', 'meta', 'edts', 'schi'])
  let pos = start
  while (pos + 8 <= end && state.count < 50_000) {
    state.count += 1
    let size = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    let header = 8
    if (size === 1) {
      if (pos + 16 > end) break
      const big = buf.readBigUInt64BE(pos + 8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break
      size = Number(big)
      header = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (size < header || pos + size > end) break

    if (type === 'pssh') {
      return 'DRM protection metadata (CENC PSSH) detected in MP4 stream'
    }
    if (type === 'sinf' || type === 'tenc') {
      return 'Encrypted media track (CENC/sinf) detected in MP4 stream'
    }
    if (type === 'stsd' && size >= header + 16) {
      const entryCount = buf.readUInt32BE(pos + header + 4)
      let cur = pos + header + 8
      for (let i = 0; i < entryCount && cur + 8 <= pos + size && state.count < 50_000; i++) {
        state.count += 1
        const entrySize = buf.readUInt32BE(cur)
        const entryType = buf.toString('latin1', cur + 4, cur + 8)
        if (entrySize < 8 || cur + entrySize > pos + size) break
        if (entryType === 'encv' || entryType === 'enca' || entryType === 'encs') {
          return `DRM-encrypted MP4 track (${entryType}) detected; cannot save encrypted media`
        }
        cur += entrySize
      }
    } else if (CONTAINERS.has(type)) {
      const childStart = type === 'meta' ? pos + header + 4 : pos + header
      const found = scanMp4BufferForDrm(buf, childStart, pos + size, depth + 1, state)
      if (found) return found
    }

    pos += size
  }
  return null
}

/** Quick check on initial response bytes of a direct MP4 download. */
export function inspectMp4PrefixBytes(prefix) {
  if (!prefix || prefix.length < 12) {
    return { valid: false, error: 'Downloaded file is too small to be a valid MP4' }
  }
  const headText = prefix.subarray(0, Math.min(prefix.length, 256)).toString('utf8').trimStart()
  if (/^<!doctype\s+html|^<html[\s>]/i.test(headText)) {
    return { valid: false, error: 'Remote source returned an HTML page instead of an MP4 video' }
  }
  if (/^#EXTM3U\b/i.test(headText)) {
    return { valid: false, isHls: true, error: 'Source returned an M3U8 playlist' }
  }
  if (/^(?:<\?xml[^>]*>\s*)?<MPD[\s>]/i.test(headText)) {
    return { valid: false, error: 'Unsupported MPEG-DASH manifest; expected an MP4 file' }
  }
  const firstType = prefix.toString('latin1', 4, 8)
  const validFirstBoxes = new Set(['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip', 'wide'])
  if (!validFirstBoxes.has(firstType)) {
    return { valid: false, error: 'Remote source is not a valid MP4 container' }
  }
  return { valid: true, error: null }
}

/**
 * Validates a completed MP4 file on disk before moving it into the library:
 * checks non-zero size, valid ISO BMFF boxes (`ftyp`/`moov`), lack of DRM
 * (`encv`/`enca`/`pssh`/`sinf`), and reports whether `moov` precedes `mdat`.
 */
export async function inspectMp4File(filePath) {
  const fh = await fsp.open(filePath, 'r')
  try {
    const stat = await fh.stat()
    if (!stat.isFile() || stat.size < 32) {
      return { valid: false, error: 'Downloaded file is empty or truncated' }
    }

    const headerBuf = Buffer.alloc(16)
    let offset = 0
    let hasFtyp = false
    let moovOffset = -1
    let moovSize = 0
    let mdatOffset = -1
    let hasMdat = false
    let boxCount = 0

    while (offset + 8 <= stat.size && boxCount < 100_000) {
      const toRead = Math.min(16, stat.size - offset)
      const { bytesRead } = await fh.read(headerBuf, 0, toRead, offset)
      if (bytesRead < 8) break

      let size = headerBuf.readUInt32BE(0)
      const type = headerBuf.toString('latin1', 4, 8)
      if (!/^[\x20-\x7e]{4}$/.test(type)) {
        if (boxCount === 0) {
          return { valid: false, error: 'File is not a valid MP4 container' }
        }
        break
      }

      let header = 8
      if (size === 1) {
        if (bytesRead < 16) return { valid: false, error: 'Truncated MP4 box header' }
        const big = headerBuf.readBigUInt64BE(8)
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          return { valid: false, error: 'Invalid MP4 box size' }
        }
        size = Number(big)
        header = 16
      } else if (size === 0) {
        size = stat.size - offset
      }

      if (size < header || offset + size > stat.size) {
        // Tolerate small trailing tags/padding (e.g. 128-byte ID3v1 TAG) at EOF
        // when both moov and mdat boxes have already been verified complete.
        if (moovOffset >= 0 && hasMdat && stat.size - offset <= 4096) {
          break
        }
        return { valid: false, error: 'Downloaded MP4 file is incomplete or truncated' }
      }

      if (type === 'ftyp' || type === 'styp') hasFtyp = true
      if (type === 'moov' && moovOffset < 0) {
        moovOffset = offset
        moovSize = size
      }
      if (type === 'mdat') {
        if (mdatOffset < 0) mdatOffset = offset
        if (size > header) hasMdat = true
      }
      if (type === 'pssh') {
        return { valid: false, drm: true, error: 'DRM-protected MP4 detected (PSSH box)' }
      }

      offset += size
      boxCount += 1
    }

    if (!hasFtyp && moovOffset < 0) {
      return { valid: false, error: 'Output is not a recognizable MP4 file' }
    }
    if (moovOffset < 0) {
      return { valid: false, error: 'Downloaded MP4 is missing its metadata header (moov)' }
    }
    if (!hasMdat) {
      return { valid: false, error: 'Downloaded MP4 contains no media payload (mdat)' }
    }

    // Inspect moov for CENC/DRM protection boxes (capped at 16 MB for safety).
    if (moovSize <= 16 * 1024 * 1024) {
      const moovBuf = Buffer.alloc(moovSize)
      const { bytesRead } = await fh.read(moovBuf, 0, moovSize, moovOffset)
      if (bytesRead === moovSize) {
        const drmErr = scanMp4BufferForDrm(moovBuf, 0, moovSize)
        if (drmErr) {
          return { valid: false, drm: true, error: drmErr }
        }
      }
    }

    return {
      valid: true,
      size: stat.size,
      fastStart: mdatOffset < 0 || moovOffset < mdatOffset,
      error: null,
    }
  } finally {
    await fh.close()
  }
}

const ISO_BMFF_FIRST_BOXES = new Set([
  'ftyp',
  'styp',
  'moov',
  'mdat',
  'free',
  'skip',
  'wide',
])

function isValidTsSyncHeader(buf, offset) {
  if (offset + 4 > buf.length) return false
  if (buf[offset] !== 0x47) return false
  // adaptation_field_control (bits 5..4 of byte 3) is never 0b00 in valid MPEG-TS packets.
  return ((buf[offset + 3] >> 4) & 0x03) !== 0
}

function detectVideoContainerFromHeader(head) {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return 'matroska' // MKV or WebM (EBML)
  }
  if (head.length >= 8 && ISO_BMFF_FIRST_BOXES.has(head.toString('latin1', 4, 8))) {
    return 'isobmff' // MP4, M4V, MOV
  }
  if (
    head.length >= 12 &&
    head.toString('latin1', 0, 4) === 'RIFF' &&
    (head.toString('latin1', 8, 12) === 'AVI ' || head.toString('latin1', 8, 12) === 'AVIX')
  ) {
    return 'avi'
  }
  if (head.length >= 4 && head.toString('latin1', 0, 4) === 'OggS') {
    return 'ogg'
  }
  // Require at least two consecutive 188-byte MPEG-TS or 192-byte BDAV M2TS sync
  // packets (with non-zero adaptation_field_control) so short files starting with
  // ASCII 'G' (0x47, e.g. GIF89a or "GET /") can never masquerade as MPEG-TS.
  if (
    head.length >= 376 &&
    isValidTsSyncHeader(head, 0) &&
    isValidTsSyncHeader(head, 188) &&
    (head.length < 380 || isValidTsSyncHeader(head, 376))
  ) {
    return 'mpegts'
  }
  if (
    head.length >= 384 &&
    isValidTsSyncHeader(head, 4) &&
    isValidTsSyncHeader(head, 196) &&
    (head.length < 392 || isValidTsSyncHeader(head, 388))
  ) {
    return 'mpegts'
  }
  return null
}

/**
 * Validates a user-uploaded movie or episode file before committing it into the
 * shared library. Accepts genuine video containers (including MKV/TS files that
 * were saved with a `.mp4` extension) while rejecting empty, HTML, text, or
 * DRM-encrypted files.
 */
export async function inspectUploadedVideoFile(filePath, ext = '') {
  let stat
  try {
    stat = await fsp.stat(filePath)
  } catch {
    return { valid: false, error: 'Uploaded file could not be read' }
  }
  if (!stat.isFile() || stat.size < 16) {
    return { valid: false, error: 'Uploaded file is empty or too small to be a video' }
  }

  const fh = await fsp.open(filePath, 'r')
  let head
  try {
    const len = Math.min(512, stat.size)
    head = Buffer.alloc(len)
    const { bytesRead } = await fh.read(head, 0, len, 0)
    head = head.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }

  const headText = head.subarray(0, Math.min(head.length, 256)).toString('utf8').trimStart()
  if (/^<!doctype\s+html|^<html[\s>]/i.test(headText)) {
    return { valid: false, error: 'File is an HTML document, not a video file' }
  }

  const detected = detectVideoContainerFromHeader(head)
  if (!detected) {
    return {
      valid: false,
      error: `File is not a recognized video container (${ext || 'unknown'}). Supported: MP4, MKV, WebM, MOV, M4V, AVI, TS.`,
    }
  }

  if (detected === 'isobmff') {
    const mp4Check = await inspectMp4File(filePath)
    if (!mp4Check.valid) return mp4Check
    return { valid: true, container: 'isobmff', fastStart: mp4Check.fastStart, size: stat.size, error: null }
  }

  return { valid: true, container: detected, fastStart: true, size: stat.size, error: null }
}

/** Password hashing using Node's built-in scrypt (no external dependency). */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const SALT_LEN = 16
const KEY_LEN = 64
const SCRYPT_COST = Math.pow(2, 14) // N parameter for scrypt (reasonable for self-hosted deployments)

/** Hash a plaintext password into `salt.hash` format suitable for storage. */
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 })
  }
  const salt = randomBytes(SALT_LEN).toString('hex')
  const derived = await scryptAsync(password, salt, KEY_LEN, { N: SCRYPT_COST, r: 8, p: 1 })
  return `${salt}.${derived.toString('hex')}`
}

/** Verify a plaintext password against a stored `salt.hash` value. Returns boolean. */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false
  const parts = stored.split('.')
  if (parts.length !== 2) return false
  const [salt, hash] = parts
  if (!salt || !hash) return false
  try {
    const derived = await scryptAsync(password, salt, KEY_LEN, { N: SCRYPT_COST, r: 8, p: 1 })
    return timingSafeEqual(Buffer.from(hash, 'hex'), derived)
  } catch {
    return false
  }
}

/** Generate a cryptographically random URL-safe token. */
export function generateToken(length = 32) {
  return randomBytes(length).toString('base64url')
}

/** SHA-256 hex digest of a string (for email-verification / reset-token storage). */
export function sha256Hex(input) {
  return createHash('sha256').update(String(input)).digest('hex')
}
