// Per-user language & locale preferences (AV-112) and playback defaults
// (AV-113). Pure; no I/O.
//
// Scope decisions (recorded per task rules):
// - `preferredLanguage` — the user's preferred content/UI language (BCP-47
//   shaped, e.g. 'en', 'ja', 'pt-BR'). It is a STORED PREFERENCE only: this
//   app has no i18n layer yet, so nothing is auto-translated; the value is
//   exposed to the client for title/display choices and future i18n work.
// - `locale` — formatting locale (dates/numbers), same shape ('en-US', 'ja-JP').
// - `defaultSubtitle` — preferred subtitle track language, or the sentinel
//   'off' meaning "no subtitles by default"; null = unset.
// - `defaultAudio` — preferred audio track language (dub), null = unset.
// All are validated by pattern (not against a fixed allowlist) so valid
// regional variants are not wrongly rejected; empty clears the field (null).
// These are STORED DEFAULTS consumed by the player/download flows; AV-113
// wires the storage and editing only.

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

export function normalizeDefaultSubtitle(value) {
  const clean = String(value ?? '').trim().toLowerCase()
  if (clean === 'off') return { ok: true, value: 'off' }
  return normalizeTag(value, 'defaultSubtitle')
}

export function normalizeDefaultAudio(value) {
  return normalizeTag(value, 'defaultAudio')
}

/** Normalize a partial preference update; unknown keys are ignored. */
export function normalizePreferencesUpdate(body) {
  const out = {}
  const fields = [
    ['preferredLanguage', normalizePreferredLanguage],
    ['locale', normalizeLocale],
    ['defaultSubtitle', normalizeDefaultSubtitle],
    ['defaultAudio', normalizeDefaultAudio],
  ]
  for (const [key, normalize] of fields) {
    if (body && typeof body === 'object' && key in body) {
      const parsed = normalize(body[key])
      if (!parsed.ok) return parsed
      out[key] = parsed.value
    }
  }
  return { ok: true, value: out }
}
