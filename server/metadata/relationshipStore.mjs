// Verified relationship store (AV-117d2): kv-backed persistence of pair
// verdicts with the Phase-4 rule — a verified record is never overwritten by
// an unverified one; disagreements are retained as 'conflicting'.

import { relationshipCacheKey } from '../relations.mjs'

export const STORE_PREFIX = 'rel:'

/** Merge an incoming verdict into an existing stored one. */
export function mergeStoredRelationship(existing, incoming) {
  if (!existing) return { record: incoming, outcome: 'accepted' }
  if (existing.verification === 'verified' && incoming.verification !== 'verified') {
    if (JSON.stringify(existing.type) !== JSON.stringify(incoming.type)) {
      return {
        record: { ...existing, conflicts: [...(existing.conflicts ?? []), incoming] },
        outcome: 'kept-verified',
      }
    }
    return { record: existing, outcome: 'kept-verified' }
  }
  return { record: incoming, outcome: 'accepted' }
}

/** Store bound to a kv instance (server/kv.mjs at runtime; Map in tests). */
export function createRelationshipStore(kv) {
  const keyFor = (idA, idB) => STORE_PREFIX + relationshipCacheKey(idA, idB).slice('rel:'.length)
  return {
    async get(idA, idB) {
      return (await kv.get(keyFor(idA, idB), null)) ?? null
    },
    async save(idA, idB, incoming) {
      const key = keyFor(idA, idB)
      const existing = (await kv.get(key, null)) ?? null
      const { record, outcome } = mergeStoredRelationship(existing, incoming)
      await kv.set(key, record)
      return { record, outcome }
    },
  }
}
