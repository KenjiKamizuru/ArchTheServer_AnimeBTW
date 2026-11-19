import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSectionOrder } from './detail.mjs'
import { atomicWriteFile, normalizeHostPatternList, validateLibraryDir } from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.ANIMEVAULT_DATA ? path.resolve(process.env.ANIMEVAULT_DATA) : path.join(ROOT, 'data')
const FILE = path.join(DATA_DIR, 'settings.json')

export const QUALITIES = ['best', '1080', '720', '480', '360', 'worst']
export const MIN_CONCURRENT_DOWNLOADS = 1
export const MAX_CONCURRENT_DOWNLOADS = 12

function clampInt(value, lo, hi, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.floor(n)))
}

function rawEnvLibraryDir() {
  return String(process.env.LIBRARY_DIR ?? process.env.ANIMEVAULT_LIBRARY_DIR ?? '').trim()
}

function defaultConcurrency() {
  return clampInt(process.env.MAX_CONCURRENT_DOWNLOADS, MIN_CONCURRENT_DOWNLOADS, MAX_CONCURRENT_DOWNLOADS, 2)
}

const DEFAULTS = {
  quality: 'best',
  dub: false,
  resultIndex: 1,
  libraryDir: 'library',
  maxConcurrentDownloads: defaultConcurrency(),
  preferLocalPlayback: true,
  autoplayNextEpisode: true,
  allowedExternalHosts: [],
  theme: 'dark',
  systemTheme: false,
  hideListCapacityWarnings: false,
  episodeCompletionThresholdPercent: 90,
  progressSaveIntervalSeconds: 15,
  updatedAt: 0,
}

let state = { ...DEFAULTS }
let resolvedLibraryPath = path.join(ROOT, 'library')
let saveChain = Promise.resolve()

function computeResolvedLibraryDir(configuredDir) {
  const fromEnv = rawEnvLibraryDir()
  if (fromEnv) {
    return validateLibraryDir(fromEnv, ROOT)
  }
  try {
    return validateLibraryDir(configuredDir || 'library', ROOT)
  } catch {
    return path.join(ROOT, 'library')
  }
}

export async function init() {
  try {
    const raw = await fsp.readFile(FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      state = {
        ...DEFAULTS,
        quality: QUALITIES.includes(parsed.quality) ? parsed.quality : DEFAULTS.quality,
        dub: Boolean(parsed.dub),
        resultIndex: clampInt(parsed.resultIndex, 1, 100, DEFAULTS.resultIndex),
        libraryDir: typeof parsed.libraryDir === 'string' && parsed.libraryDir.trim() ? parsed.libraryDir.trim() : 'library',
        maxConcurrentDownloads: clampInt(
          parsed.maxConcurrentDownloads,
          MIN_CONCURRENT_DOWNLOADS,
          MAX_CONCURRENT_DOWNLOADS,
          defaultConcurrency(),
        ),
        preferLocalPlayback:
          parsed.preferLocalPlayback === undefined ? true : Boolean(parsed.preferLocalPlayback),
        // AV-160: auto-advance to the next episode when playback finishes
        // (default on — industry norm; the countdown panel can always
        // cancel, and the toggle lives in Settings).
        autoplayNextEpisode:
          parsed.autoplayNextEpisode === undefined ? true : Boolean(parsed.autoplayNextEpisode),
        allowedExternalHosts: Array.isArray(parsed.allowedExternalHosts)
          ? safeNormalizeHosts(parsed.allowedExternalHosts)
          : [],
        theme: typeof parsed.theme === 'string' && ['dark', 'light'].includes(parsed.theme) ? parsed.theme : DEFAULTS.theme,
        systemTheme: Boolean(parsed.systemTheme),
        hideListCapacityWarnings:
          parsed.hideListCapacityWarnings === undefined ? false : Boolean(parsed.hideListCapacityWarnings),
        // AV-155: episode auto-completion threshold (percent of known runtime).
        episodeCompletionThresholdPercent: clampInt(
          parsed.episodeCompletionThresholdPercent,
          50,
          100,
          DEFAULTS.episodeCompletionThresholdPercent,
        ),
        // AV-153: playback-position save interval (seconds).
        progressSaveIntervalSeconds: clampInt(
          parsed.progressSaveIntervalSeconds,
          5,
          300,
          DEFAULTS.progressSaveIntervalSeconds,
        ),
        // Saved by save() but previously dropped here and never surfaced by
        // get(): registrationOpen/emailAccounts silently re-closed on every
        // restart (and could never open at all), and detailSectionOrder never
        // reached the detail builder (AV-139 fix).
        registrationOpen: parsed.registrationOpen === true,
        emailAccounts: parsed.emailAccounts === true,
        detailSectionOrder: Array.isArray(parsed.detailSectionOrder)
          ? normalizeSectionOrder(parsed.detailSectionOrder)
          : undefined,
        updatedAt: Number(parsed.updatedAt) || 0,
      }
    }
  } catch {
    // First run: defaults.
  }
  // If LIBRARY_DIR is invalid on boot, throw early rather than writing to an unsafe directory.
  resolvedLibraryPath = computeResolvedLibraryDir(state.libraryDir)
}

function safeNormalizeHosts(list) {
  try {
    return normalizeHostPatternList(list)
  } catch {
    return []
  }
}

