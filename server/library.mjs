// Shared local media library manager.
//
// Organizes downloaded episodes under:
//   <libraryDir>/<Anime Name>/Season 01/<Anime Name> - S01E01.mp4
// Discovers both managed anime episodes/movies and arbitrary unknown .mp4/video
// files placed inside <libraryDir>, exposes only opaque file IDs over the API,
// commits downloads atomically without overwriting existing media, and deletes
// local copies without touching anime bookmarks or metadata.

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as settings from './settings.mjs'
import * as playback from './playback.mjs'
import {
  ensureSafeLibraryParentDir,
  inspectMp4File,
  resolveInsideLibrary,
  sanitizeFileName,
  sanitizeFileSegment,
  verifyRegularLibraryFile,
} from './security.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const INDEX_FILE = path.join(DATA_DIR, 'library-index.json')
const INCOMPLETE_DIR = '.incomplete'
const MAX_SCAN_DEPTH = 6
const MAX_SCAN_FILES = 10_000
const SCAN_CACHE_TTL_MS = 1_500

/** relPosix -> metadata record persisted in data/library-index.json */
let catalog = {}
/** Cached scan snapshot */
let cachedScan = { at: 0, dir: '', items: [], byId: new Map(), byRel: new Map() }
const changeListeners = new Set()

export function onChange(listener) {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
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

export function invalidateCache() {
  cachedScan.at = 0
}

async function persistCatalog() {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${INDEX_FILE}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(catalog, null, 2))
  await fsp.rename(tmp, INDEX_FILE)
}

export async function init() {
  try {
    const raw = await fsp.readFile(INDEX_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      catalog = parsed
    }
  } catch {
    catalog = {}
  }
  await ensureLibraryDir()
}

/** Ensures the shared library folder (and its internal .incomplete staging dir) exist. */
export async function ensureLibraryDir() {
  const dir = settings.resolveLibraryDir()
  await fsp.mkdir(dir, { recursive: true })
  const st = await fsp.lstat(dir)
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw Object.assign(new Error('Library path must be a real directory, not a symlink'), { status: 400 })
  }
  await fsp.mkdir(path.join(dir, INCOMPLETE_DIR), { recursive: true })
  return dir
}

