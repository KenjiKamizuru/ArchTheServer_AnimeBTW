import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { get, set } from './cache.mjs'
import {
  atomicWriteFile,
  readResponseTextLimited,
  safeFetch,
  sanitizePublicHttpUrl,
} from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const MATCH_FILE = path.join(DATA_DIR, 'matches.json')
const MAX_RESOLVER_RESPONSE_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
let matches = Object.create(null)
let saveChain = Promise.resolve()

/** Loads saved per-show search matches (data/matches.json). */
export async function init() {
  const next = Object.create(null)
  try {
    const raw = await fsp.readFile(MATCH_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        const id = Number(k)
        if (!Number.isInteger(id) || id <= 0 || !v || typeof v !== 'object') continue
        const q = String(v.query ?? '').trim().slice(0, 200)
        if (!q) continue
        const idx = Math.floor(Number(v.index))
        next[String(id)] = {
          mediaId: id,
          query: q,
          index: Number.isFinite(idx) && idx >= 1 ? Math.min(idx, 100) : 1,
          title: String(v.title ?? '').trim().slice(0, 200),
          updatedAt: Number(v.updatedAt) || 0,
        }
      }
    }
  } catch {
    // First run.
  }
  matches = next
}

export function getMatch(mediaId) {
  const key = String(mediaId)
  if (!/^\d{1,12}$/.test(key) || !Object.hasOwn(matches, key)) return null
  return { ...matches[key] }
}

export async function saveMatch(mediaId, { query, index, title } = {}) {
  const id = Number(mediaId)
  if (!Number.isInteger(id) || id <= 0) return null
  const value = String(query ?? '').trim().slice(0, 200)
  if (!value) return null
  const parsedIndex = Math.floor(Number(index))
  const entry = {
    mediaId: id,
    query: value,
    index: Number.isFinite(parsedIndex) && parsedIndex >= 1 ? Math.min(parsedIndex, 100) : 1,
    title: String(title ?? '').trim().slice(0, 200),
    updatedAt: Date.now(),
  }
  matches[String(id)] = entry
  const payload = JSON.stringify(matches, null, 2)
  saveChain = saveChain
    .catch(() => {})
    .then(() => atomicWriteFile(MATCH_FILE, payload))
  await saveChain
  return { ...entry }
}

// Built-in resolver for the hianime.at provider (ZokoAnime embed), reimplemented
// from the open-source ani-cli scraping scripts in JavaScript. No external
// binaries: search, episode lists, embed deobfuscation, quality selection.
const BASE = 'https://hianime.at'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const KEY = 'otaku-embed-v1'
const MIN = 60_000
const inflight = new Map()

function resolveSafeHttpUrl(rawUri, baseUrl) {
  try {
    const u = baseUrl ? new URL(String(rawUri).trim(), baseUrl) : new URL(String(rawUri).trim())
    return sanitizePublicHttpUrl(u.href, { httpsOnly: false, maxLen: 4096 })
  } catch {
    return null
  }
}

