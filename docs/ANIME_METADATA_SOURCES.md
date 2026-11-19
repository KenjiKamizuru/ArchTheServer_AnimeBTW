# Anime Metadata Sources — Inventory & Research

Audit date: 2026-11-19. Every capability claim below is either observed in this
repository's code or verified against a cited public source. Where a fact could
not be verified, it is marked **unverified** — nothing here is invented.

## PART 1 — Audit: what the application uses today

The application has exactly **one anime metadata provider**: the AniList GraphQL
API. Everything else is either artwork, streaming, local storage, or derived.

| Module | Source / origin | Provides | Notes |
|---|---|---|---|
| `server/anilist.mjs` | `https://graphql.anilist.co` (GraphQL) | Canonical media IDs, romaji/English/native titles, synonyms, format, status, season/seasonYear, episodes, duration, genres, tags, studios, staff, characters, relations (incl. `relatedSeasons`), external links, trailer, meanScore, popularity | The single source of truth for anime metadata. Owns its own request quota/backoff (`server/quota.mjs` pattern, AV-020), timeout (15 s), retry, and `cached()` layer |
| `server/imdb.mjs` | `api.graphql.imdb.com`, `v3.sg.media-imdb.com`, `v3-cinemeta.strem.io` | Artwork (posters/banners/icons) via IMDb `tt` IDs | Artwork only. These endpoints are **unofficial/unlicensed GraphQL surfaces** (see Part 2, IMDb) — flagged as a risk below |
| `server/resolver.mjs` | `hianime.at` (via saved `data/matches.json`) | Stream resolution for playback | Not a metadata source; per-show manual match storage |
| `server/catalog.mjs` (`createAnimeRecord`) | AniList payloads | Local catalog records incl. `relationNames`/`relationTypes` | Derived from AniList relations; used for **search filtering** (`matchesFranchise`) |
| `server/detail.mjs` | AniList payloads | `relatedSeasons` (PREQUEL/SEQUEL TV only), relation groups, watch-order hints | Derived; relationship typing is display-level |
| `server/library.mjs` (`inferSeriesAndSeason`) | Local filenames | Series/season inference for downloaded files | **Filename-based inference** — the weakest matching path (Phase 8 target) |
| `server/search.mjs` (`matchesFranchise`) | `relationNames`/`relationTypes` | Franchise **search filter** | Name-token matching; correct as a search feature, wrong as a relationship authority |
| `server/explore.mjs` (`buildFranchiseGroups`) | AniList relation edges (local subset) | Franchise grouping via union-find over PREQUEL/SEQUEL/PARENT/SIDE_STORY | Only links entries present in the local list; no typing/confidence layer |
| `server/relations.mjs`, `server/relationsOnline.mjs` | — (new, AV-116a/b) | Verified pair typing + online verification pipeline | Not yet wired into the app (AV-116c) |
| External links (`anilist.mjs` ~:205) | AniList `externalLinks` | AniDB/MAL/etc. URLs + extracted IDs | AniDB is referenced **only as a link**; no AniDB data is fetched |

**Where wrong metadata can win today (audit findings):**

1. `library.mjs inferSeriesAndSeason` trusts filename season markers — wrong
   numbering silently produces wrong seasons.
2. `buildFranchiseGroups` unions any PREQUEL/SEQUEL/PARENT/SIDE_STORY edge
   inside the local list — spin-offs typed SIDE_STORY merge into "franchise"
   groups that the UI may treat as season lists.
3. `relatedSeasons` (anilist.mjs ~:1003) keeps only PREQUEL/SEQUEL — spin-offs
   and specials are excluded here, but split-cour parts are not distinguished
   from new seasons.
4. `matchesFranchise` name tokens can make unrelated same-word titles
   (Slime ×300-nen vs TenSura) look related in search results.
5. There is **no field-level provenance**: a single re-fetch overwrites catalog
   fields wholesale (kv `store.mjs`/`cache.mjs` write-through).
6. IMDb artwork fetches depend on unofficial endpoints (availability risk,
   no ToS coverage).

**Duplicate/redundant sources:** none duplicated today (single provider). The
redundancy problem is the opposite: **single-provider fragility** — if AniList
lacks or mislabels a relation, nothing can correct it.

## PART 2 — Source research (verified facts, cited)

