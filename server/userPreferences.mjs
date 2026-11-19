// Per-user language & locale preferences (AV-112). Pure; no I/O.
//
// Scope decisions (recorded per task rules):
// - `preferredLanguage` — the user's preferred content/UI language (BCP-47
//   shaped, e.g. 'en', 'ja', 'pt-BR'). It is a STORED PREFERENCE only: this
//   app has no i18n layer yet, so nothing is auto-translated; the value is
//   exposed to the client for title/display choices and future i18n work.
// - `locale` — formatting locale (dates/numbers), same shape ('en-US', 'ja-JP').
// Both are validated by pattern (not against a fixed allowlist) so valid
// regional variants are not wrongly rejected; empty clears the field (null).

const BCP47 = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const MAX_LENGTH = 20

function normalizeTag(value, field) {
  const clean = String(value ?? '').trim()
  if (!clean) return { ok: true, value: null }
  if (clean.length > MAX_LENGTH) return { ok: false, error: `${field} is too long` }
  const tag = clean.toLowerCase().replace(/_/g, '-')
  if (!BCP47.test(tag)) return { ok: false, error: `${field} must be a language tag like "en" or "pt-BR"` }
  return { ok: true, value: tag }
}

export function normalizePreferredLanguage(value) {
  return normalizeTag(value, 'preferredLanguage')
}

export function normalizeLocale(value) {
  return normalizeTag(value, 'locale')
}

/** Normalize a partial preference update; unknown keys are ignored. */
export function normalizePreferencesUpdate(body) {
  const out = {}
  if (body && typeof body === 'object' && 'preferredLanguage' in body) {
    const parsed = normalizePreferredLanguage(body.preferredLanguage)
    if (!parsed.ok) return parsed
    out.preferredLanguage = parsed.value
  }
  if (body && typeof body === 'object' && 'locale' in body) {
    const parsed = normalizeLocale(body.locale)
    if (!parsed.ok) return parsed
    out.locale = parsed.value
  }
  return { ok: true, value: out }
}
