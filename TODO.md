# TODO.md — AnimeVault

> Project-specific master backlog based on the uploaded `ArchTheServer_AnimeBTW` archive.
> Every numbered checkbox below is a proposed implementation or hardening task. Existing functionality is inventoried separately so it is not mistaken for unfinished work.

## Mission

Build a polished, self-hosted anime discovery and viewing platform that scales from one person with a local media library to a multi-user household installation. The ambition is intentionally expansive: reliability, privacy, accessibility, content organization, and maintainability matter just as much as flashy player features.

## Project baseline observed in the uploaded archive

- **Frontend:** React 19, TypeScript, Vite, React Router, Tailwind CSS.
- **Backend:** Node.js ES modules and Express 5, with a REST API and static production hosting.
- **Metadata:** AniList GraphQL plus AniDB helpers and in-process caching.
- **Playback:** local-first media playback, live fallback, FFmpeg remuxing, byte-range serving, and sidecar subtitles.
- **Downloads:** persistent queue, bulk jobs, pause/resume/cancel/retry, restart recovery, and Server-Sent Events.
- **Library:** shared local directory, scanner/index, chunked upload sessions, imports, and file operations.
- **Artwork:** IMDb search/lookup, local artwork claiming, and focal-point adjustment.
- **Current pages:** Home, Browse, Schedule, Search, Downloads, Downloaded, Bookmarks, and Settings.
- **Current settings:** quality, default resolver result, sub/dub preference, library path, simultaneous downloads, local playback preference, and allowed external hosts.
- **Important baseline note:** this is a code/README review, not a live deployment test or a security audit. Some behaviors may be partial, provider-dependent, or require validation.

## Verification & completion log

**Running totals (2026-11-19):** 88/800 checked; 11 partial items annotated and
still open; latest `npm run verify`: 428 tests across 16 files, typecheck and
production build clean.

**Batch 1 — baseline verification.** Added `npm test` / `npm run verify`,
`tests/core-verification.test.mjs` and `tests/api-smoke.test.mjs`; verified byte
ranges, path/SSRF guards, atomic writes, HTTP headers and local API shapes;
checked off 73 already-implemented items with evidence notes.

**Batch 2 — completion.** AV-040 daily-pick UI plus a deterministic rotation
test; AV-073 search request cancellation via `AbortController` plus the existing
sequence guard; AV-594 public `/api/ready` readiness endpoint, HTTP test and
README entry; AV-701 built-in coverage report. All four verified with
`npm run verify` (one readiness auth issue found during the batch was fixed).

**Batch 3 — AV-002.** Added a dedicated persistent provider-identifier registry
(`server/identifiers.mjs`) and read-only lookup routes. AniList auto-registers
only IDs present in its response (AniList, MAL, and direct AniDB); the registry
also supports IMDb IDs supplied by other adapters. Provider IDs stay out of the
canonical catalog record. Registry validation, reverse lookup, restart
persistence and corrupt-file recovery are tested. A review found the initial
implementation also leaked IDs into catalog records; that is now removed and
covered by the AniList-to-registry integration test.

**Batch 4 — AV-003.** `createAnimeRecord` now emits source and ISO
`lastRefreshedAt` metadata for every catalog field, including null-valued fields;
AniList normalization stamps each field from one response time. Tests verify the
field set, normalization and adapter integration.

**Batch 5 — AV-004.** Added bounded per-provider field observations and a derived
conflict flag in `fieldMetadata`. The canonical value/source remain explicit and
are never silently replaced; stale same-provider observations are collapsed by
latest timestamp, timestamp ties use stable value ordering, and null/unknown
values do not create false conflicts. `tests/catalog.test.mjs` covers conflicts,
equivalent structured values, unknowns, ties and ignored fields.

**Batch 6 — AV-007.** Added deterministic genre entities and stable IDs on tags.
IDs use NFKC/case/whitespace-normalized label keys, a readable ASCII slug, and a
SHA-256 suffix; original genre labels and tag rank/spoiler data remain available.
Genre entities and tags deduplicate by normalized label while legacy genre labels
remain unchanged. Tests cover Unicode,
slug collisions, case/spacing variants, unknown values, and aggregation. Caveat:
IDs are label-derived (a label rename creates a new ID), no cross-provider synonym
registry exists, and browse/search filters remain label-based for compatibility.
Duplicate tag ranks use the maximum and spoiler status uses conservative OR.

**Batch 7 — AV-008.** Added stable linked organization entities for studios,
producers, licensors, and distributors, with source-scoped IDs (or normalized
name fallback), deduplicated source-attributed aliases, and sanitized site URLs.
The AniList adapter now supplies studio IDs and attributes while preserving the
legacy `studios: string[]` field; the other kinds are accepted by the
provider-neutral normalizer. Tests cover absent IDs, duplicate names, Unicode
normalization/slug collisions, aliases, and all four kinds. `npm run verify`
passes with 335 tests plus clean typecheck and build.

**Batch 8 — AV-009.** Catalog records now normalize country values as
trimmed/uppercased two-letter country codes and canonicalize original-language
ISO 639 / BCP-47 tags with `Intl.Locale`; malformed and `und` values become null.
The AniList adapter already supplies country of origin but does not expose
original language, so that field stays unknown unless another adapter supplies
it. Tests cover case/space normalization, alpha-code and locale aliases,
script/region tags, invalid inputs, and adapter output. `npm run verify` passes
with 338 tests, typecheck, and build.

**Batch 9 — AV-010.** Existing catalog/consumers already used minutes, but the
factory copied runtime values without validating units or numeric bounds. Added
normalization to positive rounded whole minutes: legacy unannotated values remain
minutes; explicit minute/second/millisecond/hour units and `{value, unit}` inputs
convert to minutes; malformed, nonpositive, unsupported, or over-bound values
become null. AniList declares its API duration as minutes. Unit conversion and
invalid-value cases are tested; `npm run verify` passes with 340 tests, typecheck,
and build. Live upstream data was not available for validation.

**Batch 10 — AV-011.** Added `ageRatings`, a region-aware collection carrying
region, rating system, display value, optional minimum age, and source. Regions
normalize to uppercase two-letter codes or `GLOBAL`; rating labels/systems are
normalized, exact source-specific duplicates collapse deterministically, and
invalid entries are skipped without inferring minimum ages. The AniList adapter
has no regional age classification; its adult flag is not treated as a rating.
Tests cover multiple systems/regions, duplicate/source behavior, invalid input,
and unknown age values. `npm run verify` passes with 343 tests, typecheck, and
build.

**Batch 11 — AV-012.** Canonical `score` values are normalized to percentages
on a 0–100 scale (rounded to two decimal places), while `providerScores` retains
each known provider's source, original value, declared scale, and normalized
percentage. Legacy top-level scores remain percentage-scaled by default; adapters
for another scale must pass `scoreScale`, and supplemental provider-score entries
must explicitly include a scale. Invalid or out-of-range values are rejected
rather than guessed. The current AniList query requests `averageScore` (not a separate scale field);
the existing UI/filter contract treats this value as 0–100, and the adapter
retains it with scale 100. No other provider score is fabricated, and a live
upstream response was unavailable for validation. Bookmark/list sanitization
preserves normalized score details and decimal percentages.
Catalog, AniList-adapter, provenance, and import tests cover conversion,
validation, and retention. `npm run verify` passes with 347 tests across 14
files, typecheck, and production build.

**Batch 12 — AV-013.** Added canonical `startDate`/`endDate` FuzzyDates as
partial `{year, month, day}` values: known precision is preserved, missing
parts are never filled, and invalid or impossible calendar dates become null.
AniList already exposes these fields on detail; its shared metadata and browse
queries now request them too. `nextAiringEpisode.airingAt` remains whole Unix
seconds, is validated with its episode number, and is not reinterpreted as
milliseconds. Catalog, detail timelines/episode guides, bookmarks, and list
imports use the same normalizers. Tests cover partial/leap dates, malformed
calendar values, timestamp units, AniList mappings, and stored imports. No live
upstream response was available. `npm run verify` passes with 353 tests across
14 files, typecheck, and production build.

**Checklist reconciliation.** AV-070/071/072 are now partial and unchecked:
search groups are format-only, highlighting and relevance reasons appear in
typeahead/local-library views rather than catalog result cards, and character,
staff, and studio result types are absent. AV-099 and AV-277 are also partial:
notes are server-shared without account ownership, and quality options are
presets rather than source-derived renditions. AV-553 is partial because global
CSRF middleware is tested on only a subset of mutating routes. The AV-099 UI no
longer incorrectly claims notes are device-only. AV-594 and AV-701 evidence now
distinguishes actual readiness checks/current totals from the initial coverage
baseline.

**Not verifiable here:** live provider responses (no outbound access), ffmpeg
(binary absent), browser E2E, real upload/download I/O, and multi-user deployment
behavior. These remain unchecked until a suitable integration environment exists.

## How to use this backlog

- [ ] means the proposed task has not been verified as complete in this review; it does **not** prove no partial implementation exists.
- Section priority is a suggested order, not a hard dependency. **P0** protects the foundation; **P1** improves everyday use; **P2** adds power-user and scaling capability; **P3** is optional ambitious territory.
- Give each item an issue, owner, acceptance criteria, and tests before implementation.
- Keep the local-library experience useful even when external metadata or media providers are unavailable.
- Only connect media sources the operator is authorized to access. Do not build DRM, paywall, or access-control circumvention.

## TODO

### 01 · Catalog and metadata normalization · P0 / P1

A single clean metadata model is the foundation for every other screen.