### 1. AniList — PRIMARY (already integrated)

- Site: https://anilist.co · Docs: https://docs.anilist.co · API:
  `POST https://graphql.anilist.co` (GraphQL).
- Auth: none for basic usage; OAuth for user actions.
- Rate limit: **90 requests/minute** (applications accepted for per-IP
  increases) [cited: anarchy.website/2022/06/14/character-search.html].
- Fields: titles (romaji/english/native/synonyms), format, status, season,
  episodes, duration, genres/tags, studios, staff, characters, **Media.relations
  with relationType** (SEQUEL, PREQUEL, ALTERNATIVE, SPIN_OFF, SIDE_STORY,
  CHARACTER, SOURCE, ADAPTATION, COMPILATION, SUMMARY, OTHER), external IDs.
- Verdict: **best primary for anime identity + relationships**. Production-ready
  (already is the production dependency).

### 2. MyAnimeList — SECONDARY (cross-IDs, relation cross-check)

- Docs: https://myanimelist.net/apiconfig/references/api/v2 · API base:
  `https://api.myanimelist.net/v2` (REST/JSON) [cited: dlthub.com MAL loader;
  github.com/SuperMarcus/myanimelist-api-specification].
- Auth: **required** — OAuth2 bearer token and/or `X-MAL-Client-ID` header from
  a registered API client (Mal API program) [cited: both above].
- Fields: anime IDs, `alternative_titles`, related_anime, season, episodes,
  studios, start_date. Related-anime uses MAL's own vocabulary
  (Sequel/Prequel/Side Story/Spin-off/Alternative version/Other…).
- Rate limits: published in the official docs (third parties report ~100
  req/min; treat as **unverified** until read off the official page).
- Verdict: **production-suitable as secondary** for cross-IDs + relation
  cross-checks, provided the installation registers its own API client. Without
  a key it cannot be used — document as opt-in.

### 3. Kitsu — SECONDARY (titles, cross-IDs)

- Docs: https://kitsu.docs.apiary.io (legacy) · repo github.com/hummingbird-me/api-docs
  · API: `https://kitsu.io/api/edge` (JSON:API).
- Auth: **not required for public reads**; OAuth only for user actions
  [cited: freeapihub.com/apis/kitsu].
- Rate limit: fair-use (429 on excess; exact number unpublished) — cache
  responses [cited: freeapihub.com/apis/kitsu].
- Fields: canonical + `titles`/`abbreviatedTitles`, episode counts, air dates,
  `relationships` (JSON:API links incl. media relationships), `mappings`
  (external IDs: MAL, AniList, AniDB).
- Verdict: **good tertiary** — its `mappings` table is valuable for verified
  cross-database IDs. Fair-use limit means it must be cached.

### 4. AniDB — OPTIONAL (detailed relations), restrictive

- Wiki: https://wiki.anidb.net/API (HTTP API: wiki.anidb.net/HTTP_API_Definition;
  UDP API: wiki.anidb.net/UDP_API_Definition).
- Auth: **API client registration required** (per-account client). XML (HTTP)
  and UDP protocols [cited: grokipedia.com/page/AniDB].
- Rate limits: HTTP ≤ 1 request / 2 s **with mandatory heavy local caching —
  repeated same-day requests can get you banned**; UDP 0.5 pkt/s short-term,
  1 pkt / 4 s long-term, violations → IP bans [cited: FileBot forum thread
  quoting the wiki; anarchy.website API survey].
