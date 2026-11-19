// Post-build: write pre-compressed .gz and .br twins for every static asset so
// Express can serve them with zero per-request compression cost.
//
// Brotli level 11 is used for JS/CSS/HTML (built once at build time, so the
// extra CPU is free at runtime and yields ~15-20% over gzip).
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const BROTLI_OPTIONS = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    [zlibConstants.BROTLI_PARAM_LGWIN]: 22,
    [zlibConstants.BROTLI_PARAM_SIZE_HINT]: 0,
  },
}

let gzCount = 0
let brCount = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(js|css|html|svg|json|webmanifest)$/.test(entry)) continue
    const raw = readFileSync(full)
    // Only bother compressing payloads where it actually helps.
    if (raw.length < 256) continue
    writeFileSync(`${full}.gz`, gzipSync(raw, { level: 9 }))
    gzCount += 1
    try {
      const br = brotliCompressSync(raw, { ...BROTLI_OPTIONS, params: { ...BROTLI_OPTIONS.params, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      // Keep Brotli only when it beats gzip, so we never serve a larger body.
      const gzSize = statSync(`${full}.gz`).size
      if (br.length < gzSize) {
        writeFileSync(`${full}.br`, br)
        brCount += 1
      }
    } catch {
      /* brotli unsupported on this platform — gzip twins still work */
    }
  }
}

walk(dist)
console.log(`precompressed assets: ${gzCount} gzip, ${brCount} brotli`)
