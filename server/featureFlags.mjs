// Account-level feature flags and beta opt-ins (AV-125a). Pure; no I/O.
//
// Scope decisions (recorded per task rules):
// - Beta opt-ins are USER-DRIVEN: the owner holds a list of beta codes on the
//   account record (`betaOptIns: string[]`) for features they opted into.
//   This slice wires STORAGE and EDITING only — consumption by feature code
//   comes with each future feature (same deferred-wiring stance as AV-112–116
//   preferences).
// - Codes are lowercase slugs (`[a-z][a-z0-9-]{0,31}`), trimmed and
//   lowercased on input, deduplicated (case-insensitively), max 20 per
//   account. This is an OPEN registry (future betas register their own
//   codes), so — unlike the quality/rating allowlists — unknown codes are
//   accepted on purpose; malformed ones are not.
// - Update semantics mirror the preferences rules: strict — one malformed
//   entry rejects the whole update; `betas` REPLACES the list; `[]` clears.
// - Server-driven rollout flags (admin-side kill switches) are out of scope:
//   no admin surface exists in this app. `hasBetaOptIn` is the single
//   consumption helper future features gate on.
// - Betas are ACCOUNT-level: guest profiles (AV-122) carry preferences only,
//   never beta opt-ins.

const CODE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
export const MAX_BETAS = 20

/** Normalize one beta code; returns { ok, value } | { ok: false, error }. */
export function normalizeBetaCode(input) {
  const clean = String(input ?? '').trim().toLowerCase()
  if (!clean) return { ok: false, error: 'A beta code cannot be empty' }
  if (!CODE_PATTERN.test(clean)) {
    return { ok: false, error: 'Beta codes are lowercase slugs: a letter, then letters, digits, or dashes (max 32 characters)' }
  }
  return { ok: true, value: clean }
}

/** Normalize a whole opt-in list: trimmed/lowercased, deduplicated, capped. */
export function normalizeBetaOptIns(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'betas must be an array of beta codes' }
  const seen = new Set()
  for (const entry of input) {
    const parsed = normalizeBetaCode(entry)
    if (!parsed.ok) return parsed
    seen.add(parsed.value)
  }
  if (seen.size > MAX_BETAS) {
    return { ok: false, error: `A beta opt-in list holds at most ${MAX_BETAS} codes` }
  }
  return { ok: true, value: [...seen] }
}

/**
 * Strict update (preferences-rule family): `betas` replaces the whole list;
 * `[]` clears; one malformed entry rejects everything; unknown keys ignored.
 */
export function normalizeBetaOptInsUpdate(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  if (!('betas' in source)) return { ok: false, error: 'betas is required' }
  return normalizeBetaOptIns(source.betas)
}

/** Replace the account's opt-in list (validated upstream). */
export function setBetaOptIns(user, betas) {
  user.betaOptIns = [...betas]
  return { ok: true, value: betaOptInsView(user) }
}

export function betaOptInsView(user) {
  const list = Array.isArray(user?.betaOptIns) ? user.betaOptIns : []
  return { betas: [...list].sort() }
}

/** The single consumption helper future beta features gate on. */
export function hasBetaOptIn(user, code) {
  const parsed = normalizeBetaCode(code)
  if (!parsed.ok) return false
  return (Array.isArray(user?.betaOptIns) ? user.betaOptIns : []).includes(parsed.value)
}
