// IMDb artwork resolver (by `tt...` ID or search) and persistent local artwork store.
//
// Fetches official posters, widescreen stills/backdrops, trailer slates, and logos
// for any IMDb title ID (e.g. `tt0234144`, `tt5311514`), validates all remote image
// hosts against a strict allowlist + SSRF DNS checks, verifies image magic bytes,
// and saves claimed images locally under `data/artwork/` (gitignored) behind opaque
// `art_<hex>` IDs so banners, posters, and icons load offline and never break.

import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cache from './cache.mjs'
import {
  atomicWriteFile,
  readResponseBufferLimited as readBodyBufferLimited,
  readResponseTextLimited,
  safeFetch,
  validateRemoteUrl,
} from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const ARTWORK_DIR = path.join(DATA_DIR, 'artwork')
const MANIFEST_FILE = path.join(DATA_DIR, 'artwork.json')

const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // 15 MB per image
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024 // 8 MB per gallery preview
const MAX_META_BYTES = 8 * 1024 * 1024 // 8 MB per IMDb metadata response
const MAX_BUCKET_ENTRIES = 5_000
const FETCH_TIMEOUT_MS = 10_000

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Strict allowlist of official IMDb / Amazon image CDNs (plus Cinemeta IMDb mirror).
export const APPROVED_IMDB_IMAGE_HOSTS = [
  'm.media-amazon.com',
  'ia.media-imdb.com',
  'images-na.ssl-images-amazon.com',
  'images-eu.ssl-images-amazon.com',
  'images.media-imdb.com',
  'images.metahub.space',
  'live.metahub.space',
]

const VALID_SLOTS = new Set(['banner', 'poster', 'icon'])
const VALID_TARGET_TYPES = new Set(['app', 'media', 'series', 'file'])
const VALID_FOCUSES = new Set(['top', 'center', 'bottom'])
const TITLE_CACHE_TTL_MS = 15 * 60_000
const SEARCH_CACHE_TTL_MS = 10 * 60_000

function emptyManifest() {
  return {
    app: Object.create(null),
    media: Object.create(null),
    series: Object.create(null),
    file: Object.create(null),
  }
}

let manifest = emptyManifest()

let writeChain = Promise.resolve()
const targetLocks = new Map()
const changeListeners = new Set()

function withTargetLock(lockKey, fn) {
  const prev = targetLocks.get(lockKey) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  targetLocks.set(lockKey, next)
  return next.finally(() => {
    if (targetLocks.get(lockKey) === next) targetLocks.delete(lockKey)
  })
}

export function onChange(fn) {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

function notifyChange() {
  for (const fn of changeListeners) {
    try {
      fn()
    } catch {
      /* ignore listener errors */
    }
  }
}

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

/** Normalizes a series/movie title into a deterministic artwork lookup key. */
export function normalizeSeriesKey(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, '')
    .slice(0, 120)
}

function normalizeTargetKey(targetType, rawKey) {
  if (!VALID_TARGET_TYPES.has(targetType)) {
    throw httpError('Invalid artwork target type', 400)
  }
  if (targetType === 'app') return 'global'
  if (targetType === 'media') {
    const id = Number(rawKey)
    if (!Number.isInteger(id) || id <= 0) throw httpError('Invalid media ID', 400)
    return String(id)
  }
  if (targetType === 'file') {
    const clean = String(rawKey ?? '').trim()
    if (!/^f_[0-9a-f]{20}$/.test(clean)) throw httpError('Invalid library file ID', 400)
    return clean
  }
  const key = normalizeSeriesKey(rawKey)
  if (!key || key === '__proto__') throw httpError('A series or movie title key is required', 400)
  return key
}

/**
 * Parses and validates an IMDb title ID (e.g. `tt0234144`, `tt5311514`, or a full
 * `https://www.imdb.com/title/tt0234144/` URL). Zero-pads short IDs to 7 digits.
 */
export function parseImdbId(raw) {
  const input = String(raw ?? '').trim()
  if (!input) return null

  // Extract from full IMDb URL if pasted (e.g. https://www.imdb.com/title/tt0234144/?ref_=...)
  const urlMatch = input.match(/imdb\.com\/title\/tt(\d{1,12})(?:[/?#]|$)/i)
  if (urlMatch) {
    const digits = urlMatch[1]
    return `tt${digits.length < 7 ? digits.padStart(7, '0') : digits}`
  }

  // Standard `tt0234144` format (case-insensitive, tolerates accidental whitespace after `tt`)
  const direct = input.match(/^tt\s*(\d{1,12})$/i)
  if (direct) {
    const digits = direct[1]
    return `tt${digits.length < 7 ? digits.padStart(7, '0') : digits}`
  }

  // Bare 7–10 digit numeric ID convenience (e.g. `0234144` -> `tt0234144`)
  const bare = input.match(/^(\d{7,10})$/)
  if (bare) {
    return `tt${bare[1]}`
  }

  return null
}

/** Detects image format from leading magic bytes (strictly raster formats only — no SVG/HTML). */
export function sniffImageFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' }
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: '.png', mime: 'image/png' }
  }
  // WebP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', mime: 'image/webp' }
  }
  // GIF: GIF87a / GIF89a
  const head6 = buf.subarray(0, 6).toString('ascii')
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { ext: '.gif', mime: 'image/gif' }
  }
  return null
}

function isApprovedImdbImageUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl ?? '').trim())
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    const host = parsed.hostname.toLowerCase()
    return APPROVED_IMDB_IMAGE_HOSTS.includes(host)
  } catch {
    return false
  }
}

/**
 * Extracts canonical Amazon media-amazon.com prefix so resized variants of the
 * same photo deduplicate cleanly and can be requested at optimal resolution.
 */
