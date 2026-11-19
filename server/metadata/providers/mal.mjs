// MyAnimeList provider adapter (AV-117c2b): REST v2 (api.myanimelist.net/v2)
// — opt-in: a registered API client id is required (X-MAL-Client-ID header).
// Pure mapping + injected transport; nothing invented. MAL relation vocabulary
// (snake_case) is translated to the AniList-style vocabulary that
// relations.mjs classifyEdge understands; the raw providerType is preserved.

import { normalizeUnifiedAnime } from '../model.mjs'
import { classifyEdge } from '../../relations.mjs'

export const MAL_ID = 'mal'

// MAL relation_type → AniList-style vocabulary for classifyEdge.
const RELATION_VOCAB = {
  sequel: 'SEQUEL',
  prequel: 'PREQUEL',
  side_story: 'SIDE_STORY',
  spin_off: 'SPIN_OFF',
  alternative_version: 'ALTERNATIVE',
  alternative_setting: 'ALTERNATIVE',
  summary: 'SUMMARY',
  full_story: 'OTHER', // "full story" counterpart of a summary — kept raw in providerType
  character: 'CHARACTER',
  other: 'OTHER',
  source: 'SOURCE',
  adaptation: 'ADAPTATION',
  parent_story: 'PARENT',
}

/** MAL anime JSON (fields=title,alternative_titles,media_type,num_episodes,
 * status,start_season,studios,related_anime) → unified model. */
export function toUnified(anime) {
  if (!anime?.id) return null
  const alt = anime.alternative_titles ?? {}
  return normalizeUnifiedAnime({
    internalId: `mal:${anime.id}`,
    titles: {
      canonical: anime.title ?? null,
      english: alt.en ?? null,
      romaji: null, // MAL does not separate romaji — stays unknown
      native: alt.japanese ?? null,
      alternatives: (alt.synonyms ?? []).map(String).filter(Boolean),
    },
    release: {
      year: anime.start_season?.year ?? null,
      season: anime.start_season?.season ? String(anime.start_season.season).toUpperCase() : null,
      startDate: null,
      endDate: null,
    },
    format: normalizeMediaType(anime.media_type),
    episodes: anime.num_episodes ?? null,
    status: anime.status ?? null,
    studios: (anime.studios ?? []).map((studio) => studio?.name).filter(Boolean),
    genres: [],
    tags: [],
    externalIds: { mal: String(anime.id) },
    provenance: {},
    lastVerifiedAt: null,
  })
}

function normalizeMediaType(mediaType) {
  const map = { tv: 'TV', movie: 'MOVIE', ova: 'OVA', ona: 'ONA', special: 'SPECIAL', music: 'MUSIC' }
  return map[String(mediaType ?? '').toLowerCase()] ?? null
}

/** MAL related_anime → RelationEdge[] (raw relation_type preserved). */
export function toRelationEdges(anime) {
  const edges = []
  for (const related of anime?.related_anime ?? []) {
    const node = related?.node
    if (!node?.id) continue
    const providerType = String(related.relation_type ?? '')
    edges.push({
      targetKey: `mal:${node.id}`,
      source: MAL_ID,
      sourceId: String(node.id),
      title: node.title ?? null,
      providerType,
      normalizedType: classifyEdge({ relationType: RELATION_VOCAB[providerType] ?? providerType.toUpperCase().replace(/ /g, '_') }),
      format: null,
      verified: true,
    })
  }
  return edges
}

export function buildAnimeUrl(id, { clientId, fields } = {}) {
  const params = new URLSearchParams({
    fields: fields ?? 'title,alternative_titles,media_type,num_episodes,status,start_season,studios,related_anime',
  })
  void clientId // auth travels in headers, not the URL
  return `https://api.myanimelist.net/v2/anime/${encodeURIComponent(String(id))}?${params}`
}

export async function lookupEvidence(input, { transport, clientId } = {}) {
  if (!transport?.request) throw new Error('mal lookupEvidence requires a transport')
  const id = input?.sourceIds?.mal
  if (!id) return null // MAL lookup is by id only — search is not used for identity
  const anime = await transport.request(buildAnimeUrl(id), {
    headers: { 'X-MAL-Client-ID': String(clientId ?? ''), Accept: 'application/json' },
    ttlMs: 24 * 60 * 60 * 1000,
  })
  if (!anime?.id) return null
  const unified = toUnified(anime)
  return {
    key: `mal:${anime.id}`,
    sourceIds: unified.externalIds,
    title: unified.titles.canonical,
    english: unified.titles.english,
    native: unified.titles.native,
    synonyms: unified.titles.alternatives,
    format: unified.format,
    relations: toRelationEdges(anime).map((edge) => ({
      source: edge.source,
      sourceId: edge.sourceId,
      title: edge.title,
      relationType: edge.providerType,
      format: edge.format,
    })),
    note: 'mal adapter: by-id lookup only (registered client required)',
  }
}
