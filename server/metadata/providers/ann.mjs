// Anime News Network adapter (AV-117c2b): encyclopedia XML API
// (cdn.animenewsnetwork.com/encyclopedia/api.xml) — no auth, but **1 req/s
// mandatory and attribution required** (docs/ANIME_METADATA_SOURCES.md).
// Scope: production/staff + vintage cross-check. Documented limitation: the
// encyclopedia API exposes related productions only loosely, so this adapter
// does not claim a relation graph.

export const ANN_ID = 'ann'
export const ATTRIBUTION = 'Data from the Anime News Network Encyclopedia (animenewsnetwork.com/encyclopedia)'

/** api.xml anime response → { id, name, infos, staff } (raw info types kept). */
export function parseAnnXml(xmlText) {
  const xml = String(xmlText ?? '')
  const id = xml.match(/<anime\s+id="(\d+)"/i)?.[1] ?? null
  if (!id) return null
  const name = xml.match(/<anime\s+id="\d+"[^>]*>([^<]*)/i)?.[1]?.trim() ?? null
  const infos = []
  for (const match of xml.matchAll(/<info\s+type="([^"]*)"[^>]*>([^<]*)<\/info>/gi)) {
    infos.push({ type: match[1].trim(), value: decodeEntities(match[2].trim()) })
  }
  const staff = []
  for (const match of xml.matchAll(/<staff>[\s\S]*?<person[^>]*>([^<]*)<\/person>[\s\S]*?<task>([^<]*)<\/task>[\s\S]*?<\/staff>/gi)) {
    staff.push({ person: decodeEntities(match[1].trim()), task: decodeEntities(match[2].trim()) })
  }
  return { id: String(id), name, infos, staff }
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

/** ANN info rows → unified-friendly extracts (vintage → year, episodes). */
export function annToUnifiedParts(parsed) {
  const vintage = parsed?.infos?.find((info) => info.type === 'Vintage')?.value ?? ''
  const yearMatch = vintage.match(/\b(19|20)\d{2}\b/)
  const episodes = parsed?.infos?.find((info) => info.type === 'Number of episodes')?.value ?? null
  return {
    year: yearMatch ? Number(yearMatch[0]) : null,
    episodes: episodes !== null && /^\d+$/.test(episodes) ? Number(episodes) : null,
    staff: parsed?.staff ?? [],
  }
}

export function buildAnimeUrl(id) {
  return `https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=${encodeURIComponent(String(id))}`
}

export async function lookupEvidence(input, { transport } = {}) {
  if (!transport?.request) throw new Error('ann lookupEvidence requires a transport')
  const id = input?.sourceIds?.ann
  if (!id) return null
  const xmlText = await transport.request(buildAnimeUrl(id), { ttlMs: 24 * 60 * 60 * 1000 })
  const parsed = parseAnnXml(typeof xmlText === 'string' ? xmlText : '')
  if (!parsed) return null
  const parts = annToUnifiedParts(parsed)
  return {
    key: `ann:${parsed.id}`,
    sourceIds: { ann: parsed.id },
    title: parsed.name ?? input?.title ?? null,
    relations: [],
    extras: { year: parts.year, episodes: parts.episodes, staff: parts.staff },
    attribution: ATTRIBUTION,
    note: 'ann adapter: production/staff cross-check only (1 rps + attribution)',
  }
}
