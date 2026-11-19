import { randomInt } from 'node:crypto'

// Select only from the current list; randomInt avoids modulo bias.
export function pickListEntry(entries, choose = randomInt) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const index = choose(entries.length)
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new RangeError('Invalid random index')
  return entries[index]
}
