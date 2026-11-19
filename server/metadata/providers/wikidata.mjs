// Wikidata provider adapter (AV-117c2a): cross-database ID resolution
// (identity rung 2) via the public SPARQL endpoint. Property IDs are
// CONFIGURED, not invented: only verified property IDs ship filled in
// (P345 IMDb, P4086 MyAnimeList anime), and any property the installation
// has not verified is passed as null and simply omitted from queries.

export const WIKIDATA_ID = 'wikidata'

/** Verified Wikidata property IDs (see docs/ANIME_METADATA_SOURCES.md). */
export const KNOWN_PROPERTIES = {
  imdb: 'P345',
  mal: 'P4086',
  // AniList / AniDB property IDs: to be verified before use — omitted until then.
  anilist: null,
  anidb: null,
}

/**
 * Build a SPARQL query resolving one external ID → other external IDs.
 * `properties` maps our external-id keys to Wikidata property IDs; null or
 * unknown values are omitted — nothing is invented.
 */
export function buildCrossIdQuery({ source, id, properties = KNOWN_PROPERTIES } = {}) {
  const sourceProperty = properties[source]
  if (!sourceProperty) return null
  const selected = Object.entries(properties)
    .filter(([key, property]) => property && key !== source)
    .map(([key, property]) => `OPTIONAL { ?item wdt:${property} ?${key} . }`)
    .join('\n  ')
  return `SELECT ?item ?itemLabel ${Object.entries(properties)
    .filter(([key, property]) => property && key !== source)
    .map(([, property]) => `?${property}`)
    .join(' ')} WHERE {
  ?item wdt:${sourceProperty} "${String(id)}" .
  ${selected}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}`
}

/** SPARQL JSON bindings → { externalIds, label, wikidata }. */
export function bindingsToResult(bindings, { properties = KNOWN_PROPERTIES } = {}) {
  const rows = Array.isArray(bindings) ? bindings : []
  if (!rows.length) return null
  const row = rows[0]
  const externalIds = {}
  for (const [key, property] of Object.entries(properties)) {
    const cell = row[property]?.value
    if (property && cell) externalIds[key] = String(cell)
  }
  const wikidata = row.item?.value?.match(/\/(Q\d+)$/)?.[1] ?? null
  if (wikidata) externalIds.wikidata = wikidata
  return {
    externalIds,
    label: row.itemLabel?.value ?? null,
  }
}

export async function lookupEvidence(input, { transport = null, properties = KNOWN_PROPERTIES } = {}) {
  if (!transport?.request) throw new Error('wikidata lookupEvidence requires a transport')
  for (const [source, id] of Object.entries(input?.sourceIds ?? {})) {
    const query = buildCrossIdQuery({ source, id, properties })
    if (!query) continue
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`
    const doc = await transport.request(url)
    const result = bindingsToResult(doc?.results?.bindings ?? [], { properties })
    if (result) {
      return {
        key: result.externalIds.wikidata ? `wikidata:${result.externalIds.wikidata}` : `wikidata:${source}:${id}`,
        sourceIds: result.externalIds,
        title: result.label ?? input?.title ?? null,
        relations: [],
        note: 'wikidata resolves cross-ids only',
      }
    }
  }
  return null
}
