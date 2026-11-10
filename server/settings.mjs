import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'settings.json')

export const QUALITIES = ['best', '1080', '720', '480', '360', 'worst']
export const PLAYER_TARGETS = ['mpv', 'app']

const DEFAULTS = {
  anicliBin: 'ani-cli',
  anicliQuality: 'best',
  anicliDub: false,
  anicliResultIndex: 1,
  playerTarget: 'mpv',
  updatedAt: 0,
}

let state = { ...DEFAULTS }

export async function init() {
  try {
    const raw = await fsp.readFile(FILE, 'utf8')
    state = { ...DEFAULTS, ...JSON.parse(raw) }
    if (!QUALITIES.includes(state.anicliQuality)) state.anicliQuality = DEFAULTS.anicliQuality
    if (!PLAYER_TARGETS.includes(state.playerTarget)) state.playerTarget = DEFAULTS.playerTarget
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

  if (patch.playerTarget !== undefined) {
    const target = String(patch.playerTarget)
    if (!PLAYER_TARGETS.includes(target)) {
      throw Object.assign(new Error('Unknown player target'), { status: 400 })
    }
    next.playerTarget = target
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

export function stateExists() {
  return fs.existsSync(FILE)
}
