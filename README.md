# AnimeVault

A Jellyfin-styled seasonal anime browser with bookmarks and a local download library.

- **This Season / Browse** — currently releasing and popular anime for any season, pulled live from
  [AniList](https://anilist.co)'s public GraphQL API, including next-episode air times.
- **ani-cli downloads** — the default engine. Pick a show, search it on the streaming site, choose the
  right match, then queue one episode, a hand-picked set, or every aired episode. Files land in
  `library/` next to the app.
- **URL template downloads** — optional fallback for a NAS, Jellyfin/Emby HTTP endpoint, or any static
  file host you control.
- **Bookmarks** — saved to `data/bookmarks.json` on this machine.
- **Downloaded tab** — everything on disk, grouped by show with posters, episode numbers, sizes and
  delete controls.
- **Built-in player** — play finished downloads in the browser, with subtitles and seeking. Open a
  show and hit **Watch now** to stream an episode immediately without saving it, or press the play
  button on an active transfer to watch it while the download continues.

## Run it

Prerequisites for the default ani-cli engine:

- [ani-cli](https://github.com/pystardust/ani-cli) on `PATH` (or set its full path in Settings)
- `yt-dlp` **or** `ffmpeg` — the downloader ani-cli hands the stream to
- `ffmpeg` — required for live playback and for remuxing MKV/TS files in the browser
- `curl` — used to resolve streams
- `fzf` (or `rofi` / `dmenu`) — ani-cli checks for a menu even when the app supplies the selection

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

```bash
npm run build
npm start          # serves dist/ + API on http://127.0.0.1:5173
```

The Settings page shows whether the configured ani-cli binary and its helpers were found.

## Downloading with ani-cli

Open any anime and use **Download to this machine**:

1. The search title is pre-filled from AniList. Hit the search icon to see live matches from the
   streaming site, then pick the correct entry (result order matches `ani-cli -S`).
2. Choose an episode and queue it, or select several episodes / **Download all aired**.
3. The server runs `ani-cli -d` once per episode, with `ANI_CLI_DOWNLOAD_DIR` pointed at a scratch
   folder inside `library/`. Progress and speed are parsed from yt-dlp/ffmpeg and streamed to the UI.
4. When ani-cli finishes, the video and its subtitle are renamed to
   `library/<Show> - E01.mp4` / `.vtt` and the scratch folder is removed.

The match you pick is remembered per show in `data/anicli-matches.json`, so the next download for the
same show preselects it. Settings control the binary path, preferred quality (`best`, `1080`, `720`,
`480`, `360`, `worst`), default search result and sub/dub preference.

Episode numbers are the ones listed on the streaming site. Specials or absolute numbering can differ
from AniList's episode list — pick the match manually when a show is unusual.

## Playing and watching live

The player is part of the app — no external media server is needed.

- **Play a download** — the play button on any file under **Downloaded** (or **Just finished** on the
  queue page) opens the in-app player. MP4/WebM/MOV files are served directly with HTTP range
  support, so the timeline can be scrubbed and playback resumes cleanly.
- **Watch now** — open any anime and press **Watch now** next to **Download all aired**. The server
  resolves the same ani-cli stream used by the downloader and starts playing immediately. Nothing is
  written to `library/`.
- **Watch while downloading** — active transfers show a play button on the queue page. It starts a
  real-time stream of that episode from the source, so you can watch before the download finishes.
- **Subtitles** — sidecar `.vtt` files next to a download are exposed as a subtitle track. Remote
  ani-cli subtitles are proxied through the app so the browser can load them without CORS issues.
- **Audio** — some sources keep video and audio in separate HLS playlists. The app resolves the
  audio rendition that belongs to the selected video variant and muxes it in, so downloads and live
  playback both have sound. Completed downloads missing audio are repaired automatically when the
  server starts (this needs `ffmpeg`/`ffprobe` on `PATH`).
- **MKV and other containers** — browsers cannot reliably play `.mkv`/`.ts`. Those files are remuxed
  on the fly to fragmented MP4 with `ffmpeg` (`-c copy`, so there is no re-encoding). This needs
  `ffmpeg` on `PATH`; live viewing always needs it too.

Playback endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/stream/:id` | Range-capable stream for a completed job |
| `GET /api/stream?path=…` | Range-capable stream for a hand-dropped library file |
| `GET /api/transcode/:id` / `?path=…` | Fragmented-MP4 remux for non-browser containers |
| `GET /api/subtitle/:id` / `?path=…` | Sidecar subtitle as WebVTT |
| `GET /api/live/stream?query=…&episode=…` | Live ani-cli stream |
| `GET /api/live/job/:id` | Live stream for an active download |
| `GET /api/live/…/subtitle` | Remote ani-cli subtitle proxy |

## Optional: URL template source

Switch **Download engine → URL template** in Settings and fill in a template. Every episode is
resolved against it, so downloads work in one click:

```
http://192.168.1.20:8096/anime/{title}/E{ep2}.mkv
```

| Placeholder | Becomes |
| --- | --- |
| `{title}` | preferred title, URL-encoded |
| `{romaji}` | romaji title, URL-encoded |
| `{id}` | AniList media id |
| `{episode}` | `1`, `2`, `12` |
| `{ep2}` | `01`, `02`, `12` |
| `{ep3}` | `001`, `012` |

The template must be `http(s)` and contain an episode placeholder. Point it at a host you control.

### Why not AniDB directly?

AniDB is a metadata database. It stores titles, air dates, episode lists and file hashes — it does not
host or serve video files, and it blocks automated fetching (HTTP 403). So AniDB supplies the metadata
and links here, while the actual bytes come from ani-cli or your configured source.

## How downloading works

1. `POST /api/downloads/bulk` queues episodes for ani-cli or the template engine. Two transfers run at
   once; the rest queue in order.
2. **ani-cli jobs** spawn `ani-cli -d -q <quality> -S <result> -e <episode> <title>` in a per-job
   scratch folder (`library/.anicli/<id>`). Output is parsed for percentage, total size and speed.
3. **HTTP jobs** `fetch` the source and pipe the response body to
   `library/<title> - E01.mkv.part`.
4. On completion the finished file is moved/renamed into place (subtitles included for ani-cli jobs).
   Cancelling kills the whole ani-cli process group and removes partial files.
5. Progress, speed, cancellation and failures stream to the UI over Server-Sent Events
   (`/api/downloads/events`) — no polling.
6. The Downloaded tab groups files by show, offers **Save to device**, and deletes single files or a
   whole show. Files copied into `library/` by hand are listed under "Other files"; sidecar subtitles
   and the ani-cli scratch folder are ignored.

## Layout

```
server/index.mjs      Express: metadata proxy, bookmarks, downloads, bulk queue, settings, SSE, Vite
server/anilist.mjs    AniList client + 10 min TTL cache + normalization + batch lookup
server/anicli.mjs     ani-cli detection, hianime search, per-show match store, live stream resolver
server/downloads.mjs  ani-cli + HTTP runners, job state, bulk queue, library scan
server/playback.mjs   range streaming, ffmpeg remux, subtitle proxying
server/settings.mjs   Download engine, ani-cli options, source template store
server/store.mjs      Bookmarks (JSON)
src/components/Player.tsx  In-app video player (local files, live ani-cli streams, subtitles)
src/                  React 19 + Tailwind 4 UI (Jellyfin-ish dark theme)
library/              Downloaded media (gitignored)
data/                 JSON state: bookmarks, downloads, settings, ani-cli matches (gitignored)
```

## Notes

- The server binds to `127.0.0.1` only and serves files from `library/` no other path.
- Metadata is cached 10 minutes on the server and 5 minutes in the browser; ani-cli searches are
  cached for 10 minutes too.
- `npm run typecheck` runs TypeScript across `src/`.
- Playback stays local: streams are relayed from this server to the browser on the same machine or
  your LAN. Nothing is uploaded anywhere.
- ani-cli is a separate third-party tool. Use it only for media you are allowed to download where
  you live; the app merely runs the binary and keeps the resulting file on this machine.