/** Returns an absolute temporary path inside `<libraryDir>/.incomplete/` for atomic staging. */
export async function allocateTempPath(name) {
  const dir = await ensureLibraryDir()
  const safe = String(name ?? '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
  if (!safe) throw new Error('Invalid temp file name')
  const { absPath } = resolveInsideLibrary(dir, `${INCOMPLETE_DIR}/${safe}`, { allowIncomplete: true })
  return absPath
}

/** Removes orphaned `.part*` files in `.incomplete/` that belong to no active/paused job. */
export async function cleanupIncompleteFiles(keepFileNames = new Set()) {
  const dir = settings.resolveLibraryDir()
  const incDir = path.join(dir, INCOMPLETE_DIR)
  let entries
  try {
    entries = await fsp.readdir(incDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (keepFileNames.has(entry.name)) continue
    if (!entry.isFile()) continue
    await fsp.rm(path.join(incDir, entry.name), { force: true }).catch(() => {})
  }
}

/** Deterministic opaque ID for a relative POSIX path inside the library. */
export function fileIdFor(relPosix) {
  const digest = crypto.createHash('sha256').update(String(relPosix)).digest('hex').slice(0, 20)
  return `f_${digest}`
}

function normalizeLookupKey(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, '')
}

const SEASON_SUFFIX_PATTERNS = [
  /^(.*?)[\s:–—-]+season\s+(\d{1,2})\s*$/i,
  /^(.*?)[\s:–—-]+(\d{1,2})(?:st|nd|rd|th)\s+season\s*$/i,
  /^(.*?)[\s:–—-]+s(\d{1,2})\s*$/i,
]

/**
 * Extracts a clean base series name and season number from an anime title so
 * multi-season shows share one `<Anime Name>/Season XX/` folder tree.
 */
export function inferSeriesAndSeason(rawTitle, explicitSeason) {
  const cleaned = String(rawTitle ?? '').trim() || 'Anime'
  let baseTitle = cleaned
  let detectedSeason = 1

  for (const re of SEASON_SUFFIX_PATTERNS) {
    const match = cleaned.match(re)
    if (match && match[1]?.trim() && Number(match[2]) >= 1 && Number(match[2]) <= 99) {
      baseTitle = match[1].trim()
      detectedSeason = Number(match[2])
      break
    }
  }

  const parsedExplicit = Number(explicitSeason)
  const season =
    Number.isFinite(parsedExplicit) && parsedExplicit >= 1
      ? Math.min(99, Math.floor(parsedExplicit))
      : detectedSeason

  return {
    seriesTitle: baseTitle,
    seriesFolder: sanitizeFileSegment(baseTitle, 'Anime', 80),
    season,
  }
}

export function formatSeasonEpisodeCode(season, episode) {
  const s = String(Math.max(1, Math.floor(Number(season) || 1))).padStart(2, '0')
  const e = String(Math.max(1, Math.floor(Number(episode) || 1))).padStart(2, '0')
  return `S${s}E${e}`
}

/**
 * Builds the canonical relative path inside the shared library:
 *   `<Anime Name>/Season 01/<Anime Name> - S01E01.mp4`
 */
export function buildEpisodeLocation(rawTitle, { season, episode, seriesTitle, ext = '.mp4' } = {}) {
  const inferred = inferSeriesAndSeason(seriesTitle || rawTitle, season)
  const ep = Math.min(9999, Math.max(1, Math.floor(Number(episode) || 1)))
  const safeExt = playback.VIDEO_EXTENSIONS.has(String(ext).toLowerCase())
    ? String(ext).toLowerCase()
    : '.mp4'
  const seasonTag = String(inferred.season).padStart(2, '0')
  const epTag = String(ep).padStart(2, '0')
  const seasonFolder = `Season ${seasonTag}`
  const fileName = `${inferred.seriesFolder} - S${seasonTag}E${epTag}${safeExt}`
  const relPosix = `${inferred.seriesFolder}/${seasonFolder}/${fileName}`

  // Cross-check through resolveInsideLibrary as a defense-in-depth invariant.
  resolveInsideLibrary(settings.resolveLibraryDir(), relPosix)

  return {
    seriesTitle: inferred.seriesTitle,
    seriesFolder: inferred.seriesFolder,
    seasonFolder,
    season: inferred.season,
    episode: ep,
    fileName,
    relPosix,
  }
}

/** Checks whether a canonical relative library file currently exists on disk. */
export async function getExistingByRelPath(relPosix) {
  const dir = settings.resolveLibraryDir()
  let absPath
  try {
    absPath = resolveInsideLibrary(dir, relPosix).absPath
  } catch {
    return null
  }
  const verified = await verifyRegularLibraryFile(dir, absPath)
  if (!verified) return null
  return {
    id: fileIdFor(relPosix),
    relPosix,
    size: verified.size,
    mtimeMs: verified.mtimeMs,
  }
}

/**
 * Atomically moves `tempAbsPath` into `<libraryDir>/<targetRelPath>` without
 * ever overwriting an existing file.
 */
export async function commitTempFile(tempAbsPath, targetRelPath, metadata = null) {
  const dir = await ensureLibraryDir()
  const { absPath: destAbs, relPosix } = resolveInsideLibrary(dir, targetRelPath)
  await ensureSafeLibraryParentDir(dir, destAbs)

  // Fast check: never replace an existing library file.
  try {
    await fsp.lstat(destAbs)
    await fsp.rm(tempAbsPath, { force: true }).catch(() => {})
    const err = Object.assign(new Error('Episode file already exists in library'), {
      code: 'EEXIST',
      status: 409,
      fileId: fileIdFor(relPosix),
    })
    throw err
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
  }

  // Atomic, non-overwriting commit: hardlink fails atomically with EEXIST on POSIX.
  try {
    await fsp.link(tempAbsPath, destAbs)
    await fsp.unlink(tempAbsPath)
  } catch (err) {
    if (err?.code === 'EEXIST') {
      await fsp.rm(tempAbsPath, { force: true }).catch(() => {})
      throw Object.assign(new Error('Episode file already exists in library'), {
        code: 'EEXIST',
        status: 409,
        fileId: fileIdFor(relPosix),
      })
    }
    if (err?.code === 'EXDEV') {
      // Cross-device fallback: exclusive copy into a sibling temp file, fsync, then rename.
      const siblingTmp = path.join(
        path.dirname(destAbs),
        `.commit-${crypto.randomBytes(6).toString('hex')}.tmp`,
      )
      try {
        await fsp.copyFile(tempAbsPath, siblingTmp, fs.constants.COPYFILE_EXCL)
        const fh = await fsp.open(siblingTmp, 'r+')
        try {
          await fh.sync()
        } finally {
          await fh.close()
        }
        try {
          await fsp.lstat(destAbs)
          await fsp.rm(siblingTmp, { force: true }).catch(() => {})
          throw Object.assign(new Error('Episode file already exists in library'), {
            code: 'EEXIST',
            status: 409,
            fileId: fileIdFor(relPosix),
          })
        } catch (checkErr) {
          if (checkErr?.code !== 'ENOENT') throw checkErr
        }
        await fsp.rename(siblingTmp, destAbs)
        await fsp.rm(tempAbsPath, { force: true }).catch(() => {})
      } catch (copyErr) {
        await fsp.rm(siblingTmp, { force: true }).catch(() => {})
        throw copyErr
      }
    } else if (err?.code === 'EPERM' || err?.code === 'ENOTSUP' || err?.code === 'ENOSYS') {
      // Filesystems without hardlink support (e.g. exFAT / certain SMB mounts).
      await fsp.rename(tempAbsPath, destAbs)
    } else {
      throw err
    }
  }

  const verified = await verifyRegularLibraryFile(dir, destAbs)
  if (!verified) {
    throw new Error('Committed file failed library integrity check')
  }

  if (metadata && typeof metadata === 'object') {
    catalog[relPosix] = {
      relPosix,
      mediaId: Number.isInteger(metadata.mediaId) && metadata.mediaId > 0 ? metadata.mediaId : null,
      animeTitle: metadata.animeTitle ? String(metadata.animeTitle).slice(0, 200) : null,
      seriesTitle: metadata.seriesTitle ? String(metadata.seriesTitle).slice(0, 200) : null,
      season: Number.isInteger(metadata.season) && metadata.season >= 1 ? metadata.season : null,
      episode: Number.isInteger(metadata.episode) && metadata.episode >= 1 ? metadata.episode : null,
      quality: metadata.quality ? String(metadata.quality).slice(0, 32) : null,
      resolvedHeight: Number.isFinite(metadata.resolvedHeight) && metadata.resolvedHeight > 0 ? metadata.resolvedHeight : null,
      dub: Boolean(metadata.dub),
      format: metadata.format ? String(metadata.format).slice(0, 32) : null,
      cover: metadata.cover ? String(metadata.cover).slice(0, 500) : null,
      sourceType: metadata.sourceType === 'external' ? 'external' : metadata.sourceType === 'import' ? 'import' : 'resolver',
      addedAt: Date.now(),
    }
    await persistCatalog()
  }

  invalidateCache()
  notifyChange()
  return {
    id: fileIdFor(relPosix),
    relPosix,
    size: verified.size,
  }
}

/** Atomically writes a sidecar `.vtt` subtitle alongside a library video without overwriting. */
export async function commitSidecarSubtitle(videoRelPosix, vttText) {
  if (!vttText || !String(vttText).trim()) return false
  const dir = await ensureLibraryDir()
  const ext = path.posix.extname(videoRelPosix)
  const subRelPosix = `${videoRelPosix.slice(0, videoRelPosix.length - ext.length)}.vtt`
  const { absPath: subAbs } = resolveInsideLibrary(dir, subRelPosix)

  try {
    await fsp.lstat(subAbs)
    return true // Preserve existing subtitle file.
  } catch (err) {
    if (err?.code !== 'ENOENT') return false
  }

  const tempSub = await allocateTempPath(`sub-${crypto.randomBytes(8).toString('hex')}.part.vtt`)
  try {
    await ensureSafeLibraryParentDir(dir, subAbs)
    await fsp.writeFile(tempSub, vttText, 'utf8')
    await fsp.rename(tempSub, subAbs)
    invalidateCache()
    return true
  } catch {
    await fsp.rm(tempSub, { force: true }).catch(() => {})
    return false
  }
}

/**
 * Infers metadata from a relative library path for files not in `library-index.json`.
 * Canonical `Anime/Season 01/Anime - S01E01.mp4` files are parsed cleanly;
 * arbitrary files (e.g. `unknown.mp4`, `Unsorted/clip.mp4`) return `known: false`.
 */
function inferFromPath(relPosix) {
  const parts = relPosix.split('/')
  const fileName = parts.at(-1) ?? relPosix
  const ext = path.posix.extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : ''
  const topFolder = parts.length >= 2 ? parts[0] : ''

  const qualityMatch = stem.match(/\b(2160|1440|1080|720|480|360)p\b/i)
  const inferredQuality = qualityMatch ? qualityMatch[1] : null
  const inferredDub = /\b(?:dub|dubbed|dual[-.\s]?audio)\b/i.test(stem)

  // Standard S01E02 / s1e2 pattern (including `Anime Name - S01E01.mp4`).
  const sxe = stem.match(/^(.*?)[\s._-]*\bS(\d{1,2})E(\d{1,4})\b/i)
  if (sxe) {
    const season = Number(sxe[2])
    const episode = Number(sxe[3])
    const fromStem = sxe[1].replace(/[\s._-]+$/g, '').trim()
    const series =
      (topFolder && topFolder.toLowerCase() !== 'unsorted' && !/^season\s+\d+$/i.test(topFolder)
        ? topFolder
        : '') ||
      fromStem ||
      null
    if (series && season >= 1 && episode >= 1) {
      return {
        known: true,
        seriesTitle: series,
        animeTitle: series,
        season,
        episode,
        quality: inferredQuality,
        dub: inferredDub,
        isMovie: /\bmovie\b/i.test(relPosix),
      }
    }
  }

  // `Anime Name/Season 01/Episode 03.mp4` or `Anime Name/Season 01/03.mp4`
  const seasonFolderMatch = parentFolder.match(/^Season\s+(\d{1,2})$/i)
  if (seasonFolderMatch && parts.length >= 3 && topFolder.toLowerCase() !== 'unsorted') {
    const epMatch = stem.match(/(?:^|\b(?:ep|episode)[\s._-]*)(\d{1,4})\b/i)
    if (epMatch && Number(epMatch[1]) >= 1) {
      return {
        known: true,
        seriesTitle: topFolder,
        animeTitle: topFolder,
        season: Number(seasonFolderMatch[1]),
        episode: Number(epMatch[1]),
        quality: inferredQuality,
        dub: inferredDub,
        isMovie: false,
      }
    }
  }

  // `Movies/Movie Title.mp4` or `Movie Title/Movie/Movie Title.mp4`
  if (/^movies?$/i.test(topFolder) || /^movies?$/i.test(parentFolder)) {
    const movieTitle =
      !/^movies?$/i.test(topFolder) && topFolder ? topFolder : stem.replace(/[._]+/g, ' ').trim()
    return {
      known: true,
      seriesTitle: movieTitle,
      animeTitle: movieTitle,
      season: 1,
      episode: 1,
      quality: inferredQuality,
      dub: inferredDub,
      isMovie: true,
    }
  }

  // Arbitrary / unknown MP4 or video file in the library.
  return {
    known: false,
    seriesTitle: null,
    animeTitle: null,
    season: null,
    episode: null,
    quality: inferredQuality,
    dub: inferredDub,
    isMovie: false,
  }
}

function toPublicItem(entry) {
  return {
    id: entry.id,
    fileName: entry.fileName,
    folder: entry.folder,
    container: entry.container,
    mediaId: entry.mediaId,
    seriesTitle: entry.seriesTitle,
    animeTitle: entry.animeTitle,
    season: entry.season,
    episode: entry.episode,
    quality: entry.quality,
    resolvedHeight: entry.resolvedHeight,
    dub: entry.dub,
    format: entry.format,
    isMovie: entry.isMovie,
    known: entry.known,
    cover: entry.cover,
    size: entry.size,
    addedAt: entry.addedAt,
    modifiedAt: entry.modifiedAt,
    hasSubtitle: entry.hasSubtitle,
    directPlayable: entry.directPlayable,
  }
}

async function scanInternal({ fresh = false } = {}) {
  const dir = settings.resolveLibraryDir()
  const now = Date.now()
  if (!fresh && cachedScan.dir === dir && now - cachedScan.at < SCAN_CACHE_TTL_MS) {
    return cachedScan
  }

  let realLib
  try {
    const st = await fsp.lstat(dir)
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('not a dir')
    realLib = await fsp.realpath(dir)
  } catch {
    const empty = { at: now, dir, items: [], byId: new Map(), byRel: new Map() }
    cachedScan = empty
    return empty
  }

  const found = []

  async function walk(absDir, relPrefix, depth) {
    if (depth > MAX_SCAN_DEPTH || found.length >= MAX_SCAN_FILES) return
    let dirents
    try {
      dirents = await fsp.readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const dirent of dirents) {
      if (found.length >= MAX_SCAN_FILES) break
      const name = dirent.name
      // Skip hidden entries (including `.incomplete`) and symlinks.
      if (!name || name.startsWith('.') || dirent.isSymbolicLink()) continue

      const absChild = path.join(absDir, name)
      const relPosix = relPrefix ? `${relPrefix}/${name}` : name

      if (dirent.isDirectory()) {
        await walk(absChild, relPosix, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue

      const ext = path.extname(name).toLowerCase()
      if (!playback.VIDEO_EXTENSIONS.has(ext)) continue

      let st
      try {
        st = await fsp.lstat(absChild)
        if (!st.isFile() || st.isSymbolicLink()) continue
        const realFile = await fsp.realpath(absChild)
        const checkRel = path.relative(realLib, realFile)
        if (!checkRel || checkRel.startsWith('..') || path.isAbsolute(checkRel)) continue
      } catch {
        continue
      }

      const meta = catalog[relPosix] ?? null
      const inferred = inferFromPath(relPosix)
      const isCatalogedEpisode = Boolean(
        meta && meta.sourceType !== 'import' && (meta.seriesTitle || meta.animeTitle),
      )
      const known = isCatalogedEpisode || (meta?.mediaId ? true : inferred.known)
      const format = meta?.format ?? (inferred.isMovie ? 'MOVIE' : null)
      const isMovie = format === 'MOVIE' || Boolean(inferred.isMovie)
      const folder = relPrefix || ''

      found.push({
        id: fileIdFor(relPosix),
        relPosix,
        absPath: absChild,
        fileName: name,
        folder,
        container: ext.slice(1).toUpperCase(),
        mediaId: meta?.mediaId ?? null,
        seriesTitle: meta?.seriesTitle ?? inferred.seriesTitle,
        animeTitle: meta?.animeTitle ?? inferred.animeTitle,
        season: meta?.season ?? inferred.season,
        episode: meta?.episode ?? inferred.episode,
        quality: meta?.quality ?? inferred.quality,
        resolvedHeight: meta?.resolvedHeight ?? null,
        dub: meta ? Boolean(meta.dub) : Boolean(inferred.dub),
        format,
        isMovie,
        known,
        cover: meta?.cover ?? null,
        size: st.size,
        addedAt: meta?.addedAt ?? Math.round(st.mtimeMs),
        modifiedAt: Math.round(st.mtimeMs),
        hasSubtitle: Boolean(playback.findSubtitle(absChild)),
        directPlayable: playback.directPlayable(absChild),
      })
    }
  }

  await walk(dir, '', 0)

  // Sort: newest added/modified first at top level; UI also sorts SxxExx inside each series.
  found.sort((a, b) => b.addedAt - a.addedAt || a.relPosix.localeCompare(b.relPosix))

  const byId = new Map()
  const byRel = new Map()
  for (const item of found) {
    byId.set(item.id, item)
    byRel.set(item.relPosix, item)
  }

  cachedScan = { at: Date.now(), dir, items: found, byId, byRel }
  return cachedScan
}

/** Public list of all local media files in the shared library (zero raw paths). */
export async function list({ fresh = false } = {}) {
  const scan = await scanInternal({ fresh })
  const items = scan.items.map(toPublicItem)
  let totalBytes = 0
  let episodeCount = 0
  let movieCount = 0
  let unknownCount = 0
  for (const item of items) {
    totalBytes += item.size
    if (!item.known) unknownCount += 1
    else if (item.isMovie) movieCount += 1
    else episodeCount += 1
  }
  return {
    items,
    stats: {
      totalFiles: items.length,
      episodeCount,
      movieCount,
      unknownCount,
      totalBytes,
    },
  }
}

/** Resolves an opaque library file ID to a verified regular file inside `libraryDir`. */
export async function resolveById(id) {
  const cleanId = String(id ?? '').trim()
  if (!/^f_[0-9a-f]{20}$/.test(cleanId)) return null

  let scan = await scanInternal({ fresh: false })
  let entry = scan.byId.get(cleanId)
  if (!entry) {
    scan = await scanInternal({ fresh: true })
    entry = scan.byId.get(cleanId)
  }
  if (!entry) return null

  const verified = await verifyRegularLibraryFile(scan.dir, entry.absPath)
  if (!verified) {
    invalidateCache()
    return null
  }
  return {
    entry,
    publicItem: toPublicItem(entry),
    realPath: verified.realPath,
    libraryDir: scan.dir,
  }
}

/** Returns downloaded files belonging to an anime (matched by mediaId or series title). */
export async function listForAnime({ mediaId, title, romaji, english } = {}) {
  const scan = await scanInternal({ fresh: false })
  const numericId = Number(mediaId)
  const hasId = Number.isInteger(numericId) && numericId > 0

  const titleKeys = new Set()
  for (const candidate of [title, romaji, english]) {
    if (!candidate) continue
    titleKeys.add(normalizeLookupKey(candidate))
    const inferred = inferSeriesAndSeason(candidate)
    titleKeys.add(normalizeLookupKey(inferred.seriesTitle))
    titleKeys.add(normalizeLookupKey(inferred.seriesFolder))
  }
  titleKeys.delete('')

  const inferredTarget = inferSeriesAndSeason(title || romaji || english)
  const expectedSeason = inferredTarget.season

  const matches = scan.items.filter((item) => {
    if (!item.known) return false
    if (hasId && item.mediaId === numericId) return true
    if (item.mediaId && hasId && item.mediaId !== numericId) return false
    if (titleKeys.size > 0) {
      const sKey = normalizeLookupKey(item.seriesTitle)
      const aKey = normalizeLookupKey(item.animeTitle)
      if ((sKey && titleKeys.has(sKey)) || (aKey && titleKeys.has(aKey))) {
        // When matching unindexed files by title on a sequel entry ("Season 2"),
        // avoid claiming Season 1 files as this entry's episodes.
        if (expectedSeason > 1 && item.season != null && item.season !== expectedSeason) return false
        return true
      }
    }
    return false
  })

  matches.sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 1) - (b.episode ?? 1))
  return matches.map(toPublicItem)
}

/** Finds an already-downloaded file for an episode (duplicate prevention + local playback). */
export async function findDownloadedEpisode({ mediaId, title, seriesTitle, season, episode, targetRelPath } = {}) {
  const scan = await scanInternal({ fresh: false })
  if (targetRelPath) {
    const direct = scan.byRel.get(targetRelPath)
    if (direct) return toPublicItem(direct)
    const onDisk = await getExistingByRelPath(targetRelPath)
    if (onDisk) {
      const refreshed = await scanInternal({ fresh: true })
      const hit = refreshed.byRel.get(targetRelPath)
      if (hit) return toPublicItem(hit)
    }
  }

  const ep = Number(episode)
  if (!Number.isFinite(ep) || ep < 1) return null

  const inferred = inferSeriesAndSeason(seriesTitle || title, season)
  const targetSeason = season != null ? Number(season) : inferred.season
  const numericId = Number(mediaId)
  const hasId = Number.isInteger(numericId) && numericId > 0
  const baseKey = normalizeLookupKey(inferred.seriesTitle)

  for (const item of scan.items) {
    if (!item.known || item.episode !== ep) continue
    if (Number.isFinite(targetSeason) && item.season != null && item.season !== targetSeason) continue
    if (hasId && item.mediaId === numericId) {
      return toPublicItem(item)
    }
    if (item.mediaId && hasId && item.mediaId !== numericId) continue
    if (baseKey && normalizeLookupKey(item.seriesTitle) === baseKey) {
      return toPublicItem(item)
    }
  }
  return null
}

async function pruneEmptyDirsUpward(startDir, stopDir) {
  const resolvedStop = path.resolve(stopDir)
  let cur = path.resolve(startDir)
  for (let i = 0; i < 4; i++) {
    const rel = path.relative(resolvedStop, cur)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) break
    try {
      const entries = await fsp.readdir(cur)
      if (entries.length > 0) break
      await fsp.rmdir(cur)
      cur = path.dirname(cur)
    } catch {
      break
    }
  }
}

