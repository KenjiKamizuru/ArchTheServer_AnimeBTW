# Continuation note — 2026-11-19

**Status:** branch `arena/c8881487-archtheserver-animebtw`; working tree clean
except two new untracked files (not yet committed). AV-008 through AV-016 are
complete. Latest `npm run verify`: 381 tests across 14 files, typecheck and
production build clean. TODO.md records 84/800 checked, with 11 partial items
still open. Live provider responses, ffmpeg, browser E2E, and real
upload/download I/O remain unavailable.

**Completed this turn: AV-016 — detect and merge duplicate anime records safely.**

New `server/duplicateDetection.mjs`:
- `normalizeTitle`, `titleTokens`, `titleSimilarity`, `bestTitleSimilarity`: NFKC/case/whitespace/punctuation folding plus Jaccard token similarity across all title variants (title/romaji/english/native).
- `findDuplicates(target, candidates, { externalIds, findId, threshold })`: flags a candidate as a duplicate when it shares an external identifier with the target (AniList/MAL/AniDB/IMDb via `server/identifiers.mjs` reverse lookup) or when best cross-variant title similarity meets `threshold` (default 0.8). Returns `{ id, similarity, reason }`; target never included.
- `mergeRecords(primary, duplicate)`: produces a merged catalog record + `repoint: { [duplicate.id]: primary.id }`. Primary canonical values win; empty/unknown primary fields are filled from the duplicate; primary field-metadata provenance wins; observations merged and deduplicated by source+value. Inputs never mutated.
- `mergeIdentifiers(primaryId, duplicateId)`: releases the duplicate's registry record first, then repoints its provider ids to the primary; best-effort, never throws.
- The module never mutates stores directly — callers apply the repoint map to bookmark/list entries.

`tests/duplicateDetection.test.mjs`: covers normalization, similarity bounds, merging (incl. non-mutation, gap-fill, title-fallback/UNKNOWN handling, provenance, observation dedup), registry-backed detection, identifier repointing, and restart persistence. Sets `ANIMEVAULT_DATA` to a temp dir before importing server modules (mirrors identifiers.test.mjs).

**Honest gaps (not AV-016 scope, recorded for the next turn):**
- The repoint map is not yet applied to `server/store.mjs` bookmarks or `server/listStore.mjs` entries — that's the store-integration follow-up.
- `mergeIdentifiers` overwrites a primary's same-provider id with the duplicate's (e.g. primary anilist:60 + duplicate anilist:61 → anilist:61); callers should pick the primary whose identifiers they want to preserve.

**Next task:** AV-017 — Support manual corrections without overwriting source metadata (build on `fieldMetadata`: let a manual correction override display while retaining provider observations and the original source value).

Earlier committed work: AV-002 through AV-016. Related files touched across the series:
`server/catalog.mjs`, `server/anilist.mjs`, `server/browse.mjs`, `server/detail.mjs`,
`server/store.mjs`, `server/identifiers.mjs`, `server/duplicateDetection.mjs` (new),
`src/types.ts`, `src/lib/api.ts`, `src/pages/AnimeDetail.tsx`, `src/pages/Browse.tsx`,
`src/pages/Search.tsx`, `tests/catalog.test.mjs`, `tests/anilist.test.mjs`,
`tests/core-verification.test.mjs`, `tests/list-import.test.mjs`,
`tests/duplicateDetection.test.mjs` (new), `tests/identifiers.test.mjs`,
`tests/metadata-provenance.test.mjs`, `TODO.md`, `CONTINUATION.md`, `README.md`,
`package.json`. `package-lock.json` is unchanged. `data/` is gitignored.
