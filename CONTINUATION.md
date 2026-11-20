# Continuation note — 2026-11-19

**Status:** branch `arena/c8881487-archtheserver-animebtw`; working tree clean
except TODO.md/CONTINUATION.md edits (not yet committed). AV-008 through AV-018
are complete. Latest `npm run verify`: 406 tests across 15 files, typecheck and
production build clean. TODO.md records 86/800 checked, with 11 partial items
still open. Live provider responses, ffmpeg, browser E2E, and real
upload/download I/O remain unavailable.

**Completed this turn: AV-018 — add a metadata refresh policy per entity type.**

`src/types.ts`:
- Added `EntityType` (`'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special' | 'Other'`).
- Added `RefreshCategory` (`'identity' | 'airing' | 'score' | 'descriptive' | 'links'`).
- Added `FieldFreshness` (`'fresh' | 'stale' | 'never_refreshed' | 'unknown'`).
- Added `RefreshPolicyEntry` (`maxAgeMs`, `category`) and `RecordRefreshStatus` (`needsRefresh`, `staleFields`, `freshness`).

`server/catalog.mjs`:
- Groups `CATALOG_METADATA_FIELDS` into refresh categories: identity (title, cover, source, etc. — 30 days), airing (status, nextEpisode, startDate, etc. — TV 1h, movies 7d), score (score, providerScores — TV 6h, movie 1d), descriptive (description, genres, tags — 7d), links (links, streams — 30 days).
- Exports `entityTypeFromFormat(format)`, `fieldCategory(field)`, `refreshPolicy(entityType, field)`, `fieldFreshness(field, lastRefreshedAt, entityType, now)`, `isFieldStale(...)`, and `recordRefreshStatus(record, now)` which evaluates every field against its entity-type TTL and reports `needsRefresh`/`staleFields`/`freshness` without mutating the record.
- `fieldFreshness` handles null (`never_refreshed`), unparseable (`unknown`), numeric timestamps, and ISO strings.

`tests/refresh-policy.test.mjs`: covers format mapping (incl. case/separator normalization and Other fallback), field categories, per-entity TTLs, freshness boundaries (exactly-at-TTL is fresh), stale/never_refreshed/unknown states, and record-level assessment including non-mutation.

**Honest gaps (not AV-018 scope, recorded for the next turn):**
- `recordRefreshStatus` is not yet wired into any API route, store, or UI — no staleness indicators or automatic refresh triggers exist yet.
- `lastRefreshedAt` is not retained through `server/store.mjs` bookmark sanitization or `server/listStore.mjs`, so staleness is lost on bookmark round trips.

**Next task:** AV-019 — Expose a metadata freshness indicator on detail pages (consume `recordRefreshStatus` / `fieldFreshness` in the detail page UI to show stale/never-refreshed fields).

Earlier committed work: AV-002 through AV-018. Related files touched across the series:
`server/catalog.mjs`, `server/anilist.mjs`, `server/browse.mjs`, `server/detail.mjs`,
`server/store.mjs`, `server/identifiers.mjs`, `server/duplicateDetection.mjs`,
`src/types.ts`, `src/lib/api.ts`, `src/pages/AnimeDetail.tsx`, `src/pages/Browse.tsx`,
`src/pages/Search.tsx`, `tests/catalog.test.mjs`, `tests/anilist.test.mjs`,
`tests/core-verification.test.mjs`, `tests/list-import.test.mjs`,
`tests/duplicateDetection.test.mjs`, `tests/refresh-policy.test.mjs` (new),
`tests/identifiers.test.mjs`, `tests/metadata-provenance.test.mjs`, `TODO.md`,
`CONTINUATION.md`, `README.md`, `package.json`. `package-lock.json` is unchanged.
`data/` is gitignored.
