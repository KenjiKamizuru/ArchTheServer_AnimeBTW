import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'settings.json')

export const PROVIDERS = ['anicli', 'template']
export const QUALITIES = ['best', '1080', '720', '480', '360', 'worst']

const DEFAULTS = {
  downloadProvider: 'anicli',
  sourceTemplate: '',
  anicliBin: 'ani-cli',
  anicliQuality: 'best',
  anicliDub: false,
  anicliResultIndex: 1,
  updatedAt: 0,
}

let state = { ...DEFAULTS }

export async function init() {
  try {
    const raw = await fsp.readFile(FILE, 'utf8')
    state = { ...DEFAULTS, ...JSON.parse(raw) }
    if (!PROVIDERS.includes(state.downloadProvider)) state.downloadProvider = DEFAULTS.downloadProvider
    if (!QUALITIES.includes(state.anicliQuality)) state.anicliQuality = DEFAULTS.anicliQuality
  } catch {
    // First run: defaults.
  }
}

export function get() {
  return { ...state }
}

export function validateTemplate(input) {
  const value = String(input ?? '').trim()
  if (!value) return { ok: true, value: '' }
  if (!/^https?:\/\//i.test(value)) {
    return { ok: false, error: 'The source template must start with http:// or https://' }
  }
  if (!/\{(episode|ep2|ep3)\}/.test(value)) {
    return { ok: false, error: 'Add an episode placeholder such as {ep2} so every episode maps to its own file' }
  }
  return { ok: true, value }
}

const PLACEHOLDERS = ['title', 'romaji', 'id', 'episode', 'ep2', 'ep3']

/** Fills {title} {romaji} {id} {episode} {ep2} {ep3} in a source template. */
export function resolveSource(template, { id, title, romaji, episode }) {
  const ep = Number(episode) || 1
  return String(template)
    .replace(/\{id\}/g, String(id ?? ''))
    .replace(/\{title\}/g, encodeURIComponent(title ?? ''))
    .replace(/\{romaji\}/g, encodeURIComponent(romaji ?? ''))
    .replace(/\{episode\}/g, String(ep))
    .replace(/\{ep2\}/g, String(ep).padStart(2, '0'))
    .replace(/\{ep3\}/g, String(ep).padStart(3, '0'))
}

function parseIndex(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(1, Math.floor(n)))
}

export async function save(patch = {}) {
  const next = { ...state }

  if (patch.downloadProvider !== undefined) {
    const provider = String(patch.downloadProvider)
    if (!PROVIDERS.includes(provider)) {
      throw Object.assign(new Error('Unknown download provider'), { status: 400 })
    }
    next.downloadProvider = provider
  }

  if (patch.sourceTemplate !== undefined) {
    const verdict = validateTemplate(patch.sourceTemplate)
    if (!verdict.ok) throw Object.assign(new Error(verdict.error), { status: 400 })
    next.sourceTemplate = verdict.value
  }

  if (patch.anicliBin !== undefined) {
    const value = String(patch.anicliBin).trim()
    if (/[\n\r]/.test(value)) {
      throw Object.assign(new Error('The ani-cli path cannot contain line breaks'), { status: 400 })
    }
    next.anicliBin = (value || DEFAULTS.anicliBin).slice(0, 300)
  }

  if (patch.anicliQuality !== undefined) {
    const quality = String(patch.anicliQuality).trim().toLowerCase()
    if (!QUALITIES.includes(quality)) {
      throw Object.assign(new Error('Unsupported quality'), { status: 400 })
    }
    next.anicliQuality = quality
  }

  if (patch.anicliResultIndex !== undefined) {
    next.anicliResultIndex = parseIndex(patch.anicliResultIndex, next.anicliResultIndex)
  }

  if (patch.anicliDub !== undefined) next.anicliDub = Boolean(patch.anicliDub)

  state = { ...next, updatedAt: Date.now() }
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(FILE, JSON.stringify(state, null, 2))
  return get()
}

export function placeholders() {
  return PLACEHOLDERS
}

export function stateExists() {
  return fs.existsSync(FILE)
}
