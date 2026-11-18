# AnimeVault

A self-hosted local web app for browsing anime, streaming episodes live, and
saving episodes or movies into a shared local media library for offline viewing.
The server resolves episodes in JavaScript, muxes streams with ffmpeg, manages a
persistent download queue, and serves your shared library directly over HTTP
byte ranges. The app is a single Express server (REST API + static build) with a
React frontend.

## Features

- **This season, browsing, airing schedule** — live AniList GraphQL data.
- **Watch (local-first + live fallback)** — automatically plays downloaded files
  straight from the shared local library (with seeking and sidecar WebVTT
  subtitles) when available, and falls back to live ffmpeg remuxing otherwise.
- **Persistent Download Manager** — download individual episodes, multi-selected
  episodes, custom episode ranges, full seasons, entire series, or authorized
  external MP4 / HLS (`.m3u8`) sources with configurable simultaneous download
  limits, pause/resume, cancel, retry, bulk deletion, and restart recovery.
- **Shared Media Library** — organizes files under
  `library/<Anime Name>/Season 01/<Anime Name> - S01E01.mp4`, preserves existing
  media across updates, discovers standalone/unknown `.mp4` files, and lets any
  client stream in-browser or download files to their device.
- **Bookmarks** — a persisted list you can add to from any card, the detail
  sheet, search results, or the schedule.
- **Settings** — quality, default search result, sub/dub, shared library path,
  simultaneous download limit, local playback preference, and approved external
  source domains.

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
127.0.0.1 by default — set `HOST=0.0.0.0` to expose it on the LAN. Additional
optional environment variables:

- `LIBRARY_DIR` — path to the shared media library (default: `./library`,
  excluded from Git; existing media is never overwritten or deleted on updates)
- `MAX_CONCURRENT_DOWNLOADS` — default simultaneous downloads (`1`–`6`, default `2`)
- `ALLOWED_SOURCE_HOSTS` — comma-separated approved hostnames/wildcards (e.g.
  `cdn.example.com,*.example.org`) for external MP4/M3U8 downloads
- `FFMPEG_BIN` — custom path to the `ffmpeg` binary

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
| `/api/downloads` | GET/POST | List queue snapshot or enqueue an episode / external URL |
| `/api/downloads/bulk` | POST | Queue selected episodes, a range, a season, or a series |
| `/api/downloads/events` | GET | Server-Sent Events stream for live download & library updates |
| `/api/downloads/actions` | POST | Bulk pause, resume, cancel, retry, delete, or clear finished |
| `/api/downloads/:id/pause` | POST | Pause a download |
| `/api/downloads/:id/resume` | POST | Resume a paused download |
| `/api/downloads/:id/cancel` | POST | Cancel an active or queued download |
| `/api/downloads/:id/retry` | POST | Retry a failed or cancelled download |
| `/api/downloads/:id` | DELETE | Delete a download entry (optional `?deleteFile=1`) |
| `/api/library` | GET | List local episodes, movies, and standalone MP4 files (opaque IDs) |
| `/api/library/anime/:mediaId` | GET | List downloaded local files for a specific anime |
| `/api/library/import` | POST | Import an MP4/video file into `library/Unsorted/` |
| `/api/library/bulk-delete` | POST | Delete multiple local files without removing anime metadata |
| `/api/library/:id/stream` | GET | Play a local file via HTTP byte ranges (or ffmpeg remux) |
| `/api/library/:id/download` | GET | Download a local file to a client device |
| `/api/library/:id/subtitle` | GET | Serve a local sidecar subtitle as WebVTT |
| `/api/library/:id` | DELETE | Delete one local file without removing anime metadata |
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
server/playback.mjs   HTTP range serving, ffmpeg remux/download, subtitle helpers
server/downloads.mjs  persistent download queue & worker (data/downloads.json)
server/library.mjs    shared media library index, scanner & atomic file moves
server/security.mjs   path-traversal, SSRF, header, and DRM/container guards
server/settings.mjs   settings, persisted to data/settings.json
server/store.mjs      bookmarks, persisted to data/bookmarks.json
src/components/       React UI (MediaCard, MediaModal, Player, Layout, …)
src/lib/              API client, download/library store, settings, formatting
src/pages/            Season, Browse, Airing, Search, Downloads, Downloaded, Bookmarks, Settings
```

`library/` (shared downloaded media) and `data/` (settings, bookmarks, provider
matches, persistent download queue, library index) are created on first run and
excluded via `.gitignore`.

## Notes

- The server binds to 127.0.0.1 by default, and the cache lives in process
  memory, so single-instance use is intended.
- AniList/AniDB responses cache 10 minutes, provider searches and resolutions
  10 minutes, provider status 5 minutes, browser requests 5 minutes. The live
  stream is proxied with ffmpeg continuously — it needs ffmpeg on the server.
- `npm run typecheck` runs `tsc --noEmit` over `src/`.
- Downloaded episodes are stored only inside the configured shared library
  (`library/` by default, ignored by Git) and never overwritten or removed
  during updates. Use only for media you are authorized to access where you live.