function splitAmazonImageUrl(rawUrl) {
  const m = String(rawUrl ?? '').match(
    /^(https:\/\/(?:m\.media-amazon\.com|ia\.media-imdb\.com|images-(?:na|eu)\.ssl-images-amazon\.com|images\.media-imdb\.com)\/images\/[A-Z]\/[^./?#]+)\._V1[^?#]*(\.(?:jpg|jpeg|png|webp))(?:\?.*)?$/i,
  )
  if (!m) return null
  const ext = m[2].toLowerCase() === '.jpeg' ? '.jpg' : m[2].toLowerCase()
  return { prefix: m[1], ext }
}

function canonicalImageKey(rawUrl) {
  const amz = splitAmazonImageUrl(rawUrl)
  if (amz) {
    const idPart = amz.prefix.split('/').pop() || amz.prefix
    return `amz:${idPart}`
  }
  try {
    const u = new URL(rawUrl)
    return `${u.hostname.toLowerCase()}${u.pathname}`
  } catch {
    return rawUrl
  }
}

/** Builds optimized Amazon CDN variant URLs (preview, banner, poster, icon, full). */
export function shapeImdbImageUrl(rawUrl, variant = 'full') {
  const amz = splitAmazonImageUrl(rawUrl)
  if (!amz) return rawUrl
  // Keep PNGs untouched when used for icons/logos to preserve alpha transparency.
  if (amz.ext === '.png' && (variant === 'icon' || variant === 'full')) {
    return `${amz.prefix}._V1_${amz.ext}`
  }
  switch (variant) {
    case 'preview':
      return `${amz.prefix}._V1_QL82_UX720_${amz.ext}`
    case 'banner':
      return `${amz.prefix}._V1_QL92_UX1920_${amz.ext}`
    case 'poster':
      return `${amz.prefix}._V1_QL92_UX1000_${amz.ext}`
    case 'icon':
      return `${amz.prefix}._V1_QL92_UX512_${amz.ext}`
    default:
      return `${amz.prefix}._V1_${amz.ext}`
  }
}

function buildPreviewEndpoint(rawUrl) {
  const shaped = shapeImdbImageUrl(rawUrl, 'preview')
  return `/api/imdb/preview?u=${encodeURIComponent(shaped)}`
}

async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    return await fetch(url, { redirect: 'error', ...init, signal: controller.signal })
  } catch {
    // Network-level failure (DNS, TLS, reset, timeout) is an upstream gateway error,
    // never a 500 with internal stack context.
    throw httpError('IMDb is unreachable right now', 502)
  } finally {
    clearTimeout(timer)
  }
}

async function safeMetaFetch(url, headers, timeoutMs = FETCH_TIMEOUT_MS) {
  const { response } = await safeFetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    maxRedirects: 3,
    requireApprovedHost: false,
  })
  return response
}

async function readJsonLimited(res, maxBytes = MAX_META_BYTES) {
  const text = await readResponseTextLimited(res, maxBytes, 'IMDb metadata response')
  return JSON.parse(text)
}

async function readResponseBufferLimited(res, maxBytes) {
  return readBodyBufferLimited(res, maxBytes, 'Image')
}

/**
 * Fetches an image strictly from `APPROVED_IMDB_IMAGE_HOSTS` with SSRF DNS checks
 * on every redirect hop, byte cap, and raster magic-byte verification.
 */
export async function fetchVerifiedImdbImage(rawUrl, { maxBytes = MAX_IMAGE_BYTES, dnsLookup } = {}) {
  let current = String(rawUrl ?? '').trim()
  for (let hop = 0; hop <= 4; hop++) {
    if (!isApprovedImdbImageUrl(current)) {
      throw httpError('Only official IMDb media image URLs can be claimed', 403)
    }
    const parsed = await validateRemoteUrl(current, {
      requireApprovedHost: true,
      extraApprovedHosts: APPROVED_IMDB_IMAGE_HOSTS,
      ...(dnsLookup ? { dnsLookup } : {}),
    })
    if (parsed.protocol !== 'https:' || !APPROVED_IMDB_IMAGE_HOSTS.includes(parsed.hostname.toLowerCase())) {
      throw httpError('Image host is not an approved IMDb media domain', 403)
    }

    const res = await fetchWithTimeout(
      parsed.toString(),
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8',
          Referer: 'https://www.imdb.com/',
        },
      },
      15_000,
    )

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel?.().catch(() => {})
      if (!loc) throw httpError('IMDb image redirect missing location', 502)
      current = new URL(loc, parsed).toString()
      continue
    }

    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {})
      throw httpError(`IMDb image returned HTTP ${res.status}`, res.status === 404 ? 404 : 502)
    }

    const buf = await readResponseBufferLimited(res, maxBytes)
    const fmt = sniffImageFormat(buf)
    if (!fmt) {
      throw httpError('Remote URL did not return a valid JPEG, PNG, WebP, or GIF image', 422)
    }
    return { buffer: buf, ext: fmt.ext, mime: fmt.mime }
  }
  throw httpError('Too many redirects while fetching IMDb image', 502)
}

// ── IMDb Metadata + Photo Gallery Collectors ─────────────────────────────────

const GRAPHQL_FULL_QUERY = `
query TitleArtwork($id: ID!) {
  title(id: $id) {
    id
    titleText { text }
    originalTitleText { text }
    titleType { id text }
    releaseYear { year }
    ratingsSummary { aggregateRating }
    plot { plotText { plainText } }
    primaryImage {
      id
      url
      width
      height
      caption { plainText }
    }
    images(first: 48) {
      edges {
        node {
          id
          url
          width
          height
          type
          caption { plainText }
        }
      }
    }
    primaryVideos(first: 8) {
      edges {
        node {
          id
          name { value }
          thumbnail {
            url
            width
            height
          }
        }
      }
    }
  }
}`

const GRAPHQL_MINIMAL_QUERY = `
query TitleArtworkMin($id: ID!) {
  title(id: $id) {
    id
    titleText { text }
    releaseYear { year }
    primaryImage { id url width height }
    images(first: 36) {
      edges {
        node { id url width height type }
      }
    }
  }
}`

