import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { get, set } from './cache.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const MATCH_FILE = path.join(DATA_DIR, 'matches.json')
let matches = {}

/** Loads saved per-show search matches (data/matches.json). */
export async function init() {
  try {
    const raw = await fsp.readFile(MATCH_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') matches = parsed
  } catch {
    // First run.
  }
}

export function getMatch(mediaId) {
  const entry = matches[String(mediaId)]
  return entry ? { ...entry } : null
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
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(MATCH_FILE, JSON.stringify(matches, null, 2))
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

async function html(url, referer) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*', ...(referer ? { referer } : {}) },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  const text = await res.text()
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
  const key = `eps:${slug}`
  const hit = get(key)
  if (hit) return hit
  const body = await html(`${BASE}/api/theme/episode/list/${slug.split('-').pop()}`)
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
      audioRenditions.push({
        groupId: attrs['GROUP-ID'] || '',
        name: attrs.NAME || '',
        language: attrs.LANGUAGE || '',
        isDefault: /^YES$/i.test(attrs.DEFAULT || ''),
        isAutoSelect: /^YES$/i.test(attrs.AUTOSELECT || ''),
        // RFC 8216: an AUDIO rendition without URI is muxed into the variant.
        uri: attrs.URI ? new URL(attrs.URI, masterUrl).href : null,
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
      variants.push({
        height,
        bandwidth,
        audioGroup: attrs.AUDIO || null,
        url: new URL(target, masterUrl).href,
      })
    }
  }

  if (variants.length === 0) {
    if (/^#EXTINF:/im.test(masterText)) {
      return { videoUrl: masterUrl, audioUrl: null, height: 0, hls: true }
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
    const mode = wantDub ? 'dub' : 'sub'
    const servers = JSON.parse(await html(`${BASE}/api/theme/episode/servers?episodeId=${entry.epId}`))
    const serverHtml = (servers.html ?? '').replace(/\\"/g, '"')
    let out = null
    for (const tag of serverHtml.match(/<div[^>]*server-item[^>]*>/g) ?? []) {
      if (!tag.includes('data-server-name="ZokoAnime"')) continue
      const type = (tag.match(/data-type="([^"]+)"/) ?? [])[1]
      const hash = (tag.match(/data-hash="([^"]+)"/) ?? [])[1]
      if (type !== mode || !hash) continue
      const embed = Buffer.from(hash, 'base64').toString('utf8')
      const page = await html(embed)
      const blob = (page.match(/window\.__P="([^"]+)"/) ?? [])[1]
      if (!blob) continue
      const config = JSON.parse(deobfuscate(blob))
      const master = config.src
      if (!master) continue
      const embedUrl = new URL(embed)
      const referer = `${embedUrl.protocol}//${embedUrl.host}/`
      const subs = (config.subtitles ?? []).find((s) => s.default === true) ?? (config.subtitles ?? [])[0]
      const masterText = await html(master, referer)
      const selected = parseMasterPlaylist(masterText, master, { quality: wantedQuality, dub: wantDub })
      if (!selected) continue
      out = {
        videoUrl: selected.videoUrl,
        audioUrl: selected.audioUrl,
        height: selected.height,
        hls: selected.hls,
        subtitleUrl: subs?.src ?? null,
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
    const res = await fetch(`${BASE}/search?keyword=test`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
    })
    const body = await res.text()
    reachable = res.ok && !body.includes('Just a moment')
    if (!reachable) error = `HTTP ${res.status} from hianime.at`
  } catch (err) {
    error = err.message
  }
  const out = { reachable, error }
  set(key, out, 5 * MIN)
  return out
}