- Scraping: explicitly not the intended access method ("designed for bots,
  scripts and third-party tools rather than direct website scraping").
- Fields: rich relations (sequel/prequel/side story/remake…), episode-level
  detail, alternate titles, groupings.
- Verdict: **only viable as an opt-in adapter for self-hosted installs that
  register an API client**, with day-scale caching. Never scrape. If neither is
  acceptable for an installation, skip it — AniList/Kitsu cover the basics.

### 5. Anime News Network Encyclopedia — OPTIONAL (production/staff cross-check)

- API: `https://cdn.animenewsnetwork.com/encyclopedia/api.xml` (also
  `.../encyclopedia/api.php`), XML; batch reports at `reports.xml`
  [cited: boyapi.com/api/animenewsnetwork.html; github.com/Nekmo/anime-news-network].
- Auth: **none**. Rate limit: **~1 request/second/IP is mandatory** (≥1 s delay
  between queries; overload → 503) [cited: Nekmo README ("mandatory… at least
  1 second"); boyapi].
- **Attribution required**: link to the ANN encyclopedia page [cited: boyapi].
- Fields: vintage, production staff/casts, related productions, IDs (MAL, AniDB,
  official site). Data quality: strong on 1990s–2000s productions, weaker on
  recent seasons; episode counts sometimes incomplete.
- Verdict: **optional adapter** for staff/production cross-checks at 1 rps.

### 6. IMDb — ARTWORK/IDs ONLY, restricted

- Official program: https://developer.imdb.com — official non-commercial
  datasets (`imdb-datasets`) or IMDb API/Enterprise licensing; the general web
  API is **not openly keyless**. The endpoints this repo uses today
  (`api.graphql.imdb.com`, cinemeta) are unofficial surfaces with **no published
  rate limits or reuse grant** — they can break or be withdrawn at any time.
- Verdict: keep strictly as artwork/`tt`-ID enrichment (current usage),
  **never** as a franchise-relationship authority (per requirement). Migrate
  artwork to TMDB + provider-supplied images where possible; document the
  unofficial-endpoint risk (already done in the audit table).

### 7. TVmaze — SUPPLEMENTARY only

- API: https://www.tvmaze.com/api · Auth: **none** · Rate limit: **~20 calls /
  10 s per IP** [cited: freeapi.watch/tvmaze; hypereal.cloud API comparison].
- Fields: TV schedules, episode air dates/numbers, some anime-adjacent entries.
- Verdict: optional episode-airdate cross-check for simulcast scheduling; weak
  anime coverage outside popular TV slots. Not authoritative.

### 8. TMDB — MOVIES/SEASONS + artwork alternative

- Docs: https://developer.themoviedb.org · Auth: **API key required**
  (free registration). Free for non-commercial use with **attribution** (TMDb
  logo + link); commercial use needs prior approval. Rate limit **40 req/10 s,
  200k req/day** [cited: decodeerror.com/tmdb/pricing].
- Fields: movies/TV seasons/episodes, alternative titles, collections
  (franchise groupings), external IDs (IMDb `tt`, TVDB), images.
- Verdict: **good adapter for anime movies + collections + external IDs** and a
  licensed artwork alternative to the IMDb endpoints.

### 9. Wikidata — CROSS-ID HUB

- API: https://www.wikidata.org/w/api.php · SPARQL:
  https://query.wikidata.org/sparql. Auth: none. Rate limits: fair-use /
  maxlag etiquette (no hard published number).
- Fields: cross-database identifiers (P1985 AniList? — exact property IDs
  **unverified here**; MAL P4086, IMDb P345, AniDB P5646 etc.), franchise
  (P179 "part of the series"), inception dates, native labels.
- Verdict: **excellent for verified cross-database ID resolution** (Phase 5
  mapping) via SPARQL; not an episode/season authority.

## PART 3 — Decisions

| Source | Role | Status |
|---|---|---|
| AniList | Primary: identity, titles, relations, seasons, studios | ✅ integrated (production) |
| MAL v2 | Secondary: cross-IDs + relation cross-check | 🆕 adapter (opt-in, needs API client) |
| Kitsu | Tertiary: titles + `mappings` cross-IDs | 🆕 adapter (public reads) |
| AniDB | Optional: deep relations | 🆕 adapter (opt-in, registered client, day cache) |
| ANN | Optional: staff/production cross-check | 🆕 adapter (1 rps + attribution) |
| TMDB | Movies/collections/IDs + licensed artwork | 🆕 adapter (API key) |
| Wikidata | Cross-ID resolution hub | 🆕 adapter (SPARQL) |
| TVmaze | Supplementary airdate checks | ⏸ deferred (weak anime coverage) |
| IMDb | Artwork/`tt` IDs only | ⚠️ keep current usage, flagged unofficial; never a relation source |
| hianime | Stream resolution | ✅ unchanged (not metadata) |

Legal/access compliance: no source is scraped beyond its terms in this plan;
AniDB and ANN usage is rate-limited and cached per their published policies;
IMDb's unofficial endpoints are documented as a risk rather than expanded.
