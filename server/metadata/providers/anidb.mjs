// AniDB provider adapter (AV-117c2b): opt-in ONLY — the HTTP API requires a
// registered client (wiki.anidb.net/HTTP_API_Definition), ≤1 request / 2 s
// with day-level caching and a ban policy. XML responses are parsed with a
// small purpose-built extractor (documented limits: the anime response shape
// only). Scraping the website is out of the question.

import { classifyEdge } from '../../relations.mjs'

export const ANIDB_ID = 'anidb'

/** httpapi anime response (XML text) → parsed record. */
export function parseAnimeXml(xmlText) {
  const xml = String(xmlText ?? '')
  const aid = xml.match(/<anime\s+id="(\d+)"/i)?.[1] ?? null
  if (!aid) return null
  const titles = []
  for (const match of xml.matchAll(/<title(?:\s+[^>]*)?>([^<]+)<\/title>/gi)) {
    titles.push(decodeEntities(match[1].trim()))
  }
  const type = xml.match(/<type(?:\s+[^>]*)?>([^<]+)<\/type>/i)?.[1]?.trim() ?? null
  const episodes = xml.match(/<episodecount>(\d+)<\/episodecount>/i)?.[1] ?? null
  const year = xml.match(/<year>([^<]+)<\/year>/i)?.[1]?.trim() ?? null
  return {
    id: String(aid),
    titles,
    type,
    episodes: episodes === null ? null : Number(episodes),
    year: year && /^\d{4}/.test(year) ? Number(year.slice(0, 4)) : null,
  }
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

/** <relatedanime> block → RelationEdge[] (AniDB type strings preserved). */
export function parseRelatedAnime(xmlText) {
  const xml = String(xmlText ?? '')
  const block = xml.match(/<relatedanime>([\s\S]*?)<\/relatedanime>/i)?.[1] ?? ''
  const edges = []
  for (const match of block.matchAll(/<anime\s+id="(\d+)"(?:\s+type="([^"]*)")?[^>]*>([^<]*)<\/anime>/gi)) {
    const providerType = decodeEntities((match[2] ?? '').trim())
    edges.push({
      targetKey: `anidb:${match[1]}`,
      source: ANIDB_ID,
      sourceId: String(match[1]),
      title: decodeEntities((match[3] ?? '').trim()) || null,
      providerType,
      normalizedType: classifyEdge({ relationType: providerType.toUpperCase().replace(/[\s-]+/g, '_') }),
      format: null,
      verified: true,
    })
  }
  return edges
}

export function buildAnimeUrl(aid, { client, clientver = '1', protover = '1' } = {}) {
  const params = new URLSearchParams({
    request: 'anime',
    client: String(client ?? ''),
    clientver: String(clientver),
    protover: String(protover),
    aid: String(aid),
  })
  return `http://api.anidb.net:9001/httpapi?${params}`
}

export async function lookupEvidence(input, { transport, client } = {}) {
  if (!transport?.request) throw new Error('anidb lookupEvidence requires a transport')
  const aid = input?.sourceIds?.anidb
  if (!aid) return null // by-id only; identity never goes through AniDB search
  const xmlText = await transport.request(buildAnimeUrl(aid, { client }), {
    ttlMs: 24 * 60 * 60 * 1000, // day-level caching per AniDB's ban policy
  })
  const parsed = parseAnimeXml(typeof xmlText === 'string' ? xmlText : '')
  if (!parsed) return null
  return {
    key: `anidb:${parsed.id}`,
    sourceIds: { anidb: parsed.id },
    title: parsed.titles[0] ?? input?.title ?? null,
    synonyms: parsed.titles.slice(1),
    format: parsed.type ? String(parsed.type).toUpperCase() : null,
    relations: parseRelatedAnime(typeof xmlText === 'string' ? xmlText : '').map((edge) => ({
      source: edge.source,
      sourceId: edge.sourceId,
      title: edge.title,
      relationType: edge.providerType,
      format: edge.format,
    })),
    note: 'anidb adapter: registered client + day cache required',
  }
}