async function runImdbGraphql(query, imdbId) {
  const res = await fetchWithTimeout(
    'https://api.graphql.imdb.com/',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': BROWSER_UA,
        Origin: 'https://www.imdb.com',
        Referer: `https://www.imdb.com/title/${imdbId}/`,
        'x-imdb-client-name': 'imdb-web-next-localized',
      },
      body: JSON.stringify({ query, variables: { id: imdbId } }),
    },
    FETCH_TIMEOUT_MS,
  )
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => {})
    throw new Error(`GraphQL HTTP ${res.status}`)
  }
  const payload = await readJsonLimited(res)
  return payload?.data?.title ?? null
}

async function collectFromGraphql(imdbId) {
  let t = null
  try {
    t = await runImdbGraphql(GRAPHQL_FULL_QUERY, imdbId)
  } catch {
    t = await runImdbGraphql(GRAPHQL_MINIMAL_QUERY, imdbId)
  }
  if (!t) {
    t = await runImdbGraphql(GRAPHQL_MINIMAL_QUERY, imdbId).catch(() => null)
  }
  if (!t) return null

  const images = []
  if (t.primaryImage?.url) {
    images.push({
      id: t.primaryImage.id || 'primary',
      url: t.primaryImage.url,
      width: Number(t.primaryImage.width) || null,
      height: Number(t.primaryImage.height) || null,
      kind: 'poster',
      isPrimary: true,
      caption: t.primaryImage.caption?.plainText || 'Official IMDb Poster',
    })
  }

  for (const edge of t.primaryVideos?.edges ?? []) {
    const node = edge?.node
    if (!node?.thumbnail?.url) continue
    images.push({
      id: node.id || undefined,
      url: node.thumbnail.url,
      width: Number(node.thumbnail.width) || null,
      height: Number(node.thumbnail.height) || null,
      kind: 'video',
      isPrimary: false,
      caption: node.name?.value ? `Trailer · ${node.name.value}` : 'Video Backdrop',
    })
  }

  for (const edge of t.images?.edges ?? []) {
    const node = edge?.node
    if (!node?.url) continue
    const rawType = String(node.type ?? '').toLowerCase()
    const kind =
      rawType === 'poster'
        ? 'poster'
        : rawType === 'still_frame'
          ? 'still'
          : rawType.includes('logo')
            ? 'logo'
            : 'gallery'
    images.push({
      id: node.id || undefined,
      url: node.url,
      width: Number(node.width) || null,
      height: Number(node.height) || null,
      kind,
      isPrimary: false,
      caption: node.caption?.plainText || null,
    })
  }

  return {
    title: t.titleText?.text || null,
    originalTitle: t.originalTitleText?.text || null,
    type: t.titleType?.text || t.titleType?.id || null,
    year: Number(t.releaseYear?.year) || null,
    rating:
      typeof t.ratingsSummary?.aggregateRating === 'number'
        ? Number(t.ratingsSummary.aggregateRating.toFixed(1))
        : null,
    plot: t.plot?.plotText?.plainText || null,
    images,
  }
}

async function collectFromSuggestionCdn(imdbId) {
  const url = `https://v3.sg.media-imdb.com/suggestion/t/${encodeURIComponent(imdbId)}.json`
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
      },
    },
    8_000,
  )
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => {})
    return null
  }
  const json = await readJsonLimited(res)
  const list = Array.isArray(json?.d) ? json.d : []
  const hit = list.find((entry) => String(entry?.id ?? '').toLowerCase() === imdbId)
  if (!hit) return null

  const images = []
  if (hit.i?.imageUrl) {
    images.push({
      id: `${imdbId}-poster`,
      url: hit.i.imageUrl,
      width: Number(hit.i.width) || null,
      height: Number(hit.i.height) || null,
      kind: 'poster',
      isPrimary: true,
      caption: hit.l ? `${hit.l} — Official Poster` : 'Official IMDb Poster',
    })
  }
  if (Array.isArray(hit.v)) {
    for (const vid of hit.v) {
      if (!vid?.i?.imageUrl) continue
      images.push({
        id: vid.id || undefined,
        url: vid.i.imageUrl,
        width: Number(vid.i.width) || null,
        height: Number(vid.i.height) || null,
        kind: 'video',
        isPrimary: false,
        caption: vid.l ? `Trailer · ${vid.l}` : 'Trailer Frame',
      })
    }
  }

  return {
    title: hit.l || null,
    originalTitle: null,
    type: hit.q || hit.qid || null,
    year: Number(hit.y) || null,
    rating: null,
    plot: null,
    images,
  }
}

