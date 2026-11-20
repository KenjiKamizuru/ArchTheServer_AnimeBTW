# Continuation note — 2026-11-19

**Status:** branch `arena/c8881487-archtheserver-animebtw`; work remains
uncommitted. AV-008 through AV-014 are complete. Latest `npm run verify` passes
359 tests across 14 files, typecheck and production build clean. TODO.md records
82/800 checked, with 11 partial items still open. Live provider responses,
ffmpeg, browser E2E, and real upload/download I/O remain unavailable.

**Completed this turn: AV-014 — represent unknown, unannounced, and not-applicable values separately.**

`server/catalog.mjs`:
- Added `FIELD_VALUE_STATES = ['known', 'unknown', 'unannounced', 'not_applicable']`.
- `normalizeFieldValueState(raw, field, value, record)`: infers `'unknown'` for null/blank/`'UNKNOWN'`/title-fallback canonical values, `'known'` otherwise; explicit provider states pass through except `'known'`, which cannot manufacture a known state for a missing value. Unknown strings fall back to inference.
- `normalizeObservations(raw, fallbackTime, field, record)`: each observation now carries `valueState` (inferred or explicit); stable tie ordering includes value state.
- `observationsConflict(field, record, selectedSource, observations, canonicalState)`: unknown states are excluded; comparable values are keyed by (state, value), so `unannounced`/`not_applicable` are distinct comparable states and only disagree with differing known values.
- `createFieldMetadata(input, record)`: every `CATALOG_METADATA_FIELDS` entry now emits `valueState` plus `source`, `lastRefreshedAt`, `observations`, `conflict`; per-field `valueState`/`source`/`lastRefreshedAt` from `input.fieldMetadata[field]` are honored.

`src/types.ts`: added `FieldValueState` type; `FieldObservation.valueState` and `FieldMetadata.valueState` are now required fields.

`tests/catalog.test.mjs`: updated existing exact-shape assertions for the new `valueState` field (observations included) and added 6 focused tests: default unknown for missing/placeholder values, known for real values and empty collections, explicit unannounced/not_applicable authority (incl. title fallback and 'known' cannot override missing), garbage state strings fall back to inference, per-observation state inference/persistence, unknown observations excluded from conflict, and not_applicable vs known conflict semantics.

**Honest gaps (not AV-014 scope, recorded for the next turn):**
- `server/store.mjs` bookmark sanitization builds an explicit media object and does not retain `fieldMetadata`, so value states do not survive bookmark round trips yet.
- No UI consumer reads `fieldMetadata.valueState`; nothing displays unknown/unannounced/not_applicable to users yet.
- AniList `NOT_YET_RELEASED` is not mapped to `valueState: 'unannounced'`; providers opt in via `fieldMetadata: { <field>: { valueState: 'unannounced' } }`. NOT_YET_RELEASED already yields an "Announced" timeline event shown as "TBA" in `server/detail.mjs` — do not conflate the two.

**Next task:** AV-015 — Add metadata schema versioning and migration support (`server/catalog.mjs` is the natural place; consider a `metadataSchemaVersion` on records plus a migration path for stored bookmarks/imports).

Earlier uncommitted work includes AV-002/003/004/007/008/009/010/011/012/013 and existing changes in `README.md`, `package.json`, `server/identifiers.mjs`, `server/index.mjs`, `server/browse.mjs`, `server/detail.mjs`, `src/lib/api.ts`, `src/pages/AnimeDetail.tsx`, `src/pages/Browse.tsx`, `src/pages/Search.tsx`, and related tests. `package-lock.json` is unchanged.
