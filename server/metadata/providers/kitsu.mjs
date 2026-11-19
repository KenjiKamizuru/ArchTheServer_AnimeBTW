// Kitsu provider adapter (AV-117c2a): pure JSON:API → unified mappings plus
// cross-database `mappings` handling (identity rung 2). Public reads need no
// key (docs/ANIME_METADATA_SOURCES.md). URL builders follow Kitsu's documented
// JSON:API conventions (kitsu.docs.apiary.io); the network boundary is the
// injected transport, so live endpoint verification happens at integration
// (AV-117d), not here.

import { normalizeUnifiedAnime } from '../model.mjs'

export const KITSU_ID = 'kitsu'

/** Kitsu media resource attributes → unified model. Never invents fields. */
export function toUnified(media) {
  const attrs = media?.attributes ?? {}
  if (!media?.id) return null
  const titles = attrs.titles ?? {}
  return normalizeUnifiedAnime({
    internalId: `kitsu:${media.id}`,
    titles: {
      canonical: attrs.canonicalTitle ?? titles.en_jp ?? null,
      english: titles.en ?? null,
      romaji: titles.en_jp ?? null,
      native: titles.ja_jp ?? null,
      alternatives: (attrs.abbreviatedTitles ?? []).map(String).filter(Boolean),
    },
    release: {
      year: attrs.startDate ? Number(String(attrs.startDate).slice(0, 4)) || null : null,
      season: null,
      startDate: attrs.startDate ?? null,
      endDate: attrs.endDate ?? null,
    },
    format: normalizeSubtype(attrs.subtype),
    episodes: attrs.episodeCount ?? null,
    status: attrs.status ?? null,
    studios: [],
    genres: [],
    tags: [],
    externalIds: { kitsu: String(media.id) },
    provenance: {},
    lastVerifiedAt: null,
  })
}

function normalizeSubtype(subtype) {
  const map = { TV: 'TV', movie: 'MOVIE', OVA: 'OVA', ONA: 'ONA', special: 'SPECIAL', music: 'MUSIC' }
  return map[String(subtype ?? '')] ?? null
}

/**
 * Kitsu `mappings` resources → verified cross-DB ids.
 * Each mapping: { attributes: { externalSite, externalId } }.
 * Only database-shaped sites become externalIds; everything else is ignored
 * (never promoted to identity evidence).
 */
export function mappingsToExternalIds(mappings) {
  const ids = {}
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const site = String(mapping?.attributes?.externalSite ?? '').toLowerCase()
    const externalId = String(mapping?.attributes?.externalId ?? '')
    if (!externalId) continue
    if (site.includes('myanimelist')) ids.mal = ids.mal ?? externalId
    else if (site.includes('anilist')) ids.anilist = ids.anilist ?? externalId
    else if (site.includes('anidb')) ids.anidb = ids.anidb ?? externalId
    else if (site.includes('thetvdb')) ids.tvdb = ids.tvdb ?? externalId
  }
  return ids
}

/** JSON:API document → evidence shape for relationsOnline.verifyPairOnline. */
export function toEvidence(media, { mappings = [] } = {}) {
  const unified = toUnified(media)
  if (!unified) return null
  return {
    key: `kitsu:${media.id}`,
    sourceIds: { ...mappingsToExternalIds(mappings), kitsu: String(media.id) },
    title: unified.titles.canonical,
    romaji: unified.titles.romaji,
    english: unified.titles.english,
    native: unified.titles.native,
    synonyms: unified.titles.alternatives,
    format: unified.format,
    relations: [],
    note: 'kitsu adapter carries no relation edges yet (AV-117d)',
  }
}

/** Search URL per JSON:API filter conventions (filter[text], sparse fields). */
export function buildSearchUrl(query, { limit = 5 } = {}) {
  const params = new URLSearchParams({
    'filter[text]': String(query ?? ''),
    'page[limit]': String(limit),
    fields: 'anime:canonicalTitle,titles,abbreviatedTitles,startDate,endDate,episodeCount,subtype,status',
  })
  return `https://kitsu.io/api/edge/anime?${params}`
}

/** Mappings lookup URL (verified cross-DB ids for identity rung 2). */
export function buildMappingsUrl(externalSite, externalId) {
  const params = new URLSearchParams({
    'filter[externalSite]': String(externalSite ?? ''),
    'filter[externalId]': String(externalId ?? ''),
    include: 'item',
  })
  return `https://kitsu.io/api/edge/mappings?${params}`
}

export async function lookupEvidence(input, { transport } = {}) {
  if (!transport?.request) throw new Error('kitsu lookupEvidence requires a transport')
  const mal = input?.sourceIds?.mal
  if (mal) {
    const doc = await transport.request(buildMappingsUrl('myanimelist', mal))
    const mapping = Array.isArray(doc?.data) ? doc.data[0] : null
    const item = mapping?.relationships?.item?.data ?? null
    const externalIds = mappingsToExternalIds(doc?.data ?? [])
    if (item?.id) {
      return {
        key: `kitsu:${item.id}`,
        sourceIds: { ...externalIds, kitsu: String(item.id) },
        title: input?.title ?? null,
        relations: [],
      }
    }
    return null
  }
  const doc = await transport.request(buildSearchUrl(input?.title ?? ''))
  const media = doc?.data?.[0] ?? null
  return media ? toEvidence(media) : null
}
