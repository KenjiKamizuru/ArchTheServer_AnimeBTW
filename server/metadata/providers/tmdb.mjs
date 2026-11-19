// TMDB provider adapter (AV-117c2b): opt-in (API key), movies/TV + collections
// + external IDs, and a licensed artwork path (attribution required —
// docs/ANIME_METADATA_SOURCES.md). Pure mapping + injected transport.

import { normalizeUnifiedAnime } from '../model.mjs'

export const TMDB_ID = 'tmdb'
export const ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.'

/** TMDB movie/tv search-or-detail JSON → unified model. */
export function toUnified(item, { kind = 'movie' } = {}) {
  if (!item?.id) return null
  const title = kind === 'tv' ? item.name ?? item.original_name : item.title ?? item.original_title
  const original = kind === 'tv' ? item.original_name : item.original_title
  const release = kind === 'tv' ? item.first_air_date : item.release_date
  return normalizeUnifiedAnime({
    internalId: `tmdb:${kind}:${item.id}`,
    titles: {
      canonical: title ?? null,
      english: kind === 'movie' ? item.title ?? null : null,
      romaji: null,
      native: original !== title ? original ?? null : null,
      alternatives: [],
    },
    release: {
      year: release ? Number(String(release).slice(0, 4)) || null : null,
      season: null,
      startDate: release ?? null,
      endDate: kind === 'tv' ? item.last_air_date ?? null : null,
    },
    format: kind === 'tv' ? 'TV' : 'MOVIE',
    episodes: kind === 'tv' ? item.number_of_episodes ?? null : null,
    status: item.status ?? null,
    studios: (item.production_companies ?? []).map((company) => company?.name).filter(Boolean),
    genres: [],
    tags: [],
    externalIds: { tmdb: String(item.id) },
    franchise: { key: item.belongs_to_collection?.id ? `tmdb:collection:${item.belongs_to_collection.id}` : null, role: null },
    provenance: {},
    lastVerifiedAt: null,
  })
}

/** TMDB external_ids JSON → verified cross-ids. */
export function externalIdsFrom(detail) {
  const ids = {}
  if (detail?.id) ids.tmdb = String(detail.id)
  if (detail?.imdb_id) ids.imdb = String(detail.imdb_id)
  if (detail?.tvdb_id) ids.tvdb = String(detail.tvdb_id)
  return ids
}

export function buildSearchUrl(query, { kind = 'movie', key } = {}) {
  const params = new URLSearchParams({ query: String(query ?? '') })
  if (key) params.set('api_key', String(key))
  return `https://api.themoviedb.org/3/search/${kind}?${params}`
}

export function buildExternalIdsUrl(id, { kind = 'movie', key } = {}) {
  const params = new URLSearchParams()
  if (key) params.set('api_key', String(key))
  const query = params.toString()
  return `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(String(id))}/external_ids${query ? `?${query}` : ''}`
}

export async function lookupEvidence(input, { transport, key, kind = 'movie' } = {}) {
  if (!transport?.request) throw new Error('tmdb lookupEvidence requires a transport')
  const id = input?.sourceIds?.tmdb
  if (!id) return null
  const detail = await transport.request(buildExternalIdsUrl(id, { kind, key }), { ttlMs: 24 * 60 * 60 * 1000 })
  return {
    key: `tmdb:${kind}:${id}`,
    sourceIds: externalIdsFrom(detail),
    title: input?.title ?? null,
    relations: [],
    attribution: ATTRIBUTION,
    note: 'tmdb adapter: cross-ids + collections (movies/TV), licensed artwork path',
  }
}
