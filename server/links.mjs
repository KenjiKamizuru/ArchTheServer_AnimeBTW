// External metadata links with provider attribution (AV-095): pure
// normalization of AniList externalLinks into safe, attributed link entries.

import { sanitizePublicHttpUrl } from './security.mjs'

/**
 * Normalizes AniList `externalLinks` into `{ site, url, type }` entries:
 * dangerous urls dropped, provider names trimmed/capped, and the link type
 * (STREAMING / INFO / …) preserved so the UI can attribute each provider.
 */
export function normalizeExternalLinks(externalLinks) {
  return (Array.isArray(externalLinks) ? externalLinks : [])
    .map((l) => {
      const safeUrl = l?.url ? sanitizePublicHttpUrl(l.url, { httpsOnly: false, maxLen: 512 }) : null
      if (!safeUrl || !l?.site) return null
      return {
        site: String(l.site).replace(/\s+/g, ' ').trim().slice(0, 80),
        url: safeUrl,
        type: typeof l.type === 'string' ? l.type : null,
      }
    })
    .filter(Boolean)
}
