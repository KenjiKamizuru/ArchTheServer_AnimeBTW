# Anime Metadata System — Final Report (AV-117, 2026-11-19)

## 1. Metadata sources currently used (pre-existing)

| Source | Used for | Status |
|---|---|---|
| **AniList GraphQL** (`graphql.anilist.co`) | The sole anime metadata provider: IDs, titles, formats, seasons, episodes, studios, genres/tags, relations, external links | ✅ in production |
| **IMDb endpoints** (`api.graphql.imdb.com`, cinemeta) | Artwork only (posters/banners/icons via `tt` IDs) | ⚠️ unofficial endpoints — documented risk |
| **hianime.at** | Stream resolution (not metadata) | unchanged |

## 2. New sources integrated (adapters in `server/metadata/providers/`)

| Source | Adapter | Auth | Integrated capability |
|---|---|---|---|
| MyAnimeList v2 | `mal.mjs` | opt-in `X-MAL-Client-ID` | by-id records, `alternative_titles`, related_anime (vocab translated, raw preserved) |
| Kitsu | `kitsu.mjs` | none (public reads) | JSON:API records + **`mappings` cross-IDs** (identity rung 2) |
| AniDB | `anidb.mjs` | opt-in registered client | httpapi XML records + related anime (day-cache per ban policy) |
| ANN Encyclopedia | `ann.mjs` | none | vintage/episodes/staff cross-check (1 rps + attribution) |
| TMDB | `tmdb.mjs` | opt-in API key | movies/collections, external IDs, licensed artwork path |
| Wikidata | `wikidata.mjs` | none (SPARQL) | cross-database ID resolution (verified properties only) |

## 3. Sources rejected / deferred, and why

- **TVmaze** — deferred: weak anime coverage outside simulcast TV slots; supplementary airdate checks only.
- **IMDb as a relationship authority** — rejected per requirement: restricted official access (datasets/Enterprise), never a franchise source.
- **Website scraping anywhere** — rejected: AniDB explicitly bans it; every adapter uses documented APIs only.

## 4. API capabilities and limitations

- AniList: 90 req/min, richest relations vocabulary (the primary). MAL: registered client required; rate limit "reported ~100/min" — to confirm in official docs before the MAL adapter goes live.
- Kitsu: keyless public reads, fair-use limits; `mappings` is its unique value.
- AniDB: strict ban policy (≤1 req/2 s, day caching) — opt-in only.
- ANN: mandatory 1 rps + attribution; no relation graph.
- TMDB: 40 req/10 s, non-commercial with attribution.
- Wikidata: cross-IDs only; unverified property IDs (AniList/AniDB) are never invented — omitted until verified.

## 5. Files changed (this program)

Docs: `ANIME_METADATA_SOURCES.md`, `ANIME_METADATA_ARCHITECTURE.md`, `ANIME_RELATIONSHIPS.md`, `ANIME_METADATA_TESTING.md`, `ANIME_METADATA_REPORT.md`.
Core: `server/relations.mjs`, `server/relationsOnline.mjs`; `server/metadata/{model,identity,transport,registry,libraryMatch,relationshipStore}.mjs`; `server/metadata/providers/{anilist,kitsu,wikidata,mal,anidb,ann,tmdb}.mjs`.
Wired: `server/anilist.mjs` (relatedSeasons `kind`, `mediaEvidence`), `server/explore.mjs` (verified franchise grouping + seasons/branches partition), `server/library.mjs` (candidate-only title keys).
Tests: `relations`, `relations-online`, `metadata-core`, `metadata-transport`, `metadata-adapters`, `metadata-adapters2`, `library-match`, `franchise-groups`, `metadata-regression` (+ earlier suites).

## 6. Tests executed and results

`node --test tests/*.test.mjs` → **498 pass / 0 fail**; `npm run typecheck` clean; `npm run build` clean. Regression examples (Slime ×7, Re:ZERO ×2, Killing-Slimes-300-Years negative) verified end to end in `tests/metadata-regression.test.mjs`.

## 7. Known remaining problems

1. Secondary adapters are offline-tested (injected transport) — live smoke tests at first integration are still due; MAL rate limit must be confirmed from the official docs page.
2. Wikidata AniList/AniDB property IDs unverified (by design omitted).
3. `split-cour` detection needs official part markers on titles; unnamed cour splits stay `next-season` (conservative).
4. The relationship store is ready but not yet consulted by every read path (wiring continues as needed).
5. IMDb artwork still runs on unofficial endpoints (availability risk).

## 8. Recommended future improvements

- Live smoke harness for adapters (rate-limit-aware, fixture-first in CI).
- Populate Wikidata property IDs for AniList/AniDB after verification; enable identity rung 2 at scale.
- Replace IMDb artwork with TMDB where licensing requires it.
- Counter/backstop policy for passkeys (AV-105b) and the classic backlog (AV-105–108).
- Discrepancy surfacing UI for episode-count conflicts (the flag exists in the model).
