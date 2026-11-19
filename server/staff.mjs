// Staff member detail payloads (AV-086): pure normalization of AniList Staff
// query results into the shape /api/staff/:id returns. Also serves voice-actor
// profiles (AV-087) — AniList models them as the same Staff type.

import { sanitizeCoverUrl, sanitizePublicHttpUrl } from './security.mjs'

/**
 * Normalizes `{ Staff: {...} }` (or a bare staff node) into
 * `{ id, name, nativeName, alternativeNames, image, description, siteUrl,
 *    primaryOccupations, media: [{ id, type, format, title, year, role }] }`.
 * Returns null when the id is missing/invalid.
 */
export function normalizeStaffMember(raw) {
  const node = raw?.Staff ?? raw ?? {}
  const id = Number(node.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    id,
    name: node.name?.full || node.name?.native || `Staff #${id}`,
    nativeName: node.name?.native ?? null,
    alternativeNames: (Array.isArray(node.name?.alternative) ? node.name.alternative : []).filter(Boolean),
    image: sanitizeCoverUrl(node.image?.large ?? null),
    description: typeof node.description === 'string' ? node.description : '',
    siteUrl: sanitizePublicHttpUrl(node.siteUrl, { httpsOnly: false, maxLen: 512 }),
    primaryOccupations: (Array.isArray(node.primaryOccupations) ? node.primaryOccupations : []).filter(Boolean),
    characterCredits: (node.characters?.edges ?? [])
      .flatMap((edge) => {
        const character = edge?.node
        if (!character?.id) return []
        const characterName = character.name?.full || character.name?.native || `Character #${character.id}`
        return (edge.media?.nodes ?? [])
          .filter((media) => media?.id)
          .map((media) => ({
            characterId: character.id,
            characterName,
            role: typeof edge.role === 'string' ? edge.role : null,
            mediaId: media.id,
            mediaTitle: media.title?.romaji || media.title?.english || media.title?.native || `#${media.id}`,
          }))
      }),
    media: (node.staffMedia?.edges ?? [])
      .map((edge) => {
        const media = edge?.node
        if (!media?.id) return null
        return {
          id: media.id,
          type: media.type ?? 'ANIME',
          format: media.format ?? null,
          title: media.title?.romaji || media.title?.english || media.title?.native || `#${media.id}`,
          year: media.startDate?.year ?? null,
          role: typeof edge.role === 'string' ? edge.role : null,
        }
      })
      .filter(Boolean),
  }
}
