# Continuation note — 2026-11-19

**Status:** branch `arena/c8881487-archtheserver-animebtw`; work remains
uncommitted. AV-008 through AV-015 are complete. Latest `npm run verify` passes
364 tests across 14 files, typecheck and production build clean. TODO.md records
83/800 checked, with 11 partial items still open. Live provider responses,
ffmpeg, browser E2E, and real upload/download I/O remain unavailable.

**Completed this turn: AV-015 — metadata schema versioning and migration support.**

`server/catalog.mjs`:
- Added `export const METADATA_SCHEMA_VERSION = 1`.
- `createAnimeRecord` stamps `metadataSchemaVersion: METADATA_SCHEMA_VERSION` on every record.
- New exported `migrateMetadataSchema(record)`: records at/above the current version are copied unchanged; missing/null/garbage versions are migrated. Migration adds a complete `fieldMetadata` entry for every `CATALOG_METADATA_FIELDS` field, infers missing `valueState`s from canonical values (via `normalizeFieldValueState`), backfills missing observation `valueState`s (via `backfillObservationValueState`), recomputes `conflict` when absent, bumps `metadataSchemaVersion`, and never mutates the input.

`server/store.mjs`:
- `sanitizeBookmarkMedia` now returns `migrateMetadataSchema(clean)`, so stored and imported bookmarks are upgraded to the current schema on load (covers store init, listStore init, and listImport).

`src/types.ts`: `Media` gains `metadataSchemaVersion?: number`.

`tests/catalog.test.mjs`: added tests for version stamping on new records, idempotent copy of current records, schemaless upgrades, field/observation state backfilling, bad-version handling, and non-mutation. Also updated the canonical-fields assertion to exclude `metadataSchemaVersion`.

**Honest gaps (not AV-015 scope, recorded for the next turn):**
- `migrateMetadataSchema` preserves an existing `conflict` flag when present rather than re-deriving it (full re-derivation would need the original selected source).
- No UI surface consumes `metadataSchemaVersion` yet.

**Next task:** AV-016 — Detect and merge duplicate anime records safely (candidate keys: normalized title, AniList/MAL/AniDB/IMDb identifiers in `server/identifiers.mjs`, plus a similarity threshold; merge strategy must keep bookmarks/lists intact).

Earlier uncommitted work includes AV-002 through AV-015 and existing changes in
`README.md`, `package.json`, `server/identifiers.mjs`, `server/index.mjs`,
`server/browse.mjs`, `server/detail.mjs`, `src/lib/api.ts`,
`src/pages/AnimeDetail.tsx`, `src/pages/Browse.tsx`, `src/pages/Search.tsx`,
and related tests. AV-013/AV-014 changed `server/catalog.mjs`,
`server/anilist.mjs`, `server/browse.mjs`, `server/detail.mjs`, `server/store.mjs`,
`src/types.ts`, `tests/catalog.test.mjs`, `tests/anilist.test.mjs`,
`tests/core-verification.test.mjs`, `tests/list-import.test.mjs`, `TODO.md`, and
this handoff. `package-lock.json` is unchanged.
