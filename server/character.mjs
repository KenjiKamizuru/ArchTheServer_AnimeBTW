// Character detail payloads (AV-085): pure normalization of AniList
// Character query results into the shape /api/characters/:id returns.

import { sanitizeCoverUrl, sanitizePublicHttpUrl } from './security.mjs'

/**
 * Normalizes `{ Character: {...} }` (or a bare character node) into
 * `{ id, name, nativeName, alternativeNames, image, description, siteUrl,
 *    media: [{ id, type, format, title, year, characterRole }] }`.
 * Returns null when the id is missing/invalid.
 */
export function normalizeCharacter(raw) {
  const node = raw?.Character ?? raw ?? {}
  const id = Number(node.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    id,
    name: node.name?.full || node.name?.native || `Character #${id}`,
    nativeName: node.name?.native ?? null,
    alternativeNames: (Array.isArray(node.name?.alternative) ? node.name.alternative : []).filter(Boolean),
    image: sanitizeCoverUrl(node.image?.large ?? null),
    description: typeof node.description === 'string' ? node.description : '',
    siteUrl: sanitizePublicHttpUrl(node.siteUrl, { httpsOnly: false, maxLen: 512 }),
    media: (node.media?.edges ?? [])
      .map((edge) => {
        const media = edge?.node
        if (!media?.id) return null
        return {
          id: media.id,
          type: media.type ?? 'ANIME',
          format: media.format ?? null,
          title: media.title?.romaji || media.title?.english || media.title?.native || `#${media.id}`,
          year: media.startDate?.year ?? null,
          characterRole: edge.characterRole ?? null,
        }
      })
      .filter(Boolean),
  }
}
