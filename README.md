# AnimeVault

Browse this season's anime in a Jellyfin-style web UI, and watch episodes through
[ani-cli](https://github.com/pystardust/ani-cli) — the same way you would in a terminal.
Nothing is downloaded, nothing is stored. The server keeps AniList metadata in a cache and,
when you press **Watch**, it runs `ani-cli` on this machine.

- Browse the current season, search the full catalogue, follow the airing schedule.
- **Watch an episode with one click** — mpv opens (like `ani-cli` on the terminal), with English
  subtitles available as a track (press `v` in mpv).
- Prefer the browser? Pick the **In-app player** in Settings: the server resolves the stream through
  `ani-cli` and remuxes it with `ffmpeg` into the page, subtitles included.
- Bookmarks: save shows to watch later.
- Per-show saved matches: pick the right ani-cli search result once, and AnimeVault reuses it.

## Prerequisites

- **ani-cli** on your `PATH` (or set its full path in Settings). The server drives it with
  `-q <quality> -S <result> -e <episode>` flags, so no interactive menu (fzf/rofi) is needed.
- **mpv** — for the default `mpv` player target.
- **ffmpeg** — for the In-app player (remuxes HLS to fragmented MP4 in the browser).
- **curl** — ani-cli needs it to resolve streams.

The server checks all of this live; the Settings page shows what is missing.

## Run it

```
npm install
npm run dev      # vite dev server + API, open http://127.0.0.1:5173
npm run build    # production client, then:
npm run start
```

`npm run typecheck` runs `tsc --noEmit` over the client.

## How watching works

- **mpv target (default, faithful to ani-cli):** `POST /api/watch` spawns
  `ani-cli -q best -S 1 -e 12 "Frieren"` detached from the server. ani-cli resolves the stream and
  hands it to mpv. Close the tab, the show keeps playing.
- **In-app target:** `GET /api/live/stream` runs `ani-cli --debug` to capture the stream URL
  (90s cache), and `ffmpeg` streams a fragmented MP4 into the `<video>` element.
  `GET /api/live/subtitle` proxies the English subtitle track from the same run, same-origin,
  so the player can show it.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | ok flag, season key |
| `GET /api/season` | `?season&year&sort&page&perPage` — season list |
| `GET /api/airing` | next 50 airing episodes |
| `GET /api/search` | `?q` — AniList search |
| `GET /api/media?ids=` | posters/meta for a batch of ids |
| `GET /api/anime/:id` | full detail (cover, episodes, streams) |
| `GET /api/settings`, `PUT /api/settings` | player target, quality, result number, dub, binary |
| `GET /api/anicli/status` | ani-cli / curl / mpv / ffmpeg availability |
| `GET /api/anicli/search?q=` | ani-cli search results (10 min cache) |
| `GET/PUT /api/anicli/matches/:mediaId` | per-show saved match |
| `POST /api/watch` | launch `ani-cli` in mpv (mpv target) |
| `GET /api/live/stream?query&resultIndex&episode&quality&dub` | remoted stream → fragmented MP4 |
| `GET /api/live/subtitle?...` | English subtitle track, same-origin VTT |
| `GET /api/bookmarks`, `POST /api/bookmarks`, `DELETE /api/bookmarks/:id` | watch-later list |

Metadata is cached in memory (10 min server-side, 5 min in the browser); settings, bookmarks and
saved matches persist in `data/` (gitignored).

## Why not AniDB directly?

AniDB has an XML API with anime metadata, and AniList GraphQL has richer schedule data,
cover images, and trending rankings. We use AniList for browsing, AniDB where its data is better,
and `ani-cli` for streams — exactly the way `ani-cli` itself works. No stream database is shipped
in this repo.

## Layout

- `server/index.mjs` — Express app: serves the built client and every API route below.
- `server/anilist.mjs` — AniList GraphQL client with a small cache.
- `server/anicli.mjs` — ani-cli detection, search, stream resolution, per-show saved matches.
- `server/viewer.mjs` — launches `ani-cli` detached for the mpv target.
- `server/playback.mjs` — `ffmpeg` remux to fragmented MP4, subtitle proxy.
- `server/settings.mjs` — persisted settings (`data/settings.json`).
- `server/store.mjs` — bookmarks, persisted (`data/bookmarks.json`).
- `src/components/Player.tsx` — full-screen in-app player overlay (live streams + subtitles).
- `src/` — React 19 + Tailwind 4, dark Jellyfin-like theme.

`data/` is gitignored. There is no `library/` — nothing is written to disk beyond settings,
bookmarks, saved matches, and ani-cli's own history.

## Notes

- The server binds `127.0.0.1:5173`. Nothing is exposed on the LAN.
- Streams are resolved at play time; stream URLs are cached for 90 seconds.
- Streaming anime through ani-cli is subject to the laws where you live — use it only for media you
  are allowed to watch. This app does not download, store, or serve files.