async function html(url, referer) {
  let response
  try {
    ;({ response } = await safeFetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/json,*/*',
        ...(referer ? { Referer: referer } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      requireApprovedHost: false,
    }))
  } catch (err) {
    if (Number.isInteger(err?.status)) throw err
    // Provider unreachable (DNS/TLS/reset/timeout) is an upstream gateway failure,
    // not a local bug — surface 502 instead of an opaque 500.
    const wrapped = new Error('Anime provider is unreachable right now')
    wrapped.status = 502
    throw wrapped
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {})
    const err = new Error(`Provider responded with HTTP ${response.status}`)
    err.status = response.status === 404 ? 404 : 502
    throw err
  }
  const text = await readResponseTextLimited(response, MAX_RESOLVER_RESPONSE_BYTES, 'Provider response')
  if (text.includes('Just a moment')) {
    const err = new Error('Blocked by Cloudflare at hianime.at')
    err.status = 502
    throw err
  }
  return text
}

function decodeEntities(s) {
  return s.replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

// Embed config ships as base64(json XOR "otaku-embed-v1"), key rotates per byte.
function deobfuscate(blob) {
  const bytes = Buffer.from(blob, 'base64')
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] ^ KEY.charCodeAt(i % KEY.length))
  return out
}

export async function search(query) {
  const key = `search:${query.toLowerCase()}`
  const hit = get(key)
  if (hit) return hit
  const page = await html(`${BASE}/search?keyword=${encodeURIComponent(query)}`)
  const sidebar = page.indexOf('id="main-sidebar"')
  const cut = sidebar >= 0 ? page.slice(0, sidebar) : page
  const results = []
  const re = /<h3 class="film-name">\s*<a href="[^"]*\/([^"\/]*)"\s*title="([^"]*)"/g
  for (const m of cut.matchAll(re)) {
    if (!results.some((r) => r.slug === m[1])) {
      results.push({ index: results.length + 1, slug: m[1], title: decodeEntities(m[2]) })
    }
  }
  set(key, results, 10 * MIN)
  return results
}

/** Episode list for a slug: [{ number, epId }] (api takes the trailing numeric id) */
export async function episodes(slug) {
  const cleanSlug = String(slug ?? '').trim()
  const numericId = cleanSlug.split('-').pop() ?? ''
  if (!/^\d{1,12}$/.test(numericId)) {
    throw Object.assign(new Error('Invalid provider title slug'), { status: 400 })
  }
  const key = `eps:${cleanSlug}`
  const hit = get(key)
  if (hit) return hit
  const body = await html(`${BASE}/api/theme/episode/list/${numericId}`)
  const list = JSON.parse(body).html ?? ''
  const eps = []
  for (const m of list.matchAll(/data-number="(\d+)"[^>]*data-id="(\d+)"|data-id="(\d+)"[^>]*data-number="(\d+)"/g)) {
    const num = Number(m[1] ?? m[4])
    const id = m[2] ?? m[3]
    if (num && id) eps.push({ epId: id, number: num })
  }
  set(key, eps, 10 * MIN)
  return eps
}

/** Resolves the available episode list for a search query + 1-based result index. */
export async function episodesForQuery(query, { resultIndex = 1 } = {}) {
  const index = Math.min(100, Math.max(1, Math.floor(Number(resultIndex) || 1)))
  const results = await search(query)
  if (results.length === 0) {
    const err = new Error(`No results for "${query}"`)
    err.status = 404
    throw err
  }
  const chosen = results[index - 1] ?? results[0]
  const eps = await episodes(chosen.slug)
  return {
    title: chosen.title,
    slug: chosen.slug,
    index: chosen.index,
    episodes: eps.map((e) => e.number).sort((a, b) => a - b),
  }
}

function parseAttributes(line) {
  const attrs = {}
  const re = /(?:^|,)\s*([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/gi
  for (const match of line.matchAll(re)) {
    attrs[match[1].toUpperCase()] = (match[2] ?? match[3] ?? '').trim()
  }
  return attrs
}

function isEnglishTrack(track) {
  return /^en(?:g|[-_]|$)/i.test(track.language) || /\benglish\b/i.test(track.name)
}

function isJapaneseTrack(track) {
  return /^(?:ja|jpn)(?:[-_]|$)/i.test(track.language) || /\bjapanese\b/i.test(track.name)
}

function chooseAudioRendition(renditions, audioGroup, { dub = false } = {}) {
  if (renditions.length === 0) return null
  const grouped = audioGroup ? renditions.filter((entry) => entry.groupId === audioGroup) : []
  const candidates = grouped.length > 0 ? grouped : renditions

  // Dub servers sometimes expose English as a non-default rendition alongside
  // the original audio; prefer it so dub mode does not play the Japanese track.
  if (dub) {
    const picked =
      candidates.find((entry) => isEnglishTrack(entry) && entry.isDefault) ||
      candidates.find(isEnglishTrack) ||
      candidates.find((entry) => entry.isDefault) ||
      candidates.find((entry) => entry.isAutoSelect) ||
      candidates[0]
    return picked?.uri ?? null
  }

  const picked =
    candidates.find((entry) => entry.isDefault && !isEnglishTrack(entry)) ||
    candidates.find(isJapaneseTrack) ||
    candidates.find((entry) => entry.isDefault) ||
    candidates.find((entry) => entry.isAutoSelect && !isEnglishTrack(entry)) ||
    candidates.find((entry) => entry.isAutoSelect) ||
    candidates[0]
  return picked?.uri ?? null
}

function sumHlsDuration(text) {
  let total = 0
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.trim().match(/^#EXTINF:\s*([0-9]+(?:\.[0-9]+)?)/i)
    if (!m) continue
    const sec = Number.parseFloat(m[1])
    if (Number.isFinite(sec) && sec > 0) total += sec
  }
  return total > 0 ? Math.round(total * 100) / 100 : null
}

/**
 * Parses an HLS master playlist, selecting the requested video variant and any
 * separate `EXT-X-MEDIA:TYPE=AUDIO` rendition attached to it.
 */
export function parseMasterPlaylist(masterText, masterUrl, { quality = 'best', dub = false } = {}) {
  const variants = []
  const audioRenditions = []
  const lines = String(masterText ?? '').split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^#EXT-X-MEDIA:/i.test(line)) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1))
      if (attrs.TYPE?.toUpperCase() !== 'AUDIO') continue
      let audioUri = null
      if (attrs.URI) {
        audioUri = resolveSafeHttpUrl(attrs.URI, masterUrl)
        if (!audioUri) continue
      }
      audioRenditions.push({
        groupId: attrs['GROUP-ID'] || '',
        name: attrs.NAME || '',
        language: attrs.LANGUAGE || '',
        isDefault: /^YES$/i.test(attrs.DEFAULT || ''),
        isAutoSelect: /^YES$/i.test(attrs.AUTOSELECT || ''),
        // RFC 8216: an AUDIO rendition without URI is muxed into the variant.
        uri: audioUri,
      })
      continue
    }
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue
    const attrs = parseAttributes(line.slice(line.indexOf(':') + 1))
    const height = Number((attrs.RESOLUTION?.match(/(\d+)x(\d+)/i) ?? [])[2] ?? 0)
    const bandwidth = Number(attrs.BANDWIDTH ?? 0)
    let target = ''
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim()
      if (!next) continue
      if (!next.startsWith('#')) target = next
      i = j
      break
    }
    if (target) {
      const safeVariantUrl = resolveSafeHttpUrl(target, masterUrl)
      if (!safeVariantUrl) continue
      variants.push({
        height,
        bandwidth,
        audioGroup: attrs.AUDIO || null,
        url: safeVariantUrl,
      })
    }
  }

  if (variants.length === 0) {
    if (/^#EXTINF:/im.test(masterText)) {
      const safeMaster = resolveSafeHttpUrl(masterUrl)
      return safeMaster ? { videoUrl: safeMaster, audioUrl: null, height: 0, hls: true } : null
    }
    return null
  }

  variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth)
  let picked = variants[0]
  if (quality === 'worst') {
    picked = variants[variants.length - 1]
  } else if (quality !== 'best') {
    const exact = variants.find((v) => v.height === Number(quality))
    if (exact) picked = exact
  }

  const resolvedAudio = chooseAudioRendition(audioRenditions, picked.audioGroup, { dub })
  const audioUrl = resolvedAudio && resolvedAudio !== picked.url ? resolvedAudio : null

  return {
    videoUrl: picked.url,
    audioUrl,
    height: picked.height,
    hls: true,
  }
}

/**
 * Resolve an episode to a direct video URL (+ separate audio URL when split) +
 * English subtitle + referer.
 * quality: 'best' | 'worst' | '1080' | '720' | '480' | '360'
 */
export async function resolve(query, { resultIndex = 1, episode = 1, quality = 'best', dub = false } = {}) {
  const index = Math.min(100, Math.max(1, Math.floor(Number(resultIndex) || 1)))
  const ep = Math.max(1, Number(episode) || 1)
  const wantedQuality = String(quality || 'best').toLowerCase()
  const wantDub = Boolean(dub)
  const key = `resolve:${query.toLowerCase()}:${index}:${ep}:${wantedQuality}:${wantDub}`
  const hit = get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async () => {
    const results = await search(query)
    if (results.length === 0) {
      const err = new Error(`No results for "${query}"`)
      err.status = 404
      throw err
    }
    const chosen = results[index - 1] ?? results[0]
    const eps = await episodes(chosen.slug)
    const entry = eps.find((e) => e.number === ep)
    if (!entry) {
      const err = new Error(`Episode ${ep} is not available for ${chosen.title}`)
      err.status = 404
      throw err
    }
    if (!/^\d{1,12}$/.test(String(entry.epId))) {
      throw Object.assign(new Error('Invalid provider episode id'), { status: 502 })
    }
    const mode = wantDub ? 'dub' : 'sub'
    const servers = JSON.parse(await html(`${BASE}/api/theme/episode/servers?episodeId=${entry.epId}`))
    const serverHtml = (servers.html ?? '').replace(/\\"/g, '"')
    let out = null
    for (const tag of serverHtml.match(/<div[^>]*server-item[^>]*>/g) ?? []) {
      if (!tag.includes('data-server-name="ZokoAnime"')) continue
      const type = (tag.match(/data-type="([^"]+)"/) ?? [])[1]
      const hash = (tag.match(/data-hash="([^"]+)"/) ?? [])[1]
      if (type !== mode || !hash || hash.length > 2048) continue
      const embed = resolveSafeHttpUrl(Buffer.from(hash, 'base64').toString('utf8'))
      if (!embed) continue
      const page = await html(embed)
      const blob = (page.match(/window\.__P="([^"]+)"/) ?? [])[1]
      if (!blob || blob.length > 65_536) continue
      let config
      try {
        config = JSON.parse(deobfuscate(blob))
      } catch {
        continue
      }
      const master = config?.src ? resolveSafeHttpUrl(config.src, embed) : null
      if (!master) continue
      const embedUrl = new URL(embed)
      const referer = `${embedUrl.protocol}//${embedUrl.host}/`
      const subs = (config.subtitles ?? []).find((s) => s?.default === true) ?? (config.subtitles ?? [])[0]
      const safeSubUrl = subs?.src ? resolveSafeHttpUrl(subs.src, embed) : null
      const masterText = await html(master, referer)
      const selected = parseMasterPlaylist(masterText, master, { quality: wantedQuality, dub: wantDub })
      if (!selected) continue
      let durationSec = /^#EXTINF:/im.test(masterText) ? sumHlsDuration(masterText) : null
      if (durationSec === null && selected.hls) {
        try {
          const variantText = await html(selected.videoUrl, referer)
          durationSec = sumHlsDuration(variantText)
        } catch {
          durationSec = null
        }
      }
      out = {
        videoUrl: selected.videoUrl,
        audioUrl: selected.audioUrl,
        height: selected.height,
        hls: selected.hls,
        durationSec,
        subtitleUrl: safeSubUrl,
        referer,
        title: chosen.title,
        slug: chosen.slug,
      }
      break
    }
    if (!out) {
      const err = new Error(`No ZokoAnime source for ${chosen.title} EP ${ep} (${mode})`)
      err.status = 404
      throw err
    }
    set(key, out, 10 * MIN)
    return out
  })()

  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

/** Provider status for the settings page. */
export async function status() {
  const key = 'status'
  const hit = get(key)
  if (hit) return hit
  let reachable = false
  let error = null
  try {
    const { response } = await safeFetch(`${BASE}/search?keyword=test`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    })
    const body = await readResponseTextLimited(response, MAX_RESOLVER_RESPONSE_BYTES, 'Provider status')
    reachable = response.ok && !body.includes('Just a moment')
    if (!reachable) error = `HTTP ${response.status} from hianime.at`
  } catch (err) {
    error = String(err?.message || 'Provider unreachable').slice(0, 200)
  }
  const out = { reachable, error }
  set(key, out, 5 * MIN)
  return out
}