/**
 * Deletes a single local media file (and any sidecar subtitle) by opaque ID.
 * Anime bookmarks, resolver matches, and metadata remain untouched.
 */
export async function removeById(id) {
  const resolved = await resolveById(id)
  if (!resolved) return { removed: false }

  const { entry, realPath, libraryDir } = resolved

  // Also remove sidecar subtitles next to this episode if verified inside the library.
  const parsed = path.parse(realPath)
  for (const ext of playback.SUBTITLE_EXTENSIONS) {
    const subCandidate = path.join(parsed.dir, `${parsed.name}${ext}`)
    const verifiedSub = await verifyRegularLibraryFile(libraryDir, subCandidate)
    if (verifiedSub) {
      await fsp.unlink(verifiedSub.realPath).catch(() => {})
    }
  }

  await fsp.unlink(realPath)
  await pruneEmptyDirsUpward(path.dirname(realPath), libraryDir)

  if (catalog[entry.relPosix]) {
    delete catalog[entry.relPosix]
    await persistCatalog()
  }

  invalidateCache()
  notifyChange()
  return { removed: true, id: entry.id, relPosix: entry.relPosix }
}

/** Deletes multiple local files by opaque IDs in one operation. */
export async function bulkRemove(ids = []) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map((v) => String(v ?? '').trim()))].slice(0, 500)
  const deleted = []
  const notFound = []
  for (const id of unique) {
    try {
      const res = await removeById(id)
      if (res.removed) deleted.push(id)
      else notFound.push(id)
    } catch {
      notFound.push(id)
    }
  }
  return { deleted, notFound }
}

