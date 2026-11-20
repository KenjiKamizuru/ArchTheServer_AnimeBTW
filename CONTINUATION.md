# Continuation note — 2026-11-19

**Status:** branch `arena/c8881487-archtheserver-animebtw`; working tree clean
except TODO.md/CONTINUATION.md edits (not yet committed). AV-008 through AV-017
are complete. Latest `npm run verify`: 386 tests across 14 files, typecheck and
production build clean. TODO.md records 85/800 checked, with 11 partial items
still open. Live provider responses, ffmpeg, browser E2E, and real
upload/download I/O remain unavailable.

**Completed this turn: AV-017 — support manual corrections without overwriting source metadata.**

`src/types.ts`:
- Added `FieldManualCorrection` interface (`value`, `correctedBy`, `correctedAt`, optional `reason`).
- `FieldMetadata` gains optional `manualCorrection?: FieldManualCorrection`.

`server/catalog.mjs`:
- Added `normalizeManualCorrection(raw)`: validates `correctedBy` (non-empty string) and `correctedAt` (ISO timestamp via `normalizeRefreshTime`); returns null for malformed input.
- `createFieldMetadata` now passes `fieldInfo?.manualCorrection` through to the per-field `fieldMetadata` entry.
- New exported `applyManualCorrection(record, field, correction)`: returns a new record with the corrected canonical value, records the correction block on `fieldMetadata[field].manualCorrection`, preserves provider `observations` untouched, recomputes `valueState` from the corrected value and `conflict` using the corrector as the selected source (so provider observations from other sources still compare), and never mutates the input. Rejects malformed corrections and unknown fields with TypeError.

`tests/catalog.test.mjs`: added tests for correction storage + observation preservation, source metadata intact for comparison, malformed-input/unknown-field rejection, `createFieldMetadata` pass-through, blank→unknown state, and input non-mutation.

**Honest gaps (not AV-017 scope, recorded for the next turn):**
- `server/store.mjs` bookmark sanitization and `server/listStore.mjs` do not yet carry `fieldMetadata`/`manualCorrection`, so manual corrections do not survive bookmark/list round trips yet.
- No API route or UI applies `applyManualCorrection`; that's the integration follow-up.

**Next task:** AV-018 — Add a metadata refresh policy per entity type (e.g., TTL/staleness rules per field or entity kind, built on `lastRefreshedAt` and `fieldMetadata`).

Earlier committed work: AV-002 through AV-017. Related files touched across the series:
`server/catalog.mjs`, `server/anilist.mjs`, `server/browse.mjs`, `server/detail.mjs`,
`server/store.mjs`, `server/identifiers.mjs`, `server/duplicateDetection.mjs`,
`src/types.ts`, `src/lib/api.ts`, `src/pages/AnimeDetail.tsx`, `src/pages/Browse.tsx`,
`src/pages/Search.tsx`, `tests/catalog.test.mjs`, `tests/anilist.test.mjs`,
`tests/core-verification.test.mjs`, `tests/list-import.test.mjs`,
`tests/duplicateDetection.test.mjs`, `tests/identifiers.test.mjs`,
`tests/metadata-provenance.test.mjs`, `TODO.md`, `CONTINUATION.md`, `README.md`,
`package.json`. `package-lock.json` is unchanged. `data/` is gitignored.
