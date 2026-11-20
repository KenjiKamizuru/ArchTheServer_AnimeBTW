/**
 * Provider-neutral catalog record used by the application. Provider adapters
 * translate their responses into these field names; no GraphQL shapes leak
 * into the record. `id` is the installation's current numeric media identity
 * (today supplied by AniList), not yet a multi-provider identifier registry.
 *
 * Null means unavailable; units are minutes for duration, percent for score,
 * and Unix seconds for nextEpisode.airingAt. The factory supplies stable
 * defaults and copies collections so adapter inputs cannot mutate the record.
 */
export function createAnimeRecord(input) {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.id) || input.id <= 0) {
    throw new TypeError('Anime record requires a positive safe integer id')
  }
  const copyLinks = (links) => Array.isArray(links) ? links.map(({ site, url }) => ({ site, url })) : []
  return {
    id: input.id,
    title: input.title || `Anime #${input.id}`,
    romaji: input.romaji ?? null,
    english: input.english ?? null,
    native: input.native ?? null,
    cover: input.cover ?? null,
    banner: input.banner ?? null,
    color: input.color ?? null,
    description: input.description ?? '',
    episodes: input.episodes ?? null,
    airedEpisodes: input.airedEpisodes ?? 0,
    duration: input.duration ?? null,
    status: input.status ?? 'UNKNOWN',
    format: input.format ?? null,
    season: input.season ?? null,
    seasonYear: input.seasonYear ?? null,
    score: input.score ?? null,
    popularity: input.popularity ?? 0,
    favourites: input.favourites ?? null,
    genres: Array.isArray(input.genres) ? [...input.genres] : [],
    tags: Array.isArray(input.tags) ? input.tags.map(({ name, rank, isMediaSpoiler }) => ({ name, rank, isMediaSpoiler })) : [],
    source: input.source ?? null,
    countryOfOrigin: input.countryOfOrigin ?? null,
    nextEpisode: input.nextEpisode ? { episode: input.nextEpisode.episode, airingAt: input.nextEpisode.airingAt } : null,
    studios: Array.isArray(input.studios) ? [...input.studios] : [],
    links: copyLinks(input.links),
    streams: copyLinks(input.streams),
    anidb: input.anidb ?? null,
    anidbSearch: input.anidbSearch ?? false,
    siteUrl: input.siteUrl ?? null,
  }
}