/**
 * Imports a streamed video file (such as an unknown `.mp4` uploaded by the user)
 * into `<libraryDir>/Unsorted/<fileName>` atomically after container validation.
 */
export async function importVideoStream(readable, rawFileName, { maxBytes = 8 * 1024 * 1024 * 1024 } = {}) {
  const safeName = sanitizeFileName(rawFileName, playback.VIDEO_EXTENSIONS, 'video')
  const relPosix = `Unsorted/${safeName}`

  const existing = await getExistingByRelPath(relPosix)
  if (existing) {
    throw Object.assign(new Error(`"${safeName}" already exists in the library`), {
      status: 409,
      fileId: existing.id,
    })
  }

  const ext = path.posix.extname(safeName).toLowerCase()
  const tempPath = await allocateTempPath(`import-${crypto.randomBytes(8).toString('hex')}.part${ext}`)

  try {
    let written = 0
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tempPath, { flags: 'wx' })
      let failed = false
      const fail = (err) => {
        if (failed) return
        failed = true
        out.destroy()
        reject(err)
      }

      readable.on('data', (chunk) => {
        if (failed) return
        written += chunk.length
        if (written > maxBytes) {
          fail(Object.assign(new Error('Uploaded file exceeds maximum allowed size'), { status: 413 }))
          return
        }
        if (!out.write(chunk)) {
          readable.pause?.()
        }
      })
      out.on('drain', () => readable.resume?.())
      readable.once('aborted', () => fail(Object.assign(new Error('Upload aborted'), { status: 499 })))
      readable.once('error', fail)
      out.once('error', fail)
      readable.once('end', () => {
        if (!failed) out.end()
      })
      out.once('finish', () => {
        if (!failed) resolve()
      })
    })

    if (written === 0) {
      throw Object.assign(new Error('Uploaded file is empty'), { status: 400 })
    }

    if (ext === '.mp4' || ext === '.m4v') {
      const check = await inspectMp4File(tempPath)
      if (!check.valid) {
        throw Object.assign(new Error(check.error || 'Uploaded file is not a valid MP4'), { status: 422 })
      }
    }

    const committed = await commitTempFile(tempPath, relPosix, {
      sourceType: 'import',
    })
    const resolved = await resolveById(committed.id)
    return resolved?.publicItem ?? { id: committed.id, fileName: safeName, size: committed.size }
  } catch (err) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    throw err
  }
}
