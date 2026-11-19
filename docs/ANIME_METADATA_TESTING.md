# Anime Metadata Testing

## Suites (results as of 2026-11-19)

| Suite | Covers | Tests | Result |
|---|---|---|---|
| `tests/relations.test.mjs` | Relationship taxonomy + pair engine (AV-116a), Slime/Re:ZERO regressions | 6 | ✅ |
| `tests/relations-online.test.mjs` | Online pipeline caching/failures (AV-116b) | 4 | ✅ |
| `tests/metadata-core.test.mjs` | Unified model provenance merge + identity ladder (AV-117a/b) | 6 | ✅ |
| `tests/metadata-transport.test.mjs` | Transport pacing/caching/retries + registry + AniList adapter (AV-117c1) | 6 | ✅ |
| `tests/metadata-adapters.test.mjs` | Kitsu + Wikidata adapters (AV-117c2a) | 4 | ✅ |
| `tests/metadata-adapters2.test.mjs` | MAL, AniDB, ANN, TMDB adapters (AV-117c2b) | 4 | ✅ |
| `tests/franchise-groups.test.mjs` | Verified franchise grouping + season/branch partition (AV-117d1) | 2 | ✅ |
| `tests/library-match.test.mjs` | Library identity matching + relationship store (AV-117d2) | 3 | ✅ |
| `tests/metadata-regression.test.mjs` | End-to-end pipeline regressions (AV-117e) | 3 | ✅ |
| all tests (`node --test tests/*.test.mjs`) | whole project | **498** | ✅ 0 fail |

## Regression examples (verified against real database records)

Slime franchise — every entry typed correctly (see `tests/relations.test.mjs`):
S1 ↔ S2 Part 2 = `next-season` (indirect), S2 ↔ S2 Part 2 = `split-cour`,
"4th Season Part 3" = season (NOT spin-off), Clayman REVENGE = `spin-off`,
Slime Diaries = `spin-off`, Sukuwareru Ramiris = `special`, SUNSHINE in the
SLIME = `special`, Guren no Kizuna-hen = `movie`, and "Killing Slimes for 300
Years" (similar title!) = `unrelated`.

Re:ZERO — dash/no-dash variants = `same-entry` duplicates (`isDuplicateEntry`).

Evidence-refinement note: Sukuwareru Ramiris types as `special` when the MAL
"Other"+bonus cross-check is present (`tests/relations.test.mjs`) and `ona`
from the AniList-only edge (`tests/metadata-regression.test.mjs`) — both are
correct taxonomy answers; more sources refine the type. Neither treats it as a
season.

## Known limitations

1. Provider adapters beyond AniList are designed but not yet implemented
   (AV-117c) — the identity ladder's rung-2 `mappings` input is caller-supplied
   until the Kitsu/Wikidata adapters populate it.
2. `split-cour` detection uses official title part-markers; genuinely unnamed
   cour splits stay `next-season` (conservative, never guessed).
3. Tests run offline (injected lookups/fakes) by design; live API smoke checks
   belong to AV-117c's adapter tests and must respect each source's rate limit.
4. MAL's exact rate limit is cited as "reported ~100 req/min" — to be read off
   the official docs page before the MAL adapter ships.

## Running

```
node --test tests/*.test.mjs
npm run typecheck
npm run build
```
