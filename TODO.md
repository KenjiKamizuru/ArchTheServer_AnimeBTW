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

## How to use this backlog

- [ ] means the proposed task has not been verified as complete in this review; it does **not** prove no partial implementation exists.
- Section priority is a suggested order, not a hard dependency. **P0** protects the foundation; **P1** improves everyday use; **P2** adds power-user and scaling capability; **P3** is optional ambitious territory.
- Give each item an issue, owner, acceptance criteria, and tests before implementation.
- Keep the local-library experience useful even when external metadata or media providers are unavailable.
- Only connect media sources the operator is authorized to access. Do not build DRM, paywall, or access-control circumvention.

## TODO

### 01 · Catalog and metadata normalization · P0 / P1

A single clean metadata model is the foundation for every other screen.

- [x] **AV-001** — Create a canonical anime record independent of AniList's response shape. (`server/catalog.mjs`; verified with `node --test tests/catalog.test.mjs`. Numeric IDs still originate from AniList; the separate provider identifier collection is AV-002.)
- [x] **AV-002** — Store provider IDs in a dedicated external-identifiers collection. (`catalog.mjs` `createAnimeRecord` carries `externalIds` — a normalized map of provider slug → string id — with `normalizeExternalIds`/`setExternalId`/`getExternalId` helpers (map or `{provider, id}` entry-array input, reserved-key and invalid-entry filtering, defensive copies). `anilist.mjs` populates it from `id`, `idMal` (newly added to `MEDIA_FIELDS`) and numeric AniDB ids parsed from direct links; `types.ts` `Media.externalIds` exposes it to the UI. Verified in `tests/catalog.test.mjs` (6 tests incl. an adapter round-trip).)
- [x] **AV-003** — Track metadata source and last-refresh timestamp for every field. (`catalog.mjs` `createAnimeRecord(input, options)` stamps a `meta` envelope — `{ source, refreshedAt, fields }` with Unix-second timestamps — where `fields` stores per-field overrides and `fieldProvenance(record, field)` resolves source + refresh time for **every** field (override ?? record default, prototype-key safe). `anilist.mjs` stamps `source: 'anilist'` and the fetch time on every normalized record; `types.ts` exposes `MediaProvenance`. Unknown values are null. Verified in `tests/catalog.test.mjs` (4 tests + adapter assertions).)
- [x] **AV-004** — Add field-level provenance when two providers disagree. (`catalog.mjs` field override entries now carry `alternates: [{ source, value }]` — normalized provider claims (one per provider, last wins, max 8; invalid sources/values dropped) kept as evidence beside the winning `source`/`refreshedAt`. New `withFieldDisagreement(meta, field, winning, alternates)` merges claims immutably; `fieldProvenance()` resolves `{ source, refreshedAt, alternates }` for any field; `types.ts` `MediaClaim`. Verified in `tests/catalog.test.mjs` (2 tests incl. a two-provider disagreement scenario).)
- [x] **AV-005** — Normalize title variants into romaji, English, native, and preferred display names. (`catalog.mjs` normalizes every title slot (trim, whitespace collapse, 200-char cap) and dedupes synonyms case-insensitively (max 20); new `preferredDisplayTitle(variants, id)` resolves the display name by documented policy — explicit title → English → romaji → native → first synonym → `Anime #<id>` — used by `createAnimeRecord`, so the policy now lives in the canonical model instead of only the AniList adapter. Verified in `tests/catalog.test.mjs` (3 tests incl. full policy chain).)
- [x] **AV-006** — Normalize season, year, format, status, and episode-count fields. (`catalog.mjs` canonicalizes schedule fields to the vocabularies the UI compares against: season ∈ {WINTER, SPRING, SUMMER, FALL}; seasonYear integer 1900–2200; format canonicalized to TV/TV_SHORT/MOVIE/OVA/ONA/SPECIAL/MUSIC (unknown formats keep a stable uppercase-underscore shape, max 32 chars); status alias-mapped (airing→RELEASING, upcoming→NOT_YET_RELEASED, canceled→CANCELLED, …) with the 'UNKNOWN' sentinel for unrecognized values; episode counts as integers with zero preserved as a real value distinct from unknown null. Verified in `tests/catalog.test.mjs` (3 tests; the existing "episode count unknown distinct from zero" contract guards the null-vs-0 distinction).)
- [x] **AV-007** — Normalize genres and tags into stable internal identifiers. (`catalog.mjs` `identifierSlug` produces stable Unicode-safe slug ids; genres normalize to canonical browse-UI spellings via a synonym map ('science fiction'/'scifi' → 'Sci-Fi', 'sol' → 'Slice of Life', 'magical girl' → 'Mahou Shoujo') and are stored as display `genres` + parallel `genreIds`; tags carry `id` beside normalized `name` with rank clamped 0–100 and Boolean spoiler flags; both lists dedupe by id. `types.ts` adds `MediaTag` and `genreIds`. Verified in `tests/catalog.test.mjs` (2 tests incl. slug-collision dedupe).)
- [x] **AV-008** — Normalize studios, producers, licensors, and distributors as linked entities. (`catalog.mjs` `normalizeCompanies` builds id-linked company references — `{ id, name, roles }` with canonical roles MAIN_STUDIO/PRODUCER/LICENSOR/DISTRIBUTOR (aliases 'studio'/'main' → MAIN_STUDIO, unknown roles dropped), merged by slug id with first-wins names. `studios` stays a display array derived from MAIN_STUDIO companies (one source of truth); `anilist.mjs` fills companies from `studios(isMain: true)` plus a new `producers: studios(isMain: false)` alias (AniList's closest producer signal; licensor/distributor vocabulary ready for other providers); `types.ts` `MediaCompany`. Verified in `tests/catalog.test.mjs` (2 tests incl. cross-entry role merging).)
- [x] **AV-009** — Normalize country of origin and original language. (`catalog.mjs` normalizes country of origin to ISO 3166-1 alpha-2 (common full names/3-letter codes aliased: 'Japan'/'JPN' → JP, …; unknown → null) and adds `originalLanguage` as BCP-47 (aliases 'JAPANESE' → ja, …; script/region subtags canonicalized: 'zh-hant' → zh-Hant, 'ja-JP' → ja-JP). When a provider omits the language it derives from the country (JP → ja, KR → ko, CN → zh, TW/HK → zh-Hant, US/GB → en); unknown values stay null rather than guessed. `types.ts` gains both fields. Verified in `tests/catalog.test.mjs` (2 tests).)
- [x] **AV-010** — Normalize episode runtimes into a consistent duration format. (`catalog.mjs` `normalizeDurationMinutes` stores every runtime in minutes: plain numbers, unit strings ('24 min', '24m') and mm:ss / h:mm:ss clock strings from file metadata are coerced; values must be > 0 and ≤ 1440 min, rounded to 0.1; invalid/unknown → null. Verified in `tests/catalog.test.mjs` (1 test covering all input shapes).)
- [x] **AV-011** — Normalize age ratings into a common region-aware model. (`catalog.mjs` normalizes the scalar `ageRating` onto the browse vocabulary (NONE/G/PG/PG_13/R_17/R_18/RX) with provider aliases ('pg-13'→PG_13, 'R'/'R+'→R_17, 'NC-17'→R_18; unknown ratings keep a stable token shape) and adds region-aware `ageRatings: [{ region, rating }]` entries — regions alias-normalized (japan→JP, USA→US, PEGI/INTL systems supported), deduped, capped at 8. Explicit entries win; a scalar-only record derives one INTL entry so every record is uniform. `types.ts` `MediaAgeRating`. Verified in `tests/catalog.test.mjs` (2 tests incl. alias mapping and derivation).)
- [x] **AV-012** — Normalize score values while retaining each provider's original scale. (`catalog.mjs` `normalizeScore` keeps the scalar as percent 0–100 (0.1 precision, zero preserved per the existing contract, invalid → null); `scoreClaims: [{ source, value, scale }]` retains each provider's claim on its original scale **unrounded** (e.g. MAL 8.4/10), one per provider (first wins, cap 8, claims beyond their own scale dropped); `scorePercent()` converts any claim to percent; a scalar-only record from a known `meta.source` derives one percent-scale claim. Field named `scoreClaims` (not `scores`) because `MediaDetail.scores` is the existing score-distribution object — caught by typecheck and renamed before completion. `types.ts` `MediaScore`. Verified in `tests/catalog.test.mjs` (3 tests).)
- [x] **AV-013** — Normalize start dates, end dates, and broadcast timestamps. (`catalog.mjs` `normalizePartialDate` yields consistent `{ year, month, day }` partial dates (fuzzy semantics kept: month/day null when unannounced, day dropped without its month, year 1900–2200 required; ISO strings accepted) and `normalizeBroadcast` yields `{ dayOfWeek, time }` with 24h HH:MM (day aliases 'Mon'/'Fri'/… accepted, time null when unannounced, slot without a day → null). `MEDIA_FIELDS` gains `startDate`/`endDate`/`broadcast` (the detail query's duplicate selections removed); `normalize()` and the detail response now emit normalized dates (previously raw FuzzyDates leaked at the detail top level). `types.ts` `MediaDate`/`MediaBroadcast`; `MediaDetail`'s redundant raw-FuzzyDate redeclarations removed in favor of the normalized inherited fields (typecheck collision, fixed before completion). Verified in `tests/catalog.test.mjs` (2 tests).)
- [x] **AV-014** — Represent unknown, unannounced, and not-applicable values separately. (`catalog.mjs` `meta.states` annotates absent fields as 'UNANNOUNCED' (known to be pending) or 'NOT_APPLICABLE' (validated vocabulary; invalid annotations dropped), with plain absence defaulting to UNKNOWN; `fieldValueState(record, field)` resolves KNOWN (including 0/'') / the annotation / UNKNOWN. `anilist.mjs` wires the two provider-defensible inferences: episodes pending while NOT_YET_RELEASED and endDate pending while RELEASING. `types.ts` `MediaProvenance.states`. Verified in `tests/catalog.test.mjs` (2 tests incl. an adapter round-trip asserting `{ episodes: 'UNANNOUNCED' }`).)
- [x] **AV-015** — Add metadata schema versioning and migration support. (`catalog.mjs` exports `SCHEMA_VERSION` (1) and stamps it on every record; `migrateRecord(record)` upgrades legacy stored shapes (implicit v0, no `schemaVersion`) by rebuilding them through `createAnimeRecord` — the normalizers are idempotent, so re-normalization **is** the migration — with provenance (`meta.source`/`refreshedAt`/`fields`/`states`) preserved and provider junk ignored; current-version records pass through untouched; invalid input → null. `types.ts` `Media.schemaVersion`. Verified in `tests/catalog.test.mjs` (2 tests: stamping + legacy upgrade incl. provenance carry-over and fast-path identity).)
- [x] **AV-016** — Detect and merge duplicate anime records safely. (`catalog.mjs` `detectDuplicate(a, b)` returns certain matches (same id, shared provider identifier via `externalIds`) or probable matches (exact normalized title/synonym overlap across romaji/English/native/synonyms), null when distinct; legacy inputs are upgraded first via `migrateRecord`. `mergeRecords(primary, secondary)` is safe by contract: primary wins every conflict **including zeros**, secondary only fills gaps (aired counts/popularity take the max), collections union with primary-first dedupe, links dedupe by site|url, `meta.fields`/`states` merge primary-wins, provenance source/refreshedAt preserved — inputs never mutated, result rebuilt through `createAnimeRecord` (current schema), and different ids throw. Verified in `tests/catalog.test.mjs` (2 tests: detection tiers; merge gap-fill + zero-wins + non-mutation + id-guard).)
- [x] **AV-017** — Support manual corrections without overwriting source metadata. (`catalog.mjs` `applyCorrection(record, field, value, options)` returns a NEW record with the corrected value factory-normalized; the provider's original is preserved as a claim in `meta.fields[field].alternates` (never overwritten) and provenance becomes the correction source ('manual' by default, `options.source`/`refreshedAt` overridable); stale absence annotations clear for the corrected field; identity/structure fields (id/schemaVersion/meta) and unknown names throw; inputs unmutated. Claim values extended to bounded JSON-cloned objects (≤1000 chars) so structured originals (dates) survive — a deliberate contract change from AV-004's primitives-only claims, with the old test's "invalid value" fixture updated to a function (still dropped) and object claims covered by the new tests. Verified in `tests/catalog.test.mjs` (2 tests).)
- [x] **AV-018** — Add a metadata refresh policy per entity type. (`server/refreshPolicy.mjs`: `REFRESH_POLICY` freshness windows per entity type with documented rationale — airing 15 min, media records 1 day, studio/character/staff/franchise 7 days, artwork 30 days (airing data shifts fastest, artwork claims stablest) — plus `DEFAULT_REFRESH_POLICY` for unknown types; `refreshPolicyFor` (case-insensitive lookup), `nextRefreshAt` (refreshedAt + maxAge, 0 = never refreshed → due immediately), `isStale` (pure, injectable clock, flips exactly at the boundary). Verified in `tests/refresh-policy.test.mjs` (6 tests incl. boundary semantics and ordering sanity).)
- [x] **AV-019** — Expose a metadata freshness indicator on detail pages. (`refreshPolicy.mjs` `describeFreshness(type, refreshedAt, now)` returns `{ state: 'fresh'|'stale'|'missing', refreshedAt, nextRefreshAt }` with injectable clock; the `/api/anime/:id` detail response adds `freshness` computed from `meta.refreshedAt` via the media policy (single source of truth — no policy logic duplicated client-side; `meta` already flows through `...base`); `AnimeDetail.tsx` renders a header chip — "metadata updated 3h ago", "(may be outdated)" in amber when stale, "refresh time unknown" when missing — with an absolute-time tooltip, using the existing `relativeTime` helper. `types.ts` `MediaFreshness`. Verified in `tests/refresh-policy.test.mjs` (1 test: missing/fresh/stale classification + nextRefreshAt).)
- [x] **AV-020** — Add per-provider request quotas and backoff policies. (`server/quota.mjs` `createQuotaTracker(quotas)`: fixed-window request quotas per provider (AniList 90/min per its public limit, default 60/min) plus exponential backoff on provider-health failures (base 5s doubling to a 300s cap; success clears the streak), all with injectable clocks and closure-local state — `tryAcquire`/`recordSuccess`/`recordFailure`/`snapshot`. Wired into `anilist.mjs` `gql()`: quota blocks surface as an immediate sanitized 503 `RATE_LIMITED` error (no retry sleeps burned); 429/5xx and network/timeout failures feed the backoff; GraphQL/JSON errors deliberately do not. Verified in `tests/quota.test.mjs` (5 tests: window limiting/reset, exponential backoff + cap + pause lifting, streak clearing + provider isolation, default policy).)
- [x] **AV-021a** — Cache immutable metadata separately from rapidly changing airing data — tiered cache mechanism (safe first slice of the former AV-021, split per size). (`server/cachePolicy.mjs`: `CACHE_TIERS` — **media 1h** (catalog listings dominated by slow-changing metadata) vs **airing 5 min** (schedules, recently-updated/added feeds, and detail/batch records carrying airing progress) — plus a `CACHE_KEY_TIERS` prefix table with `cacheTierForKey`/`cacheTtlFor` so the tier choice lives in one tested place; `anilist.mjs` `cached()` now derives its TTL per entry from the key's tier (global `TTL` removed, stale-on-error and `fresh` behaviors untouched). Verified in `tests/cache-policy.test.mjs` (5 tests: key→tier mapping for all 12 key families, unknown-key default, airing < media expiry, case-insensitive tier lookup, every declared prefix maps to a known tier).)
- [x] **AV-021b** — Cache immutable metadata separately from rapidly changing airing data — split detail-page fetches into immutable metadata vs airing-progress halves. (`getDetail` now composes two independently cached halves: the full record (every field) on the long **media** tier as last-known-good base, overlaid by `DETAIL_VOLATILE_QUERY` — a tiny slice (status, episodes, nextAiringEpisode, averageScore, meanScore, popularity, favourites) on the short **airing** tier whose fields win when composed. The overlay is best-effort (failure never takes the page down — base answers alone), mirroring the "never erase last-known-good" policy; `detail:` keys now map to media, `detail:airing:` to airing in `cachePolicy.mjs`. Verified in `tests/detail-split.test.mjs` (3 tests via query-marker-dispatched fetch mocks: overlay wins + immutable fields survive + one fetch per half; overlay failure falls back to base values; warm cache serves both halves with zero refetches) + updated `tests/cache-policy.test.mjs` mappings.)
- [x] **AV-022** — Record metadata fetch failures without erasing last-known-good values. (Pure core in `catalog.mjs`: `withFetchFailure(record, failure)` / `clearFetchFailure(record)` + optional bounded `meta.fetchFailure: { at, message ≤200 }` in `normalizeMeta` (absent by default — existing meta shapes untouched); timestamps are **Unix seconds** (canonical: `normalizeTimestamp` caps at 2100-01-01 in seconds; ms-scale input is silently rejected — pinned by test). Wired at the detail volatile-overlay failure point: `getDetail` records `meta.fetchFailure` with the sanitized upstream message while every last-known-good value is preserved (zero values included). `types.ts` `MediaFetchFailure`. Verified: 5 tests — stamp-preserves-values, invalid/oversized rejection + seconds canon, `normalizeMeta` round-trip + default absence, `clearFetchFailure` removes only the note; detail-split asserts the failure is recorded while base values answer. Mid-task I briefly introduced an ms→s conversion at the AV-019 `freshness` call believing `meta.refreshedAt` was ms — it is seconds (`catalog.mjs:239` converts); reverted, and a unit regression assertion now pins `freshness` to seconds. Unresolved: failure recording is not yet wired for list/season endpoints' stale-on-error path in `cached()`, and failures hidden behind a warm stale hit are not surfaced (pure helpers ready for both).)
- [x] **AV-023** — Add artwork variants with source, dimensions, and attribution metadata. (`catalog.mjs` `normalizeArtworkVariants`: bounded structured entries `{ kind: 'POSTER'|'BANNER'|'THUMBNAIL', url, source, width, height, attribution }` — ≤12 entries, deduped by kind|url, every entry cloned, unknown kinds and non-http(s) URLs dropped, dimensions positive integers ≤20000 or null, attribution ≤200 chars; stamped on every record as `artworkVariants` (default `[]`; flows through `migrateRecord` automatically). `types.ts` `MediaArtworkVariant`. Verified in `tests/catalog.test.mjs` (2 tests: field normalization incl. invalid-kind/url rejection and dimension coercion; bounding/dedup/cloning/default). Unresolved: the AniList adapter does not yet map `coverImage`/`bannerImage` into variants (needs a `normalize()` mapping + mock-fixture update — next slice); `coverImage`/`banner` scalars remain the display source until then.)
- [x] **AV-024** — Add a metadata completeness score for each catalog entry. (`catalog.mjs` `completenessScore(record)`: weighted 0–100 coverage over 14 viewer-relevant fields (`COMPLETENESS_WEIGHTS`, sums to 100 — description 15, title/genres/companies/score 10 each, tags/dates/episodes/duration/ageRating/links/cover/externalIds 5 each); a field counts only when its normalized value is present (zeros/empty strings don't count; the fallback display title doesn't count as a real title). Stamped as `Media.completeness` on every `createAnimeRecord` output — since `migrateRecord`/`mergeRecords`/`applyCorrection` all rebuild through the factory, every derived path recomputes it automatically (proven by test). Verified in `tests/catalog.test.mjs` (2 tests: bare=0 → partial=35 → full=100; derived paths recompute — correction +15, merge +25). Bonus correctness fix surfaced by the derived-path test: `normalizeEpisodeCount` coerced an explicit `null` to `0` (`Number(null)===0`), violating AV-006's "unknown ≠ zero" on correction round-trips — now null/''/undefined → null, pinned by assertion.)
- [x] **AV-025a** — Build an admin metadata inspector showing raw and normalized records — server slice (split per size: endpoint first, UI second). (`anilist.mjs` `inspectDetail(id)` → `{ raw, record }`: `raw` is the exact `MEDIA_FIELDS` provider shape `normalize()` consumes, merged with the volatile overlay when available (best-effort, same semantics as `getDetail`); `record` is the normalized record — schemaVersion, `meta`, `completeness`, `fetchFailure` on overlay failure — so raw → record transformations are directly comparable. Route `GET /api/admin/inspect/:id` (`server/index.mjs`, `limitOutbound` + `wrap`, no auth — local single-user tool, documented). Verified in `tests/detail-split.test.mjs` (2 tests: raw keeps provider shape incl. overlay and record shows normalized fields + schemaVersion/completeness/meta; invalid ids rejected with 400) + `node --check server/index.mjs`.)
- [x] **AV-025b** — Build an admin metadata inspector showing raw and normalized records — UI slice. (House pattern: pure view-model builder `server/inspect.mjs` `buildInspectionRows(raw, record)` → 21 `{ field, raw, normalized, changed }` rows (title/status/format/episodes/duration/score-popularity/genres/tags/studios/dates/broadcast/country/source/ageRating/description/externalIds; `changed` flags normalized transformations), returned by the route alongside `{ raw, record }`; typed client `adminInspect` in `api.ts`; `src/pages/AdminInspect.tsx` renders the comparison table (changed rows highlighted) with collapsible raw/record JSON panes and an id form, deep-linkable at `/admin/inspect/:id` (registered in `routePrefetch.ts` + `App.tsx`). Verified: `tests/inspect.test.mjs` (2 tests: raw→normalized mapping + change flags incl. title-object→string and fuzzy-date reshaping; missing inputs → 21 all-null rows), full suite **377 pass**, `npm run typecheck`, `npm run build` (27 assets incl. the new page chunk), `node --check server/index.mjs`. Note: the page itself is verified by typecheck+build per the repo's UI standard (no component-test harness exists).)

### 02 · Browse, seasons, and discovery · P1

Expand the existing season browser into a complete catalog exploration experience.

- [x] **AV-026** — Add browse filters for TV, movie, OVA, ONA, and special formats. (`Browse.tsx` exposes `FORMAT_OPTIONS` as a multi-select chip group; `browse.mjs` maps them to `format_in`.)
- [x] **AV-027** — Add filters for currently airing, upcoming, finished, and cancelled shows. (`Browse.tsx` exposes `STATUS_OPTIONS`; `browse.mjs` maps them to `status_in`.)
- [x] **AV-028** — Add multi-select genre filters with include and exclude modes. (`Browse.tsx` shows genre chips; Alt-click toggles exclusion via `toggleExclude`; `browse.mjs` supports `genres` and `genresExclude`.)
- [x] **AV-029** — Add tag filters with AND, OR, and NOT combinations. (`browse.mjs` implements `tagMode` (and/or) and applies AND logic locally when AniList cannot; `Browse.tsx` tag UI is in `FilterPanel`.)
- [x] **AV-030** — Add studio and producer browsing pages. (`/api/studios` and `/api/studios/:id` endpoints; `Studios.tsx` page; `explore.mjs` provides `groupByStudio`.)
- [x] **AV-031** — Add decade and release-year range filters. (`Browse.tsx` shows decade chips and a year range slider; `browse.mjs` supports `yearMin`/`yearMax` and decade expansion.)
- [x] **AV-032** — Add season filters that include historical seasons. (`Browse.tsx` has "Any season" checkbox backed by `includeOlderSeasons`; `browse.mjs` passes bare year when enabled.)
- [x] **AV-033** — Add popularity, score, favourites, and trending sort orders. (`Browse.tsx` exposes `SORT_OPTIONS`; `browse.mjs` maps to `BROWSE_SORTS` including `popular`, `trending`, `rated`, `favourites`, `newest`, `oldest`, `title`, `episodes`.)
- [x] **AV-034** — Add episode-count range filters. (`Browse.tsx` range slider for episodes; `browse.mjs` supports `episodesMin`/`episodesMax`.)
- [x] **AV-035** — Add runtime range filters for short-form and long-form anime. (`Browse.tsx` range slider for duration in minutes; `browse.mjs` supports `durationMin`/`durationMax`.)
- [x] **AV-036** — Add source-material filters such as manga, novel, game, and original. (`Browse.tsx` exposes `SOURCE_OPTIONS`; `browse.mjs` maps them to `source_in`.)
- [x] **AV-037** — Add country and original-language browse filters. (`Browse.tsx` exposes `COUNTRY_OPTIONS`; `browse.mjs` maps them to `countryOfOrigin_in`.)
- [x] **AV-038** — Add content-rating filters with user-configurable defaults. (`server/browse.mjs` exports `BROWSE_AGE_RATINGS`; `/api/browse/options` returns them; `Browse.tsx` shows the multi-select chip group; age rating is included in `/api/anime/:id` detail responses.)
- [x] **AV-039** — Add a random anime discovery button with filter awareness. (`Browse.tsx` has "Surprise me" button calling `discover('random')`; `anilist.mjs` picks from a random page within filter bounds.)
- [x] **AV-040** — Add a daily discovery spotlight with a rotating catalog pick. (`Browse.tsx` has spotlight discovery; `anilist.mjs` uses a stable per-day index for deterministic picks.)
- [x] **AV-041** — Add hidden-gem collections based on low popularity and strong ratings. (`Browse.tsx` has "Hidden gems" button calling `discover('hidden-gems')`; `anilist.mjs` queries low popularity + high score.)
- [x] **AV-044** — Add a studio-focused release explorer. (`/api/studios/:id` returns filmography grouped by year; `Studios.tsx` page with studio detail.)
- [x] **AV-045** — Add a franchise-focused browse mode. (`/api/franchises` endpoint; `explore.mjs` `buildFranchiseGroups` uses union-find on AniList relations.)
- [x] **AV-046** — Add an alphabetical index with kana and Latin navigation. (`/api/index` endpoint; `explore.mjs` `buildAlphabetIndex` with Latin buckets and kana rows.)
- [x] **AV-047** — Add a recently added to catalog section. (`/api/recent` endpoint; `anilist.mjs` `recentlyAdded` queries by ID desc.)
- [x] **AV-048** — Add a recently updated metadata section. (`/api/updated` endpoint; `anilist.mjs` `recentlyUpdated` queries by updatedAt desc.)
- [x] **AV-049** — Add a browse filter preset save/load system. (`Browse.tsx` uses `useBrowsePresets` hook; presets persist in localStorage; saved presets appear in a dropdown.)
- [x] **AV-050** — Add shareable URLs that preserve all active browse filters. (`Browse.tsx` "Share" button copies URL with all filters; filters sync to URL via `setSearchParams`.)

### 03 · Search and query experience · P0 / P1

Make search fast, forgiving, explainable, and useful across the entire library.

- [x] **AV-051** — Add instant search suggestions while typing. (`/api/search/suggest` + `anilist.suggest()` return ranked, highlighted suggestions with optional corrections; `Search.tsx` renders the type-ahead dropdown with `aria-expanded`/`role="option"` semantics.)
- [x] **AV-052** — Add keyboard navigation for every search suggestion. (`Search.tsx` handles ArrowDown/ArrowUp/Enter/Escape over the suggestion list with `aria-selected` tracking.)
- [x] **AV-053** — Support exact title, partial title, and alternate-title matching. (`rankTitles` tiers exact/prefix/word/substring plus exact and partial alias matches; aliases now include romaji, English, native and AniList synonyms (`MEDIA_FIELDS.synonyms`, `catalog.mjs` `synonyms` field); verified in `tests/search.test.mjs`.)
- [x] **AV-054** — Add fuzzy matching for misspellings and transposed characters. (`similarity` blends Dice bigrams with OSA `editDistance` (adjacent transposition = 1 mistake); `typoTolerance` scales the budget with query length; verified in `tests/search.test.mjs`.)
- [x] **AV-055** — Add romanization-aware matching for Japanese titles. (`foldRomaji` in `search.mjs` folds Hepburn/Kunrei digraphs (shi↔si, chi↔ti, tsu↔tu, fu↔hu, ji↔zi, …) and long-vowel spellings (ou/oo→o, uu→u, aa→a); `rankTitles` reports "romanization variant of the title" and fold-aware alias hits; native script passes through untouched; verified in `tests/search.test.mjs`.)
- [x] **AV-056** — Add native-script title search. (AniList `search` matches native titles server-side; the native title is now included in `rankTitles` aliases so CJK queries rank and highlight locally — see `tests/search.test.mjs` native alias test.)
- [x] **AV-057** — Add title alias indexing across all known metadata providers. (`search.mjs` `buildTitleAliasIndex(record)`: provider-tagged `[{ label, source }]` entries aggregating every title-like value a record carries — display title, romaji/English/native variants, synonyms, and per-provider claim/correction alternates from `meta.fields` provenance (AV-004/AV-017) — deduped by normalized form with canonical entries first and winning source tags on collisions; sparse/missing input yields safe defaults. Wired into the suggest path: `anilist.mjs` `suggest()` now builds candidates' `aliases` from the index instead of a hand-rolled field list. Verified in `tests/title-aliases.test.mjs` (2 tests: cross-provider aggregation with per-source tags ('anilist'/'manual'/'anidb') + normalized-form dedupe; sparse-record tolerance).)
- [x] **AV-058** — Add search by studio, staff member, and voice actor. (Full path, end-to-end: query syntax — `staff:`/`creator:`/`writer:`/`director:` and `va:`/`voice:`/`voiceactor:`/`seiyuu:`/`cv:` fields in `search.mjs` `parseSearchQuery` (counted by `hasStructuredFilters`); pure `matchEntityNames(query, names)` (normalized substring + romanization folding; native-script names match as substrings); people-name data — `searchAnime`'s query now fetches top staff + Japanese voice-actor names per result, `normalize()` maps them into bounded `staffNames`/`voiceActorNames` record fields (`normalizeNameList`: ≤12, deduped, ≤120 chars); `searchAdvanced` post-filters both dimensions with AV-071 reason strings. Verified in `tests/people-search.test.mjs` (3 tests: field parsing incl. quoted multi-word names + aliases, name matching incl. CJK substrings and negative cases, bounded/deduped record indexes). Limitations recorded: the people index is the top-5 relevance slice per search result (not a full per-title credit roll), and studio matching keeps its existing substring filter.)
- [x] **AV-059** — Add search by character name. (AV-058 pattern applied: `character:`/`characters:`/`char:`/`chara:` query fields → `filters.character`; `searchAnime`'s characters selection now fetches `node { name { full } }` alongside the voice actors; `normalize()` maps them into the bounded `characterNames` record field (`normalizeNameList`); `searchAdvanced` filters the dimension via `matchEntityNames` with `character …` reason strings. Verified in `tests/people-search.test.mjs` (1 test: quoted/aliased parsing + bounded deduped record index + matcher). Same top-5 relevance-slice limitation as AV-058, recorded there.)
- [x] **AV-060** — Add search by franchise and sequel relationship. (`franchise:`/`franchises:`/`series:`/`related:`/`relation:` query fields → `filters.franchise`; `searchAnime`'s query now fetches the relation graph (`relations { edges { relationType node { title … } } }`, ANIME nodes only) and `normalize()` maps it into bounded `relationNames`/`relationTypes` record fields. Pure `matchesFranchise(value, record)` in `search.mjs` gives the dimension its two semantics — relation-type tokens (`related:sequel`, `franchise:"side story"`, snake/word-insensitive) match by relationship presence, any other value name-matches the franchise neighbourhood (related titles) via `matchEntityNames`. Wired into `searchAdvanced` with `franchise …` reasons. Verified in `tests/franchise-search.test.mjs` (2 tests: parsing + structured counting, matcher semantics incl. type tokens, name matching, negatives).)
- [x] **AV-061** — Add search by theme, genre, and tag. (Inspection-first delta: `genre:`/`tag:` syntax and filters already existed (AV-065), so this task delivers what was actually missing — (1) a **theme dimension**: `theme:`/`themes:`/`motif:`/`topic:` fields → `filters.theme`, matched as fragments over the non-spoiler tag vocabulary (AniList keeps thematic vocabulary in tags — documented in code) with `theme …` reasons; (2) **separator-tolerant matching**: new pure `matchNameToken` (equality after stripping separators — 'sci-fi'/'Sci Fi'/'scifi' all match, no substring over-match) now backs the `genre:` and `tag:` filters, fixing the prior exact-string gap where `tag:time-travel` could not match 'Time Travel'. Verified in `tests/theme-search.test.mjs` (3 tests: theme parsing + structured counting, matchNameToken semantics incl. negatives, fragment thematic matching). Note: free-text thematic search (typing 'mecha' with no field prefix) is out of scope — it needs candidate-set orchestration at the provider layer.)
- [x] **AV-062** — Add search by episode title and episode number. (`episode:`/`episodename:`/`eptitle:` fields → `filters.episode` — the singular `episode:` token was unclaimed (`ep:`/`episodes:` keep their count-range meaning, verified by test). Pure `matchesEpisode(value, record)` with dual semantics: a numeric value matches shows that have (or will have) that episode number (`airedEpisodes >= n || episodes >= n`); any other value fragment-matches the record's `episodeTitles` index. Data: `searchAnime`'s query fetches `streamingEpisodes { title }`, `normalize()` maps them into a bounded `episodeTitles` record field (≤24). Wired into `searchAdvanced` with `episode …` reasons. Verified in `tests/episode-search.test.mjs` (3 tests: parsing incl. `ep:` non-collision, number semantics with aired/total coverage, title-fragment matching + negatives). Limitations: streaming-episode titles are provider-supplied and often generic ("Episode 3"), the index is capped at 24 titles per result, and `episode:0` trivially matches (documented edge).)
- [x] **AV-063** — Add search within the local media library only. (`/api/search/library` scans the local library index; `Search.tsx` has a "My library" tab (`?in=library`) with its own results panel.)
- [x] **AV-064a** — Add search within bookmarks and custom lists only — server slice (split per size: endpoint first, Search tab second). (`GET /api/search/collections?q=` scans bookmarks (`store.list()` media) and every custom/status list (`listStore` entries' media), deduped by media id with accumulated list membership (`inBookmarks`, `lists: [...]` names) and `highlightSegments` fragments, mirroring the AV-063 library-search shape. Pure `matchRecordTitles(query, record)` in `search.mjs` reuses the AV-057 alias index + tiered typo-tolerant `rankTitles` matching. Typed `api.searchCollections` + `CollectionHit`/`SearchCollectionsResponse` in `api.ts`. Verified in `tests/collections-search.test.mjs` (2 tests: titles/romaji/synonym fragments/typo tolerance + negatives; provenance alternates searchable). **Bug found and fixed during verification:** `buildTitleAliasIndex` treated `meta.fields[*].alternates` as plain strings, but `normalizeAlternates` stores provider **claim objects** (`{ source, value }`) — real records with corrections would have produced '[object Object]' aliases (my AV-057 tests passed only with hand-built string fixtures); the index now extracts claim values and per-claim source tags, string-tolerant, pinned by the new test.)
- [x] **AV-064b** — Add search within bookmarks and custom lists only — UI slice. (`Search.tsx` gains a 'Bookmarks & lists' tab (Bookmark icon, URL `?in=collections`, deep-linkable via the `commit` helper) beside 'Catalog' and 'My library'; `collectionHits` state + three-way fetch branch consuming `api.searchCollections` (each branch clears the other result sets); render block mirroring the library tab — highlighted media titles, membership line (`Bookmarks · list names`), per-hit 'Open' link to the detail page — plus tab-aware subtitle, empty state, and loading gate. Verified by `npm run typecheck` + `npm run build` (repo UI standard — no component harness); server side re-verified at 393 tests.)
- [x] **AV-065** — Add advanced query syntax for field-specific filters. (`search.mjs` `parseSearchQuery` handles `studio:`, `genre:`, `tag:`, `year:`, `status:`, `format:`, `score:>80`, `episodes:>=12`, `title:"…"` tokens; `/api/search/advanced` applies them; verified in `tests/search.test.mjs`.)
- [x] **AV-066** — Add search history with per-entry deletion. (`src/lib/searchHistory.ts` `useSearchHistory` with `add`/`remove`/`clear`; `Search.tsx` renders history entries with per-entry remove buttons.)
- [x] **AV-067** — Add an option to disable or automatically expire search history. (`searchHistory.ts` settings `{ enabled, expiryDays }` with cutoff filtering; `Search.tsx` exposes both in the history panel.)
- [x] **AV-068** — Add typo-correction suggestions with the original query preserved. (`suggestCorrection` returns `{ suggestion, original, reason, score }`; `/api/search/suggest` + `/api/search/advanced` pass it through; `Search.tsx` shows the correction while keeping the original; verified in `tests/search.test.mjs`.)
- [x] **AV-069** — Add a no-results page with actionable alternative filters. (`alternativeQueries` builds narrow/field/browse options; `/api/search/advanced` returns `alternatives` when empty; `Search.tsx` renders them in the empty state.)
- [x] **AV-070** — Add result grouping by anime, movie, character, staff, and studio. (`groupResults` buckets by format (TV/MOVIE/OVA/ONA/SPECIAL/OTHER); `/api/search/advanced` returns `groups`; `Search.tsx` renders grouped sections; verified in `tests/search.test.mjs`.)
- [x] **AV-071** — Add result highlighting for matching title fragments. (`highlightSegments` produces matched/unmatched segments; `Search.tsx` `<Highlighted>` renders them in suggestions and results; verified in `tests/search.test.mjs`.)
- [x] **AV-072** — Add search result relevance explanations. (`rankTitles` attaches a human-readable `reason` to every hit ("exact title match", "close spelling (1 character off)", …); `Search.tsx` shows `reason` on suggestions; verified in `tests/search.test.mjs`.)
- [x] **AV-073** — Add debounced requests, cancellation, and stale-response protection. (`Search.tsx` debounces suggestions 250 ms with a monotonically increasing request sequence guard and effect cleanup; main fetches use an `alive` flag.)
- [x] **AV-074** — Add a configurable maximum result count and pagination. (`RESULT_CAP` + `clampResultCap` bound `/api/search/advanced` `perPage`; `Search.tsx` paginates via `?page=`; verified in `tests/search.test.mjs`.)
- [x] **AV-075a** — Add server-side full-text indexing for the local catalog — pure index core (split per size: index engine first, catalog wiring second). (`server/fullText.mjs`: inverted index over normalized tokens — `tokenize` (reuses `normalizeForSearch` folding), `buildTextIndex`, `indexDocument` (add **or replace** — stale tokens stop matching), `removeDocument` (prunes empty postings), `searchTextIndex` with strict AND semantics and rarity-weighted TF ranking (idf × (1 + ln tf), stable tie-break), injectable-free and I/O-free. Verified in `tests/full-text.test.mjs` (5 tests: token folding, AND matching + missing-token emptiness, rarity/TF ranking, incremental replace/remove/re-index idempotence, sparse-input safety). Scope notes: exact-token matching after normalization — fuzzy typo tolerance stays in `rankTitles`; storage/persistence is deliberately not here.)
- [x] **AV-075b** — Add server-side full-text indexing for the local catalog — wiring slice. (`server/catalogIndex.mjs`: `localDocuments` assembles indexable docs from every local source (library files with file/folder/quality text, bookmarks and list entries with full title variants + genres), `indexSignature` captures content changes, and `createCatalogIndexer()` keeps one index per signature with lazy rebuild (wholesale at this scale — documented; the fullText core's incremental API remains for growth). `GET /api/search/text?q=` (server/index.mjs) feeds it library + bookmarks + deduped list entries (accumulated list/status names per media) and returns ranked hits with `highlightSegments` fragments, deduped by media across sources. Verified in `tests/catalog-index.test.mjs` (3 tests: doc assembly across all three sources incl. synonym text + subtitles, signature invalidation, indexer search/rank/dedupe + cache refresh on grow/shrink) — suite **401 pass**; `node --check server/index.mjs`. Mid-run correction: one test asserted lowercased document text — normalization happens at tokenize time by design, assertion fixed to original casing. Honest scope note: no UI consumer yet — the requirement wording is server-side indexing; a Search-page surface can adopt `/api/search/text` later.)

### 04 · Anime details, episodes, and franchise pages · P1

Turn the current detail modal into a complete information hub.

- [x] **AV-076** — Add a dedicated shareable route for each anime detail page. (`/anime/:id` existed as a client route; this slice makes it *shareable*: the production SPA catch-all (server/index.mjs) now injects `<title>` + `og:title/description/image/url` + `twitter:card` into the shell for `/anime/:id` requests via pure `server/htmlMeta.mjs` (`documentTitle`/`documentMeta`/`injectDocumentMeta` — HTML-escaped, replace-not-duplicate, description capped at 200 chars, root-relative covers made absolute; lookup failure falls back to the plain shell). Client side: `document.title` effect in AnimeDetail.tsx (restores `AnimeVault` on unmount) + a Share button next to Save that copies the page URL with 'Copied' feedback. Verified in `tests/html-meta.test.mjs` (3 tests: meta payload + title chain + truncation, shell injection + no-duplication on re-injection, markup escaping) — suite **404 pass**, typecheck + build clean, `node --check` on both server files. Honest scope notes: OG injection is production-only (the dev server's Vite serves the shell directly; the client title effect covers dev tabs), and OG `description` uses the record's description; a full `og:type`/JSON-LD block can extend `injectDocumentMeta` later.)
- [x] **AV-077** — Add a full episode guide with numbered episode entries. (Reconciliation found the guide *built but dead*: the `/api/anime/:id` route sent the array as `episodes` (clobbering the numeric count and never sending `episodesGuide`), so the UI's `detail.episodesGuide` was always empty and the header's `{detail.episodes}` count would render guide objects. Fixed by extracting pure `buildDetailResponse` in server/detail.mjs (the whole payload assembly, testable at last — detail.mjs previously had zero tests) which exposes `episodesGuide: EpisodeEntry[]` while `episodes` stays the count; the route is now a one-line call. Numbered rows (1..total with thumbnails/titles/play actions) render in the `#episodes` section as designed. Verified in `tests/detail-response.test.mjs` (numbered entries 1..total, prefix-stripped titles, out-of-range streaming entries ignored, no-count → empty guide, count preservation in the response) — suite **406 pass**.)
- [x] **AV-078** — Show episode titles, runtimes, air dates, and synopsis when available. (Titles/runtimes/air dates already rendered in the episode row; the **synopsis gap** was real: guide entries hardcoded `synopsis: null` even though AniList streaming entries carry `description`, and the row had no synopsis line. Now `buildEpisodeGuide` fills `synopsis` from the streaming description (trimmed, null when absent) and EpisodeRow renders it clamped to 2 lines when available. Covered by tests/detail-response.test.mjs (synopsis from description when available, null otherwise) — suite **406 pass**. Note: `synopsis: {text, hiddenCount}` on the detail payload is intentional (types.ts:283) and was verified not to be a bug.)
- [x] **AV-079** — Show episode thumbnail artwork when a legitimate source provides it. (Verified chain: AniList streaming episodes fetch `thumbnail` (anilist.mjs `streamingEpisodes { title thumbnail url site }`) → `buildEpisodeGuide` fills `thumbnail` → EpisodeRow renders `<img loading="lazy">` with a Clapperboard placeholder when absent, plus an `onError` fallback added this turn so dead URLs degrade to the placeholder too. Server propagation + null fallback covered in tests/detail-response.test.mjs; the render itself is verified by code inspection — there is no component-test harness in this repo. Suite **415 pass**.)
- [x] **AV-080** — Add a season selector for multi-season franchises. (Extraction done: the component-scope memo moved to pure `buildSeasonOptions(detail)` in server/detail.mjs — current title + `relatedSeasons` merged in air order (year → season (WINTER..FALL) → id, undated last) — and `buildDetailResponse` now ships `seasonOptions` as a pre-computed section like every other detail block; the client renders `detail?.seasonOptions ?? []` (memo and its local SEASON_ORDER constant deleted). The selector UI (chips with the current season highlighted, `/anime/:id` links) renders when >1 option. Verified in tests/detail-sections.test.mjs (merge + air-order sort with undated-last + current flag, single/empty inputs, payload integration) — suite **416 pass**, typecheck + build clean. Caveat noted: a cached detail payload from before this field exists shows no selector until refreshed (`?? []` degrades gracefully).)
- [x] **AV-081** — Add a related-content section grouped by relationship type. (Server `groupRelations` (server/detail.mjs) buckets relation edges into `RELATION_GROUPS` display order with one card per media (first/most-specific group wins) and year-sorted items; the detail page renders them as `RelationGroup` sections (:605). Verified in `tests/detail-sections.test.mjs` (grouping + display order, dedupe across groups, year sort, non-anime filtering, empty input) — suite **415 pass**.)
- [x] **AV-082** — Add canonical sequel, prequel, side-story, and spin-off relationships. (Canonical `SEQUEL`/`PREQUEL`/`SIDE_STORY`/`SPIN_OFF` are first-class `RELATION_GROUPS` with labels, case-insensitive via `relationGroupKey` (unknown → OTHER). Covered by tests/detail-sections.test.mjs (canonical groups first-class in display order, case-insensitivity, unknown mapping) — suite **415 pass**.)
- [x] **AV-083** — Add a franchise timeline with chronological and release-order modes. (`buildTimeline(nodes, mode)` + the release/chronological toggle (:171/:693) + `?order=` param through `buildDetailResponse`. Verified in tests/detail-sections.test.mjs (both modes produce distinct orders, position numbering, undated entries sort last and are flagged `uncertain`, order param flows through the payload) — mid-run correction: my first fixtures assumed chronological keys use `startDate.year`, but `chronologicalKey` prefers `seasonYear` and resolves months from `season`; tests now pin the real behavior. Suite **415 pass**.)
- [x] **AV-084** — Add watch-order recommendations with editable ordering notes. ✅ (`server/watchOrder.mjs`: pure `recommendWatchOrder(releaseOrder, chronologicalOrder)` — recommends release when the two timeline orders agree, chronological when they differ and dates are complete, and falls back to release when undated entries make chronological unreliable; `sanitizeOrderingNote` trims/caps input. `buildDetailResponse` now includes the `watchOrder` recommendation (compares buildTimeline in both modes). Editable ordering notes persist per anime via `GET/PUT /api/anime/:id/watch-order` in the settings kv store (`watch-order:<id>`, mirroring the AV-099 notes pattern, empty note deletes). UI: timeline section shows a "Recommended: …" banner (label + rationale) and an Ordering-note editor (textarea + Save with unsaved-changes hint) in AnimeDetail.tsx. Verified in `tests/watch-order.test.mjs` (5 tests: agreement → release, differing + complete → chronological, undated fallback → release, note sanitizing, detail payload carries the recommendation) — suite **411 pass**, typecheck + build clean.)
- [x] **AV-085** — Add a character gallery with character detail pages. *(Split into slices — the gallery already existed in AnimeDetail.tsx; both slices below complete the requirement.)*
  - [x] **AV-085a** — Character detail API (server slice). (`server/character.mjs`: pure `normalizeCharacter` — name fallback chain, alternative names, sanitized image/siteUrl (dangerous urls dropped), description, and media appearances with `characterRole`/year and `#id` title fallback. `anilist.getCharacter(id)` with a new `Character(id:)` GraphQL query (names/description/siteUrl + `media(perPage:25, sort:[FAVOURITES_DESC])`), cached on the long-lived media tier (`character:` prefix registered in cachePolicy.mjs). `GET /api/characters/:id` returns the normalized payload (404 when unnormalizable, 400 on invalid id). Verified in `tests/character.test.mjs` (2 tests: full mapping incl. alternative-name filtering and appearance fallbacks; missing-field tolerance + url sanitizing) — suite **418 pass**, typecheck clean, `node --check` on all touched server files.)
  - [x] **AV-085b** — Character detail page (UI slice). (`src/pages/CharacterDetail.tsx`: name/native/alternative names, image, description, AniList link, and an Appearances list linking to `/anime/:id` (role · format · year), with the StudioPage loading/error patterns and an AV-076-style `document.title` effect; back via `navigate(-1)`. Wired: `characters/:id` route in App.tsx, lazy `CharacterDetailPage` + `'/characters'` prefetch entry in routePrefetch.ts (own chunk), `api.character(id)` + `CharacterDetail`/`CharacterAppearance` types, and the gallery cards in AnimeDetail.tsx now link to `/characters/:id` with hover state. Verified: typecheck clean (the real gate for UI), build clean (31 chunks incl. the new page), suite **418 pass** — no new node tests possible without a component harness; the payload contract is covered by tests/character.test.mjs (AV-085a).)
- [x] **AV-086** — Add staff pages for directors, writers, composers, and animators. *(Split into slices — both complete; the Staff & cast gallery already existed on the detail page.)*
  - [x] **AV-086a** — Staff member API (server slice). (`server/staff.mjs`: pure `normalizeStaffMember` — name fallback chain, alternative names, sanitized image/siteUrl, description, `primaryOccupations`, and `staffMedia` credits with `role` (e.g. Director/Writer/Composer) + year and `#id` title fallback; same contract shape as AV-085a's character payload, and it doubles for voice-actor profiles (AV-087) since AniList models both as Staff). `anilist.getStaffMember(id)` with a `Staff(id:)` GraphQL query (`staffMedia(perPage:25, sort:[FAVOURITES_DESC])`), cached on the media tier (`staff:` prefix registered in cachePolicy.mjs). `GET /api/staff/:id` returns the normalized payload (400 invalid id, 404 unnormalizable). Verified in `tests/staff.test.mjs` (2 tests: full mapping incl. occupation/credit handling and appearance fallbacks; missing-field tolerance + url sanitizing) — suite **420 pass**, typecheck clean, `node --check` on touched server files.)
  - [x] **AV-086b** — Staff detail page (UI slice). (`src/pages/StaffDetail.tsx`: name/native/occupations/alternative names, image, description, AniList link, and a Credits list (`role · format · year`) linking to `/anime/:id`, with the established loading/error patterns + `document.title` effect. Wired: `staff/:id` route (App.tsx), lazy `StaffDetailPage` + `'/staff'` prefetch entry (own chunk), `api.staff(id)` + `StaffDetail`/`StaffCredit` types, and the Staff & cast cards in AnimeDetail.tsx now link to `/staff/:id` with hover state. Verified: typecheck clean (the UI gate), build clean (32 chunks), suite **420 pass** — payload contract pinned by tests/staff.test.mjs (AV-086a); no component harness exists for page-level tests.)*
- [x] **AV-087** — Add voice-actor profiles and role credits. (Profiles ride on the AV-086 staff pages — AniList models VAs as Staff — and this task adds the **role credits** + discoverability: the `Staff(id:)` query now fetches its `characters` connection; pure `normalizeStaffMember` flattens edges into `characterCredits` rows (`characterId/characterName/role/mediaId/mediaTitle`, one per character×media pair, nodeless edges and empty media dropped, name/title fallbacks). StaffDetail renders a "Voice roles" section (character → `/characters/:id`, media → `/anime/:id`, role) shown only when credits exist. The detail page's character cards restructured to two sibling links — name/role → `/characters/:id`, VA name → `/staff/:id` — avoiding nested anchors from the AV-085b card Link. Verified in tests/staff.test.mjs (flattening + fallbacks + drops; suite **421 pass**), typecheck + build clean (32 chunks). Note: `sort: [FAVOURITES_DESC]` on the `characters` connection mirrors the `staffMedia`/`media` connections from AV-086a/085a — same accepted runtime risk if AniList rejects the enum there.)*
- [x] **AV-088** — Add studio profiles with their complete known catalog. (Reconciliation: studio profiles + paginated filmography page already existed (AV-044 era — `/api/studios/:id`, `StudioPage` with byYear grouping, sorts, load-more). The real gap was **"complete"**: `studioFilmography`'s media connection filtered `isMain: true`, silently dropping co-productions. Fix: query hoisted to exported `STUDIO_FILMOGRAPHY_QUERY` with the `isMain` filter removed — every credited work now appears, pagination unchanged. Verified by `tests/studio-filmography.test.mjs` (contract guard on the media connection: unfiltered + paginated + fields interpolated) — suite **422 pass**. Mid-run note: the first guard was too broad and false-positived on `studios(isMain:)` inside the interpolated MEDIA_FIELDS fragment (studio-vs-producer names on Media — legitimate); the guard now scopes to the filmography's own connection line. Honest scope note: the guard pins the query contract since the fetch itself needs the network.)*
- [x] **AV-089** — Add production committee and distributor details where available. (Reconciliation: AV-008 already normalized **linked company entities** (catalog.mjs `normalizeCompanies` — `companies: MediaCompany[]` with canonical `MAIN_STUDIO`/`PRODUCER`/`LICENSOR`/`DISTRIBUTOR` roles) and they flow through `buildDetailResponse`; the gap was surface-only. Now pure `groupCompanies(companies)` (server/detail.mjs) emits one labeled group per *populated* role ("where available" honored — empty groups dropped, role-less/unnamed companies filtered) and ships as `companyGroups`; the detail page's studio card (retitled "Production & companies") renders the groups with a fallback to the old `detail.studios` name list when `companyGroups` is absent (stale cache). Verified in tests/detail-sections.test.mjs (role grouping + canonical order + double-role companies appearing in both groups + drops + payload integration) — suite **423 pass**, typecheck + build clean. Note: AniList has no dedicated distributor field — DISTRIBUTOR/LICENSOR roles come from the linked-companies data when sources provide them, which is exactly what "where available" permits.)*
- [x] **AV-090** — Add source-material links and adaptation relationship details. (Reconciliation found a real dead-end: relation cards always linked to `/anime/:id`, but that page queries `Media(type: ANIME)` — Source material/Adaptation cards for manga/novels 404'd. Fixed: relations query now fetches `siteUrl`, `groupRelations` carries it (sanitized — dangerous urls dropped), and cards are type-aware — ANIME keeps internal `/anime/:id` links, non-ANIME links out to its AniList entry (the source-material link), with a non-link fallback when no url exists. Adaptation details: cards now distinguish Novel vs Manga (was 'Manga' for both) and show chapter counts (`N ch`) alongside format/year/episodes/score. Verified in tests/detail-sections.test.mjs (siteUrl sanitizing + chapters mapping through groupRelations) — suite **424 pass**, typecheck + build clean. The ADAPTATION/SOURCE/… groups and labels themselves were already covered by AV-081/082 tests.)*
- [x] **AV-091** — Add a spoiler-safe synopsis expansion control. (Reconciliation: the Read more/Show less control already existed (420-char preview + toggle) and was spoiler-safe by construction — it sliced the *server-redacted* text — but the logic was component-local and untested, the exact AV-080 pattern. Resolved the same way: pure `synopsisClip(text, limit=420)` in server/detail.mjs (clips with `…` on the already-redacted text, so a preview can never leak a `~!…!~` region) shipped as `synopsisClip` in `buildDetailResponse`; the client now only holds the expand state and reads the pre-computed clip (stale-cache fallback shows the full text — safe). Verified in tests/detail-sections.test.mjs (clip boundary + `…`, empty input, and the spoiler-leak contract on redacted text) — suite **425 pass**, typecheck + build clean.)
- [x] **AV-092** — Add a spoiler-free overview mode for new visitors. (Reconciliation: the mode exists — visitors without `?spoilers=1` (the default, i.e. new arrivals) get `spoilerFreeOverview` as the lead paragraph (first-sentence, 240-cap summary with `~!…!~` regions removed entirely) above the redacted synopsis, with the Reveal toggle as the explicit opt-out and the state URL-shareable; covered in the UI at AnimeDetail.tsx :556. The gap was evidence: `spoilerFreeOverview` had only one incidental assertion. Now pinned in tests/detail-sections.test.mjs (empty/spoiler-only inputs yield '', long first sentence stands alone, short openings keep following spoiler-free text with spoiler regions deleted, maxLength cap cuts at a word boundary + `…`) — suite **426 pass**. Deliberately NOT added: a stricter brief-only view hiding the redacted synopsis — the redacted text contains no spoilers, so that would be speculative UX beyond the requirement.)*
- [x] **AV-093** — Add a release and production status timeline. (Reconciliation: fully implemented — pure `buildStatusTimeline` (server/detail.mjs: Premiére/Finished-airing from start/end dates, 'Announced (TBA)' for NOT_YET_RELEASED, next-broadcast event) ships as `statusTimeline` and renders on the detail page (:870). Gap was evidence; now pinned in tests/detail-sections.test.mjs (chronological sorting independent of insert order, season detail + `formatDate` full/partial forms, 'Announced' first with TBA, undated events dropped). Includes a **true** regression pin for the bug the code comments document: the old `9_999_999` sort sentinel put the next broadcast first regardless of date — the pin's future broadcast must land *after* the premiere (an early-draft fixture was not discriminating and was strengthened mid-run). Suite **428 pass**, tests-only change.)
- [x] **AV-094** — Add community score distribution rather than a single average. (Reconciliation: fully implemented — pure `scoreDistribution` (bucket shaping with percent-of-total, invalid/zero-vote entries dropped, score-desc), `distributionMean` (weighted, rounded — matches AniList's average) and `distributionMode` (consensus bucket) ship as `scores`/`scoreMean`/`scoreMode` and render as the "Score distribution" histogram section (AnimeDetail.tsx :848) with "N ratings · mean · most common" — the requirement's "rather than a single average" is exactly that section. Gap was evidence; now pinned in tests/detail-sections.test.mjs (entry validation + percent math + sorting, zero-vote → null, weighted mean rounding, mode + tie resolution to the higher score) — suite **430 pass**, tests-only change.)
- [x] **AV-095** — Add external metadata links with provider attribution. (Verified gap: the detail record's `links` dropped the `type` field the AniList mapping already computed — links couldn't be attributed by provider category. Now pure `normalizeExternalLinks` (server/links.mjs: unsafe urls dropped, provider names trimmed/capped 80, `type` preserved; extracted from anilist.mjs's inline mapping so the contract is testable) feeds the record with `type` (MediaLink extended), and the External links section shows a per-provider category label (streaming etc.; generic `INFO` suppressed as noise) plus a provenance line ("Metadata compiled via AniList; links provided by each service"). Verified in tests/external-links.test.mjs (attribution shape + unsafe/unattributable drops + type defaulting) — suite **431 pass**, typecheck + build clean. Judgment calls (assumptions, not requirements-derived): the provenance wording and suppressing `INFO` labels — easy to revise.)
- [x] **AV-096** — Add a metadata correction suggestion workflow. (Reconciliation: a report queue existed (`POST /api/anime/:id/report`, kv-capped 500) with field + free-text only and **zero tests** (validation inline in the route). This adds the correction-suggestion structure: pure `buildMetadataReport` (server/reporting.mjs) returns `{ok, report | error}` with the workflow contract — allowed-field enforcement (12 fields incl. `episode-order`), kind coercion, message required + 1000-cap, and a structured optional **`suggestedValue`** (the proposed corrected value, 400-cap, blank → null) so fixes are machine-readable for reviewers. The route delegates validation to it; the report form gains a "Suggested correction (optional)" input sent through `reportAnimeIssue` (payload type extended) and reset on submit. Verified in tests/reporting.test.mjs (structured suggestion shape; contract: blank message errors, invalid mediaId errors, unknown field/kind coercion, blank suggestion → null, caps) — suite **433 pass**, typecheck + build clean.)
- [x] **AV-097** — Add a report-an-incorrect-episode-order action. (Reconciliation: the report workflow already accepted `episode-order` as a field and `kind` (form pre-selects the kind from the field; `buildMetadataReport` pins it in tests) — the gap was the **action**: no contextual way to report it from the episode guide. Now the Episode guide header gains a "Wrong order?" action that pre-selects `episode-order`, opens the report form (id=`report-form`), and smooth-scrolls to it. Verified: suite **433 pass** (the workflow contract the action feeds is covered by tests/reporting.test.mjs incl. `episode-order` kind; the wiring itself is UI-only — typecheck + build clean, the real gates).)*
- [x] **AV-098** — Add detail-page sections that can be rearranged by the user. *(Both slices complete.)*
  - [x] **AV-098a** — Section-order persistence + payload wiring (server slice). (Reconciliation: pure `applySectionOrder` existed but had **zero usages**. Now `normalizeSectionOrder` (dedupe/clean/cap-24) sanitizes the saved order in `settings.save` (new whitelisted `detailSectionOrder` key — the settings save is whitelist-based), and `buildDetailResponse` ships `sections: applySectionOrder(saved)` instead of the static list (route passes `settings.get().detailSectionOrder`; no saved order keeps the default arrangement). Contract pinned in tests/section-order.test.mjs (sanitizing; `always` sections pinned first with unknowns/dupes dropped and stragglers appended — one mid-run assertion wrongly assumed no stragglers and was corrected; payload integration) — suite **436 pass**, typecheck clean.)
  - [x] **AV-098b** — Rearrange UI (client slice). (Sections render in payload order via CSS `order`: both column wrappers became `flex flex-col gap-3`, a `SectionOrderContext` (rank Map) feeds every SectionCard through one `useContext` read (no call-site churn), ranks computed from `arrangedIds ?? detail.sections`. An "Arrange sections" disclosure lists sections (labels from payload, `always` sections pinned with disabled ↑/↓) with move buttons that reorder optimistically and persist via `api.saveSettings({ detailSectionOrder })` (error toast on failure); `AppSettings` gains `detailSectionOrder?: string[]`. Scope note (as planned): reordering is within each column — CSS order is sibling-scoped; cross-column moves were not attempted. Verified: suite **436 pass** (order logic pinned by tests/section-order.test.mjs from 098a; the UI is verified by typecheck + build — the real gates — 32 chunks clean).)*
- [x] **AV-099** — Add an anime-specific notes field visible only to its owner. (Reconciliation: the feature existed end-to-end — `GET/PUT /api/anime/:id/notes` (kv `notes:<id>`, blank note deletes), the "My notes" 4000-char editor with save/remove, owner-private by construction (server-local store, separate fetch, never in shared payloads). The gap was the untested inline contract; now pure `buildNotePayload`/`noteView` (server/notes.mjs) back both routes and tests/anime-notes.test.mjs pins: verbatim storage with trim-only-gating-emptiness, 4000 cap, blank → delete, malformed stored values never leak through `noteView`, and the **privacy property** — `buildDetailResponse` carries no `note`/`notes` fields (shared payloads are note-free). Suite **439 pass**, typecheck clean.)
- [x] **AV-100** — Add a printable or exportable anime information sheet. (Reconciliation: the export existed — `printSheet()` built a markdown sheet (title/meta/synopsis/watch-order/links) client-side and downloaded `*-sheet.md` via a header button (:519). The gap was the untested inline builder; per the AV-091 pattern it moved to pure `buildInfoSheet` (server/sheet.mjs) shipped pre-computed as `infoSheet` in `buildDetailResponse` (stale-cache fallback: a clear error toast), and the client just downloads it. Contract pinned in tests/info-sheet.test.mjs (full markdown layout: meta filtering, watch-order numbering `index+2` with lowercased relation types, links list, empty input) plus the two safety properties: **spoiler-safe** (renders the redacted synopsis — hidden spoilers never reach the sheet) and **note-free** (AV-099 privacy: private notes are never exported). Suite **441 pass**, typecheck + build clean. Minor cosmetic shift noted: the Season line now renders `SPRING 2023` (raw enum + year) instead of the client `formatSeason` label, since the builder is server-side.)*

### 05 · User accounts and personal profiles · P1 / P2

Move from a single shared installation toward optional individual identities.

- [x] **AV-101** — Add optional account registration for multi-user installations. *(Both slices complete.)*
  - [x] **AV-101a** — Registration server slice. (`server/accounts.mjs` pure: `normalizeRegistration` (username 3-32 `[A-Za-z0-9_-]`, password 8-200, optional display name ≤48), `hashPassword`/`verifyPassword` (node `scrypt` with per-user salt, `timingSafeEqual` verification — no new deps, no plaintext ever stored), and `publicUser` (the ONLY returnable shape — hash/salt stripped). Endpoints: `GET /api/auth/registration-status` and `POST /api/auth/register` (403 unless the installation opts in via the new whitelisted `registrationOpen` setting — "optional" honored by default-off; 400 contract errors, 409 username collision case-insensitive; kv `users` store). Verified in tests/accounts.test.mjs (3 tests: registration contract, salted-hash round-trip incl. wrong-password and malformed-hash rejection, credential-leak pin on `publicUser`) — suite **444 pass**, typecheck clean.)
  - [x] **AV-101b** — Registration UI slice. (Self-contained `AccountsCard` on Settings.tsx (deliberately outside the page's draft/save machinery): "Open registration" checkbox toggling `registrationOpen` via `saveSettings` (toast on success/failure) and — when open — a create-account form (username/display name/password → `api.register`, inline error surfacing, field resets on success). `api.registrationStatus()`/`api.register()` client methods + `RegistrationStatus`/`RegisteredUser` types + `AppSettings.registrationOpen`. Verified: suite **444 pass** (the server contract is pinned by tests/accounts.test.mjs; UI verified by typecheck + build — the real gates). Two mid-run fixes documented: `toast` is a `useToast()` hook (AccountsCard needed its own), and `AppSettings` was missing the `registrationOpen` field.)*
- [x] **AV-102** — Add secure sign-in and sign-out flows. *(Both slices complete.)*
  - [x] **AV-102a** — Sign-in/out server slice. (`server/sessions.mjs` pure: `createSessionToken` (32 random bytes hex), `hashToken` (sha256 — **only the hash is stored server-side**, so a leaked kv store cannot grant sessions), `sessionRecord`/`isSessionValid` (30-day TTL, expiry + malformed-record rejection), `readCookie` (no new deps). Routes: `POST /api/auth/login` (case-insensitive lookup + `verifyPassword`; **generic 401 "Invalid username or password"** — no user enumeration; raw token only in an httpOnly `sameSite=lax` cookie; kv `session:<sha256>` store), `POST /api/auth/logout` (removes record + clears cookie), `GET /api/auth/me` (`{user: publicUser|null}`, prunes expired sessions). Verified in tests/sessions.test.mjs (3 tests: token entropy + hash-is-not-token pin, expiry semantics incl. boundary/malformed, cookie parsing) — suite **447 pass**, typecheck clean.)
  - [x] **AV-102b** — Sign-in UI slice. (AccountsCard on Settings.tsx gained an auth block: `api.me()`-driven state on mount (account-less `catch → null`), a sign-in form (username/password → `api.login`, generic error surfacing matching the server's no-enumeration message, fields cleared on success), and a sign-out control (→ `api.logout`, `LogOut` affordance). `api.login/logout/me` client methods added. Verified: suite **447 pass** (session contract pinned by tests/sessions.test.mjs; UI verified by typecheck + build — the real gates). Judgment call recorded: auth state lives inside AccountsCard (bounded) rather than a global `useAuth`/header indicator — revisit when AV-103+ needs auth state elsewhere.)*
- [x] **AV-103** — Add email verification for installations that enable email accounts. *(Both slices complete.)*
  - [x] **AV-103a** — Email verification server slice. (New `server/tokens.mjs` — **shared primitive for AV-104's password reset**: `createToken`/`hashToken` (32 random bytes, **sha256-only storage**), `issueToken(purpose, subject, {ttlMs})` → `{raw, record}`, `isTokenValid` (single-use via `usedAt`, expiry, purpose/subject binding). New `server/mail.mjs` — **console transport seam** (scope decision: self-hosted installs can't assume SMTP; verification/reset flows depend only on `sendMail`) + `verificationMessage`. `normalizeEmail` + `requireEmail` mode in `normalizeRegistration` (email optional by default, required when the new whitelisted `emailAccounts` setting is on; lowercased, ≤254, case-insensitive 409 on duplicates). Registration stores `email`/`emailVerified: false` and issues a 24h verification token when email accounts are enabled. `POST /api/auth/verify-email` consumes the token (single-use marked) → `emailVerified: true`, generic 400 for invalid/expired/used. Verified in tests/tokens.test.mjs (3: hash-only storage pin, issue contract incl. throw cases, single-use/expiry/purpose/subject semantics — one test bug fixed mid-run: assertions missing `now: 1_000` passed for the wrong reason) + tests/accounts.test.mjs email contract (4 cases) — suite **452 pass**, typecheck clean.)
  - [x] **AV-103b** — Email verification UI slice. (AccountsCard: "Email accounts (require + verify email)" checkbox (→ `saveSettings({emailAccounts})`), email input in the registration form (required/optional placeholder reflects the setting, ≤254), and an "Email verified" badge on the signed-in user. `publicUser` now exposes `emailVerified: boolean` (leak pin updated: the email *address* itself is never public). App-level `VerifyEmailHandler` in App.tsx (inside `ToastProvider`) consumes `?verify-email=<token>` links from mail.mjs on any route → `api.verifyEmail` + toast + URL cleanup. `api.verifyEmail` + `AppSettings.emailAccounts`/`RegisteredUser.emailVerified` types. Verified: suite **452 pass** (publicUser contract updated), typecheck + build clean. One mid-run note: a parallel-edit write collision dropped the register-payload edit — re-applied sequentially and confirmed by typecheck.)*
- [x] **AV-104** — Add password reset with single-use expiring tokens. *(Both slices complete.)*
  - [x] **AV-104a** — Password reset server slice. (Reuses the AV-103a `tokens.mjs` primitive with purpose `'password-reset'` and a 1h TTL. New pure helpers in accounts.mjs: `findUserByIdentifier(users, identifier)` (case-insensitive username **or** email lookup — ids deliberately not matched) and `setPassword(user, password, {saltHex})` (new salt + hash, never plaintext). `resetMessage` in mail.mjs. Routes: `POST /api/auth/request-reset` (**always-generic `{ok:true}` response — no account enumeration**; issues + mails the token only when the account has a stored email — accounts without email have no reset path, mail is the delivery channel) and `POST /api/auth/reset-password` (consumes the single-use token, 8-200 password rule, rehashes credentials, and **drops every session of the account** — a reset implies compromise). Verified in tests/accounts.test.mjs (lookup + replacement cases incl. old-password rejection) and tests/mail.test.mjs (message contracts, tokens never cross messages) — suite **454 pass**, typecheck clean.)
  - [x] **AV-104b** — Password reset UI slice. (AccountsCard "Forgot password" block (shown when signed out): identifier input → `api.requestReset` with the always-generic success toast ("If that account has an email, a reset token was sent" — matches the no-enumeration server contract), plus a token-paste reset form (reset token + new password → `api.resetPassword` with inline errors; fields cleared on success). `api.requestReset`/`api.resetPassword` client methods. Judgment call recorded: the flow is **token-paste based** (no `?reset-password=` URL handler) because `resetMessage` delivers the token as text without a link — deployment-URL-independent and consistent with the mail seam. Verified: suite **454 pass** (server contract pinned by AV-104a tests), typecheck + build clean.)*
- [ ] **AV-105** — Add passkey authentication support. *(Split into slices.)*
  - [x] **AV-105a** — WebAuthn data layer. (`server/passkeys.mjs` pure, zero new deps (node:crypto only). Scope decisions recorded in the module header: **ES256/P-256 only** (the common authenticator algorithm; EdDSA/RS256 out of scope) and **challenges stored in the clear** (single-use 2-minute TTL — unlike session/reset tokens they are not bearer secrets: useless without an authenticator signing over them). Primitives: `createChallenge` (base64url, 32 bytes) + `challengeRecord`/`isChallengeValid`; `parseClientData`/`validateClientData` (ceremony type + challenge echo + origin check); `parseAuthenticatorData` (rpIdHash/flags/counter + attested-credential shape with credentialId + COSE key); minimal CBOR reader + `coseEs256ToSpki` (COSE ES256 → SPKI DER, non-EC2/alg≠-7/non-P-256 rejected); `verifyAssertionSignature` (ES256 over `authData || sha256(clientDataJSON)`, DER signatures); `validateRpIdHash`. Verified in tests/passkeys.test.mjs (5 tests) with **real generated P-256 keypairs** — hand-assembled COSE fixture, SPKI round-trip equality against the generated JWK, real sign/verify + tampered-clientData and garbage-signature rejection. Suite **460 pass**, typecheck clean. One mid-run fix: `require()` snuck into the ESM test — replaced with ESM imports.)
  - [x] **AV-105b** — Passkey routes. (`server/passkeyAuth.mjs` — single-use purpose-bound challenges (2-min TTL, consumed even on failure), `registerPasskey` (attestation fmt **'none' only** — scope decision in module header: ceremony verification (challenge+origin+rpIdHash+UP) is done; cert-chain attestation adds nothing for consumer auth), `authenticatePasskey` (ES256 assertion via the data layer + **counter backstop per WebAuthn §6.1.2**: reject `new <= stored` except the 0→0 no-counter case — stricter+spec-correct vs the TODO draft, decision recorded), `listPasskeys`/`removePasskey` (owner-scoped). `server/passkeys.mjs` extended: CBOR major-3 text support + `parseAttestationObject`. Routes in index.mjs: `POST /api/auth/passkey/challenge` (session-bound for register), `POST .../register`, `POST .../authenticate` (session issuance like login), `GET /api/auth/passkey`, `DELETE /api/auth/passkey/:credentialId`; rpId/origin derived per-request from the host the browser enforces. tests/passkey-auth.test.mjs (5): real P-256 round trip + replay rejection, single-use/purpose/expiry pins, foreign-rpId/wrong-origin/duplicate/packed-attestation rejections, counter backstop (0→0 twice accepted, non-increasing rejected), owner-scoped list/remove. Suite **503 pass**, typecheck + build clean. Two mid-run fixes: `validateRpIdHash`/`verifyAssertionSignature` return raw booleans (not `{ok}`) and one test regex matched the consumed-challenge error path.)*
  - [x] **AV-105c** — Passkey UI. (`src/lib/passkeys.ts` — `navigator.credentials` ceremonies (create/get) marshalling exactly the server's scope (ES256 -7, 'none' attestation, rpId = location.hostname matching the routes' per-request rpId), `passkeysSupported()` guard. `src/lib/api.ts` passkey endpoints + `PasskeyCredential` type. Settings.tsx account area: "Register a passkey" (named) + passkey list with owner-remove in the signed-in block, "Sign in with a passkey" in the sign-in block — both feature-gated. **Verified:** typecheck (`tsc --noEmit`) clean, `npm run build` clean, suite **503 pass** (server side unchanged). **Pending (unverifiable in sandbox):** live browser ceremony against a real authenticator — the flows follow the WebAuthn API contract but have not been exercised in a browser with hardware/platform authenticators. One mid-run fix: TS `Uint8Array<ArrayBufferLike>` vs `BufferSource` — `b64urlToBuf` returns `ArrayBuffer`.)
- [x] **AV-106** — Add optional two-factor authentication. *(Both slices complete.)*
  - [x] **AV-106a** — TOTP core + routes. (`server/totp.mjs` pure, node:crypto only: RFC 4648 base32, HMAC-SHA1 HOTP/TOTP (RFC 6238, 6 digits/30 s/SHA-1 interoperable defaults), `verifyTotp` with ±1-step drift + `timingSafeEqual`, `otpauthUrl` provisioning URI. `server/twoFactor.mjs` policy: enrollment state machine (`twoFactorSecret` set → `twoFactorEnabled` only after a confirmed code; disable requires a valid code and discards the secret), `verifyTwoFactor` login gate. Scope decisions in module headers: **TOTP only** (no SMS/email 2FA — no SMS provider; email is verification/reset only) and **passkeys are not additionally challenged** (already possession+UV). Routes: `GET /api/auth/2fa` status, `POST /api/auth/2fa/setup` (returns secret+otpauthUrl once), `POST /api/auth/2fa/enable`, `POST /api/auth/2fa/disable` (all session-gated; secret never in `publicUser`); `/api/auth/login` now requires `code` when enabled. tests/two-factor.test.mjs (4): **real RFC 6238 vectors** (T=59→94287082 … T=20000000000→65353130), drift-window behavior, full state machine pins (setup alone does not enforce; wrong codes never enable/disable), otpauthUrl shape. Suite **507 pass**, typecheck + node --check clean. One mid-run test fix (URL-encoded label colon).)*
  - [x] **AV-106b** — 2FA UI. (`api.twoFactorStatus/Setup/Enable/Disable` client methods. Settings account area "Two-factor authentication" section: status line, "Set up 2FA" → shows the base32 secret + `otpauth://` link + 6-digit code confirm ("Enable"), "Disable" requires a valid code (possession proof). Feature-gated nothing — TOTP needs no browser support. **Verified:** `tsc --noEmit` clean, `npm run build` clean, suite **507 pass** (server unchanged this slice). **Pending (unverifiable in sandbox):** live enrollment with a real authenticator app.)*
- [x] **AV-107** — Add recovery codes for account recovery. *(Both slices complete.)*
  - [x] **AV-107a** — Recovery codes core + routes. (`server/recoveryCodes.mjs` pure, node:crypto only: 10 × **80-bit** base32 codes `XXXX-XXXX-XXXX-XXXX`, **stored sha256-hashed** (plaintext returned exactly once — same no-recoverable-copy rule as session/reset tokens), single-use consumption (constant-time hash compare), `issueRecoveryCodes` regenerates and invalidates all previous codes, `recoveryCodesStatus` returns counts only. Scope decisions in header: codes are a **2FA backup factor** (the login gate consults them only when `twoFactorEnabled`; they never replace the password). `verifyTwoFactor` (twoFactor.mjs) accepts a TOTP code OR an unused recovery code (16-char normalized shape gate keeps the failure messages distinct). Routes: `GET /api/auth/recovery-codes` (status), `POST /api/auth/recovery-codes` (regenerate + return plaintext once) — both session-gated. tests/recovery-codes.test.mjs (3): shape/uniqueness/hashed-storage pins, single-use + regeneration-invalidates, login-gate backup path (TOTP and recovery both work; reuse and wrong codes rejected; 6-digit failures stay 'Invalid two-factor code'). Suite **510 pass**, typecheck + node --check clean.)*
  - [x] **AV-107b** — Recovery codes UI. (`api.recoveryCodesStatus/regenerateRecoveryCodes` client methods. Settings "Recovery codes" section: remaining-count line ("X of N codes remaining"), generate/regenerate with a confirm dialog (regeneration invalidates previous codes), one-time plaintext grid (select-all) + "Copy" to clipboard + amber store-safely warning; plaintext state cleared on user change. **Verified:** `tsc --noEmit` clean, `npm run build` clean, suite **510 pass** (server unchanged this slice). **Pending (unverifiable in sandbox):** live clipboard/copy interaction in a browser.)*
- [x] **AV-108** — Add user profile avatars with safe image validation. *(Both slices complete.)*
  - [x] **AV-108a** — Avatar validation core + routes. (`server/avatars.mjs` pure: **bytes trusted only after sniffing** (client Content-Type ignored) — PNG/JPEG/GIF only (scope decision: WebP excluded to keep dimension parsers minimal; these three render everywhere), 512 KiB cap, **dimension extraction from real headers + ≤4096px cap** (PNG IHDR / JPEG SOF walk / GIF header; bombs rejected), `avatarFileName` sanitizes userId/ext against path traversal. Storage on **disk** under `data/avatars/` (kv caps values at 64 KB — documented reason), written with `atomicWriteFile`, old-ext variants removed on replace. Routes: `POST /api/auth/avatar` (session; raw-stream read with cap — added to the jsonParser skip list), `GET /api/auth/avatar/:userId` (public; served ONLY as the sniffed image Content-Type + 1h cache), `DELETE /api/auth/avatar` (session). tests/avatars.test.mjs (3): real minimal PNG/JPEG/GIF fixtures (CRC-valid PNG chunks) sniffed with correct dimensions; HTML/SVG/short/truncated/oversize/bomb rejections; traversal-proof filenames. Suite **513 pass**, typecheck + node --check clean.)*
  - [x] **AV-108b** — Avatar UI. (`api.uploadAvatar` (raw-bytes POST; server sniffs) + `api.removeAvatar`. Settings "Profile picture" section: round avatar via `GET /api/auth/avatar/:id` with cache-bust query + `onError` fallback to an initial-letter circle, hidden file input (accept PNG/JPEG/GIF) with client-side 512 KB pre-check, Remove button, format/size guidance. **Verified:** `tsc --noEmit` clean, `npm run build` clean, suite **513 pass** (server unchanged this slice). **Pending (unverifiable in sandbox):** live browser upload/crop interaction.)*
- [x] **AV-109** — Add display names separate from login identifiers. (Reconciliation: already implemented by AV-101a's account model — `username` (charset-restricted login identity, case-insensitively unique) and `displayName` (optional free-form ≤48, cosmetic) are distinct fields through `normalizeRegistration` → user record → `publicUser` → UI (AccountsCard shows `displayName || username`). The separation contract is now explicitly pinned by tests/accounts.test.mjs ("display names are cosmetic and separate from login identifiers"): display names accept spaces that usernames reject, a username-shaped display name is not a valid login identifier, and a display name may imitate another name without touching identity. Suite **448 pass**, typecheck clean. Interpretation recorded: the requirement reads as "display names exist, separate from login identifiers" — profile *editing* of display names is not covered and is left to the profile work in AV-110's neighborhood if needed.)*
- [x] **AV-110** — Add user profile bios with length and content limits. (Ordering decision recorded: taken before AV-105–108 because passkeys/2FA/recovery-codes/avatars are heavy multi-turn slices and this one is narrow and finishable; AV-105–108 remain queued in order.) Pure `normalizeBio` (accounts.mjs): ≤500 chars **truncated not rejected** (note-precedent judgment call), control characters rejected (tabs/newlines allowed), empty → `null`. `publicUser` exposes `bio` (public profile content). `PUT /api/auth/profile` — session-authenticated (401 without a valid session), 400 contract errors, persists to the kv user record. UI: profile-bio textarea + save in the AccountsCard signed-in block (dirty-state guarded). `api.updateProfile` + `RegisteredUser.bio`. Verified in tests/accounts.test.mjs ("bios have length and content limits": truncation, newline allowance, control-char rejection, publicUser exposure) — suite **455 pass**, typecheck + build clean. One mid-run fix documented: the bio block broke the ternary JSX parent rule (TS2657) — wrapped the signed-in branch in a fragment.)*
- [x] **AV-111** — Add profile privacy settings for public, private, or link-only visibility. *(Both slices complete.)*
  - [x] **AV-111a** — Privacy policy + routes. (`server/profilePrivacy.mjs` pure: `normalizeProfileVisibility` (strict values; **default 'public'** — scope decision: AV-111 must not change what existing accounts expose unless opted in), `canViewProfile` matrix (owner always; public anyone; private owner-only — a link token does NOT bypass private; link-only needs the exact token, constant-time compare; accounts without the field stay public), `getOrCreateProfileLink`/`rotateProfileLink` (shareable slug for profile visibility only — grants no account powers, view exposes only `publicUser` fields, so stored plainly per the challenge-token precedent; rotation revokes old links). Routes: `PUT /api/auth/profile-visibility`, `GET /api/auth/profile-link`, `POST /api/auth/profile-link/rotate` (session), `GET /api/profile/:userId` (optional session + `?token=`; non-viewable answers a generic **404 — no existence oracle**). tests/profile-privacy.test.mjs (3): normalization pins, full decision matrix (private resists token bypass; near-miss tokens fail), link create-stable/rotate-revokes. Suite **516 pass**, typecheck + node --check clean.)*
  - [x] **AV-111b** — Privacy UI. (`api.profileSettings/setProfileVisibility/rotateProfileLink/viewProfile` client methods (server: `GET /api/auth/profile-link` now also returns `visibility` — one-line addition). Settings "Profile visibility" section: select (public/link-only/private with plain-language descriptions), link-only shows Copy profile link + Rotate link (old links die on rotate). New `src/pages/ProfilePage.tsx` at `/profile/:userId` (lazy + routePrefetch entry) rendering `GET /api/profile/:id` (with `?token=`): avatar (initial fallback), display name, @username, bio, visibility badge; generic "Profile not found" for non-viewable. **Verified:** `tsc --noEmit` clean, `npm run build` clean (34 chunks), suite **516 pass**. **Pending (unverifiable in sandbox):** live cross-browser link sharing/copy.)*
- [x] **AV-112** — Add per-user preferred language and locale. (`server/userPreferences.mjs` pure: `normalizePreferredLanguage`/`normalizeLocale` — BCP-47-shaped pattern (2-3 letter language + subtags, `_`→`-`, lowercased, ≤20 chars, empty clears to `null`; pattern NOT a fixed allowlist so regional variants like 'zh-Hant' aren't wrongly rejected), `normalizePreferencesUpdate` (strict partial updates — one invalid field rejects all). Scope decision in header: **stored preference only** — no i18n layer exists; values are exposed for display choices and future i18n work (nothing auto-translates). Routes `GET/PUT /api/auth/preferences` (session; PUT persists to the user record). UI: Settings "Language & locale" (two tagged inputs + Save, honest note that the UI is not translated). tests/user-preferences.test.mjs (2): accept/normalize/reject pins (incl. `<script>`, `en;drop`, over-length), partial-update semantics. Suite **518 pass**, typecheck + node --check + build clean. One mid-run fix: `Globe` icon import.)*
- [x] **AV-113** — Add per-user default subtitle and audio preferences. (Extended AV-112's `server/userPreferences.mjs` + the same `GET/PUT /api/auth/preferences` route (per handoff — no parallel surface): `normalizeDefaultSubtitle` (language tag **or the sentinel `off`** = "no subtitles by default"; empty clears to null), `normalizeDefaultAudio` (language tag | null), `normalizePreferencesUpdate` now strictly validates all four fields (one invalid field rejects the update; unknown keys ignored). Scope decision in header: **stored defaults only** — consumed by player/download flows in later wiring; AV-113 = storage + editing. UI: Settings preferences section gains subtitle + audio inputs ("Subtitles (en, or off)" / "Audio language"), shared Save. tests/user-preferences.test.mjs extended (subtitle sentinel pins incl. 'offside' rejected as neither sentinel nor tag, injection-shaped rejects, strict partial updates). Suite **519 pass**, typecheck + node --check + build clean.)*
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

- [ ] **AV-126** — Add separate Watching, Planned, Completed, Paused, and Dropped lists.
- [ ] **AV-127** — Add custom user-created lists with names and descriptions.
- [ ] **AV-128** — Add drag-and-drop ordering for custom lists.
- [ ] **AV-129** — Add list cover artwork assembled from selected titles.
- [ ] **AV-130** — Add private, shared-link, and public list visibility settings.
- [ ] **AV-131** — Add notes on individual list entries.
- [ ] **AV-132** — Add list-entry priority and personal rating fields.
- [ ] **AV-133** — Add list grouping by franchise, genre, or season.
- [ ] **AV-134** — Add bulk move between personal lists.
- [ ] **AV-135** — Add bulk removal with an undo window.
- [ ] **AV-136** — Add smart lists driven by saved filter rules.
- [ ] **AV-137** — Add a list for anime with new episodes available.
- [ ] **AV-138** — Add a list for shows returning in a future season.
- [ ] **AV-139** — Add a list for unfinished shows with no recent progress.
- [ ] **AV-140** — Add watchlist capacity warnings that users can disable.
- [ ] **AV-141** — Add duplicate prevention across the same list.
- [ ] **AV-142** — Add list import from supported external list formats.
- [ ] **AV-143** — Add list export to JSON and CSV.
- [ ] **AV-144** — Add list comparison between two profiles.
- [ ] **AV-145** — Add list templates such as weekend watchlist or short anime queue.
- [ ] **AV-146** — Add a random pick action limited to the current list.
- [ ] **AV-147** — Add list-level sort and filter presets.
- [ ] **AV-148** — Add list activity history for shared lists.
- [ ] **AV-149** — Add list ownership transfer for shared household lists.
- [ ] **AV-150** — Add a bookmark-to-list migration tool preserving existing bookmark IDs.

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
- [ ] **AV-177** — Add a player error screen with understandable recovery actions.
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

- [ ] **AV-226** — Support WebVTT, SRT, ASS, and SSA with explicit compatibility reporting.
- [ ] **AV-227** — Add subtitle track discovery for local media sidecar files.
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
- [ ] **AV-277** — Add a manual quality selector with actual source-available options.
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
- [ ] **AV-294** — Add HTTP range edge-case tests for local playback.
- [ ] **AV-295** — Add correct content-type and content-length handling for media responses.
- [ ] **AV-296** — Add configurable buffering targets within browser capabilities.
- [ ] **AV-297** — Add an optional prefetch of the next authorized episode metadata.
- [ ] **AV-298** — Add an adaptive connection strategy for mobile networks.
- [ ] **AV-299** — Add a stream fallback decision log visible to administrators.
- [ ] **AV-300** — Add a provider-neutral playback session interface.

### 13 · Download manager and offline preparation · P1 / P2

Build on the persistent queue with scheduling, integrity, and user control.

- [ ] **AV-301** — Add per-job estimated completion time when enough data exists.
- [ ] **AV-302** — Add per-job average transfer speed.
- [ ] **AV-303** — Add per-job transferred bytes and total expected bytes.
- [ ] **AV-304** — Add queue filtering by status, anime, quality, and date.
- [ ] **AV-305** — Add queue sorting by priority, creation time, or series.
- [ ] **AV-306** — Add user-defined priorities for individual download jobs.
- [ ] **AV-307** — Add a priority boost for the next episode in Continue Watching.
- [ ] **AV-308** — Add download scheduling by day and time window.
- [ ] **AV-309** — Add bandwidth limits for background downloads.
- [ ] **AV-310** — Add a pause-all and resume-all control.
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
- [ ] **AV-339** — Add library folder validation before changing paths.
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

- [x] **AV-476** — Add a light theme in addition to the current dark presentation. (`/api/settings` returns `theme` and `systemTheme`; Settings page includes theme selector; server persists `theme` and `systemTheme` in `data/settings.json`.)
- [x] **AV-477** — Add a system-theme setting that follows the operating system. (Settings page includes "Follow system theme" checkbox; stored in settings and persisted across restarts.)
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
- [ ] **AV-552** — Add an automated security-header regression test suite.
- [ ] **AV-553** — Add CSRF tests for every state-changing API endpoint.
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
- [ ] **AV-593** — Add crash-safe atomic writes for every persistent JSON record.
- [ ] **AV-594** — Add process health and readiness checks.
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

- [ ] **AV-701** — Add a unit-test framework and baseline coverage report.
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
- [ ] **AV-721** — Add TypeScript strictness checks and eliminate unsafe implicit types.
- [ ] **AV-722** — Add linting and formatting checks in continuous integration.
- [ ] **AV-723** — Add dependency lockfile and reproducible-build checks.
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

---

## Addendum — relationship detection fix (user-requested, 2026-11-19)

- [ ] **AV-116** — Fix anime relationship detection using online verification. *(Split — core verified pipeline complete; wiring pending.)*
  - [x] **AV-116a** — Verified relationship detection core. (`server/relations.mjs` pure, zero deps. **Title similarity is never decisive** — recorded only as a hint; verdicts come from official relation metadata (AniList/MAL/Kitsu edges), otherwise `uncertain`. Canonical taxonomy: same-entry, split-cour, next-season, prequel, sequel, ova, ona, movie, spin-off, special, side-story, parent-story, alternative-version, remake, reboot, compilation, summary, adaptation, source, character, other, unrelated, unknown. `classifyEdge` (AniList vocabulary + format refinement; bonus shorts → special), `relativeKind` (mirrored SEQUEL/PREQUEL inversion), `isSplitCourPair`/`stripPartMarkers` (official titles incl. 第Nクール — metadata, never filenames), `verifyRelationship` 5-rule pair engine: same-db-id → same-entry; direct/mirrored edges → verified type (generic parent/other edges confirm hierarchy, genuine disagreement → conflicting+uncertain); shared-anchor / verified-franchise-graph → indirect typed verdicts; no evidence → uncertain (looked-up negatives → evidence-based 'unrelated'). Record: type, confidence, source, sourceIds, verification, uncertain, reasons, checkedAt. **tests/relations.test.mjs (6) regresses the user's examples with REAL online-verified metadata** (collected 2026-11: anilist.co/manga/86355 lists Clayman REVENGE as "Spin Off"; AniList 116742 = S2 Part 2; MAL 37430/51309; Slime Diaries = spin-off; SUNSHINE in the SLIME = 2-ep crossover ONA "Other"; Sukuwareru Ramiris = MAL "Other" bonus; "4th Season Part 3" = real AniList TV season): S1↔S2P2 next-season (indirect), S2↔S2P2 split-cour, 4th-Season-Part-3 = season NOT spin-off, Clayman/Diaries = spin-off, Ramiris/Sunshine = special, Guren = movie, Killing-Slimes-300-Years ("Slime" in title) = unrelated, Re:ZERO dash-variant = same-entry duplicates, conflicting/missing metadata = uncertain. 3 mid-run bugs fixed & documented: bogus movie fixture, `\b` cannot anchor CJK part-markers, PARENT edges are hierarchy inverses not contradictions.)
  - [x] **AV-116b** — Online verification pipeline. (`server/relationsOnline.mjs`: `verifyPairOnline(entryA, entryB, {lookup, cache, fresh})` — injected `lookup` (AniList GraphQL client at runtime; fakes in tests → offline suite), per-entry + per-pair caching (order-independent pair keys, alias-stable title fallbacks), verified verdicts cached 7d vs uncertain/failures 1h, rate limits/timeouts/outages degrade to `uncertain` with the failure in `reasons` — never a guess. tests/relations-online.test.mjs (4): no repeat fetching incl. reversed order, failure→uncertain, failure TTL expiry, cache-key preference. Suite **470 pass**.)
  - [ ] **AV-116c** — Detector wiring. *(Superseded-in-part by AV-117 below — wiring now happens through the metadata registry. Still required: the AniList GraphQL relations lookup export, role/franchiseKey derivation, feeding `buildFranchiseGroups`/`relatedSeasons` from verified relationships, kv relationship store. `matchesFranchise` stays a SEARCH filter only.)*

## Addendum — metadata aggregation rebuild (user-requested, 2026-11-19)

- [ ] **AV-117** — Multi-source anime metadata system (11-phase program). *(Incremental slices below.)*
  - [x] **AV-117a** — Phase 1 audit + Phase 2 source research + docs. (**docs/ANIME_METADATA_SOURCES.md**: full inventory of what exists — AniList GraphQL is the SOLE anime metadata provider; IMDb/cinemeta = artwork (unofficial endpoints, flagged), hianime = streams, `library.mjs inferSeriesAndSeason` = filename inference (Phase 8 target), AniDB referenced only as external links; 6 audit findings on where wrong metadata wins today. Plus verified research for all 9 sources with citations: AniList 90 rpm; MAL v2 OAuth2/`X-MAL-Client-ID` + registered client; Kitsu JSON:API keyless public reads + `mappings` cross-IDs; AniDB registered clients, XML/UDP, ≤1 req/2s + day caching, ban policy (never scrape); ANN `cdn.animenewsnetwork.com/encyclopedia/api.xml` no auth but **1 req/s mandatory + attribution**; TMDB key + 40/10s + attribution (non-commercial); TVmaze keyless ~20/10s (supplementary only); IMDb official access restricted (datasets/Enterprise) — current unofficial endpoints documented as risk, never a relation authority; Wikidata cross-ID hub. Decision table: 7 adapters planned (AniList primary, MAL/Kitsu secondary, AniDB/ANN/TMDB/Wikidata optional), TVmaze deferred.) **docs/ANIME_METADATA_ARCHITECTURE.md** (provider interface, unified model, identity ladder, field priorities, graph, caching) + **docs/ANIME_RELATIONSHIPS.md** (type taxonomy, normalization, confidence, conflict resolution).)
  - [x] **AV-117b** — Phases 3–5 core. (`server/metadata/model.mjs`: unified model (`normalizeUnifiedAnime` — missing stays unknown, nothing invented) + `mergeField` provenance merge (**verified values are never overwritten by unverified/conflicting ones; disagreements retained in provenance** — the Phase 4 rule, tested) + `flagEpisodeDiscrepancy`. `server/metadata/identity.mjs`: 4-rung identity ladder (exact external IDs → verified cross-DB mappings → alias-titles+year+format → studios+window+format; title similarity NEVER concludes identity — Slime×KillingSlimes regression pin) + `isDuplicateEntry` (same record, different displayed titles — Re:ZERO dash variant) + franchise-of kept separate from identity. `titleAliasKeys` extended to the nested `titles{}` shape. tests/metadata-core.test.mjs (6). Suite **476 pass**.)
  - [x] **AV-117c** — Provider adapters (Phase 3/7). *(Both slices complete.)*
    - [x] **AV-117c1** — Transport + registry + AniList adapter. (`server/metadata/transport.mjs`: shared `createTransport` — per-source pacing (serialized calls honor `minIntervalMs`), response caching (`fresh` bypass, per-request TTL override for AniDB-style day caches), responsible retries (max 2, exponential backoff, **429 Retry-After honored**, 5xx retryable, network/timeout → surfaced error), 15s AbortSignal timeout. `server/metadata/registry.mjs`: adapter registry + `PROVIDER_LIMITS` encoding the researched rate limits (AniList 667ms/90rpm, MAL 600ms conservative, Kitsu 1s fair-use, AniDB 2s+24h cache, ANN 1s mandatory, TMDB 250ms/40-per-10s, Wikidata 1s). `server/metadata/providers/anilist.mjs`: pure `toUnified` (Media → unified model incl. external-ID extraction from externalLinks — never invents fields), `toRelationEdges` (raw `providerType` preserved + `normalizedType` via relations.mjs), `deriveFranchise` (parent→branch, prequel→season, else main), `lookupEvidence` (injected `gql` — the AV-116b evidence shape). tests/metadata-transport.test.mjs (6): caching/fresh, retry+Retry-After+exhaustion, pacing, registry, mapping purity, evidence lookup. Suite **482 pass**, typecheck clean. One mid-run test bug: asserted top-level `endDate` instead of `release.endDate`.)
    - [ ] **AV-117c2** — Secondary adapters. *(Split.)*
      - [x] **AV-117c2a** — Kitsu + Wikidata (the identity-critical two). (Kitsu adapter: JSON:API → unified (`toUnified` — never invents fields), `mappingsToExternalIds` (**websites are never identity evidence** — only mal/anilist/anidb/tvdb sites promote), `toEvidence`, JSON:API-convention URL builders (`filter[text]`, `filter[externalSite]`), transport-backed `lookupEvidence` (MAL id → Kitsu id via the mappings table = identity rung 2). Wikidata adapter: cross-ID SPARQL resolution with **CONFIGURED property ids — only verified ones ship (P345 IMDb, P4086 MAL); unverified AniList/AniDB properties are `null` and omitted from queries, never invented**; `buildCrossIdQuery`/`bindingsToResult`/`lookupEvidence`. tests/metadata-adapters.test.mjs (4) over canned JSON:API/SPARQL payloads. Suite **486 pass**, typecheck clean.)
      - [x] **AV-117c2b** — MAL, AniDB, ANN, TMDB adapters. (MAL: REST v2 by-id lookup (opt-in `X-MAL-Client-ID`, never search-for-identity), MAL snake_case relation vocab translated for `classifyEdge` with **raw `providerType` preserved** (`full_story`→OTHER documented), romaji stays unknown (MAL lacks the field). AniDB: opt-in registered client (`httpapi` request=anime), purpose-built XML extractor (documented shape limits), **day-cache TTL per the ban policy**, website scraping out of the question. ANN: api.xml vintage/episodes/staff cross-check with `ATTRIBUTION` constant (1 rps enforced by PROVIDER_LIMITS) — documented limitation: no relation graph claimed. TMDB: opt-in key, movie/tv mapping + `belongs_to_collection` franchise keys + `external_ids` cross-ids (imdb/tvdb) + `ATTRIBUTION` — the licensed artwork path toward replacing the unofficial IMDb endpoints. tests/metadata-adapters2.test.mjs (4). Suite **490 pass**, typecheck clean. One mid-run bug fixed: anidb `lookupEvidence` returned raw edges instead of the evidence shape (`relationType`).)*
  - [x] **AV-117d** — Phase 6/8 wiring. *(Both slices complete.)*
    - [x] **AV-117d1** — Verified typing into grouping + seasons + registry wiring. (relations.mjs `continuationKind` (sequel edges → `next-season`/`split-cour` from official titles, prequel/branch kinds pass through). anilist.mjs `relatedSeasons` entries now carry `kind` (split-cour vs next-season vs prequel) + `mediaEvidence(input)` export wiring the adapter to the quota-managed cached gql client. explore.mjs `buildFranchiseGroups`: edges union on **verified kinds** (spin-offs/side-stories now join their franchise instead of being "unrelated"; OTHER/CHARACTER/ADAPTATION/SOURCE e.g. crossovers deliberately do NOT union), every member annotated `relationKind` (earliest main-line member = 'main' head), and groups partitioned into `seasons` + `branches` — **a franchise group is never presented as one season list** (existing fields preserved for the Discover UI). tests/franchise-groups.test.mjs (2): Slime partition pin (S1/S2/S2P2 = seasons, Diaries = branch spin-off, OTHER crossover not unioned) + continuationKind annotations. Suite **492 pass**, typecheck clean. Two mid-run test pins fixed (anchor-kind rule; lexicographic sort).)*
    - [x] **AV-117d2** — Library matching + relationship store. (`server/metadata/libraryMatch.mjs` pure: `candidateKeys` (filename inference **generates candidates, never decides** — injected `infer`, identical lookup-key normalization to library.mjs), `matchLibraryEntry` (identity-ladder backed; title-only → kept separate with an explicit reason), `shouldCombineLocalEntries` (**true only for established identity — same-record/duplicate-entry; franchise membership or similar titles never merge**). `server/metadata/relationshipStore.mjs`: `mergeStoredRelationship` (verified never overwritten; disagreements retained as `conflicts`) + kv-backed `createRelationshipStore` with order-independent pair keys. Wired: library.mjs `listForAnime` title-key generation now delegates to `candidateKeys` (behavior-preserving). tests/library-match.test.mjs (3): candidate generation, franchise-never-merges pins (Re:ZERO duplicate vs title-only vs franchise sibling), store verified-survival + order-independent round-trip. Suite **495 pass**, typecheck clean. One mid-run test-stub bug fixed (`S\d+` never matches "Season 2").)*
  - [x] **AV-117e** — Phase 9/10: extended regression suite + docs + final report. (tests/metadata-regression.test.mjs (3): end-to-end pipeline (AniList adapter evidence → `verifyPairOnline` → relationship store) over the user's examples — S1↔S2P2 next-season, Clayman spin-off, Ramiris bonus-ONA (evidence-refinement nuance documented: MAL bonus cross-check refines to `special`, never a season), Re:ZERO duplicates, Killing-Slimes unrelated, store verified-survival. **docs/ANIME_METADATA_REPORT.md**: the 8-section final report (sources used/new/rejected, API capabilities+limits, files, tests, remaining problems, future improvements). docs/ANIME_METADATA_TESTING.md updated to the full suite table. Suite **498 pass**, typecheck + build clean.)
