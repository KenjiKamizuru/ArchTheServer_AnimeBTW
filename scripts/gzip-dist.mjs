// Post-build: write .gz twins for hashed assets so Express can serve them
// pre-compressed with zero runtime cost.
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full)
    } else if (/\.(js|css|html|svg)$/.test(entry)) {
      writeFileSync(full + '.gz', gzipSync(readFileSync(full), { level: 9 }))
    }
  }
}

walk(dist)
console.log('gzip twins written')
