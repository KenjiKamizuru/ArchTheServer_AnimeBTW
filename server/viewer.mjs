// Viewer for the mpv target: launches the ani-cli binary itself, exactly the
// way `ani-cli -q 1080 -S 1 -e 12 <title>` works on the command line. ani-cli
// resolves the episode and hands the stream (plus its English subtitle track)
// to mpv, which opens on the user's machine.
//
// Spawned detached with stdio ignored so the web app stays responsive; ani-cli
// needs curl on PATH, and mpv to play.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { binName, resolveBin } from './anicli.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')

const QUALITY_SET = new Set(['best', '1080', '720', '480', '360', 'worst'])

/**
 * Launches one episode of ani-cli in its own process.
 * Returns { launched, bin, args, pid }; throws 400/503 with a readable message.
 */
export async function launch({
  query,
  resultIndex = 1,
  episode = 1,
  quality = 'best',
  dub = false,
  bin = binName(),
} = {}) {
  const search = String(query ?? '').trim().slice(0, 200)
  if (!search) {
    throw Object.assign(new Error('A title to search for on ani-cli is required'), { status: 400 })
  }

  const resolvedBin = resolveBin(bin)
  if (!resolvedBin) {
    throw Object.assign(
      new Error(`ani-cli was not found ("${bin}"). Install it or set its path in Settings.`),
      { status: 503 },
    )
  }

  const qualityValue = String(quality || 'best').toLowerCase()
  const args = []
  if (QUALITY_SET.has(qualityValue)) args.push('-q', qualityValue)
  const index = Math.min(Math.max(1, Math.floor(Number(resultIndex) || 1)), 100)
  const ep = Math.max(1, Math.floor(Number(episode) || 1))
  args.push('-S', String(index), '-e', String(ep))
  if (dub) args.push('--dub')
  args.push(search)

  const child = spawn(resolvedBin, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      // Keep the history the web app already curates in data/, and stay quiet.
      ANI_CLI_LOG: '0',
      ANI_CLI_HIST_DIR: path.join(DATA_DIR, 'anicli-history'),
    },
  })
  child.unref()

  return { launched: true, bin: resolvedBin, args, pid: child.pid ?? null }
}