function decodeHtmlEntities(str) {
  return String(str ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

async function collectFromTitleHtml(imdbId) {
  const res = await safeMetaFetch(
    `https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`,
    {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    FETCH_TIMEOUT_MS,
  )
  // IMDb returns 202 when an empty JS challenge shell is served; ignore non-200 cleanly.
  if (res.status !== 200) {
    await res.body?.cancel?.().catch(() => {})
    return null
  }
  const html = await readResponseTextLimited(res, MAX_META_BYTES, 'IMDb title page')
  if (!html) return null

  const images = []
  let title = null
  let originalTitle = null
  let type = null
  let year = null
  let rating = null
  let plot = null

  // 1) Parse __NEXT_DATA__ (richest gallery: primaryImage + titleMainImages + primaryVideos + videoStrip)
  const nextMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (nextMatch) {
    try {
      const next = JSON.parse(nextMatch[1])
      const atf = next?.props?.pageProps?.aboveTheFoldData
      const main = next?.props?.pageProps?.mainColumnData
      if (atf) {
        title = atf.titleText?.text || title
        originalTitle = atf.originalTitleText?.text || originalTitle
        type = atf.titleType?.text || atf.titleType?.id || type
        year = Number(atf.releaseYear?.year) || year
        if (typeof atf.ratingsSummary?.aggregateRating === 'number') {
          rating = Number(atf.ratingsSummary.aggregateRating.toFixed(1))
        }
        plot = atf.plot?.plotText?.plainText || plot
        if (atf.primaryImage?.url) {
          images.push({
            id: atf.primaryImage.id || 'primary',
            url: atf.primaryImage.url,
            width: Number(atf.primaryImage.width) || null,
            height: Number(atf.primaryImage.height) || null,
            kind: 'poster',
            isPrimary: true,
            caption: atf.primaryImage.caption?.plainText || 'Official IMDb Poster',
          })
        }
        for (const edge of atf.primaryVideos?.edges ?? []) {
          const node = edge?.node
          if (node?.thumbnail?.url) {
            images.push({
              id: node.id,
              url: node.thumbnail.url,
              width: Number(node.thumbnail.width) || null,
              height: Number(node.thumbnail.height) || null,
              kind: 'video',
              isPrimary: false,
              caption: node.name?.value ? `Trailer · ${node.name.value}` : 'Video Backdrop',
            })
          }
        }
      }
      if (main) {
        for (const edge of main.titleMainImages?.edges ?? []) {
          const node = edge?.node
          if (node?.url) {
            images.push({
              id: node.id,
              url: node.url,
              width: Number(node.width) || null,
              height: Number(node.height) || null,
              kind: 'still',
              isPrimary: false,
              caption: node.caption?.plainText || null,
            })
          }
        }
        for (const edge of main.videoStrip?.edges ?? []) {
          const node = edge?.node
          if (node?.thumbnail?.url) {
            images.push({
              id: node.id,
              url: node.thumbnail.url,
              width: Number(node.thumbnail.width) || null,
              height: Number(node.thumbnail.height) || null,
              kind: 'video',
              isPrimary: false,
              caption: node.name?.value || 'Clip Backdrop',
            })
          }
        }
      }
    } catch {
      /* continue to JSON-LD fallback */
    }
  }

  // 2) Parse JSON-LD fallback
  const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1])
      title = title || (ld.name ? decodeHtmlEntities(ld.name) : null)
      originalTitle = originalTitle || (ld.alternateName ? decodeHtmlEntities(ld.alternateName) : null)
      type = type || ld['@type'] || null
      plot = plot || (ld.description ? decodeHtmlEntities(ld.description) : null)
      if (!year && typeof ld.datePublished === 'string') {
        const ym = ld.datePublished.match(/^(\d{4})/)
        if (ym) year = Number(ym[1])
      }
      if (!rating && ld.aggregateRating?.ratingValue) {
        const rv = Number(ld.aggregateRating.ratingValue)
        if (Number.isFinite(rv)) rating = Number(rv.toFixed(1))
      }
      if (typeof ld.image === 'string') {
        images.push({
          url: ld.image,
          width: null,
          height: null,
          kind: 'poster',
          isPrimary: true,
          caption: 'Official IMDb Poster',
        })
      }
      if (typeof ld.trailer?.thumbnailUrl === 'string') {
        images.push({
          url: ld.trailer.thumbnailUrl,
          width: null,
          height: null,
          kind: 'video',
          isPrimary: false,
          caption: ld.trailer.name ? decodeHtmlEntities(ld.trailer.name) : 'Official Trailer Backdrop',
        })
      }
    } catch {
      /* ignore */
    }
  }

  // 3) og:image final fallback
  if (images.length === 0) {
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
    if (og?.[1]) {
      images.push({
        url: decodeHtmlEntities(og[1]),
        width: null,
        height: null,
        kind: 'poster',
        isPrimary: true,
        caption: 'IMDb Cover',
      })
    }
  }

  if (!title && images.length === 0) return null
  return { title, originalTitle, type, year, rating, plot, images }
}

