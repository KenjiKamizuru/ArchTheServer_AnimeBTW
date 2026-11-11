import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'settings.json')

export const QUALITIES = ['best', '1080', '720', '480', '360', 'worst']

const DEFAULTS = {
  quality: 'best',
  dub: false,
  resultIndex: 1,
  updatedAt: 0,
}

let state = { ...DEFAULTS }

export async function init() {
  try {
    const raw = await fsp.readFile(FILE, 'utf8')
    state = { ...DEFAULTS, ...JSON.parse(raw) }
    if (!QUALITIES.includes(state.quality)) state.quality = DEFAULTS.quality
  } catch {
    // First run: defaults.
  }
}

export function get() {
  return { ...state }
}

function parseIndex(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(1, Math.floor(n)))
}

export async function save(patch = {}) {
  const next = { ...state }

  if (patch.quality !== undefined) {
    const quality = String(patch.quality).trim().toLowerCase()
    if (!QUALITIES.includes(quality)) {
      throw Object.assign(new Error('Unsupported quality'), { status: 400 })
    }
    next.quality = quality
  }

  if (patch.resultIndex !== undefined) {
    next.resultIndex = parseIndex(patch.resultIndex, next.resultIndex)
  }

  if (patch.dub !== undefined) next.dub = Boolean(patch.dub)

  state = { ...next, updatedAt: Date.now() }
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(FILE, JSON.stringify(state, null, 2))
  return get()
}

export function stateExists() {
  return fs.existsSync(FILE)
}
