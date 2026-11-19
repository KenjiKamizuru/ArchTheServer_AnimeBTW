# Anime Relationships — Types, Normalization, Confidence

The semantics live in code at `server/relations.mjs` (AV-116a) and
`server/relationsOnline.mjs` (AV-116b). This document is the human-readable
contract.

## Supported relationship types (normalized)

| Normalized | Provider vocabulary (examples) | Meaning |
|---|---|---|
| `same-entry` | (identity match) | One database record behind different titles — duplicates |
| `split-cour` | SEQUEL + part markers on official titles | Two cours/parts of the *same* season |
| `next-season` | SEQUEL (TV→TV) | A new season continuing the main story |
| `prequel` | PREQUEL | Reverse view of `next-season`/`sequel` |
| `sequel` | SEQUEL (generic continuation) | Continuation when season-scope is unclear |
| `ova` / `ona` | SIDE_STORY/OTHER + format OVA/ONA | Home/web originals attached to the series |
| `movie` | SIDE_STORY/SPIN_OFF + format MOVIE | Theatrical entries in the franchise |
| `spin-off` | SPIN_OFF | Separate story in the same world |
| `special` | OTHER + bonus flag, TV_SPECIAL | Bonus shorts, recap specials, crossovers |
| `side-story` | SIDE_STORY | Side material without a finer classification |
| `parent-story` | PARENT | Hierarchy edge (inverse of side-story/branch) |
| `alternative-version` | ALTERNATIVE | Alt version/retelling |
| `remake` / `reboot` | ALTERNATIVE + remake/reboot flag | Reanimated or restarted continuity |
| `compilation` / `summary` | COMPILATION / SUMMARY | Recaps |
| `adaptation` / `source` | ADAPTATION / SOURCE | Cross-medium (anime ↔ manga/novel) |
| `character` | CHARACTER | Shared characters only |
| `other` | OTHER | Related but unclassifiable |
| `unrelated` | (negative verdict after lookups) | Evidence says no relationship |
| `unknown` | — | Insufficient/conflicting evidence |

## Normalization rules

- Mirrored edges invert direction: SEQUEL↔PREQUEL (`relativeKind`).
- Generic edges (`parent-story`, `other`, `unknown`) **confirm hierarchy** and
  never contradict a specific type supplied by the other side.
- `split-cour` is derived only from **official entry titles** (part markers:
  `Part N`, `Cour N`, `第Nクール`) — never from filenames.
- Provider's raw type is always preserved on the edge (`providerType`) next to
  `normalizedType`.

## Confidence & verification

| confidence | verification | When |
|---|---|---|
| `high` | `verified` | Direct/mirrored official edges, or same external ID |
| `medium` | `indirect` | Shared franchise anchor / verified franchise graph |
| `medium` | `verified` | Evidence-based negative (`unrelated` after both lookups) |
| `low` | `conflicting` | Providers disagree — **uncertain**, both values retained |
| `none` | `unverified` | No metadata — `uncertain`, type `unknown` |

Record shape: `{ type, confidence, source, sourceIds, verification, uncertain,
reasons[], roles?, checkedAt }` — `reasons` always explains the verdict.

## Conflict resolution

1. Retain both provider values in `provenance`.
2. Mark the relationship `conflicting` + `uncertain: true`.
3. Downstream (season lists, watch order) treats uncertain edges as absent.
4. A later `verified` result from a higher-priority source may supersede —
   but only through `mergeField`, which refuses to overwrite `verified` with
   `unverified`.

## Franchise vs continuation (explicitly separate)

- `sameFranchise(record)` answers "one franchise?"
- `record.type === 'next-season' | 'split-cour' | …` answers "what exactly?"
- Two spin-offs of one anchor are `branch` pairs (`other` + `roles`), never
  seasons of each other. Watch-order building may only chain
  continuation kinds.
