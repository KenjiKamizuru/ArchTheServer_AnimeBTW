// AniList provider adapter (AV-117c1): pure mapping from AniList GraphQL
// shapes to the unified model + relation-edge evidence. The network call is
// injected (`gql`) — server/anilist.mjs's quota-managed client plugs in at
// runtime; tests pass fakes. Mapping only ever copies fields AniList actually
// returns; missing fields stay unknown.

import { normalizeUnifiedAnime } from '../model.mjs'
import { classifyEdge, normalizeTitleKey } from '../../relations.mjs'

export const ANILIST_ID = 'anilist'

/** AniList Media → unified model. */
export function toUnified(media) {
  if (!media?.id) return null
  const externalIds = { anilist: String(media.id) }
  for (const link of media.externalLinks ?? []) {
    const url = String(link?.url ?? '')
    const site = String(link?.site ?? '').toLowerCase()
    const mal = url.match(/myanimelist\.net\/anime\/(\d+)/i) ?? (site.includes('myanimelist') ? url.match(/(\d+)/) : null)
    const anidb = url.match(/anidb\.net\/anime\/(\d+)/i)
    const kitsu = url.match(/kitsu\.(?:io|app)\/anime\/([\w-]+)/i)
    if (mal) externalIds.mal = externalIds.mal ?? String(mal[1])
    if (anidb) externalIds.anidb = externalIds.anidb ?? String(anidb[1])
    if (kitsu) externalIds.kitsu = externalIds.kitsu ?? String(kitsu[1])
  }
  return normalizeUnifiedAnime({
    internalId: `anilist:${media.id}`,
    titles: {
      canonical: media.title?.romaji ?? media.title?.english ?? null,
      english: media.title?.english ?? null,
      romaji: media.title?.romaji ?? null,
      native: media.title?.native ?? null,
      alternatives: (media.synonyms ?? []).map(String).filter(Boolean),
    },
    release: {
      year: media.seasonYear ?? media.startDate?.year ?? null,
      season: media.season ?? null,
      startDate: media.startDate?.year ? `${media.startDate.year}` : null,
      endDate: null,
    },
    format: media.format ?? null,
    episodes: media.episodes ?? null,
    status: media.status ?? null,
    studios: (media.studios?.nodes ?? []).map((node) => node?.name).filter(Boolean),
    genres: (media.genres ?? []).map(String).filter(Boolean),
    tags: (media.tags ?? []).map((tag) => tag?.name).filter(Boolean),
    externalIds,
    provenance: {},
    lastVerifiedAt: null,
  })
}

/** AniList relations edges → RelationEdge[] (raw providerType preserved). */
export function toRelationEdges(media) {
  const edges = []
  for (const edge of media?.relations?.edges ?? []) {
    for (const node of edge?.nodes ?? [edge?.node]) {
      if (!node?.id) continue
      const providerType = String(edge.relationType ?? '')
      edges.push({
        targetKey: `anilist:${node.id}`,
        source: ANILIST_ID,
        sourceId: String(node.id),
        title: node.title?.romaji ?? node.title?.english ?? null,
        providerType,
        normalizedType: classifyEdge({ relationType: providerType, format: node.format ?? edge.format }),
        format: node.format ?? null,
        verified: true,
      })
    }
  }
  return edges
}

/** Role/franchise derivation from an entry's own relation edges. */
export function deriveFranchise(media, edges = toRelationEdges(media)) {
  const parent = edges.find((edge) => edge.normalizedType === 'parent-story')
  if (parent) {
    const branchKinds = edges
      .map((edge) => edge.normalizedType)
      .filter((kind) => ['side-story', 'spin-off', 'special', 'movie', 'ova', 'ona'].includes(kind))
    return {
      key: parent.targetKey,
      role: `branch:${branchKinds[0] ?? 'side-story'}`,
    }
  }
  const prequel = edges.find((edge) => edge.normalizedType === 'prequel')
  return {
    key: `anilist:${media?.id ?? normalizeTitleKey(media?.title?.romaji ?? '')}`,
    role: prequel ? 'season' : 'main',
  }
}

/**
 * Online evidence lookup for relationsOnline.verifyPairOnline.
 * `gql(query, variables)` is injected (server/anilist.mjs at runtime).
 */
export async function lookupEvidence(input, { gql } = {}) {
  if (typeof gql !== 'function') throw new Error('lookupEvidence requires an injected gql')
  const byId = input?.sourceIds?.anilist
    ? { id: Number(input.sourceIds.anilist) }
    : { search: String(input?.title ?? ''), perPage: 1 }
  const data = await gql(byId.id ? MEDIA_BY_ID_QUERY : MEDIA_SEARCH_QUERY, byId)
  const media = data?.Media ?? data?.Page?.media?.[0] ?? null
  if (!media) return null
  const edges = toRelationEdges(media)
  const unified = toUnified(media)
  const franchise = deriveFranchise(media, edges)
  return {
    key: `anilist:${media.id}`,
    sourceIds: unified.externalIds,
    title: unified.titles.canonical,
    romaji: unified.titles.romaji,
    english: unified.titles.english,
    native: unified.titles.native,
    synonyms: unified.titles.alternatives,
    format: unified.format,
    franchiseKey: franchise.key,
    role: franchise.role,
    relations: edges.map((edge) => ({
      source: edge.source,
      sourceId: edge.sourceId,
      title: edge.title,
      relationType: edge.providerType,
      format: edge.format,
    })),
  }
}

const MEDIA_FIELDS = `
  id format status episodes season seasonYear
  title { romaji english native } synonyms genres
  startDate { year }
  studios { nodes { name } }
  tags { name }
  externalLinks { site url }
  relations { relationType format nodes { id format title { romaji english } } }
`

const MEDIA_BY_ID_QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`
const MEDIA_SEARCH_QUERY = `query ($search: String, $perPage: Int) { Page(perPage: $perPage) { media(search: $search, type: ANIME) { ${MEDIA_FIELDS} } } }`
