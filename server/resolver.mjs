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
  const cut = page.slice(0, page.indexOf('id="main-sidebar"'))
  const results = []
  const re = /<h3 class="film-name">\s*<a href="[^"]*\/([^"\/]*)"\s*title="([^"]*)"/g
  for (const m of cut.matchAll(re)) {
    if (!results.some((r) => r.slug === m[1])) {
      results.push({ slug: m[1], title: decodeEntities(m[2]) })
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

/**
 * Resolve an episode to a direct video URL + English subtitle + referer.
 * quality: 'best' | 'worst' | '1080' | '720' | '480' | '360'
 */
export async function resolve(query, { resultIndex = 1, episode = 1, quality = 'best', dub = false } = {}) {
  const key = `resolve:${query.toLowerCase()}:${resultIndex}:${episode}:${quality}:${dub}`
  const hit = get(key)
  if (hit) return hit
  const results = await search(query)
  if (results.length === 0) {
    const err = new Error(`No results for "${query}"`)
    err.status = 404
    throw err
  }
  const chosen = results[resultIndex - 1] ?? results[0]
  const eps = await episodes(chosen.slug)
  const entry = eps.find((e) => e.number === Number(episode))
  if (!entry) {
    const err = new Error(`Episode ${episode} is not available for ${chosen.title}`)
    err.status = 404
    throw err
  }
  const mode = dub ? 'dub' : 'sub'
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
    const variants = []
    const lines = masterText.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue
      const height = Number((line.match(/RESOLUTION=(\d+)x(\d+)/) ?? [])[2] ?? 0)
      const url = (lines[i + 1] ?? '').trim()
      if (url && !url.startsWith('#')) variants.push({ height, url: new URL(url, master).href })
    }
    if (variants.length === 0) continue
    variants.sort((a, b) => b.height - a.height)
    let picked = variants[0]
    if (quality === 'worst') picked = variants[variants.length - 1]
    else if (quality !== 'best') {
      const exact = variants.find((v) => v.height === Number(quality))
      if (exact) picked = exact
    }
    out = {
      videoUrl: picked.url,
      height: picked.height,
      subtitleUrl: subs?.src ?? null,
      referer,
      title: chosen.title,
      slug: chosen.slug,
    }
    break
  }
  if (!out) {
    const err = new Error(`No ZokoAnime source for ${chosen.title} EP ${episode} (${mode})`)
    err.status = 404
    throw err
  }
  set(key, out, 10 * MIN)
  return out
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