/** Public settings object returned by GET/PUT /api/settings. */
export function get() {
  const envOverride = Boolean(rawEnvLibraryDir())
  return {
    quality: state.quality,
    dub: state.dub,
    resultIndex: state.resultIndex,
    libraryDir: envOverride ? '(configured via LIBRARY_DIR)' : state.libraryDir,
    libraryDirLocked: envOverride,
    maxConcurrentDownloads: state.maxConcurrentDownloads,
    preferLocalPlayback: state.preferLocalPlayback,
    autoplayNextEpisode: state.autoplayNextEpisode,
    allowedExternalHosts: [...state.allowedExternalHosts],
    envExternalHostsConfigured: Boolean(String(process.env.ALLOWED_SOURCE_HOSTS ?? '').trim()),
    theme: state.theme,
    systemTheme: state.systemTheme,
    hideListCapacityWarnings: state.hideListCapacityWarnings,
    episodeCompletionThresholdPercent: state.episodeCompletionThresholdPercent,
    progressSaveIntervalSeconds: state.progressSaveIntervalSeconds,
    detailSectionOrder: state.detailSectionOrder,
    registrationOpen: state.registrationOpen === true,
    emailAccounts: state.emailAccounts === true,
    updatedAt: state.updatedAt,
  }
}

/** Server-internal canonical path to the shared media library directory. */
export function resolveLibraryDir() {
  return resolvedLibraryPath
}

export async function save(patch = {}) {
  const next = {
    ...state,
    allowedExternalHosts: [...state.allowedExternalHosts],
  }

  if (patch.detailSectionOrder !== undefined) {
    next.detailSectionOrder = normalizeSectionOrder(patch.detailSectionOrder)
  }

  if (patch.hideListCapacityWarnings !== undefined) {
    next.hideListCapacityWarnings = Boolean(patch.hideListCapacityWarnings)
  }

  if (patch.episodeCompletionThresholdPercent !== undefined) {
    next.episodeCompletionThresholdPercent = clampInt(
      patch.episodeCompletionThresholdPercent,
      50,
      100,
      next.episodeCompletionThresholdPercent,
    )
  }

  if (patch.progressSaveIntervalSeconds !== undefined) {
    next.progressSaveIntervalSeconds = clampInt(
      patch.progressSaveIntervalSeconds,
      5,
      300,
      next.progressSaveIntervalSeconds,
    )
  }

  if (patch.autoplayNextEpisode !== undefined) {
    next.autoplayNextEpisode = Boolean(patch.autoplayNextEpisode)
  }

  if (patch.registrationOpen !== undefined) {
    next.registrationOpen = Boolean(patch.registrationOpen)
  }

  if (patch.emailAccounts !== undefined) {
    next.emailAccounts = Boolean(patch.emailAccounts)
  }

  if (patch.quality !== undefined) {
    const quality = String(patch.quality).trim().toLowerCase()
    if (!QUALITIES.includes(quality)) {
      throw Object.assign(new Error('Unsupported quality'), { status: 400 })
    }
    next.quality = quality
  }

  if (patch.resultIndex !== undefined) {
    next.resultIndex = clampInt(patch.resultIndex, 1, 100, next.resultIndex)
  }

  if (patch.dub !== undefined) {
    next.dub = Boolean(patch.dub)
  }

  if (patch.maxConcurrentDownloads !== undefined) {
    const raw = Number(patch.maxConcurrentDownloads)
    if (!Number.isFinite(raw)) {
      throw Object.assign(new Error('Invalid simultaneous download limit'), { status: 400 })
    }
    next.maxConcurrentDownloads = clampInt(
      raw,
      MIN_CONCURRENT_DOWNLOADS,
      MAX_CONCURRENT_DOWNLOADS,
      next.maxConcurrentDownloads,
    )
  }

  if (patch.preferLocalPlayback !== undefined) {
    next.preferLocalPlayback = Boolean(patch.preferLocalPlayback)
  }

  if (patch.theme !== undefined) {
    const theme = String(patch.theme).trim().toLowerCase()
    if (!['dark', 'light'].includes(theme)) {
      throw Object.assign(new Error('Unsupported theme'), { status: 400 })
    }
    next.theme = theme
  }

  if (patch.systemTheme !== undefined) {
    next.systemTheme = Boolean(patch.systemTheme)
  }

  if (patch.libraryDir !== undefined && !rawEnvLibraryDir()) {
    const trimmed = String(patch.libraryDir ?? '').trim() || 'library'
    if (trimmed.length > 512) {
      throw Object.assign(new Error('Library path is too long'), { status: 400 })
    }
    // Validate strictly before persisting (rejects src/, server/, data/, .git/, etc.).
    validateLibraryDir(trimmed, ROOT)
    next.libraryDir = trimmed
  }

  if (patch.allowedExternalHosts !== undefined) {
    next.allowedExternalHosts = normalizeHostPatternList(patch.allowedExternalHosts)
  }

  const nextResolved = computeResolvedLibraryDir(next.libraryDir)
  state = { ...next, updatedAt: Date.now() }
  resolvedLibraryPath = nextResolved

  const serialized = JSON.stringify(state, null, 2)
  saveChain = saveChain
    .catch(() => {})
    .then(() => atomicWriteFile(FILE, serialized))
  await saveChain
  return get()
}

export function stateExists() {
  return fs.existsSync(FILE)
}
