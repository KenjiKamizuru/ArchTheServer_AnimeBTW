# Continuation note — 2026-11-19

**Status:** branch `arena/c8881487-archtheserver-animebtw`; working tree clean
except TODO.md/CONTINUATION.md edits (not yet committed). AV-008 through AV-020
are complete. Latest `npm run verify`: 428 tests across 16 files, typecheck and
production build clean. TODO.md records 88/800 checked, with 11 partial items
still open. Live provider responses, ffmpeg, browser E2E, and real
upload/download I/O remain unavailable.

**Completed this turn: AV-020 — per-provider request quotas and backoff policies.**

`server/rateLimit.mjs` (new):
- `RateLimiter` with per-provider sliding-window quotas and exponential backoff.
- `canProceed(provider)` gates requests on quota + cooldown and records the attempt against the provider's sliding window; returns `{ ok, reason, retryAfterMs }`.
- `recordSuccess(provider)` clears backoff; `recordFailure(provider, statusCode)` applies exponential backoff for retryable outcomes (429, 5xx, or network errors with no status; non-retryable 4xx don't back off), capped at `maxMs`, and returns the delay.
- `status(provider)`, `quotaInfo(provider)`, `reset(provider)` for inspection.
- `RequestWindow` sliding window prunes expired timestamps on every `count(now)`/`record()`.
- `rateLimiter` singleton with defaults: AniList 90 req/60s, IMDb 30 req/60s; backoff initial 500ms, max 30s, multiplier 2. Clock injectable (`now`) for deterministic tests.

`src/types.ts`:
- Added `ProviderQuota`, `BackoffConfig`, `ProviderQuotaCheck`, `ProviderRateStatus`, `ProviderQuotaInfo` types.

`server/anilist.mjs`:
- Wired `rateLimiter` into `gql`: quota/cooldown gate returns 503 `PROVIDER_RATE_LIMITED` before calling upstream; 429/5xx responses record failure and sleep the backoff delay; successes clear backoff; network failures back off.

`tests/rateLimit.test.mjs` (new): quotas/sliding-window expiry, cooldown, exponential backoff + cap, non-retryable 4xx, status/quotaInfo/reset, provider isolation.

**Honest gaps (not AV-020 scope, recorded for the next turn):**
- Only the AniList adapter is wired to the rate limiter; IMDb and other adapters are not yet integrated.
- No API surface exposes quota/backoff status to operators yet (could be a diagnostics endpoint).

**Next task:** AV-021 — Cache immutable metadata separately from rapidly changing airing data (split the existing `cache` in anilist.mjs or add a cache layer with different TTLs for immutable vs airing data).

Earlier committed work: AV-002 through AV-020. Related files touched across the series:
`server/catalog.mjs`, `server/anilist.mjs`, `server/browse.mjs`, `server/detail.mjs`,
`server/index.mjs`, `server/store.mjs`, `server/identifiers.mjs`,
`server/duplicateDetection.mjs`, `server/rateLimit.mjs` (new),
`src/types.ts`, `src/lib/api.ts`, `src/pages/AnimeDetail.tsx`, `src/pages/Browse.tsx`,
`src/pages/Search.tsx`, `tests/catalog.test.mjs`, `tests/anilist.test.mjs`,
`tests/core-verification.test.mjs`, `tests/list-import.test.mjs`,
`tests/duplicateDetection.test.mjs`, `tests/refresh-policy.test.mjs`,
`tests/rateLimit.test.mjs` (new), `tests/identifiers.test.mjs`,
`tests/metadata-provenance.test.mjs`, `TODO.md`, `CONTINUATION.md`, `README.md`,
`package.json`. `package-lock.json` is unchanged. `data/` is gitignored.