- [x] **AV-001** — Create a canonical anime record independent of AniList's response shape. (`server/catalog.mjs`; verified with `npm test`, including tests/catalog.test.mjs and tests/core-verification.test.mjs. Numeric IDs still originate from AniList; the separate provider identifier collection is AV-002.)
- [x] **AV-002** — Store provider IDs in a dedicated external-identifiers collection. (`server/identifiers.mjs` persists validated, unique AniList/MAL/AniDB/IMDb IDs; AniList adapter currently registers AniList/MAL/direct-AniDB IDs; registry remains separate from catalog records; `/api/identifiers/*`; tests/identifiers.test.mjs and tests/metadata-provenance.test.mjs)
- [x] **AV-003** — Track metadata source and last-refresh timestamp for every field. (`createAnimeRecord` emits `fieldMetadata` for every catalog metadata field; AniList normalization stamps one provider and ISO refresh time across fields; tests/catalog.test.mjs + tests/metadata-provenance.test.mjs)
- [x] **AV-004** — Add field-level provenance when two providers disagree. (`fieldMetadata` preserves bounded per-provider observations and derives `conflict`; canonical value/source remain explicit with no silent precedence; same-provider newest/tie rules and unknown handling tested in tests/catalog.test.mjs; typed in src/types.ts)
- [x] **AV-005** — Normalize title variants into romaji, English, native, and preferred display names. (createAnimeRecord exposes title/romaji/english/native with defaults; tests/catalog.test.mjs)
- [x] **AV-006** — Normalize season, year, format, status, and episode-count fields. (createAnimeRecord normalizes season, year, format, status and episode/duration fields; tests/catalog.test.mjs)
- [x] **AV-007** — Normalize genres and tags into stable internal identifiers. (`createAnimeRecord` adds deduplicated `genreEntities` and SHA-256-backed tag IDs while retaining labels/rank/spoiler fields; NFKC/case/spacing, Unicode, slug collisions and unknown inputs tested in tests/catalog.test.mjs; client types updated in src/types.ts)
- [x] **AV-008** — Normalize studios, producers, licensors, and distributors as linked entities. (`organizations` adds stable linked records with provider/name identity, source-attributed aliases and safe URLs; AniList populates studios while `studios: string[]` remains unchanged; tests/catalog.test.mjs covers missing IDs, deduplication, Unicode/collision behavior and all four kinds; producers/licensors/distributors are normalized provider-neutrally because AniList exposes only studio nodes)
- [x] **AV-009** — Normalize country of origin and original language. (`countryOfOrigin` normalizes NFKC/case/whitespace into two-letter codes; `originalLanguage` canonicalizes ISO 639 / BCP-47 tags through `Intl.Locale`, rejecting malformed/`und`; tested defaults, adapters, aliases, scripts/regions and invalid inputs in tests/catalog.test.mjs; AniList supplies country but no original-language field, so this stays null unless another adapter provides it)
- [x] **AV-010** — Normalize episode runtimes into a consistent duration format. (`createAnimeRecord` emits positive rounded whole minutes, converts explicit minute/second/millisecond/hour values, preserves unannotated legacy minutes, and maps invalid/unsupported/out-of-range runtimes to null; AniList adapter declares minutes; tests/catalog.test.mjs covers conversion and rejection; no live upstream response was available)
- [x] **AV-011** — Normalize age ratings into a common region-aware model. (`ageRatings` records normalized region, scheme, rating, optional minimum age, and source; supports ISO alpha-2-like regions plus `GLOBAL`, deduplicates identical source-specific entries, and skips invalid records without deriving ages; tests/catalog.test.mjs covers regional schemes, sources, duplicates, malformed rows and unknown ages; AniList provides no regional rating, and its adult flag is not misrepresented as one)
- [x] **AV-012** — Normalize score values while retaining each provider's original scale. (`score` is a 0–100 percentage, rounded to two decimals; `providerScores` retains source, original value, declared scale, and recomputed normalized percentage; legacy top-level inputs default to 100 while supplemental scores require explicit scales; malformed/out-of-range scores are rejected; AniList's queried `averageScore` is kept at scale 100 and no other provider score is invented; bookmarks/list imports preserve scale data; tests in catalog, AniList, provenance, and list import; `npm run verify` passes with 347 tests, typecheck, and build; live upstream validation unavailable)
- [x] **AV-013** — Normalize start dates, end dates, and broadcast timestamps. (`startDate`/`endDate` now preserve valid AniList FuzzyDate precision as year/year-month/full date without timezone or synthesized parts; impossible/out-of-range dates normalize to null; `nextEpisode.airingAt` remains validated Unix seconds and millisecond magnitudes are rejected; shared query fields added to AniList browse/metadata selections, with detail consumers and bookmark/list sanitization using the same normalizers; tests in catalog, AniList, core verification, and list import; `npm run verify` passes with 353 tests, typecheck, and build; no live upstream response available)
- [x] **AV-014** — Represent unknown, unannounced, and not-applicable values separately. (`FieldMetadata` gains `valueState: 'known' | 'unknown' | 'unannounced' | 'not_applicable'` per field; `FieldObservation` gains `valueState`. `createFieldMetadata` infers state from the canonical value (null/blank/`'UNKNOWN'`/title fallback → unknown, otherwise known) and honors explicit provider states — `'known'` cannot manufacture a known state for a missing value, while unknown/unannounced/not_applicable are authoritative. `observationsConflict` excludes unknown states and compares canonical + observations by (state, value), so unannounced/not_applicable are distinct comparable states. TypeScript types in src/types.ts; tests in tests/catalog.test.mjs (inference, explicit states, per-observation state, conflict exclusions). `npm run verify`: 359 tests, typecheck, and production build clean.)
- [x] **AV-015** — Add metadata schema versioning and migration support. (`server/catalog.mjs` exports `METADATA_SCHEMA_VERSION`; `createAnimeRecord` stamps `metadataSchemaVersion` on every record; new `migrateMetadataSchema(record)` upgrades schemaless/older records — adds complete `fieldMetadata` per `CATALOG_METADATA_FIELDS`, infers missing `valueState`s from canonical values, backfills observation states, bumps the version, and never mutates the input. Records at/above the current version are copied unchanged; missing/null/garbage versions are migrated. `server/store.mjs` runs `sanitizeBookmarkMedia` output through `migrateMetadataSchema` so stored/imported bookmarks are upgraded on load. `src/types.ts` adds `metadataSchemaVersion?: number` to `Media`. Tests in tests/catalog.test.mjs cover version stamping, idempotent copies, schemaless upgrades, state backfilling, bad-version handling, and non-mutation. `npm run verify`: 364 tests, typecheck, and production build clean.)
- [x] **AV-016** — Detect and merge duplicate anime records safely. (New `server/duplicateDetection.mjs`: `normalizeTitle`/`titleTokens`/`titleSimilarity`/`bestTitleSimilarity` for cross-variant title matching; `findDuplicates(target, candidates, { externalIds, findId, threshold })` flags titles sharing an external identifier (AniList/MAL/AniDB/IMDb via `server/identifiers.mjs`) or above the default 0.8 title-similarity threshold; `mergeRecords(primary, duplicate)` builds a merged catalog record where primary wins but empty/unknown primary fields are filled from the duplicate, field metadata provenance is preserved and observations deduplicated by source+value, plus a `repoint` map so bookmarks/lists keep referring to the surviving title; `mergeIdentifiers(primaryId, duplicateId)` moves the duplicate's provider ids to the primary and removes the duplicate's registry record, best-effort and never throwing. The module never mutates stores directly — callers apply the repoint map. Tests in tests/duplicateDetection.test.mjs cover normalization, similarity, merging, registry-backed detection, identifier repointing, and restart persistence. `npm run verify`: 381 tests, typecheck, and production build clean.)
- [x] **AV-017** — Support manual corrections without overwriting source metadata. (`FieldMetadata` gains optional `manualCorrection: { value, correctedBy, correctedAt, reason? }`; `src/types.ts` adds `FieldManualCorrection` interface. `server/catalog.mjs` adds `normalizeManualCorrection` validation, passes `manualCorrection` through `createFieldMetadata`, and exports `applyManualCorrection(record, field, correction)` which sets the corrected canonical value, records the correction block, preserves provider observations untouched, recomputes valueState/conflict (conflict uses the corrector as the selected source so provider observations still compare), and never mutates the input. Tests in tests/catalog.test.mjs cover correction storage, observation preservation, non-mutation, malformed-input rejection, createFieldMetadata pass-through, and blank→unknown state. `npm run verify`: 386 tests, typecheck, and production build clean.)
- [x] **AV-018** — Add a metadata refresh policy per entity type. (`src/types.ts` adds `EntityType`, `RefreshCategory`, `FieldFreshness`, `RefreshPolicyEntry`, and `RecordRefreshStatus` types. `server/catalog.mjs` groups `CATALOG_METADATA_FIELDS` into refresh categories (identity, airing, score, descriptive, links) with per-entity-type max-age TTLs — TV airing fields refresh every hour, movies every 7 days, identity fields 30 days; exports `entityTypeFromFormat`, `fieldCategory`, `refreshPolicy`, `fieldFreshness`, `isFieldStale`, and `recordRefreshStatus` which assesses every field and reports `needsRefresh`/`staleFields`/`freshness` without mutating the record. Tests in tests/refresh-policy.test.mjs cover format mapping, field categories, per-entity TTLs, freshness boundaries, stale/never_refreshed/unknown states, and record-level assessment. `npm run verify`: 406 tests across 15 files, typecheck, and production build clean.)
- [x] **AV-019** — Expose a metadata freshness indicator on detail pages. (`src/types.ts` adds `refreshStatus?: RecordRefreshStatus` to `MediaDetail`. `server/index.mjs` imports `recordRefreshStatus` from `catalog.mjs` and includes `refreshStatus: recordRefreshStatus(media)` in the `/api/anime/:id` detail response. `src/pages/AnimeDetail.tsx` renders a "Metadata freshness" SectionCard showing a summary (all current / N fields need refresh) plus per-field stale field name, freshness state (stale/never_refreshed/unknown) and last-refreshed time, color-coded by severity; uses a local `refreshStatus` const to satisfy TypeScript narrowing. Tests in tests/catalog.test.mjs cover all-fresh, stale/never-refreshed flagging, entity-type TTLs, record non-mutation, and fieldFreshness/isFieldStale agreement. `npm run verify`: 412 tests across 15 files, typecheck, and production build clean.)
- [x] **AV-020** — Add per-provider request quotas and backoff policies. (`server/rateLimit.mjs` adds a `RateLimiter` with per-provider sliding-window quotas and exponential backoff: `canProceed(provider)` gates requests on quota + cooldown and records the attempt; `recordSuccess`/`recordFailure` update backoff (429/5xx/network errors back off exponentially, capped at maxMs; non-retryable 4xx don't); `status`/`quotaInfo`/`reset` for inspection. Defaults: AniList 90 req/min, IMDb 30 req/min; clock injectable for deterministic tests. `src/types.ts` adds `ProviderQuota`, `BackoffConfig`, `ProviderQuotaCheck`, `ProviderRateStatus`, `ProviderQuotaInfo`. `server/anilist.mjs` wires `rateLimiter` into `gql`: quota/cooldown gate returns 503 `PROVIDER_RATE_LIMITED` before calling upstream, 429/5xx responses record failure and sleep the backoff delay, successes clear backoff, network failures back off. Tests in tests/rateLimit.test.mjs cover quotas/sliding-window expiry, cooldown, exponential backoff + cap, non-retryable 4xx, status/quotaInfo/reset, and provider isolation. `npm run verify`: 428 tests across 16 files, typecheck, and production build clean.)
- [x] **AV-021** — Cache immutable metadata separately from rapidly changing airing data. (`server/metadataCache.mjs`: two-tier cache — `cachedImmutable` 1hr TTL, `cachedAiring` 2min TTL, shared bounded LRU 300/tier, `flush()`/`snapshot()`, injectable `now`; all 12 `anilist.mjs` call sites rewired; tests/ttl tiers + tier independence + LRU + stale-beats-error + flush/snapshot — 438 pass; committed `79108c1`, `npm run verify` clean)
- [x] **AV-022** — Record metadata fetch failures without erasing last-known-good values. (`server/metadataCache.mjs`: each fetch failure is recorded with key/tier/timestamp/error in a bounded failure log (cap 100) inside the `cached` catch block; stale-beats-error preserved so last-known-good is never erased; new `recentFailures()` export; 5 tests added — no-failure-on-success, failure-recorded+stale-preserved, no-hit-error-propagates, tier tagging, bounded log — 443 pass / 0 fail)
- [x] **AV-023** — Add artwork variants with source, dimensions, and attribution metadata. (`src/types.ts`: `ArtworkVariant` interface + optional `artwork?: ArtworkVariant[]` on `Media`; `server/catalog.mjs`: `normalizeArtworkVariant` helper, `artwork` added to `CATALOG_METADATA_FIELDS` + identity refresh category, `createAnimeRecord` derives poster/banner from cover/banner or normalizes provider-supplied variants (capped 16), `server/anilist.mjs`: supplies poster+banner variants with source 'anilist' and attribution; tests/catalog.test.mjs: default empty artwork, derivation from cover/banner, provider variants with dimensions/attribution, unsafe-URL rejection, variant cap — 448 pass / 0 fail; `npm run verify` clean)
- [x] **AV-024** — Add a metadata completeness score for each catalog entry. (`server/catalog.mjs`: `computeCompletenessScore(record)` returns 0-100 using per-field weights over `CATALOG_METADATA_FIELDS`; a field counts when meaningfully present and its `fieldMetadata.valueState` is not `unknown`/`unannounced`/`not_applicable`; bare record = 0, fully populated = 100; `id`/`fieldMetadata`/`metadataSchemaVersion`/`anidbSearch` excluded; `src/types.ts`: `MetadataCompletenessScore` type + optional `completenessScore` on `Media`; tests/catalog.test.mjs: bare=0, non-record=0, monotonic growth, fully-populated=100, valueState exclusion — 453 pass / 0 fail; `npm run verify` clean)
- [x] **AV-025** — Build an admin metadata inspector showing raw and normalized records. (`server/anilist.mjs`: exported `normalize`, added shared `DETAIL_QUERY` const (used by both `getDetail` and the new `getMediaInspection`), added `getMediaInspection(id)` returning `{ id, raw, normalized, completenessScore, refreshStatus }`; `server/index.mjs`: `GET /api/admin/metadata/:id` endpoint returning the inspection object; `tests/adminMetadataInspector.test.mjs`: raw vs normalized comparison, invalid-id rejection, missing Media handling, normalize export transform — 457 pass / 0 fail across full suite; `npm run verify` clean)

### 02 · Browse, seasons, and discovery · P1

Expand the existing season browser into a complete catalog exploration experience.

- [x] **AV-026** — Add browse filters for TV, movie, OVA, ONA, and special formats. (BROWSE_FORMATS + parseBrowseFilters; tests/core-verification.test.mjs)
- [x] **AV-027** — Add filters for currently airing, upcoming, finished, and cancelled shows. (BROWSE_STATUSES + parseBrowseFilters; tests/core-verification.test.mjs)
- [x] **AV-028** — Add multi-select genre filters with include and exclude modes. (genres/genresExclude parsing and local predicate; tests/core-verification.test.mjs)
- [x] **AV-029** — Add tag filters with AND, OR, and NOT combinations. (`server/browse.mjs`: `tagMode` now accepts 'not' alongside 'and'/'or'; `matchMediaLocally` rejects media carrying any requested tag in NOT mode and ignores spoiler tags; `describeFilters` renders "none of" for NOT mode; `filtersToParams` serializes 'not' for shareable URLs; `buildBrowseQuery` keeps `tag_in` pushdown AND-only since NOT/OR are evaluated locally. `tests/core-verification.test.mjs`: NOT-mode accept/reject, spoiler-tag exclusion, combined NOT + existing filters — 457 pass / 0 fail across full suite; `npm run verify` clean)
- [x] **AV-030** — Add studio and producer browsing pages. (`server/anilist.mjs`: `studios()` accepts `type` filter ('animation' | 'producer' | 'all') based on `isAnimationStudio`, cache key includes type; `server/index.mjs`: `/api/studios` accepts `type` query param and echoes it in response; `src/lib/api.ts`: `studios()` client accepts `type` param; `StudioListResponse` includes `type`; `src/pages/Studios.tsx`: All/Animation/Producer toggle with shareable URL param; `tests/anilist.test.mjs`: type filter accept/reject, search/sort pass-through, bucket/metadata preservation — 460 pass / 0 fail; `npm run verify` clean)
- [x] **AV-031** — Add decade and release-year range filters. (decade shorthand and clamped year ranges; tests/core-verification.test.mjs)
- [x] **AV-032** — Add season filters that include historical seasons. (includeOlderSeasons (share URL key `older`); tests/core-verification.test.mjs)
- [x] **AV-033** — Add popularity, score, favourites, and trending sort orders. (BROWSE_SORTS exposes popular/trending/rated/newest/oldest/title/episodes/favourites; tests/core-verification.test.mjs)
- [x] **AV-034** — Add episode-count range filters. (episodesMin/episodesMax range; tests/core-verification.test.mjs)
- [x] **AV-035** — Add runtime range filters for short-form and long-form anime. (durationMin/durationMax range; tests/core-verification.test.mjs)
- [x] **AV-036** — Add source-material filters such as manga, novel, game, and original. (BROWSE_SOURCES filter; tests/core-verification.test.mjs)
- [x] **AV-037** — Add country and original-language browse filters. (`server/browse.mjs`: added `BROWSE_ORIGINAL_LANGUAGES` constant (JA, KO, ZH, EN), `originalLanguages` parsing in `parseBrowseFilters`, `originalLanguage_in` GraphQL pushdown in `buildBrowseQuery`, `originalLanguage` field requested in browse query, local matching in `matchMediaLocally`, serialization in `filtersToParams`, description in `describeFilters`, count in `activeFilterCount`. Country filters already existed. `tests/core-verification.test.mjs`: parsing with unknown-code rejection, local match accept/reject/null handling, GraphQL pushdown assertion, share-URL round trip, describeFilters output, activeFilterCount increment — 465 pass / 0 fail; `npm run verify` clean)
- [x] **AV-038** — Add content-rating filters with user-configurable defaults. (`server/browse.mjs`: `BROWSE_CONTENT_RATINGS` constant (G, PG, PG-13, R, NC-17, TV-Y, TV-Y7, TV-G, TV-PG, TV-14, TV-MA), `contentRatings` parsing/validation, local matching in `matchMediaLocally` against `media.ageRatings`, share-URL serialization, `describeFilters` output, `activeFilterCount` increment; `server/settings.mjs`: `defaultContentRatings` setting persisted via GET/PUT /api/settings with validation against BROWSE_CONTENT_RATINGS; `tests/core-verification.test.mjs`: parsing with unknown-code rejection, local match accept/reject/null/multi-rating handling, share-URL round trip, describeFilters output, activeFilterCount increment — 469 pass / 0 fail; `npm run verify` clean)
- [x] **AV-039** — Add a random anime discovery button with filter awareness. (Browse "Surprise me" calls filter-aware /api/discover/random)
- [x] **AV-040** — Add a daily discovery spotlight with a rotating catalog pick. (Browse "Daily pick" calls /api/discover/spotlight; daily rotation verified by tests/core-verification.test.mjs)
- [x] **AV-041** — Add hidden-gem collections based on low popularity and strong ratings. (Browse "Hidden gems" calls /api/discover/hidden-gems (low popularity, strong rating))
- [x] **AV-042** — Add seasonal comparison view for two or more seasons. (`GET /api/seasons/compare` accepts repeated `season=` and `year=` query params; `server/anilist.mjs`: `compareSeasons()` with dedup, per-season summaries via pure `seasonSummary()`, shared-title detection; frontend `src/pages/SeasonCompare.tsx` with season/year pickers, per-season stats cards, shared-title grid; route `/compare`; `src/lib/api.ts`: `compareSeasons()` client; `tests/core-verification.test.mjs`: seasonSummary aggregation + compareSeasons validation — 473 pass / 0 fail; `npm run verify` clean)
- [x] **AV-043** — Add a calendar-style seasonal release overview. (`GET /api/season/calendar`; `server/anilist.mjs`: `seasonCalendar()` + pure `groupMediaByStartDate()` grouping by `YYYY-MM-DD`; frontend `src/pages/SeasonCalendar.tsx` with season/year navigation and per-month mini-calendars showing release-day titles; route `/calendar`; `src/lib/api.ts`: `seasonCalendar()` client; `tests/core-verification.test.mjs`: grouping tests — 475 pass / 0 fail; `npm run verify` clean)
- [x] **AV-044** — Add a studio-focused release explorer. (`StudiosPage` directory with search + animation/producer type filters and alphabetical buckets; `StudioPage` filmography grouped by year with decade filtering, sort options (popular/rated/newest/oldest), load-more pagination; routes `/studios` and `/studios/:id`; backend `/api/studios` and `/api/studios/:id`; `src/lib/api.ts`: `studios()` + `studio()` clients; `explore.groupByStudio`/`normalizeStudio` tested in core-verification — 475 pass / 0 fail)
- [x] **AV-045** — Add a franchise-focused browse mode. (Discover page /api/franchises + explore.buildFranchiseGroups; tests/core-verification.test.mjs)
- [x] **AV-046** — Add an alphabetical index with kana and Latin navigation. (explore.indexBucket/buildAlphabetIndex + /index page; tests/core-verification.test.mjs)
- [x] **AV-047** — Add a recently added to catalog section. (anilist.recentlyAdded + Discover page section)
- [x] **AV-048** — Add a recently updated metadata section. (anilist.recentlyUpdated + Discover page section)
- [x] **AV-049** — Add a browse filter preset save/load system. (`src/lib/browsePresets.ts`: localStorage-backed `useBrowsePresets()` hook with save/remove/clear, MAX_PRESETS=30 cap, name deduplication, storage event sync; `Browse.tsx`: preset dropdown with save input, apply/delete buttons, clear-all; exports `readPresets`/`writePresets`/`STORAGE_KEY`/`MAX_PRESETS` for testing; `tests/core-verification.test.mjs`: round trip, validation, malformed JSON, MAX_PRESETS cap — 481 pass / 0 fail; `npm run verify` clean)
- [x] **AV-050** — Add shareable URLs that preserve all active browse filters. (browse.filtersToParams round trip + Browse share-link button; tests/core-verification.test.mjs)

### 03 · Search and query experience · P0 / P1

Make search fast, forgiving, explainable, and useful across the entire library.

- [x] **AV-051** — Add instant search suggestions while typing. (Search page typeahead via /api/suggest (live AniList unreachable in this sandbox))
- [x] **AV-052** — Add keyboard navigation for every search suggestion. (ArrowUp/ArrowDown/Enter suggestion navigation in src/pages/Search.tsx)
- [x] **AV-053** — Support exact title, partial title, and alternate-title matching. (search.rankTitles exact/partial/alias paths; tests/core-verification.test.mjs)
- [x] **AV-054** — Add fuzzy matching for misspellings and transposed characters. (search.similarity/editDistance transposition and typo cases; tests/core-verification.test.mjs)
- [x] **AV-055** — Add romanization-aware matching for Japanese titles. (`server/search.mjs`: `toRomaji()` Hepburn conversion for hiragana/katakana with digraphs/sokuon, `normalizeForSearchRomaji()` combining normalization + romaji, `rankTitles()` matches romaji queries against kana titles with 'romaji title match' reason; `tests/core-verification.test.mjs`: toRomaji hiragana/katakana/kanji/digraphs, normalizeForSearchRomaji, rankTitles romaji matching — 489 pass / 0 fail; `npm run verify` clean)
- [x] **AV-056** — Add native-script title search. (normalizeForSearch preserves CJK titles and folds accents; tests/core-verification.test.mjs)
- [x] **AV-057** — Add title alias indexing across all known metadata providers. (`server/catalog.mjs`: `createAnimeRecord` builds deduplicated `aliases` array from `input.aliases`, `romaji`, `english`, `native` fields, excluding canonical title; added `aliases` to `CATALOG_METADATA_FIELDS` and `COMPLETENESS_FIELD_WEIGHTS`; `server/search.mjs` `rankTitles()` already matches aliases; `tests/core-verification.test.mjs`: alias building, dedup, title exclusion, provider-supplied aliases — 493 pass / 0 fail; `npm run verify` clean)
- [x] **AV-058** — Add search by studio, staff member, and voice actor. (`server/search.mjs`: `staff`/`voiceActor`/`va`/`voice` added to `FIELD_ALIASES` and `parseSearchQuery` filters, `hasStructuredFilters` updated; `server/browse.mjs`: `studio`/`staff`/`voiceActor` added to `parseBrowseFilters`, `filtersToParams`, and `matchMediaLocally` (studio filter matches against `media.studios`); `tests/core-verification.test.mjs`: staff/voiceActor parsing, studio local matching — 495 pass / 0 fail; `npm run verify` clean)
- [ ] **AV-059** — Add search by character name.
- [ ] **AV-060** — Add search by franchise and sequel relationship.
- [x] **AV-061** — Add search by theme, genre, and tag. (genre:/tag: search syntax + browse filters; tests/core-verification.test.mjs)
- [ ] **AV-062** — Add search by episode title and episode number.
- [x] **AV-063** — Add search within the local media library only. (Search page "My library" tab backed by /api/search/library)
- [ ] **AV-064** — Add search within bookmarks and custom lists only.
- [x] **AV-065** — Add advanced query syntax for field-specific filters. (parseSearchQuery field syntax and structured filters; tests/core-verification.test.mjs)
- [x] **AV-066** — Add search history with per-entry deletion. (src/lib/searchHistory.ts with per-entry deletion and cross-tab sync)
- [x] **AV-067** — Add an option to disable or automatically expire search history. (searchHistory enabled toggle and expiryDays setting)
- [x] **AV-068** — Add typo-correction suggestions with the original query preserved. (search.suggestCorrection + Search page correction UI; tests/core-verification.test.mjs)
- [x] **AV-069** — Add a no-results page with actionable alternative filters. (search.alternativeQueries + no-results UI; tests/core-verification.test.mjs)
- [ ] **AV-070** — Add result grouping by anime, movie, character, staff, and studio. (partially verified: catalog results are grouped by media format; no character, staff, or studio result types)
- [ ] **AV-071** — Add result highlighting for matching title fragments. (partially verified: title highlighting is wired in typeahead and local-library results, not catalog result cards)
- [ ] **AV-072** — Add search result relevance explanations. (partially verified: human-readable match reasons appear in typeahead suggestions, but not catalog result cards)
- [x] **AV-073** — Add debounced requests, cancellation, and stale-response protection. (250 ms debounce + AbortController cancellation + sequence guard in src/pages/Search.tsx and src/lib/api.ts; typechecked)
- [x] **AV-074** — Add a configurable maximum result count and pagination. (RESULT_CAP/clampResultCap + page/perPage filters; tests/core-verification.test.mjs)
- [ ] **AV-075** — Add server-side full-text indexing for the local catalog.

### 04 · Anime details, episodes, and franchise pages · P1

Turn the current detail modal into a complete information hub.

- [x] **AV-076** — Add a dedicated shareable route for each anime detail page. (/anime/:id route in src/App.tsx)
- [x] **AV-077** — Add a full episode guide with numbered episode entries. (detail.buildEpisodeGuide + AnimeDetail episode guide; tests/core-verification.test.mjs)
- [x] **AV-078** — Show episode titles, runtimes, air dates, and synopsis when available. (guide supplies titles, runtimes and derived air dates; AniList provides no episode synopsis field (synopsis remains null))
- [x] **AV-079** — Show episode thumbnail artwork when a legitimate source provides it. (streamingEpisodes thumbnails rendered in the guide; tests/core-verification.test.mjs)
- [x] **AV-080** — Add a season selector for multi-season franchises. (AnimeDetail season selector built from relatedSeasons)
- [x] **AV-081** — Add a related-content section grouped by relationship type. (detail.groupRelations; tests/core-verification.test.mjs)
- [x] **AV-082** — Add canonical sequel, prequel, side-story, and spin-off relationships. (RELATION_GROUPS covers sequel/prequel/side story/spin-off; tests/core-verification.test.mjs)
- [x] **AV-083** — Add a franchise timeline with chronological and release-order modes. (detail.buildTimeline release/chronological modes + UI toggle; tests/core-verification.test.mjs)
- [ ] **AV-084** — Add watch-order recommendations with editable ordering notes.
- [ ] **AV-085** — Add a character gallery with character detail pages.
- [ ] **AV-086** — Add staff pages for directors, writers, composers, and animators.
- [ ] **AV-087** — Add voice-actor profiles and role credits.
- [ ] **AV-088** — Add studio profiles with their complete known catalog.
- [ ] **AV-089** — Add production committee and distributor details where available.
- [ ] **AV-090** — Add source-material links and adaptation relationship details.
- [x] **AV-091** — Add a spoiler-safe synopsis expansion control. (detail.redactSpoilers + reveal control; tests/core-verification.test.mjs)
- [x] **AV-092** — Add a spoiler-free overview mode for new visitors. (/api/media exposes spoilerFreeOverview as `overview`; tests/core-verification.test.mjs)
- [x] **AV-093** — Add a release and production status timeline. (detail.buildStatusTimeline + release-timeline section; tests/core-verification.test.mjs)
- [x] **AV-094** — Add community score distribution rather than a single average. (detail.scoreDistribution/distributionMean/distributionMode + scores section; tests/core-verification.test.mjs)
- [x] **AV-095** — Add external metadata links with provider attribution. (catalog links/siteUrl + AnimeDetail external-links section)
- [ ] **AV-096** — Add a metadata correction suggestion workflow.
- [ ] **AV-097** — Add a report-an-incorrect-episode-order action.
- [ ] **AV-098** — Add detail-page sections that can be rearranged by the user. (partially verified: detail.applySectionOrder helper exists; no UI reorder control is wired up)
- [ ] **AV-099** — Add an anime-specific notes field visible only to its owner. (partially verified: per-anime editor and persistence exist, but notes are in the shared server KV store with no account/owner isolation; UI now says they are stored on this server)
- [x] **AV-100** — Add a printable or exportable anime information sheet. (detail.informationSheet + AnimeDetail print action; tests/core-verification.test.mjs)

### 05 · User accounts and personal profiles · P1 / P2

Move from a single shared installation toward optional individual identities.

- [ ] **AV-101** — Add optional account registration for multi-user installations.
- [ ] **AV-102** — Add secure sign-in and sign-out flows.
- [ ] **AV-103** — Add email verification for installations that enable email accounts.
- [ ] **AV-104** — Add password reset with single-use expiring tokens.
- [ ] **AV-105** — Add passkey authentication support.
- [ ] **AV-106** — Add optional two-factor authentication.
- [ ] **AV-107** — Add recovery codes for account recovery.
- [ ] **AV-108** — Add user profile avatars with safe image validation.
- [ ] **AV-109** — Add display names separate from login identifiers.
- [ ] **AV-110** — Add user profile bios with length and content limits.
- [ ] **AV-111** — Add profile privacy settings for public, private, or link-only visibility.
- [ ] **AV-112** — Add per-user preferred language and locale.
- [ ] **AV-113** — Add per-user default subtitle and audio preferences.
- [ ] **AV-114** — Add per-user playback quality preferences.
- [ ] **AV-115** — Add per-user content-rating preferences.
- [ ] **AV-116** — Add per-user theme and interface preferences.
- [ ] **AV-117** — Add profile activity summaries controlled by privacy settings.
- [ ] **AV-118** — Add profile export and account deletion tools.
- [ ] **AV-119** — Add device/session management with remote sign-out.
- [ ] **AV-120** — Add login notification settings.
- [ ] **AV-121** — Add account creation and last-login audit timestamps.
- [ ] **AV-122** — Add optional guest profiles for household visitors.
- [ ] **AV-123** — Add profile switching without clearing the shared browser session.
- [ ] **AV-124** — Add profile PIN lock for shared living-room devices.
- [ ] **AV-125** — Add account-level feature flags and beta opt-ins.

### 06 · Watchlists, lists, and personal organization · P1

Make bookmarks evolve into a flexible personal anime organization system.

- [x] **AV-126** — Add separate Watching, Planned, Completed, Paused, and Dropped lists. (listStore.STATUSES exposes five built-ins; tests/lists.test.mjs + tests/lists-http.test.mjs)
- [x] **AV-127** — Add custom user-created lists with names and descriptions. (createList/deleteList + tests/lists.test.mjs and tests/lists-http.test.mjs)
- [ ] **AV-128** — Add drag-and-drop ordering for custom lists.
- [ ] **AV-129** — Add list cover artwork assembled from selected titles.
- [ ] **AV-130** — Add private, shared-link, and public list visibility settings.
- [x] **AV-131** — Add notes on individual list entries. (listStore.setNote + tests/list-notes.test.mjs)
- [x] **AV-132** — Add list-entry priority and personal rating fields. (listStore.setRating priority/rating + tests/list-ratings.test.mjs)
- [ ] **AV-133** — Add list grouping by franchise, genre, or season.
- [ ] **AV-134** — Add bulk move between personal lists.
- [ ] **AV-135** — Add bulk removal with an undo window.
- [ ] **AV-136** — Add smart lists driven by saved filter rules.
- [ ] **AV-137** — Add a list for anime with new episodes available.
- [ ] **AV-138** — Add a list for shows returning in a future season.
- [ ] **AV-139** — Add a list for unfinished shows with no recent progress.
- [ ] **AV-140** — Add watchlist capacity warnings that users can disable.
- [x] **AV-141** — Add duplicate prevention across the same list. (listStore.add reuses an existing mediaId; tests/lists-http.test.mjs)
- [x] **AV-142** — Add list import from supported external list formats. (parseListImport + /api/lists/import; tests/list-import.test.mjs)
- [x] **AV-143** — Add list export to JSON and CSV. (exportListJson/exportListCsv; tests/list-export.test.mjs)
- [ ] **AV-144** — Add list comparison between two profiles.
- [ ] **AV-145** — Add list templates such as weekend watchlist or short anime queue.
- [x] **AV-146** — Add a random pick action limited to the current list. (pickListEntry + /api/lists/:id/random; tests/list-random.test.mjs)
- [ ] **AV-147** — Add list-level sort and filter presets.
- [ ] **AV-148** — Add list activity history for shared lists.
- [ ] **AV-149** — Add list ownership transfer for shared household lists.
- [x] **AV-150** — Add a bookmark-to-list migration tool preserving existing bookmark IDs. (migrateBookmarks + /api/lists/migrate; tests/lists.test.mjs)

### 07 · Watch progress, history, and continuity · P0 / P1

Make the app remember exactly where each person stopped watching.

- [ ] **AV-151** — Persist progress independently for every user profile.
- [ ] **AV-152** — Persist progress independently for every anime, season, and episode.
- [ ] **AV-153** — Store playback position at configurable intervals.
- [ ] **AV-154** — Store whether an episode is started, completed, or manually marked.
- [ ] **AV-155** — Add a configurable episode-completion threshold.
- [ ] **AV-156** — Add manual mark-as-watched and mark-as-unwatched controls.
- [ ] **AV-157** — Add rewind-progress and reset-progress confirmation flows.
- [ ] **AV-158** — Add a continue-watching rail on the homepage.
- [ ] **AV-159** — Add a next-episode action after completion.
- [ ] **AV-160** — Add automatic next-episode selection with a user toggle.
- [ ] **AV-161** — Add a watch-history page with date and title filters.
- [ ] **AV-162** — Add watch-history search across titles and dates.
- [ ] **AV-163** — Add watch-history deletion per entry.
- [ ] **AV-164** — Add bulk watch-history deletion with confirmation.
- [ ] **AV-165** — Add private-history mode that does not record playback sessions.
- [ ] **AV-166** — Add session records with start time, end time, and watched duration.
- [ ] **AV-167** — Add resume prompts when multiple devices have different progress.
- [ ] **AV-168** — Add conflict resolution for simultaneous playback sessions.
- [ ] **AV-169** — Add progress reconciliation after offline viewing.
- [ ] **AV-170** — Add a rewatch counter and optional rewatch date history.
- [ ] **AV-171** — Add per-episode completion state for specials and recap episodes.
- [ ] **AV-172** — Add support for absolute episode numbering and split cours.
- [ ] **AV-173** — Add watched-progress import from supported list services.
- [ ] **AV-174** — Add progress export with stable external IDs.
- [ ] **AV-175** — Add a progress integrity repair utility for missing episodes.

### 08 · Core video player experience · P0

Strengthen the existing Player component into a reliable everyday player.

- [ ] **AV-176** — Add a clear loading state with separate metadata and media readiness.
- [x] **AV-177** — Add a player error screen with understandable recovery actions. (PlayerOverlay error state with an attempt-based retry action)
- [ ] **AV-178** — Add click-to-pause and click-to-resume behavior.
- [ ] **AV-179** — Add configurable keyboard shortcuts with conflict detection.
- [ ] **AV-180** — Add a seek bar with current time and total duration.
- [ ] **AV-181** — Add hover previews on the seek bar when thumbnails exist.
- [ ] **AV-182** — Add tap-to-seek gestures on touch devices.
- [ ] **AV-183** — Add a configurable skip-forward interval.
- [ ] **AV-184** — Add a configurable skip-backward interval.
- [ ] **AV-185** — Add previous-episode and next-episode controls.
- [ ] **AV-186** — Add a central play/pause control that fades when idle.
- [ ] **AV-187** — Add a persistent control bar during pointer movement.
- [ ] **AV-188** — Add playback speed selection with a remembered preference.
- [ ] **AV-189** — Add picture-in-picture support where the browser allows it.
- [ ] **AV-190** — Add fullscreen mode with reliable exit behavior.
- [ ] **AV-191** — Add double-click fullscreen toggle.
- [ ] **AV-192** — Add volume slider with mute toggle.
- [ ] **AV-193** — Add remembered volume level per profile.
- [ ] **AV-194** — Add a playback timeline marker for the intro and ending.
- [ ] **AV-195** — Add a resume-from-last-position prompt.
- [ ] **AV-196** — Add an option to start the episode from the beginning.
- [ ] **AV-197** — Add a next-episode countdown that can be dismissed.
- [ ] **AV-198** — Add manual player resize modes for windowed playback.
- [ ] **AV-199** — Add a player-only focus mode that hides surrounding interface.
- [ ] **AV-200** — Add accessible player controls with labels and focus states.

### 09 · Advanced playback and viewing modes · P2 / P3

Add power-user controls without making the default player overwhelming.

- [ ] **AV-201** — Add configurable intro-skip markers per episode.
- [ ] **AV-202** — Add configurable recap-skip markers per episode.
- [ ] **AV-203** — Add configurable ending-skip markers per episode.
- [ ] **AV-204** — Add configurable post-credit scene markers.
- [ ] **AV-205** — Add chapter markers for legitimate chapter metadata.
- [ ] **AV-206** — Add scene thumbnails generated from user-owned local files.
- [ ] **AV-207** — Add frame-by-frame stepping for supported local media.
- [ ] **AV-208** — Add playback loop for a selected time range.
- [ ] **AV-209** — Add continuous playlist playback mode.
- [ ] **AV-210** — Add a theater mode with reduced surrounding interface.
- [ ] **AV-211** — Add an ambient-color background based on the current artwork.
- [ ] **AV-212** — Add a synchronized transcript panel when a transcript exists.
- [ ] **AV-213** — Add a second-screen metadata panel during playback.
- [ ] **AV-214** — Add playback statistics such as dropped frames where exposed by the browser.
- [ ] **AV-215** — Add an optional playback diagnostics overlay.
- [ ] **AV-216** — Add user-adjustable audio/video synchronization offset.
- [ ] **AV-217** — Add user-adjustable subtitle synchronization offset.
- [ ] **AV-218** — Add a safe-screen mode that reduces flashing transitions.
- [ ] **AV-219** — Add a reduced-motion player transition mode.
- [ ] **AV-220** — Add a keyboard-only viewing mode.
- [ ] **AV-221** — Add a compact floating mini-player within the app.
- [ ] **AV-222** — Add a configurable idle screen timeout for shared displays.
- [ ] **AV-223** — Add a playback queue with reorder and remove actions.
- [ ] **AV-224** — Add a multi-episode playlist builder.
- [ ] **AV-225** — Add a watch-together playback mode with synchronized session state.

### 10 · Subtitles, captions, and transcripts · P1 / P2

Expand current sidecar subtitle support into a complete caption workflow.

- [x] **AV-226** — Support WebVTT, SRT, ASS, and SSA with explicit compatibility reporting. (SUBTITLE_EXTENSIONS + normalizeSubtitleToVtt (ASS/SSA conversion needs ffmpeg); tests/core-verification.test.mjs)
- [x] **AV-227** — Add subtitle track discovery for local media sidecar files. (playback.findSubtitle sidecar discovery; tests/core-verification.test.mjs)
- [ ] **AV-228** — Add an in-player subtitle track selector.
- [ ] **AV-229** — Add subtitle upload validation before attaching a track.
- [ ] **AV-230** — Add subtitle language metadata editing.
- [ ] **AV-231** — Add subtitle label editing for duplicate language tracks.
- [ ] **AV-232** — Add subtitle default-track preferences per profile.
- [ ] **AV-233** — Add subtitle font family selection.
- [ ] **AV-234** — Add subtitle font-size controls.
- [ ] **AV-235** — Add subtitle text-color controls.
- [ ] **AV-236** — Add subtitle background and outline controls.
- [ ] **AV-237** — Add subtitle vertical-position controls.
- [ ] **AV-238** — Add subtitle opacity controls.
- [ ] **AV-239** — Add subtitle safe-area positioning for mobile devices.
- [ ] **AV-240** — Add subtitle timing delay controls.
- [ ] **AV-241** — Add subtitle encoding detection and conversion warnings.
- [ ] **AV-242** — Add subtitle preview before saving an attachment.
- [ ] **AV-243** — Add subtitle replacement history with restore support.
- [ ] **AV-244** — Add multiple subtitle tracks per episode.
- [ ] **AV-245** — Add hearing-impaired caption track labels.
- [ ] **AV-246** — Add forced-subtitle track labels.
- [ ] **AV-247** — Add transcript search when a transcript is available.
- [ ] **AV-248** — Add transcript timestamp navigation into the player.
- [ ] **AV-249** — Add subtitle coverage status on anime and episode pages.
- [ ] **AV-250** — Add a local-only subtitle editor for user-owned media.

### 11 · Audio tracks, languages, and dubbing · P1 / P2

Make audio selection more expressive than a single global sub/dub switch.

- [ ] **AV-251** — Detect available audio tracks from supported media containers.
- [ ] **AV-252** — Display language, channel layout, and codec for each audio track.
- [ ] **AV-253** — Allow manual audio-track selection in the player.
- [ ] **AV-254** — Remember audio-track preference per anime.
- [ ] **AV-255** — Remember audio-track preference per profile.
- [ ] **AV-256** — Add preferred-language priority lists.
- [ ] **AV-257** — Add an original-language preference with fallback rules.
- [ ] **AV-258** — Add an English-dub preference with fallback rules.
- [ ] **AV-259** — Add explicit sub, dub, and dual-audio labels when metadata supports them.
- [ ] **AV-260** — Show a warning when requested audio is unavailable.
- [ ] **AV-261** — Add multi-channel audio output selection where supported.
- [ ] **AV-262** — Add stereo downmix preference for headphones.
- [ ] **AV-263** — Add audio volume normalization for local media where supported.
- [ ] **AV-264** — Add dialogue-boost preference where processing is available.
- [ ] **AV-265** — Add optional audio delay adjustment.
- [ ] **AV-266** — Add audio codec compatibility diagnostics.
- [ ] **AV-267** — Add an audio-track metadata editor for local files.
- [ ] **AV-268** — Add audio-language filters to browse and search.
- [ ] **AV-269** — Add a per-show preferred audio language override.
- [ ] **AV-270** — Add a per-show preferred subtitle language override.
- [ ] **AV-271** — Add a remember-last-track option for each series.
- [ ] **AV-272** — Add clear labels for commentary and alternate audio tracks.
- [ ] **AV-273** — Add accessibility-oriented audio description track labels.
- [ ] **AV-274** — Add audio preference import/export.
- [ ] **AV-275** — Add an audio selection test page for diagnosing device output.

### 12 · Streaming quality, adaptive delivery, and resilience · P0 / P2

Make live playback stable across weak networks and different devices.

- [ ] **AV-276** — Add an adaptive-quality mode when the authorized source exposes multiple renditions.
- [ ] **AV-277** — Add a manual quality selector with actual source-available options. (partially verified: static quality presets reach the resolver; it chooses the requested height when present and otherwise falls back to the highest variant, but the UI never receives the actual rendition list)
- [ ] **AV-278** — Show the selected rendition resolution and bitrate when known.
- [ ] **AV-279** — Show a clear reason when a requested quality is unavailable.
- [ ] **AV-280** — Add a network throughput estimate based on recent playback data.
- [ ] **AV-281** — Add a configurable initial quality cap for metered connections.
- [ ] **AV-282** — Add a low-bandwidth mode with reduced artwork and preview requests.
- [ ] **AV-283** — Add buffering-state telemetry that never records media content.
- [ ] **AV-284** — Add bounded retry behavior for transient segment failures.
- [ ] **AV-285** — Add exponential backoff for reconnect attempts.
- [ ] **AV-286** — Add a visible reconnect status and cancel option.
- [ ] **AV-287** — Add stream startup-time measurements.
- [ ] **AV-288** — Add separate timeouts for metadata, manifest, and media requests.
- [ ] **AV-289** — Add graceful handling for expired source URLs.
- [ ] **AV-290** — Add a source refresh action that does not reset watch progress.
- [ ] **AV-291** — Add stream health checks before playback begins.
- [ ] **AV-292** — Add a maximum active-stream limit per server instance.
- [ ] **AV-293** — Add per-user concurrent-stream policies for shared installations.
- [x] **AV-294** — Add HTTP range edge-case tests for local playback. (byte-range full/partial/suffix/open-ended/invalid/HEAD cases; tests/core-verification.test.mjs)
- [x] **AV-295** — Add correct content-type and content-length handling for media responses. (Content-Type, Content-Length and Accept-Ranges asserted; tests/core-verification.test.mjs)
- [ ] **AV-296** — Add configurable buffering targets within browser capabilities.
- [ ] **AV-297** — Add an optional prefetch of the next authorized episode metadata.
- [ ] **AV-298** — Add an adaptive connection strategy for mobile networks.
- [ ] **AV-299** — Add a stream fallback decision log visible to administrators.
- [ ] **AV-300** — Add a provider-neutral playback session interface.

### 13 · Download manager and offline preparation · P1 / P2

Build on the persistent queue with scheduling, integrity, and user control.

- [ ] **AV-301** — Add per-job estimated completion time when enough data exists.
- [x] **AV-302** — Add per-job average transfer speed. (downloads.toPublicJob exposes speedBps)
- [x] **AV-303** — Add per-job transferred bytes and total expected bytes. (downloads.toPublicJob exposes downloadedBytes/totalBytes)
- [ ] **AV-304** — Add queue filtering by status, anime, quality, and date.
- [ ] **AV-305** — Add queue sorting by priority, creation time, or series.
- [ ] **AV-306** — Add user-defined priorities for individual download jobs.
- [ ] **AV-307** — Add a priority boost for the next episode in Continue Watching.
- [ ] **AV-308** — Add download scheduling by day and time window.
- [ ] **AV-309** — Add bandwidth limits for background downloads.
- [x] **AV-310** — Add a pause-all and resume-all control. (Downloads bulk pause/resume actions + /api/downloads/actions)
- [ ] **AV-311** — Add automatic retry policies configurable per failure type.
- [ ] **AV-312** — Add retry backoff with a maximum attempt limit.
- [ ] **AV-313** — Add duplicate-job detection across active and completed items.
- [ ] **AV-314** — Add download integrity verification with file hashes.
- [ ] **AV-315** — Add post-download container validation.
- [ ] **AV-316** — Add automatic filename normalization rules.
- [ ] **AV-317** — Add configurable naming templates for series and episodes.
- [ ] **AV-318** — Add download destination rules by media type.
- [ ] **AV-319** — Add storage-space checks before enqueueing large jobs.
- [ ] **AV-320** — Add low-disk-space pause behavior.
- [ ] **AV-321** — Add a completed-download notification per profile.
- [ ] **AV-322** — Add a failed-download explanation with safe diagnostic details.
- [ ] **AV-323** — Add a queue export and import format.
- [ ] **AV-324** — Add a queue cleanup policy for stale completed entries.
- [ ] **AV-325** — Add a download history view separate from the active queue.

### 14 · Shared media library management · P0 / P1

Evolve the existing library scanner into a trustworthy media catalog.

- [ ] **AV-326** — Add a library overview dashboard with file and storage totals.
- [ ] **AV-327** — Add folder-level browsing with breadcrumb navigation.
- [ ] **AV-328** — Add library filters for anime, movies, episodes, and unknown files.
- [ ] **AV-329** — Add a recently imported media view.
- [ ] **AV-330** — Add a recently played local media view.
- [ ] **AV-331** — Add duplicate-file detection using file size and content hashes.
- [ ] **AV-332** — Add duplicate resolution without deleting the selected canonical copy.
- [ ] **AV-333** — Add missing-file detection for indexed entries.
- [ ] **AV-334** — Add an orphaned-metadata report.
- [ ] **AV-335** — Add rescan progress reporting with cancellable jobs.
- [ ] **AV-336** — Add incremental scanning based on filesystem changes.
- [ ] **AV-337** — Add configurable scan schedules.
- [ ] **AV-338** — Add safe library rename and move operations.
- [x] **AV-339** — Add library folder validation before changing paths. (validateLibraryDir blocks traversal, symlinks and repo/system paths; tests/core-verification.test.mjs)
- [ ] **AV-340** — Add a dry-run mode for bulk organization operations.
- [ ] **AV-341** — Add a media file details drawer with technical metadata.
- [ ] **AV-342** — Add file checksum display and verification status.
- [ ] **AV-343** — Add per-item tags and custom categories.
- [ ] **AV-344** — Add manual anime matching for unknown library files.
- [ ] **AV-345** — Add bulk metadata matching for imported files.
- [ ] **AV-346** — Add library artwork overrides independent of IMDb claims.
- [ ] **AV-347** — Add configurable display titles for local files.
- [ ] **AV-348** — Add a protected recycle bin for deleted library entries.
- [ ] **AV-349** — Add restore-from-recycle-bin support with expiry settings.
- [ ] **AV-350** — Add a library integrity report with repair suggestions.

### 15 · Upload, import, and media processing pipeline · P2

Make the current chunked upload system safer and more capable.

- [ ] **AV-351** — Add a drag-and-drop upload queue for multiple files.
- [ ] **AV-352** — Add upload progress per file and aggregate progress.
- [ ] **AV-353** — Add upload pause and resume across browser reloads.
- [ ] **AV-354** — Add upload expiration rules for abandoned staging sessions.
- [ ] **AV-355** — Add automatic cleanup of expired temporary chunks.
- [ ] **AV-356** — Add client-side file size and extension preflight checks.
- [ ] **AV-357** — Add server-side MIME sniffing and container validation.
- [ ] **AV-358** — Add a configurable import destination template.
- [ ] **AV-359** — Add an upload wizard that classifies movie, episode, and unknown media.
- [ ] **AV-360** — Add episode metadata matching during upload.
- [ ] **AV-361** — Add movie metadata matching during upload.
- [ ] **AV-362** — Add folder upload support with preserved relative paths.
- [ ] **AV-363** — Add import from a user-selected local folder where browser support permits.
- [ ] **AV-364** — Add an import manifest for bulk library ingestion.
- [ ] **AV-365** — Add a dry-run import report before committing files.
- [ ] **AV-366** — Add atomic commit and rollback tests for incomplete uploads.
- [ ] **AV-367** — Add file hash verification after chunk assembly.
- [ ] **AV-368** — Add safe optional remuxing for incompatible user-owned media containers.
- [ ] **AV-369** — Add optional transcoding profiles for personal media compatibility.
- [ ] **AV-370** — Add a background processing queue separate from downloads.
- [ ] **AV-371** — Add processing job cancellation and retry.
- [ ] **AV-372** — Add media probe metadata extraction using FFprobe.
- [ ] **AV-373** — Add thumbnail generation for local media.
- [ ] **AV-374** — Add configurable thumbnail retention and cleanup.
- [ ] **AV-375** — Add an import audit trail with source filename and final destination.

### 16 · Airing schedule and calendar intelligence · P1

Make the current daily schedule useful across time zones and full seasons.

- [ ] **AV-376** — Add a weekly airing calendar view.
- [ ] **AV-377** — Add a monthly calendar view for premiere dates.
- [ ] **AV-378** — Add a timezone selector independent of server timezone.
- [ ] **AV-379** — Add clear labels for local time and source broadcast time.
- [ ] **AV-380** — Add per-show broadcast-time reminders.
- [ ] **AV-381** — Add filters for bookmarked shows on the schedule.
- [ ] **AV-382** — Add filters for shows currently in the user's Watching list.
- [ ] **AV-383** — Add a schedule-only search field.
- [ ] **AV-384** — Add schedule grouping by weekday and broadcast window.
- [ ] **AV-385** — Add a season premiere calendar.
- [ ] **AV-386** — Add a season finale calendar.
- [ ] **AV-387** — Add delays and schedule-change notices when the provider reports them.
- [ ] **AV-388** — Add a TBD schedule bucket for shows without exact times.
- [ ] **AV-389** — Add a calendar export using standard iCalendar format.
- [ ] **AV-390** — Add external calendar subscription links with revocable tokens.
- [ ] **AV-391** — Add a compact agenda view for mobile screens.
- [ ] **AV-392** — Add a countdown to the next episode broadcast.
- [ ] **AV-393** — Add a countdown to an upcoming season premiere.
- [ ] **AV-394** — Add a configurable airing-time display format.
- [ ] **AV-395** — Add daylight-saving transition tests for schedule rendering.
- [ ] **AV-396** — Add a schedule cache freshness indicator.
- [ ] **AV-397** — Add a stale-schedule warning with last successful refresh time.
- [ ] **AV-398** — Add a weekly digest of upcoming episodes.
- [ ] **AV-399** — Add a personal schedule based on selected watchlist entries.
- [ ] **AV-400** — Add an airing archive for recently broadcast episodes.

### 17 · Social features and shared viewing · P3

Optional social systems that do not compromise the private-library-first design.

- [ ] **AV-401** — Add opt-in public profile pages.
- [ ] **AV-402** — Add shareable anime and list links with privacy controls.
- [ ] **AV-403** — Add follow and unfollow between consenting user profiles.
- [ ] **AV-404** — Add a followers-only activity feed.
- [ ] **AV-405** — Add a setting to hide individual titles from activity feeds.
- [ ] **AV-406** — Add a setting to hide all watch activity by default.
- [ ] **AV-407** — Add shared household watchlists.
- [ ] **AV-408** — Add collaborative list editing with owner permissions.
- [ ] **AV-409** — Add list comments with rate limits and moderation.
- [ ] **AV-410** — Add reactions to shared lists.
- [ ] **AV-411** — Add watch-together rooms with invite-only access.
- [ ] **AV-412** — Add synchronized playback state for a watch-together room.
- [ ] **AV-413** — Add host controls for starting, pausing, and seeking a shared session.
- [ ] **AV-414** — Add participant latency indicators for synchronized sessions.
- [ ] **AV-415** — Add a text chat panel for watch-together rooms.
- [ ] **AV-416** — Add room moderation controls for the host.
- [ ] **AV-417** — Add expiring room invitations.
- [ ] **AV-418** — Add private friend groups with membership approval.
- [ ] **AV-419** — Add group watch goals and progress tracking.
- [ ] **AV-420** — Add a shared household calendar.
- [ ] **AV-421** — Add optional activity summaries for friend groups.
- [ ] **AV-422** — Add blocking and unblocking between profiles.
- [ ] **AV-423** — Add mute controls for unwanted social activity.
- [ ] **AV-424** — Add abuse-reporting controls for public user content.
- [ ] **AV-425** — Add a full social-feature disable switch for private deployments.

### 18 · Ratings, reviews, and community curation · P3

Add community opinion carefully, with spoiler and abuse controls.

- [ ] **AV-426** — Add personal ratings separate from imported community scores.
- [ ] **AV-427** — Add half-star or decimal rating precision.
- [ ] **AV-428** — Add a rating confidence or watched-status indicator.
- [ ] **AV-429** — Add optional review text attached to a personal rating.
- [ ] **AV-430** — Add spoiler marking for review content.
- [ ] **AV-431** — Add spoiler-hidden review previews.
- [ ] **AV-432** — Add helpful and not-helpful review reactions.
- [ ] **AV-433** — Add review sorting by recency and usefulness.
- [ ] **AV-434** — Add review filtering by language.
- [ ] **AV-435** — Add a review character limit and formatting policy.
- [ ] **AV-436** — Add duplicate and spam review detection.
- [ ] **AV-437** — Add report-review and report-rating actions.
- [ ] **AV-438** — Add review edit history visible to moderators.
- [ ] **AV-439** — Add moderator review removal with reason codes.
- [ ] **AV-440** — Add community rating distribution charts.
- [ ] **AV-441** — Add rating trends over time.
- [ ] **AV-442** — Add rating comparison by demographic only where lawful, optional, and privacy-safe.
- [ ] **AV-443** — Add list-based community recommendations.
- [ ] **AV-444** — Add curated editorial collections.
- [ ] **AV-445** — Add staff-pick and featured-collection controls for admins.
- [ ] **AV-446** — Add community poll creation for approved moderators.
- [ ] **AV-447** — Add poll closing dates and immutable result snapshots.
- [ ] **AV-448** — Add a spoiler-aware discussion thread per anime.
- [ ] **AV-449** — Add separate episode discussion threads with episode gates.
- [ ] **AV-450** — Add discussion sorting and user mute controls.

### 19 · Notifications and personal automation · P1 / P2

Give users control over useful alerts instead of noisy notifications.

- [ ] **AV-451** — Add an in-app notification center.
- [ ] **AV-452** — Add unread notification counts with accessible announcement behavior.
- [ ] **AV-453** — Add per-event notification preferences.
- [ ] **AV-454** — Add new-episode notifications for selected shows.
- [ ] **AV-455** — Add premiere reminders for planned anime.
- [ ] **AV-456** — Add delayed-episode notifications when reliable schedule data exists.
- [ ] **AV-457** — Add download-completed notifications.
- [ ] **AV-458** — Add download-failed notifications with retry actions.
- [ ] **AV-459** — Add library-upload-completed notifications.
- [ ] **AV-460** — Add storage-warning notifications for administrators.
- [ ] **AV-461** — Add session-expired notifications.
- [ ] **AV-462** — Add watchlist digest frequency settings.
- [ ] **AV-463** — Add daily and weekly schedule digests.
- [ ] **AV-464** — Add quiet hours per user and timezone.
- [ ] **AV-465** — Add notification grouping to reduce duplicates.
- [ ] **AV-466** — Add notification read/unread bulk actions.
- [ ] **AV-467** — Add notification history retention settings.
- [ ] **AV-468** — Add browser push notifications with explicit permission.
- [ ] **AV-469** — Add email notifications as an optional pluggable service.
- [ ] **AV-470** — Add webhook notifications for self-hosted automation.
- [ ] **AV-471** — Add notification delivery status and retry state.
- [ ] **AV-472** — Add notification test action in Settings.
- [ ] **AV-473** — Add per-anime mute controls.
- [ ] **AV-474** — Add automatic rules for adding premieres to a planned list.
- [ ] **AV-475** — Add notification templates with localization support.

### 20 · Interface design, themes, and accessibility · P0 / P1

Make the interface polished, responsive, inclusive, and configurable.

- [ ] **AV-476** — Add a light theme in addition to the current dark presentation.
- [ ] **AV-477** — Add a system-theme setting that follows the operating system.
- [ ] **AV-478** — Add a theme accent-color picker with contrast validation.
- [ ] **AV-479** — Add compact, comfortable, and spacious density modes.
- [ ] **AV-480** — Add configurable poster-card sizes.
- [ ] **AV-481** — Add configurable homepage section visibility.
- [ ] **AV-482** — Add drag-and-drop homepage section ordering.
- [ ] **AV-483** — Add a customizable dashboard layout per profile.
- [ ] **AV-484** — Add skeleton states that match each content layout.
- [ ] **AV-485** — Add consistent empty states with useful next actions.
- [ ] **AV-486** — Add consistent loading, success, warning, and error feedback.
- [ ] **AV-487** — Add a global command palette.
- [ ] **AV-488** — Add keyboard-first navigation between primary pages.
- [ ] **AV-489** — Add visible focus indicators for all interactive controls.
- [ ] **AV-490** — Add skip-to-content navigation.
- [ ] **AV-491** — Add screen-reader landmarks and heading hierarchy audits.
- [ ] **AV-492** — Add reduced-motion support across all transitions.
- [ ] **AV-493** — Add high-contrast display mode.
- [ ] **AV-494** — Add scalable text settings without clipped layouts.
- [ ] **AV-495** — Add color-blind-safe status indicators that do not rely on color alone.
- [ ] **AV-496** — Add alt-text rules for informative artwork.
- [ ] **AV-497** — Add accessible form labels and field-level error messages.
- [ ] **AV-498** — Add touch targets that meet common accessibility guidance.
- [ ] **AV-499** — Add responsive layout tests for narrow phones and large displays.
- [ ] **AV-500** — Add an RTL layout option for right-to-left languages.

### 21 · Mobile, PWA, and device support · P2

Make AnimeVault work well on phones, tablets, televisions, and browsers.

- [ ] **AV-501** — Add installable Progressive Web App metadata and icons.
- [ ] **AV-502** — Add an offline app shell for previously visited screens.
- [ ] **AV-503** — Add an offline view of cached metadata and personal lists.
- [ ] **AV-504** — Add a connection-state banner for offline and reconnecting states.
- [ ] **AV-505** — Add responsive touch controls for playback.
- [ ] **AV-506** — Add swipe navigation between eligible detail sections.
- [ ] **AV-507** — Add mobile-friendly download and upload management.
- [ ] **AV-508** — Add device-specific player control layouts.
- [ ] **AV-509** — Add a tablet two-column browsing layout.
- [ ] **AV-510** — Add a television-friendly large-text interface mode.
- [ ] **AV-511** — Add remote-control navigation with arrow and enter keys.
- [ ] **AV-512** — Add focus trapping and visible focus movement for TV navigation.
- [ ] **AV-513** — Add a QR code to open the current title on another device.
- [ ] **AV-514** — Add a device pairing flow with expiring one-time codes.
- [ ] **AV-515** — Add per-device nicknames in the account settings.
- [ ] **AV-516** — Add a list of active playback devices.
- [ ] **AV-517** — Add remote playback stop controls for account owners.
- [ ] **AV-518** — Add a resume handoff from one device to another.
- [ ] **AV-519** — Add an optional Chromecast-compatible integration where supported.
- [ ] **AV-520** — Add an optional DLNA discovery integration for trusted local networks.
- [ ] **AV-521** — Add browser capability detection for media formats and codecs.
- [ ] **AV-522** — Add device-specific quality preference overrides.
- [ ] **AV-523** — Add battery-aware autoplay and prefetch controls on mobile.
- [ ] **AV-524** — Add data-saver mode for cellular connections.
- [ ] **AV-525** — Add install/update prompts that respect browser behavior.

### 22 · Administration and multi-user household management · P2

Give a self-hosted instance proper ownership, roles, and household controls.

- [ ] **AV-526** — Add a first-run setup wizard for a new installation.
- [ ] **AV-527** — Add an administrator dashboard with system and library summaries.
- [ ] **AV-528** — Add owner, administrator, editor, and viewer roles.
- [ ] **AV-529** — Add a permission matrix for every administrative action.
- [ ] **AV-530** — Add user invitation links with expiry and role assignment.
- [ ] **AV-531** — Add account suspension and reactivation controls.
- [ ] **AV-532** — Add profile deletion with data-retention choices.
- [ ] **AV-533** — Add household groups with separate member lists.
- [ ] **AV-534** — Add shared library access policies per household group.
- [ ] **AV-535** — Add per-user download quotas.
- [ ] **AV-536** — Add per-user storage quotas.
- [ ] **AV-537** — Add per-user concurrent playback limits.
- [ ] **AV-538** — Add per-user upload permissions.
- [ ] **AV-539** — Add per-user library deletion permissions.
- [ ] **AV-540** — Add a safe read-only guest mode.
- [ ] **AV-541** — Add a kid-friendly profile mode with administrator-managed restrictions.
- [ ] **AV-542** — Add configurable content-rating allowlists for managed profiles.
- [ ] **AV-543** — Add an admin audit log for account and permission changes.
- [ ] **AV-544** — Add an announcement banner controlled by administrators.
- [ ] **AV-545** — Add maintenance mode with a custom status message.
- [ ] **AV-546** — Add a user session revocation panel.
- [ ] **AV-547** — Add a global settings policy with per-user override rules.
- [ ] **AV-548** — Add admin-created shared collections.
- [ ] **AV-549** — Add instance ownership transfer with explicit confirmation.
- [ ] **AV-550** — Add a recovery process for a lost administrator account.

### 23 · Security, privacy, and trust · P0

Treat the server as a private media service, not an exposed public file share.

- [ ] **AV-551** — Add a documented threat model covering browser, server, and filesystem boundaries.
- [x] **AV-552** — Add an automated security-header regression test suite. (security headers asserted in tests/api-smoke.test.mjs)
- [ ] **AV-553** — Add CSRF tests for every state-changing API endpoint. (partially verified: global `/api` middleware enforces the check for POST/PUT/PATCH/DELETE; cross-origin and same-origin tests cover bookmarks and cross-origin lists, but not every mutating route)
- [ ] **AV-554** — Add authentication and authorization checks on private library routes.
- [ ] **AV-555** — Add object-level authorization for every user-owned record.
- [ ] **AV-556** — Add secure session cookie settings for authenticated deployments.
- [ ] **AV-557** — Add configurable session lifetime and idle timeout.
- [ ] **AV-558** — Add login rate limiting and account lockout protections with safe recovery.
- [ ] **AV-559** — Add password hashing using a modern memory-hard password hashing scheme.
- [ ] **AV-560** — Add secret management guidance that avoids committed credentials.
- [ ] **AV-561** — Add a startup warning when optional authentication is disabled on a public interface.
- [ ] **AV-562** — Add explicit trusted-proxy configuration rather than trusting arbitrary forwarded headers.
- [ ] **AV-563** — Add DNS rebinding protection for host-level security checks.
- [ ] **AV-564** — Add SSRF regression tests for redirects and DNS changes.
- [ ] **AV-565** — Add upload malware-scanning integration points for administrators.
- [ ] **AV-566** — Add strict content-type validation for uploaded files.
- [ ] **AV-567** — Add file-size and decompression limits for untrusted inputs.
- [ ] **AV-568** — Add a path-permission audit for data, staging, and library directories.
- [ ] **AV-569** — Add a log-redaction layer for tokens, URLs, and personal information.
- [ ] **AV-570** — Add privacy controls for history, telemetry, and social data.
- [ ] **AV-571** — Add a personal data export and deletion workflow.
- [ ] **AV-572** — Add a retention policy for temporary uploads and logs.
- [ ] **AV-573** — Add a security incident response guide for self-hosted operators.
- [ ] **AV-574** — Add dependency vulnerability scanning in continuous integration.
- [ ] **AV-575** — Add a documented rule that providers must not bypass DRM, paywalls, or access controls.

### 24 · Performance, caching, and reliability · P0 / P2

Keep the app responsive as the catalog, media library, and user count grow.

- [ ] **AV-576** — Add performance budgets for initial JavaScript and CSS payloads.
- [ ] **AV-577** — Add route-level bundle size reporting.
- [ ] **AV-578** — Add image lazy loading outside the initial viewport.
- [ ] **AV-579** — Add responsive artwork variants for poster and banner layouts.
- [ ] **AV-580** — Add an image cache with bounded disk usage.
- [ ] **AV-581** — Add cache hit/miss metrics for metadata and provider adapters.
- [ ] **AV-582** — Add cache invalidation by entity rather than clearing all entries.
- [ ] **AV-583** — Add stale-while-revalidate for safe metadata endpoints.
- [ ] **AV-584** — Add per-route response-time metrics.
- [ ] **AV-585** — Add database-backed persistence when JSON storage limits are reached.
- [ ] **AV-586** — Add indexed queries for growing library and history datasets.
- [ ] **AV-587** — Add pagination for every potentially unbounded collection endpoint.
- [ ] **AV-588** — Add cancellation of obsolete client-side requests.
- [ ] **AV-589** — Add deduplication of identical concurrent metadata requests.
- [ ] **AV-590** — Add bounded concurrency for metadata fan-out requests.
- [ ] **AV-591** — Add graceful server shutdown that stops queues cleanly.
- [ ] **AV-592** — Add startup recovery validation for persistent queues.
- [x] **AV-593** — Add crash-safe atomic writes for every persistent JSON record. (atomicWriteFile and private file/dir permissions asserted in tests/core-verification.test.mjs)
- [x] **AV-594** — Add process health and readiness checks. (public `/api/health` liveness plus `/api/ready` bookmark-store initialization and library-directory checks; other stores initialize before listening; tests/api-smoke.test.mjs + README)
- [ ] **AV-595** — Add dependency health reporting without exposing secrets.
- [ ] **AV-596** — Add memory-usage monitoring for long-running media sessions.
- [ ] **AV-597** — Add cleanup of abandoned temporary stream files.
- [ ] **AV-598** — Add bounded event-stream client counts and reconnect behavior.
- [ ] **AV-599** — Add load tests for concurrent browsing and metadata requests.
- [ ] **AV-600** — Add soak tests for long-running downloads and playback sessions.

### 25 · Backup, restore, and cross-device synchronization · P1 / P2

Make the library and user data recoverable and portable.

- [ ] **AV-601** — Add a backup wizard that explains which directories contain user data.
- [ ] **AV-602** — Add scheduled backups of settings, bookmarks, and user records.
- [ ] **AV-603** — Add optional metadata-only backups separate from large video files.
- [ ] **AV-604** — Add backup manifests with version, date, and file checksums.
- [ ] **AV-605** — Add backup encryption with a user-controlled recovery key.
- [ ] **AV-606** — Add backup destination configuration for local storage.
- [ ] **AV-607** — Add pluggable backup destinations for supported remote storage.
- [ ] **AV-608** — Add backup retention policies with protected recent snapshots.
- [ ] **AV-609** — Add a dry-run restore validation mode.
- [ ] **AV-610** — Add a restore wizard with conflict previews.
- [ ] **AV-611** — Add selective restore for settings, profiles, lists, and progress.
- [ ] **AV-612** — Add library index rebuild from the actual filesystem.
- [ ] **AV-613** — Add restore verification after database and file restoration.
- [ ] **AV-614** — Add migration tooling between JSON storage and a database.
- [ ] **AV-615** — Add versioned export bundles for a complete profile.
- [ ] **AV-616** — Add import validation before merging a profile export.
- [ ] **AV-617** — Add duplicate-aware merge behavior for imported lists.
- [ ] **AV-618** — Add conflict handling for progress from two devices.
- [ ] **AV-619** — Add a sync status page per device.
- [ ] **AV-620** — Add queued offline changes for later synchronization.
- [ ] **AV-621** — Add sync conflict history with user-selected resolution.
- [ ] **AV-622** — Add an optional trusted local-network sync node.
- [ ] **AV-623** — Add a documented disaster-recovery procedure.
- [ ] **AV-624** — Add backup failure notifications with actionable logs.
- [ ] **AV-625** — Add a backup restore rehearsal test for release candidates.

### 26 · Integrations, APIs, and automation · P2 / P3

Make the application extensible without coupling it to one metadata or media provider.

- [ ] **AV-626** — Add a documented versioned public API for supported integrations.
- [ ] **AV-627** — Add API token creation with scopes and expiration.
- [ ] **AV-628** — Add API token revocation and last-used timestamps.
- [ ] **AV-629** — Add OpenAPI documentation generated from route schemas.
- [ ] **AV-630** — Add stable pagination and filtering conventions across API endpoints.
- [ ] **AV-631** — Add idempotency keys for safe retryable write operations.
- [ ] **AV-632** — Add provider adapter interfaces for metadata sources.
- [ ] **AV-633** — Add provider adapter interfaces for authorized media sources.
- [ ] **AV-634** — Add provider health and capability discovery endpoints.
- [ ] **AV-635** — Add provider configuration validation in Settings.
- [ ] **AV-636** — Add a plugin manifest format with explicit permissions.
- [ ] **AV-637** — Add plugin enable/disable controls for administrators.
- [ ] **AV-638** — Add plugin version compatibility checks.
- [ ] **AV-639** — Add plugin sandboxing or process isolation for untrusted extensions.
- [ ] **AV-640** — Add webhooks for download, library, and schedule events.
- [ ] **AV-641** — Add signed webhook payloads with replay protection.
- [ ] **AV-642** — Add webhook delivery retries and dead-letter inspection.
- [ ] **AV-643** — Add import connectors for supported anime list services.
- [ ] **AV-644** — Add export connectors for supported anime list services.
- [ ] **AV-645** — Add a generic RSS feed for selected airing schedules.
- [ ] **AV-646** — Add optional Home Assistant event integration.
- [ ] **AV-647** — Add optional media-server catalog integration through documented APIs.
- [ ] **AV-648** — Add a command-line client for common library operations.
- [ ] **AV-649** — Add a read-only status endpoint suitable for local dashboards.
- [ ] **AV-650** — Add an integration test harness for third-party adapters.

### 27 · Observability, diagnostics, and support tools · P2

Make problems explainable to the owner without exposing sensitive user data.

- [ ] **AV-651** — Add a diagnostics page showing application version and build commit.
- [ ] **AV-652** — Add a provider status dashboard with last-check timestamps.
- [ ] **AV-653** — Add a metadata provider latency panel.
- [ ] **AV-654** — Add a media-source capability and availability panel.
- [ ] **AV-655** — Add an FFmpeg and FFprobe availability check.
- [ ] **AV-656** — Add a filesystem permission and free-space diagnostic.
- [ ] **AV-657** — Add a library scanner diagnostic with safe repair suggestions.
- [ ] **AV-658** — Add a download worker health dashboard.
- [ ] **AV-659** — Add an active-stream count and duration panel.
- [ ] **AV-660** — Add a recent server error summary with redacted context.
- [ ] **AV-661** — Add structured JSON logs with request correlation IDs.
- [ ] **AV-662** — Add configurable log levels for development and production.
- [ ] **AV-663** — Add log rotation and maximum disk-usage settings.
- [ ] **AV-664** — Add an exportable diagnostics bundle with secrets removed.
- [ ] **AV-665** — Add a copyable support summary for bug reports.
- [ ] **AV-666** — Add a self-test endpoint for core non-destructive checks.
- [ ] **AV-667** — Add provider failure classification by timeout, unavailable, invalid, and blocked.
- [ ] **AV-668** — Add queue recovery diagnostics for interrupted jobs.
- [ ] **AV-669** — Add upload staging diagnostics and cleanup recommendations.
- [ ] **AV-670** — Add per-request trace IDs shown in user-facing error details.
- [ ] **AV-671** — Add an administrator event timeline for background jobs.
- [ ] **AV-672** — Add uptime and restart history tracking.
- [ ] **AV-673** — Add a warning when the browser and server clocks differ significantly.
- [ ] **AV-674** — Add a server clock and timezone diagnostic.
- [ ] **AV-675** — Add a troubleshooting guide linked contextually from errors.

### 28 · Deployment, networking, and scaling · P2

Support reliable self-hosting from a laptop to a larger household server.

- [ ] **AV-676** — Add a production deployment guide for reverse proxies.
- [ ] **AV-677** — Add a tested Caddy deployment example.
- [ ] **AV-678** — Add a tested Nginx deployment example.
- [ ] **AV-679** — Add a Dockerfile with a minimal production runtime.
- [ ] **AV-680** — Add a Docker Compose example with persistent volumes.
- [ ] **AV-681** — Add container health checks and graceful stop behavior.
- [ ] **AV-682** — Add a non-root container execution mode.
- [ ] **AV-683** — Add a read-only application filesystem where practical.
- [ ] **AV-684** — Add a deployment configuration validation command.
- [ ] **AV-685** — Add environment-variable documentation generated from a schema.
- [ ] **AV-686** — Add an example systemd unit for non-container installations.
- [ ] **AV-687** — Add an upgrade checklist with backup requirements.
- [ ] **AV-688** — Add database migration execution as an explicit deployment step.
- [ ] **AV-689** — Add a rollback procedure for failed upgrades.
- [ ] **AV-690** — Add LAN discovery guidance without enabling public exposure by default.
- [ ] **AV-691** — Add a trusted-origin setup wizard for reverse-proxy deployments.
- [ ] **AV-692** — Add TLS and HTTPS deployment verification checks.
- [ ] **AV-693** — Add explicit configuration for trusted proxy hops.
- [ ] **AV-694** — Add a network interface binding explanation and safe default.
- [ ] **AV-695** — Add storage mount health checks before starting media jobs.
- [ ] **AV-696** — Add a multi-process-safe job queue when horizontal scaling is enabled.
- [ ] **AV-697** — Add shared-cache support for multiple server instances.
- [ ] **AV-698** — Add a documented single-instance mode and its limitations.
- [ ] **AV-699** — Add load-balancer health checks and sticky-session guidance where required.
- [ ] **AV-700** — Add a capacity calculator for storage, bandwidth, and concurrent users.

### 29 · Testing, code quality, and release engineering · P0

Protect existing functionality before the feature count starts exploding.

- [x] **AV-701** — Add a unit-test framework and baseline coverage report. (`node:test`; initial baseline captured at 311 tests/12 files, 45.64% lines and 70.04% branches; current totals are recorded above)
- [ ] **AV-702** — Add API integration tests for every documented endpoint.
- [ ] **AV-703** — Add React component tests for core navigation and player controls.
- [ ] **AV-704** — Add end-to-end tests for search-to-play navigation.
- [ ] **AV-705** — Add end-to-end tests for local playback and seeking.
- [ ] **AV-706** — Add end-to-end tests for download queue lifecycle operations.
- [ ] **AV-707** — Add end-to-end tests for chunked upload resume and completion.
- [ ] **AV-708** — Add end-to-end tests for subtitle attach and playback selection.
- [ ] **AV-709** — Add end-to-end tests for artwork claiming and removal.
- [ ] **AV-710** — Add end-to-end tests for bookmark persistence after restart.
- [ ] **AV-711** — Add test fixtures for AniList and AniDB metadata responses.
- [ ] **AV-712** — Add deterministic provider-adapter mocks for test runs.
- [ ] **AV-713** — Add malformed-input and boundary-value tests for all API schemas.
- [ ] **AV-714** — Add property-based tests for path and identifier normalization.
- [ ] **AV-715** — Add fuzz tests for media metadata parsing.
- [ ] **AV-716** — Add security tests for traversal, SSRF, and request forgery protections.
- [ ] **AV-717** — Add accessibility checks to the browser test suite.
- [ ] **AV-718** — Add visual regression tests for core responsive layouts.
- [ ] **AV-719** — Add browser compatibility tests for supported Firefox and Chromium versions.
- [ ] **AV-720** — Add a supported-browser matrix documented in the README.
- [x] **AV-721** — Add TypeScript strictness checks and eliminate unsafe implicit types. (tsconfig.json sets strict:true; `npm run typecheck` passes)
- [ ] **AV-722** — Add linting and formatting checks in continuous integration.
- [ ] **AV-723** — Add dependency lockfile and reproducible-build checks. (partially verified: package-lock.json is committed; no CI reproducibility check exists yet)
- [ ] **AV-724** — Add release tagging and generated changelog automation.
- [ ] **AV-725** — Add a pre-release smoke-test checklist and rollback gate.

### 30 · Recommendations, intelligence, and experimental discovery · P2 / P3

Make discovery personal while keeping recommendations transparent and optional.

- [ ] **AV-726** — Add a recommendation engine based on a user's completed anime.
- [ ] **AV-727** — Add genre affinity scores derived from explicit user activity.
- [ ] **AV-728** — Add tag affinity scores with decay for older activity.
- [ ] **AV-729** — Add a recommendation explanation showing the matching signals.
- [ ] **AV-730** — Add a dislike and not-interested feedback action.
- [ ] **AV-731** — Add recommendation controls for excluding genres and tags.
- [ ] **AV-732** — Add a recommendation mode that ignores community popularity.
- [ ] **AV-733** — Add a recommendation mode focused on hidden gems.
- [ ] **AV-734** — Add franchise-aware recommendations that avoid obvious sequels already watched.
- [ ] **AV-735** — Add short-series recommendations based on available watch time.
- [ ] **AV-736** — Add movie recommendations for users who prefer standalone stories.
- [ ] **AV-737** — Add seasonal recommendations based on a user's historical preferences.
- [ ] **AV-738** — Add a recommendation cold-start questionnaire users can skip.
- [ ] **AV-739** — Add a random watch picker constrained by personal lists.
- [ ] **AV-740** — Add a watch-plan builder based on a weekly time budget.
- [ ] **AV-741** — Add a backlog reduction planner that never removes user entries automatically.
- [ ] **AV-742** — Add a similarity explorer with explainable shared tags and genres.
- [ ] **AV-743** — Add a mood-based discovery interface with editable labels.
- [ ] **AV-744** — Add a content-warning filter driven by verified metadata.
- [ ] **AV-745** — Add a recommendation feedback history and reset control.
- [ ] **AV-746** — Add an optional locally computed recommendation model.
- [ ] **AV-747** — Add an opt-in natural-language search assistant over the catalog.
- [ ] **AV-748** — Add natural-language filters converted into a reviewable query before execution.
- [ ] **AV-749** — Add AI-generated synopsis summaries only when clearly labeled and source-linked.
- [ ] **AV-750** — Add an experimental feature lab with per-feature opt-in and rollback.

### 31 · Content rights, source provenance, and compliance · P0

Keep the product maintainable and avoid building around sources the operator cannot lawfully use.

- [ ] **AV-751** — Add a documented content-source policy for the installation owner.
- [ ] **AV-752** — Add a distinction between metadata providers and playable media providers.
- [ ] **AV-753** — Add a source registry recording operator authorization and terms review.
- [ ] **AV-754** — Add a provider adapter approval step before enabling a new media source.
- [ ] **AV-755** — Add a user-owned-file mode that works without external media resolvers.
- [ ] **AV-756** — Add a licensed-provider integration interface with no DRM circumvention.
- [ ] **AV-757** — Add a visible source label for each playable item.
- [ ] **AV-758** — Add source attribution links where provider terms require them.
- [ ] **AV-759** — Add a media-source disable switch for administrators.
- [ ] **AV-760** — Add a report-source problem workflow for broken or unauthorized sources.
- [ ] **AV-761** — Add a process for responding to rights-holder notices.
- [ ] **AV-762** — Add a takedown workflow for content the operator is not authorized to host.
- [ ] **AV-763** — Add an audit record for administrator source configuration changes.
- [ ] **AV-764** — Add a policy prohibiting paywall, DRM, or access-control bypass features.
- [ ] **AV-765** — Add explicit user confirmation before adding an external media URL.
- [ ] **AV-766** — Add validation that external source hosts match administrator-approved policy.
- [ ] **AV-767** — Add a separate allowlist for media URLs and subtitle URLs.
- [ ] **AV-768** — Add terms and privacy notice templates for public deployments.
- [ ] **AV-769** — Add a regional privacy requirements checklist for operators.
- [ ] **AV-770** — Add data minimization defaults for accounts and playback telemetry.
- [ ] **AV-771** — Add data-retention settings for user history and diagnostic logs.
- [ ] **AV-772** — Add clear labels for user-supplied files versus catalog metadata.
- [ ] **AV-773** — Add a mechanism to correct inaccurate rights or source attribution.
- [ ] **AV-774** — Add a deployment checklist for public-facing installations.
- [ ] **AV-775** — Add documentation that self-hosting does not itself grant rights to media.

### 32 · Community safety, moderation, and household safeguards · P2 / P3

Make optional shared features manageable, safe, and easy to turn off.

- [ ] **AV-776** — Add community guidelines for public profiles, lists, and discussions.
- [ ] **AV-777** — Add a moderation queue for reported public content.
- [ ] **AV-778** — Add moderator roles separate from server administrator roles.
- [ ] **AV-779** — Add report categories for spam, harassment, spoilers, and rights concerns.
- [ ] **AV-780** — Add rate limits for comments, reactions, and invitations.
- [ ] **AV-781** — Add anti-spam cooldowns for newly created accounts.
- [ ] **AV-782** — Add user blocking that hides their public content and interactions.
- [ ] **AV-783** — Add spoiler policies with episode-specific visibility gates.
- [ ] **AV-784** — Add controls to hide discussion threads until an episode is watched.
- [ ] **AV-785** — Add moderator actions with reason codes and audit history.
- [ ] **AV-786** — Add an appeal workflow for moderated community content.
- [ ] **AV-787** — Add an account mute and temporary posting restriction feature.
- [ ] **AV-788** — Add public profile discoverability controls.
- [ ] **AV-789** — Add controls to disable DMs and social invitations.
- [ ] **AV-790** — Add household-admin restrictions for managed child profiles.
- [ ] **AV-791** — Add content-rating gates that cannot be changed by a restricted profile.
- [ ] **AV-792** — Add an optional PIN requirement before opening restricted settings.
- [ ] **AV-793** — Add a neutral default that keeps public social features disabled on private installs.
- [ ] **AV-794** — Add an abuse-report rate limit with a safe appeal path.
- [ ] **AV-795** — Add community retention settings for removed posts.
- [ ] **AV-796** — Add transparent moderation notices to affected users.
- [ ] **AV-797** — Add moderator workload and unresolved-report metrics.
- [ ] **AV-798** — Add a process to remove illegal or non-consensual user-uploaded material.
- [ ] **AV-799** — Add a safety review before launching any public user-generated-content feature.
- [ ] **AV-800** — Add a one-click administrative switch to disable all community features.

## Suggested delivery order

1. **Foundation pass:** AV-001–AV-025, AV-051–AV-075, AV-151–AV-200, AV-226–AV-250, AV-276–AV-300, and AV-701–AV-725. Validate metadata, search, progress, player basics, streaming reliability, library correctness, security, and content-source policy before expanding scope.
2. **Everyday product pass:** Finish browsing, detail pages, personal lists, schedule, notifications, accessibility, and download workflows. These changes make the app feel complete for one person before adding social complexity.
3. **Household pass:** Add accounts, roles, quotas, multi-user progress, device continuity, and backups. Keep authentication and object-level authorization ahead of exposing the server beyond a trusted network.
4. **Power-user pass:** Add advanced player controls, richer media ingestion, diagnostics, deployment tooling, API integrations, and performance instrumentation.
5. **Experimental pass:** Only after the core product is stable, consider recommendations, watch-together, community, natural-language discovery, and plugins.

## Definition of done for every feature

- User-facing behavior is documented and has a clear empty, loading, success, and failure state.
- API input is schema-validated; authorization is enforced server-side rather than only in the UI.
- Long-running work can be cancelled or recovered safely where applicable.
- State survives a server restart when the feature promises persistence.
- Tests cover the happy path, failure path, boundary conditions, and relevant security conditions.
- The feature is usable with keyboard navigation and screen readers where it has an interface.
- Logs and telemetry do not expose passwords, tokens, private URLs, or unnecessary viewing history.
- Existing local playback, download, upload, bookmark, and library workflows continue to work.

## Architecture recommendations before implementation

- Introduce a database abstraction before account, history, social, or multi-instance features make JSON-file persistence fragile.
- Keep metadata adapters and authorized media-source adapters separate. A catalog entry must not imply that a playable stream exists.
- Introduce a job abstraction shared by downloads, scanning, imports, thumbnail generation, and optional transcoding.
- Move user-specific state (progress, preferences, lists, history) behind a user/profile ownership model before enabling multi-user access.
- Keep media files in the filesystem or object storage and store stable opaque IDs plus metadata in the database.
- Build an automated test suite before large refactors; the current project has many substantial server modules and UI components.

---

**Backlog count: 800 numbered tasks across 32 categories.**