async function collectFromCinemeta(imdbId) {
  const tryKind = async (kind) => {
    const res = await safeMetaFetch(
      `https://v3-cinemeta.strem.io/meta/${kind}/${encodeURIComponent(imdbId)}.json`,
      { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      7_000,
    )
    if (!res.ok) {
      await res.body?.cancel?.().catch(() => {})
      return null
    }
    const json = await readJsonLimited(res)
    return json?.meta?.name ? json.meta : null
  }

  const [movieRes, seriesRes] = await Promise.allSettled([tryKind('movie'), tryKind('series')])
  const meta =
    (movieRes.status === 'fulfilled' && movieRes.value) ||
    (seriesRes.status === 'fulfilled' && seriesRes.value) ||
    null
  if (!meta) return null

  const images = []
  if (typeof meta.background === 'string' && isApprovedImdbImageUrl(meta.background)) {
    images.push({
      id: `${imdbId}-backdrop`,
      url: meta.background,
      width: 1920,
      height: 1080,
      kind: 'backdrop',
      isPrimary: false,
      caption: 'HD Widescreen Banner',
    })
  }
  if (typeof meta.poster === 'string' && isApprovedImdbImageUrl(meta.poster)) {
    images.push({
      id: `${imdbId}-cm-poster`,
      url: meta.poster,
      width: 1000,
      height: 1500,
      kind: 'poster',
      isPrimary: false,
      caption: 'HD Poster',
    })
  }
  if (typeof meta.logo === 'string' && isApprovedImdbImageUrl(meta.logo)) {
    images.push({
      id: `${imdbId}-logo`,
      url: meta.logo,
      width: 800,
      height: 400,
      kind: 'logo',
      isPrimary: false,
      caption: 'Title Logo (Transparent)',
    })
  }
  if (Array.isArray(meta.videos)) {
    for (const v of meta.videos.slice(0, 12)) {
      if (typeof v?.thumbnail === 'string' && isApprovedImdbImageUrl(v.thumbnail)) {
        images.push({
          url: v.thumbnail,
          width: null,
          height: null,
          kind: 'still',
          isPrimary: false,
          caption: v.name || v.title ? `EP ${v.episode ?? ''} · ${v.name || v.title}`.trim() : 'Episode Still',
        })
      }
    }
  }

  const yrMatch = String(meta.year ?? meta.releaseInfo ?? '').match(/(\d{4})/)
  const rv = Number(meta.imdbRating)
  return {
    title: meta.name || null,
    originalTitle: null,
    type: meta.type === 'series' ? 'TV Series' : meta.type === 'movie' ? 'Movie' : meta.type || null,
    year: yrMatch ? Number(yrMatch[1]) : null,
    rating: Number.isFinite(rv) && rv > 0 ? Number(rv.toFixed(1)) : null,
    plot: meta.description || null,
    images,
  }
}

function classifySlot(img) {
  if (img.kind === 'logo') return 'icon'
  if (img.kind === 'backdrop') return 'banner'
  if (img.width && img.height) {
    const ratio = img.width / img.height
    if (ratio >= 1.2) return 'banner'
    if (ratio >= 0.85 && ratio < 1.2) return 'icon'
    return 'poster'
  }
  if (img.kind === 'still' || img.kind === 'video') return 'banner'
  return 'poster'
}

/** Merges and deduplicates photos from multiple collectors into a clean, ranked gallery. */
export function mergeImdbResults(imdbId, sources) {
  let title = null
  let originalTitle = null
  let type = null
  let year = null
  let rating = null
  let plot = null

  const byKey = new Map()
  for (const src of sources) {
    if (!src) continue
    title = title || src.title || null
    originalTitle = originalTitle || src.originalTitle || null
    type = type || src.type || null
    year = year || src.year || null
    rating = rating ?? src.rating ?? null
    plot = plot || src.plot || null

    for (const raw of src.images ?? []) {
      if (!raw?.url || !isApprovedImdbImageUrl(raw.url)) continue
      const fullUrl = shapeImdbImageUrl(raw.url, 'full')
      const key = canonicalImageKey(fullUrl)
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.width && raw.width) existing.width = raw.width
        if (!existing.height && raw.height) existing.height = raw.height
        if (!existing.caption && raw.caption) existing.caption = raw.caption
        if (raw.isPrimary) existing.isPrimary = true
        if (existing.kind === 'gallery' && raw.kind !== 'gallery') existing.kind = raw.kind
        existing.suggestedSlot = classifySlot(existing)
        continue
      }
      const entry = {
        id:
          raw.id ||
          `img_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`,
        url: fullUrl,
        previewUrl: buildPreviewEndpoint(raw.url),
        width: raw.width || null,
        height: raw.height || null,
        kind: raw.kind || 'gallery',
        isPrimary: Boolean(raw.isPrimary),
        caption: raw.caption ? String(raw.caption).slice(0, 180) : null,
        suggestedSlot: 'poster',
      }
      entry.suggestedSlot = classifySlot(entry)
      byKey.set(key, entry)
    }
  }

  const images = [...byKey.values()]
  const kindPriority = { backdrop: 0, poster: 1, still: 2, video: 3, logo: 4, gallery: 5 }
  images.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    const pa = kindPriority[a.kind] ?? 9
    const pb = kindPriority[b.kind] ?? 9
    if (pa !== pb) return pa - pb
    const areaA = (a.width || 800) * (a.height || 600)
    const areaB = (b.width || 800) * (b.height || 600)
    return areaB - areaA
  })

  // Recommended one-click selections
  const bestPoster =
    images.find((i) => i.isPrimary) ||
    images.find((i) => i.suggestedSlot === 'poster') ||
    images[0] ||
    null
  const bestBanner =
    images.find((i) => i.kind === 'backdrop') ||
    images.find((i) => i.suggestedSlot === 'banner' && (i.width ?? 1280) >= 800) ||
    images.find((i) => i.suggestedSlot === 'banner') ||
    bestPoster
  const bestIcon =
    images.find((i) => i.kind === 'logo') ||
    images.find((i) => i.suggestedSlot === 'icon') ||
    bestPoster

  return {
    imdbId,
    imdbUrl: `https://www.imdb.com/title/${imdbId}/`,
    title: title || imdbId,
    originalTitle: originalTitle && originalTitle !== title ? originalTitle : null,
    type,
    year,
    rating,
    plot,
    recommended: {
      banner: bestBanner?.url ?? null,
      poster: bestPoster?.url ?? null,
      icon: bestIcon?.url ?? null,
    },
    images,
  }
}

/** Fetches title metadata and all claimable photos for an IMDb `tt...` ID. */
export async function lookupTitle(rawInput) {
  const imdbId = parseImdbId(rawInput)
  if (!imdbId) {
    throw httpError('Enter a valid IMDb ID in the format tt0234144 (or paste an IMDb title URL)', 400)
  }

  const cacheKey = `imdb:title:${imdbId}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const settled = await Promise.allSettled([
    collectFromGraphql(imdbId),
    collectFromSuggestionCdn(imdbId),
    collectFromTitleHtml(imdbId),
    collectFromCinemeta(imdbId),
  ])

  const sources = settled
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value)

  if (sources.length === 0) {
    const anyRejected = settled.some((r) => r.status === 'rejected')
    throw httpError(
      anyRejected
        ? `Could not reach IMDb or find title "${imdbId}". Check the ID (e.g. tt0234144) and server internet access.`
        : `No IMDb title found for "${imdbId}". Double-check the tt number.`,
      404,
    )
  }

  const merged = mergeImdbResults(imdbId, sources)
  if (merged.images.length === 0 && merged.title === imdbId) {
    throw httpError(`No photos found on IMDb for "${imdbId}".`, 404)
  }

  cache.set(cacheKey, merged, TITLE_CACHE_TTL_MS)
  return merged
}

/** Searches IMDb titles by name (or `tt...` ID) and returns matching `tt` IDs + posters. */
export async function searchTitles(rawQuery) {
  const query = String(rawQuery ?? '').trim().slice(0, 100)
  if (!query) return { query: '', results: [] }

  const asId = parseImdbId(query)
  const slug = asId
    ? asId
    : query
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50)

  if (!slug) return { query, results: [] }
  const cacheKey = `imdb:search:${slug}`
  const cached = cache.get(cacheKey)
  if (cached) return { query, results: cached }

  const first = /^[a-z0-9]$/.test(slug[0]) ? slug[0] : 'x'
  const url = `https://v3.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(slug)}.json`
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
      },
    },
    8_000,
  )
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => {})
    throw httpError(`IMDb search returned HTTP ${res.status}`, 502)
  }
  const json = await readJsonLimited(res)
  const rows = Array.isArray(json?.d) ? json.d : []
  const results = []
  for (const row of rows) {
    const id = parseImdbId(row?.id)
    if (!id || !row?.l) continue
    const rawPoster = row.i?.imageUrl && isApprovedImdbImageUrl(row.i.imageUrl) ? row.i.imageUrl : null
    results.push({
      imdbId: id,
      title: String(row.l),
      year: Number(row.y) || null,
      type: row.q || row.qid || null,
      stars: row.s ? String(row.s) : null,
      previewUrl: rawPoster ? buildPreviewEndpoint(rawPoster) : null,
    })
    if (results.length >= 12) break
  }

  cache.set(cacheKey, results, SEARCH_CACHE_TTL_MS)
  return { query, results }
}

