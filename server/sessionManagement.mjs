// Device/session management (AV-119). Pure; no I/O.
//
// Session records (`session:<sha256>` → {userId, createdAt, expiresAt}) are
// already user-scoped, so listing and remote sign-out are honest. The `hash`
// shown to its owner is the STORED sha256 — the raw token never leaves the
// httpOnly cookie; the hash alone cannot sign in.
//
// Scope decisions: descriptors carry timestamps + a `current` flag only (no
// user-agent/IP tracking — the records don't store it and inventing it would
// be worse than omitting it; richer device labels can be added when the login
// path records them).

const HASH_PATTERN = /^[0-9a-f]{64}$/

export function isSessionHash(value) {
  return HASH_PATTERN.test(String(value ?? ''))
}

/** Public descriptor for one session record. */
export function describeSession(hash, record, { currentHash = null, now = Date.now() } = {}) {
  return {
    hash: String(hash),
    createdAt: Number(record?.createdAt) || null,
    expiresAt: Number(record?.expiresAt) || null,
    current: String(hash) === String(currentHash),
  }
}

/** Valid sessions of `userId`: current first, then newest first. */
export function listUserSessions(entries, { userId, currentHash = null, now = Date.now() } = {}) {
  const rows = []
  for (const [hash, record] of Array.isArray(entries) ? entries : []) {
    if (!record || record.userId !== userId) continue
    if (!(Number(record.expiresAt) > now)) continue
    rows.push(describeSession(hash, record, { currentHash, now }))
  }
  rows.sort((a, b) => Number(b.current) - Number(a.current) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return rows
}

/** Should this session be revoked by "sign out other devices"? */
export function shouldRevoke(hash, record, { userId, currentHash = null }) {
  return Boolean(record && record.userId === userId && String(hash) !== String(currentHash))
}
