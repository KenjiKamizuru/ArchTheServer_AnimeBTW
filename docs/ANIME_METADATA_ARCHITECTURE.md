# Anime Metadata Architecture

Design for the provider-based aggregation system (AV-117). The pure relationship
engine (`server/relations.mjs`) and online pipeline (`server/relationsOnline.mjs`,
AV-116a/b) already implement the relationship/confidence core; this document
extends it to full metadata aggregation.

## 1. Provider architecture (`server/metadata/`)

Each source is an adapter implementing one interface. Adapters translate a
provider's native shape into the unified model and never talk to each other.

```js
// Provider interface (contract — implemented per source)
{
  id: 'anilist' | 'mal' | 'kitsu' | 'anidb' | 'ann' | 'tmdb' | 'wikidata',
  capabilities: { search, byId, full, relations, titles, episodes, seasons, externalIds },
  search(query, { limit })            -> Promise<UnifiedAnime[]>,   // candidates only
  byId(providerId)                    -> Promise<UnifiedAnime | null>,
  relations(providerId)               -> Promise<RelationEdge[]>,   // raw + normalized
}
```

Rules:
- Adapters return `null`/`[]` for unknown fields — **missing stays unknown**;
  adapters never invent values.
- All network access goes through one transport helper with per-source rate
  limits, timeouts, retries (exponential backoff on 429/5xx/network), and a
  response cache. Adapters are pure mapping + query construction.
- `registry.mjs` exposes `getProvider(id)`, `providersFor(capability)`, and the
  ordered provider list (see §4 priorities).

## 2. Unified model (`server/metadata/model.mjs`)

```js
UnifiedAnime = {
  internalId,                 // stable: 'anilist:<id>' when known
  titles: { canonical, english, romaji, native, alternatives: [] },
  release: { year, season, startDate, endDate },
  format,                     // TV | MOVIE | OVA | ONA | TV_SPECIAL | SPECIAL | MUSIC | UNKNOWN
  episodes, status,
  studios: [], genres: [], tags: [],
  externalIds: { anilist, mal, kitsu, anidb, ann, imdb, tmdb, wikidata },
  franchise: { key, role },   // role: 'main' | 'season' | 'branch:<kind>'
  relations: [RelationEdge],
  provenance: { <field>: FieldProvenance[] },   // §4
  lastVerifiedAt,
}

RelationEdge = {
  targetKey, source, sourceId,
  providerType,               // original: 'SEQUEL' | 'PREQUEL' | ... | 'Spin Off' ...
  normalizedType,             // canonical taxonomy (relations.mjs kinds)
  verified, checkedAt,
}

FieldProvenance = { source, sourceId, value, verification: 'verified'|'unverified'|'conflicting', updatedAt }
```

## 3. Identity matching (`server/metadata/identity.mjs`) — Phase 5

Decision ladder for "are A and B the same anime record?". Stops at the first
conclusive rung; every rung records its evidence:

1. **Exact external ID match** (same provider + same id) → same, `verified`.
2. **Verified cross-database mapping** (Kitsu `mappings`, Wikidata IDs, or a
   previously verified store record) → same, `verified`.
3. **Title + year + format agreement** (all alias titles compared as *sets*,
   never fuzzy ratios) → same, `unverified` until one more signal agrees.
4. **Studios + release window + relation-graph position** → same, `unverified`.
5. Otherwise → **not established**. Title similarity alone NEVER concludes
   identity.

Kept strictly separate (different result types, different code paths):
`same-record` · `duplicate-entry` · `same-franchise` · `sequel/prequel` ·
`spin-off` · `alternative-version` (see `relations.mjs` taxonomy).

## 4. Source priorities (Phase 4) — field level

Merge = per-field: pick the best-ranked `FieldProvenance` entry; **never
overwrite a `verified` value with an `unverified` or `conflicting` one** (the
rule is enforced in `mergeField`, tested).

| Field | Priority order |
|---|---|
| Franchise relationships | AniList relations → MAL related → AniDB → Kitsu; disagreement ⇒ `conflicting` retained on both values |
| Alternate titles | union of AniList ∪ MAL ∪ Kitsu ∪ AniDB (deduped by alias key) |
| Episode counts | compare all providers; any spread > 0 ⇒ `discrepancy` flag on the field |
| External IDs | verified mappings only (Wikidata/Kitsu mappings/AniList externalLinks); raw ID guesses are never promoted to `verified` |
| Studios / staff | AniList → ANN (production credits) → TMDB |
| Release year/season | AniList → MAL → Kitsu; earliest *verified* |
| Format/status | AniList → MAL |

## 5. Relationship graph (Phase 6)

- The graph stores **edges with both raw provider type and normalized type**
  (already implemented in `relations.mjs` `classifyEdge` + `relativeKind`).
- Franchise connection ≠ direct continuation: `sameFranchise(record)` and
  `record.type` are separate answers (`other`/indirect kinds exist precisely
  because two entries can share a franchise without a direct continuation).
- Season lists/watch-order consume only `next-season`/`split-cour`/`prequel`/
  `sequel` edges; spin-offs/specials are listed as branches and never merged
  into the main order automatically.
- One-provider-missing relations are accepted when another provider verifies
  them (`verification: 'verified'` with `source` naming the provider).
- Provider disagreement ⇒ both values retained, `verification: 'conflicting'`,
  `uncertain: true` (never silently picked).

## 6. Caching (Phase 7)

- Identity resolution cache: `entry:*` keys (see `relationsOnline.mjs`), 7-day
  TTL for verified resolutions, 1-hour for failed/uncertain.
- Pair verdict cache: order-independent `rel:*` keys (same TTL split).
- Per-provider transport cache respects source rules: AniList 90 rpm, ANN 1 rps,
  AniDB 1 req / 2 s **+ day-level caching** (their ban policy), Kitsu fair-use,
  TMDB 40/10 s.
- Resolution order is identity-first: **resolve and cache both entries once,
  then build all pairwise relationships from cached records** — never one API
  request per comparison (enforced by `verifyPairOnline`'s cache tests).
- Network failures/timeouts/rate limits degrade to `uncertain` with the reason
  recorded; temporary failures retry with backoff (max 2 retries, the AV-020
  pattern).

## 7. Local library matching (Phase 8)

`library.mjs inferSeriesAndSeason` filename parsing is demoted to **candidate
generation only**. The matcher then: (1) tries verified cross-IDs stored per
entry, (2) resolves candidates through the identity ladder, (3) keeps local
entries separate unless `same-record`/`duplicate-entry` is established —
sharing a franchise never merges local files.