// ── Persistent Local Artwork Store ───────────────────────────────────────────

function sanitizeManifestBucket(raw) {
  const out = Object.create(null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let count = 0
  for (const [key, entry] of Object.entries(raw)) {
    if (count >= MAX_BUCKET_ENTRIES) break
    if (!key || key.length > 140 || key === '__proto__') continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const cleanEntry = {}
    if (typeof entry.imdbId === 'string' && /^tt\d{7,12}$/.test(entry.imdbId)) {
      cleanEntry.imdbId = entry.imdbId
    }
    if (typeof entry.imdbTitle === 'string' && entry.imdbTitle.trim()) {
      cleanEntry.imdbTitle = entry.imdbTitle.trim().slice(0, 180)
    }
    for (const slot of VALID_SLOTS) {
      const s = Object.hasOwn(entry, slot) ? entry[slot] : null
      if (!s || typeof s !== 'object') continue
      if (
        typeof s.artId === 'string' &&
        /^art_[0-9a-f]{20}$/.test(s.artId) &&
        typeof s.ext === 'string' &&
        /^\.(?:jpg|png|webp|gif)$/.test(s.ext)
      ) {
        const safeMime =
          s.ext === '.png'
            ? 'image/png'
            : s.ext === '.webp'
              ? 'image/webp'
              : s.ext === '.gif'
                ? 'image/gif'
                : 'image/jpeg'
        cleanEntry[slot] = {
          artId: s.artId,
          ext: s.ext,
          mime: safeMime,
          focus: VALID_FOCUSES.has(s.focus) ? s.focus : 'center',
          imdbId:
            typeof s.imdbId === 'string' && /^tt\d{7,12}$/.test(s.imdbId)
              ? s.imdbId
              : cleanEntry.imdbId ?? null,
          sourceKey: typeof s.sourceKey === 'string' ? s.sourceKey.slice(0, 200) : null,
          updatedAt: Number(s.updatedAt) || Date.now(),
        }
      }
    }
    if (cleanEntry.banner || cleanEntry.poster || cleanEntry.icon) {
      out[key] = cleanEntry
      count += 1
    }
  }
  return out
}

export async function init() {
  await fsp.mkdir(ARTWORK_DIR, { recursive: true, mode: 0o700 })
  try {
    const raw = JSON.parse(await fsp.readFile(MANIFEST_FILE, 'utf8'))
    manifest = {
      app: sanitizeManifestBucket(raw?.app),
      media: sanitizeManifestBucket(raw?.media),
      series: sanitizeManifestBucket(raw?.series),
      file: sanitizeManifestBucket(raw?.file),
    }
  } catch {
    manifest = emptyManifest()
  }
}

function persistManifest() {
  const serialized = JSON.stringify(manifest, null, 2)
  writeChain = writeChain
    .catch(() => {})
    .then(() => atomicWriteFile(MANIFEST_FILE, serialized))
    .catch((err) => {
      console.error('[imdb] failed to persist artwork manifest:', err?.message || err)
    })
  return writeChain
}

function collectReferencedArtIds() {
  const refs = new Set()
  for (const type of VALID_TARGET_TYPES) {
    for (const entry of Object.values(manifest[type] || {})) {
      for (const slot of VALID_SLOTS) {
        const artId = entry?.[slot]?.artId
        if (artId) refs.add(artId)
      }
    }
  }
  return refs
}

async function cleanupUnreferencedArt(candidates) {
  if (!candidates || candidates.length === 0) return
  const refs = collectReferencedArtIds()
  for (const item of candidates) {
    if (!item?.artId || refs.has(item.artId)) continue
    const filePath = path.join(ARTWORK_DIR, `${item.artId}${item.ext}`)
    const rel = path.relative(ARTWORK_DIR, filePath)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    await fsp.rm(filePath, { force: true }).catch(() => {})
  }
}

function toPublicSlot(slotObj) {
  if (!slotObj) return null
  return {
    artId: slotObj.artId,
    url: `/api/artwork/${slotObj.artId}`,
    focus: slotObj.focus || 'center',
    imdbId: slotObj.imdbId || null,
    updatedAt: slotObj.updatedAt,
  }
}

function toPublicRecord(entry) {
  if (!entry) return null
  const banner = toPublicSlot(entry.banner)
  const poster = toPublicSlot(entry.poster)
  const icon = toPublicSlot(entry.icon)
  if (!banner && !poster && !icon) return null
  return {
    imdbId: entry.imdbId ?? banner?.imdbId ?? poster?.imdbId ?? icon?.imdbId ?? null,
    imdbTitle: entry.imdbTitle ?? null,
    banner,
    poster,
    icon,
  }
}

/** Public snapshot of all claimed artwork (opaque URLs only — zero filesystem paths). */
export function snapshot() {
  const buildBucket = (bucket) => {
    const out = Object.create(null)
    for (const [k, v] of Object.entries(bucket || {})) {
      if (k === '__proto__') continue
      const pub = toPublicRecord(v)
      if (pub) out[k] = pub
    }
    return out
  }
  return {
    app: toPublicRecord(manifest.app && Object.hasOwn(manifest.app, 'global') ? manifest.app.global : null) ?? null,
    media: buildBucket(manifest.media),
    series: buildBucket(manifest.series),
    file: buildBucket(manifest.file),
  }
}

/** Resolves an opaque `art_<20hex>` ID to a verified regular file inside `data/artwork/`. */
export async function resolveArtworkFile(artId) {
  const clean = String(artId ?? '').trim()
  if (!/^art_[0-9a-f]{20}$/.test(clean)) return null

  let foundMeta = null
  for (const type of VALID_TARGET_TYPES) {
    for (const entry of Object.values(manifest[type] || {})) {
      for (const slot of VALID_SLOTS) {
        if (entry?.[slot]?.artId === clean) {
          foundMeta = entry[slot]
          break
        }
      }
      if (foundMeta) break
    }
    if (foundMeta) break
  }
  if (!foundMeta || !/^\.(?:jpg|png|webp|gif)$/.test(foundMeta.ext)) return null

  const absPath = path.join(ARTWORK_DIR, `${foundMeta.artId}${foundMeta.ext}`)
  const rel = path.relative(ARTWORK_DIR, absPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null

  try {
    const dirSt = await fsp.lstat(ARTWORK_DIR)
    if (!dirSt.isDirectory() || dirSt.isSymbolicLink()) return null
    const st = await fsp.lstat(absPath)
    if (!st.isFile() || st.isSymbolicLink()) return null
    const [realDir, realFile] = await Promise.all([fsp.realpath(ARTWORK_DIR), fsp.realpath(absPath)])
    const realRel = path.relative(realDir, realFile)
    if (!realRel || realRel.startsWith('..') || path.isAbsolute(realRel)) return null
    return { absPath: realFile, mime: foundMeta.mime, size: st.size, artId: clean }
  } catch {
    return null
  }
}

async function downloadForSlot(rawImageUrl, slot, opts = {}) {
  const trimmed = String(rawImageUrl ?? '').trim()
  if (!isApprovedImdbImageUrl(trimmed)) {
    throw httpError('Only official IMDb photo URLs can be claimed', 403)
  }

  // Try slot-optimized resolution first, then full `_V1_`, then original URL.
  const candidates = [
    shapeImdbImageUrl(trimmed, slot),
    shapeImdbImageUrl(trimmed, 'full'),
    trimmed,
  ].filter((u, idx, arr) => u && arr.indexOf(u) === idx)

  let lastErr = null
  for (const candidate of candidates) {
    try {
      return await fetchVerifiedImdbImage(candidate, opts)
    } catch (err) {
      lastErr = err
      if (err?.status === 403) throw err
    }
  }
  throw lastErr || httpError('Could not download IMDb photo', 502)
}

async function saveArtworkBuffer({ buffer, ext, mime }) {
  const artId = `art_${crypto.randomBytes(10).toString('hex')}`
  const finalPath = path.join(ARTWORK_DIR, `${artId}${ext}`)
  await atomicWriteFile(finalPath, buffer)
  return { artId, ext, mime }
}

function enforceBucketLimit(bucket, targetKey) {
  if (Object.hasOwn(bucket, targetKey)) return
  if (Object.keys(bucket).length >= MAX_BUCKET_ENTRIES) {
    throw httpError('Maximum claimed artwork entries limit reached', 429)
  }
}

/**
 * Claims a single IMDb photo for a target + slot (`banner` | `poster` | `icon`),
 * caching the verified image locally under `data/artwork/`.
 */
export async function claimArtwork(payload = {}, internalOpts = {}) {
  const targetType = String(payload.targetType ?? '').trim()
  const targetKey = normalizeTargetKey(targetType, payload.targetKey)
  const slot = String(payload.slot ?? '').trim()
  if (!VALID_SLOTS.has(slot)) {
    throw httpError('Slot must be "banner", "poster", or "icon"', 400)
  }
  const imageUrl = String(payload.imageUrl ?? '').trim()
  if (!imageUrl) {
    throw httpError('An IMDb image URL is required', 400)
  }
  const focus = VALID_FOCUSES.has(payload.focus)
    ? payload.focus
    : slot === 'banner'
      ? 'top'
      : 'center'
  const imdbId = payload.imdbId ? parseImdbId(payload.imdbId) : null
  const imdbTitle = payload.imdbTitle ? String(payload.imdbTitle).trim().slice(0, 180) : null

  enforceBucketLimit(manifest[targetType], targetKey)
  const downloaded = await downloadForSlot(imageUrl, slot, internalOpts)

  return withTargetLock(`${targetType}:${targetKey}`, async () => {
    const bucket = manifest[targetType]
    enforceBucketLimit(bucket, targetKey)
    const stored = await saveArtworkBuffer(downloaded)
    const current = Object.hasOwn(bucket, targetKey) ? { ...bucket[targetKey] } : {}
    const previousSlot = current[slot] ?? null

    if (imdbId) current.imdbId = imdbId
    if (imdbTitle) current.imdbTitle = imdbTitle
    current[slot] = {
      artId: stored.artId,
      ext: stored.ext,
      mime: stored.mime,
      focus,
      imdbId: imdbId ?? current.imdbId ?? null,
      sourceKey: canonicalImageKey(imageUrl),
      updatedAt: Date.now(),
    }
    bucket[targetKey] = current

    await persistManifest()
    if (previousSlot) await cleanupUnreferencedArt([previousSlot])
    notifyChange()

    return {
      targetType,
      targetKey,
      slot,
      record: toPublicRecord(current),
      snapshot: snapshot(),
    }
  })
}

/**
 * Claims multiple slots (`banner`, `poster`, `icon`) for a target in one operation
 * (used by one-click "Claim All" and post-upload IMDb artwork attachment).
 */
export async function claimArtworkBundle(payload = {}, internalOpts = {}) {
  const targetType = String(payload.targetType ?? '').trim()
  const targetKey = normalizeTargetKey(targetType, payload.targetKey)
  const rawSlots = payload.slots && typeof payload.slots === 'object' ? payload.slots : {}
  const entries = [...VALID_SLOTS]
    .map((slot) => [slot, Object.hasOwn(rawSlots, slot) && typeof rawSlots[slot] === 'string' ? rawSlots[slot].trim() : ''])
    .filter(([, url]) => Boolean(url))

  if (entries.length === 0) {
    throw httpError('Select at least one photo slot (banner, poster, or icon) to claim', 400)
  }

  const imdbId = payload.imdbId ? parseImdbId(payload.imdbId) : null
  const imdbTitle = payload.imdbTitle ? String(payload.imdbTitle).trim().slice(0, 180) : null
  const rawFocus = payload.focus && typeof payload.focus === 'object' ? payload.focus : {}

  enforceBucketLimit(manifest[targetType], targetKey)
  const fetched = await Promise.all(
    entries.map(async ([slot, url]) => {
      const img = await downloadForSlot(url, slot, internalOpts)
      const defaultFocus = slot === 'banner' ? 'top' : 'center'
      const focusVal = Object.hasOwn(rawFocus, slot) ? rawFocus[slot] : undefined
      const focus = VALID_FOCUSES.has(focusVal) ? focusVal : defaultFocus
      return { slot, url, img, focus }
    }),
  )

  return withTargetLock(`${targetType}:${targetKey}`, async () => {
    const bucket = manifest[targetType]
    enforceBucketLimit(bucket, targetKey)
    const downloaded = await Promise.all(
      fetched.map(async ({ slot, url, img, focus }) => ({
        slot,
        url,
        stored: await saveArtworkBuffer(img),
        focus,
      })),
    )

    const current = Object.hasOwn(bucket, targetKey) ? { ...bucket[targetKey] } : {}
    const replaced = []

    if (imdbId) current.imdbId = imdbId
    if (imdbTitle) current.imdbTitle = imdbTitle

    for (const { slot, url, stored, focus } of downloaded) {
      if (current[slot]) replaced.push(current[slot])
      current[slot] = {
        artId: stored.artId,
        ext: stored.ext,
        mime: stored.mime,
        focus,
        imdbId: imdbId ?? current.imdbId ?? null,
        sourceKey: canonicalImageKey(url),
        updatedAt: Date.now(),
      }
    }
    bucket[targetKey] = current

    await persistManifest()
    await cleanupUnreferencedArt(replaced)
    notifyChange()

    return {
      targetType,
      targetKey,
      record: toPublicRecord(current),
      snapshot: snapshot(),
    }
  })
}

/** Updates focal point (`top` | `center` | `bottom`) of an already-claimed artwork slot. */
export async function updateArtworkFocus(payload = {}) {
  const targetType = String(payload.targetType ?? '').trim()
  const targetKey = normalizeTargetKey(targetType, payload.targetKey)
  const slot = String(payload.slot ?? '').trim()
  const focus = String(payload.focus ?? '').trim()
  if (!VALID_SLOTS.has(slot)) throw httpError('Invalid artwork slot', 400)
  if (!VALID_FOCUSES.has(focus)) throw httpError('Focus must be "top", "center", or "bottom"', 400)

  return withTargetLock(`${targetType}:${targetKey}`, async () => {
    const bucket = manifest[targetType]
    const current = bucket && Object.hasOwn(bucket, targetKey) ? bucket[targetKey] : null
    if (!current?.[slot]) throw httpError('No claimed photo in that slot', 404)

    current[slot] = { ...current[slot], focus, updatedAt: Date.now() }
    await persistManifest()
    notifyChange()

    return {
      record: toPublicRecord(current),
      snapshot: snapshot(),
    }
  })
}

/** Removes one claimed slot (or all slots when `slot` is omitted) for a target. */
export async function clearArtwork(payload = {}) {
  const targetType = String(payload.targetType ?? '').trim()
  const targetKey = normalizeTargetKey(targetType, payload.targetKey)
  const slot = payload.slot ? String(payload.slot).trim() : null
  if (slot && !VALID_SLOTS.has(slot)) throw httpError('Invalid artwork slot', 400)

  return withTargetLock(`${targetType}:${targetKey}`, async () => {
    const bucket = manifest[targetType]
    const current = bucket && Object.hasOwn(bucket, targetKey) ? bucket[targetKey] : null
    if (!current) {
      return { removed: false, snapshot: snapshot() }
    }

    const removed = []
    if (slot) {
      if (current[slot]) {
        removed.push(current[slot])
        delete current[slot]
      }
      if (!current.banner && !current.poster && !current.icon) {
        delete bucket[targetKey]
      }
    } else {
      for (const s of VALID_SLOTS) {
        if (current[s]) removed.push(current[s])
      }
      delete bucket[targetKey]
    }

    await persistManifest()
    await cleanupUnreferencedArt(removed)
    notifyChange()

    return {
      removed: removed.length > 0,
      record: Object.hasOwn(bucket, targetKey) ? toPublicRecord(bucket[targetKey]) : null,
      snapshot: snapshot(),
    }
  })
}

/** Streams a verified gallery preview thumbnail from an approved IMDb image CDN. */
export async function fetchPreviewThumbnail(rawUrl) {
  return fetchVerifiedImdbImage(rawUrl, { maxBytes: MAX_PREVIEW_BYTES })
}
