# AnimeVault

A local web app for browsing anime and watching episodes in the browser. It has
no external dependencies: the server resolves episodes in JavaScript by
searching hianime.at, decoding the ZokoAnime embed, and remuxing the stream with
ffmpeg. Nothing is downloaded, stored, or queued. The app is a single Express
server (REST API + static build), with a React frontend.

## Features

- **This season, browsing, airing schedule** — live AniList GraphQL data.
- **Watch** — the server resolves the episode (search title, result #, quality,
  sub/dub) in JavaScript, remuxes the stream with ffmpeg, and plays it in the
  browser with English subtitles. The first search for a show is saved as its
  match; episode details let you pick a different title and result.
- **Bookmarks** — a persisted list you can add to from any card, the detail
  sheet, search results, or the schedule.
- **Settings** — quality, default search result, sub/dub.

## Run it

```bash
npm install
npm run dev        # server + Vite on http://127.0.0.1:5173
npm run build      # creates dist/
npm run start      # server + built UI on one port
```

Requirements: Node 18+, **ffmpeg** on PATH (used to remux streams for
in-browser playback), and internet access (the server fetches hianime.at, the
ZokoAnime embed, AniList and AniDB).

The Settings page shows the provider status, ffmpeg availability, quality, the
default result number, and dub.

`PORT` and `HOST` env vars override the port/host. The server listens on
127.0.0.1 by default — set `HOST=0.0.0.0` to expose it on the LAN. The in-app
player works from any device; episodes stream through the server.

## API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/season` | GET | Currently airing shows, sorted by next-airing time |
| `/api/airing` | GET | Today's schedule |
| `/api/search?q=` | GET | AniList title search |
| `/api/media/:id` | GET | Full AniList detail, cached from AniDB |
| `/api/media/many?ids=` | GET | Bulk metadata for bookmarked shows |
| `/api/settings` | GET/POST | Stream settings |
| `/api/resolver/status` | GET | Provider reachability + ffmpeg availability |
| `/api/resolver/search?q=` | GET | Provider search results (1-based indices) |
| `/api/resolver/matches/:mediaId` | GET/PUT | Saved provider match per show |
| `/api/bookmarks` | GET/POST | Bookmarked media ids |
| `/api/bookmarks/:mediaId` | PUT/DELETE | Toggle one bookmark |
| `/api/watch` | POST | Resolve an episode (warms cache, saves the match) |
| `/api/live/stream` | GET | Episode stream, remuxed for the browser |
| `/api/live/subtitle` | GET | Episode subtitles as WebVTT |
| `/api/health` | GET | Server status |

## Why not AniDB directly

AniDB's API carries no streaming links, and AniList carries no episode list —
 AniDB's `anime_ep_list` needs auth, AniList episode pages are unscoped
GraphQL queries, and AniDB's `episodes.xml` is only a code table, so episode
numbers come from AniList's `nextEpisode` / `airedEpisodes`. hianime.at exposes
episode lists (an `id` key that is AniDB's anime id), server lists, embed
decoding, and subtitles, and ZokoAnime serves the HLS stream. The app
reimplements that resolution pipeline in JavaScript, fetching with Node's
global fetch and keeping a small server-side cache.

## Layout

```
server/index.mjs      Express server: REST API + static build
server/anilist.mjs    AniList GraphQL + AniDB helpers, LRU cache
server/resolver.mjs   hianime/ZokoAnime resolver (search, embed, quality)
server/cache.mjs      TTL/LRU cache for provider requests
server/playback.mjs   ffmpeg remux + subtitle proxy for the browser
server/settings.mjs   settings, persisted to data/settings.json
server/store.mjs      bookmarks, persisted to data/bookmarks.json
src/components/       React UI (MediaCard, MediaModal, Player, Layout, …)
src/lib/              API client, settings store, formatting
src/pages/            This Season, Browse, Airing, Search, Bookmarks, Settings
```

`data/` (settings, bookmarks, provider matches) is created on first run and
gitignored. Metadata, searches, and resolved streams are cached in memory.

## Notes

- The server binds to 127.0.0.1 by default, and the cache lives in process
  memory, so single-instance use is intended.
- AniList/AniDB responses cache 10 minutes, provider searches and resolutions
  10 minutes, provider status 5 minutes, browser requests 5 minutes. The live
  stream is proxied with ffmpeg continuously — it needs ffmpeg on the server.
- `npm run typecheck` runs `tsc --noEmit` over `src/`.
- The app does not download, store, or serve files, and streams only through
  the built-in resolver. Use it only for media you are allowed to watch where
  you live.
