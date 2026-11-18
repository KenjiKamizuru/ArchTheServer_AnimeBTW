import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  HardDrive,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Trash2,
  Zap,
} from 'lucide-react'
import { api } from '../lib/api'
import { focusObjectClass, removeArtwork, useArtwork } from '../lib/artwork'
import { refreshDownloads, refreshLibrary } from '../lib/downloads'
import { saveSettings, useSettings } from '../lib/settings'
import { ImdbArtworkModal } from '../components/ImdbArtworkModal'
import { useToast } from '../components/Toasts'
import type { AppSettings, ResolverStatus } from '../types'

const QUALITIES: { value: string; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: 'worst', label: 'Smallest available' },
]

function editable(s: AppSettings) {
  return {
    quality: s.quality,
    dub: s.dub,
    resultIndex: s.resultIndex,
    libraryDir: s.libraryDir,
    maxConcurrentDownloads: s.maxConcurrentDownloads,
    preferLocalPlayback: s.preferLocalPlayback,
    allowedHostsText: (s.allowedExternalHosts ?? []).join('\n'),
  }
}

type Draft = ReturnType<typeof editable>

export default function SettingsPage() {
  const settings = useSettings()
  const artwork = useArtwork()
  const appArt = artwork.app
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => editable(settings))
  const [busy, setBusy] = useState(false)
  const [imdbOpen, setImdbOpen] = useState(false)
  const [status, setStatus] = useState<ResolverStatus | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const touchedRef = useRef(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(settings))

  useEffect(() => {
    if (!touchedRef.current) {
      setDraft(editable(settings))
    }
  }, [settings])

  function checkStatus() {
    setStatusBusy(true)
    api
      .resolverStatus()
      .then((next) => setStatus(next))
      .catch(() => setStatus(null))
      .finally(() => setStatusBusy(false))
  }

  useEffect(() => {
    checkStatus()
  }, [])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    touchedRef.current = true
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function onSave() {
    setBusy(true)
    try {
      const allowedExternalHosts = draft.allowedHostsText
        .split(/[\r\n,\s]+/)
        .map((v) => v.trim())
        .filter(Boolean)

      const patch: Partial<AppSettings> = {
        quality: draft.quality,
        dub: draft.dub,
        resultIndex: draft.resultIndex,
        maxConcurrentDownloads: draft.maxConcurrentDownloads,
        preferLocalPlayback: draft.preferLocalPlayback,
        allowedExternalHosts,
      }
      if (!settings.libraryDirLocked) {
        patch.libraryDir = draft.libraryDir
      }

      const next = await saveSettings(patch)
      touchedRef.current = false
      setDraft(editable(next))
      await Promise.all([refreshLibrary(true), refreshDownloads()])
      toast('Settings saved')
      checkStatus()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save settings', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Settings</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Stream quality, shared media library, and persistent download limits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <ImdbArtworkModal
        open={imdbOpen}
        onClose={() => setImdbOpen(false)}
        targetLabel="AnimeVault App (Banner, Icon & Favicon)"
        targetType="app"
        targetKey="global"
        initialImdbId={appArt?.imdbId}
      />

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
              <ImagePlus size={13} className="text-accent" />
              App Banner, Icon &amp; IMDb Artwork
            </h2>
            <p className="mt-1 text-xs text-white/45">
              Claim any official poster, backdrop, still, or logo from IMDb using its{' '}
              <span className="font-mono text-amber-300">tt0234144</span> ID for your server banner, app icon, favicon, or any movie/anime.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {appArt ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await removeArtwork({ targetType: 'app', targetKey: 'global' })
                    toast('Reset custom app banner & icon')
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Could not reset artwork', 'err')
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:bg-red-500/15 hover:text-red-200"
              >
                <Trash2 size={12} />
                Reset
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setImdbOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600"
            >
              <ImagePlus size={13} />
              Claim from IMDb (tt…)
            </button>
          </div>
        </div>

        {appArt ? (
          <div className="mt-3.5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="relative h-24 overflow-hidden rounded-xl bg-ink-850 ring-1 ring-white/10">
              {appArt.banner ? (
                <img
                  src={`${appArt.banner.url}?v=${appArt.banner.updatedAt}`}
                  alt="Claimed app banner"
                  className={`h-full w-full object-cover ${focusObjectClass(appArt.banner.focus)}`}
                />
              ) : (
                <div className="grid h-full place-items-center text-[11px] text-white/30">No app banner set</div>
              )}
              <span className="absolute bottom-1.5 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white/85">
                Banner{appArt.imdbId ? ` · ${appArt.imdbId}` : ''}
              </span>
            </div>

            <div className="flex flex-col items-center justify-center rounded-xl bg-ink-850 px-4 py-2 ring-1 ring-white/10">
              {appArt.icon ? (
                <img
                  src={`${appArt.icon.url}?v=${appArt.icon.updatedAt}`}
                  alt="Claimed app icon"
                  className={`h-12 w-12 rounded-xl object-cover ring-1 ring-white/15 ${focusObjectClass(appArt.icon.focus)}`}
                />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-ink-800 text-[10px] text-white/30">
                  None
                </div>
              )}
              <span className="mt-1 text-[10px] text-white/45">Icon</span>
            </div>

            <div className="flex flex-col items-center justify-center rounded-xl bg-ink-850 px-4 py-2 ring-1 ring-white/10">
              {appArt.poster ? (
                <img
                  src={`${appArt.poster.url}?v=${appArt.poster.updatedAt}`}
                  alt="Claimed fallback poster"
                  className={`h-12 w-9 rounded object-cover ring-1 ring-white/15 ${focusObjectClass(appArt.poster.focus)}`}
                />
              ) : (
                <div className="grid h-12 w-9 place-items-center rounded bg-ink-800 text-[10px] text-white/30">
                  —
                </div>
              )}
              <span className="mt-1 text-[10px] text-white/45">Cover</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
            <Zap size={13} className="text-accent" />
            Streaming &amp; Default Quality
          </h2>
          <button
            type="button"
            onClick={checkStatus}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:text-white"
          >
            {statusBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Recheck
          </button>
        </div>

        {status ? (
          status.reachable ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent">
              <Check size={12} />
              Provider site reachable
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-red-300">
              <AlertTriangle size={12} />
              {status.error}
            </p>
          )
        ) : null}

        {status ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ring-1 ${
                status.ffmpeg
                  ? 'bg-accent/10 text-accent ring-accent/25'
                  : 'bg-red-500/10 text-red-300 ring-red-500/25'
              }`}
            >
              {status.ffmpeg ? <Check size={10} /> : <AlertTriangle size={10} />}
              ffmpeg
            </span>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Default quality</span>
            <select
              value={draft.quality}
              onChange={(event) => set('quality', event.target.value)}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              {QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-white/35">
              Used for live streaming and pre-selected when queuing downloads.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Default search result number</span>
            <input
              type="number"
              min={1}
              max={100}
              value={draft.resultIndex}
              onChange={(event) => set('resultIndex', Number(event.target.value))}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              Which search hit to use before you pick one per show.
            </span>
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.dub}
              onChange={(event) => set('dub', event.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-white/70">Prefer the English dub</span>
          </label>
        </div>

        {settings.updatedAt > 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/35">
            <Check size={11} className="text-accent" />
            Updated {new Date(settings.updatedAt).toLocaleString()}
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
          <HardDrive size={13} className="text-accent" />
          Shared Media Library &amp; Downloads
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] text-white/45">
              Shared library directory
              {settings.libraryDirLocked ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                  <Lock size={10} />
                  env
                </span>
              ) : null}
            </span>
            <input
              value={draft.libraryDir}
              disabled={settings.libraryDirLocked}
              onChange={(event) => set('libraryDir', event.target.value)}
              placeholder="library"
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              {settings.libraryDirLocked
                ? 'Controlled by the LIBRARY_DIR environment variable on the server.'
                : 'Defaults to library/ (excluded from Git). Absolute paths such as /mnt/media/anime are supported; source folders are blocked.'}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Simultaneous downloads</span>
            <input
              type="number"
              min={1}
              max={6}
              value={draft.maxConcurrentDownloads}
              onChange={(event) => set('maxConcurrentDownloads', Number(event.target.value))}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              How many episodes download in parallel (1–6). Remaining jobs stay in the persistent queue.
            </span>
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.preferLocalPlayback}
              onChange={(event) => set('preferLocalPlayback', event.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-white/70">
              Prefer local library files over remote streaming when an episode is downloaded
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-white/45">
              Additional approved external source domains
            </span>
            <textarea
              rows={3}
              value={draft.allowedHostsText}
              onChange={(event) => set('allowedHostsText', event.target.value)}
              placeholder={'cdn.example.com\n*.example.org'}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 font-mono text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              One hostname or wildcard (<code className="text-white/55">*.domain.com</code>) per line for
              external MP4/M3U8 downloads. Private, loopback, and link-local networks are always blocked.
              {settings.envExternalHostsConfigured
                ? ' Additional domains from ALLOWED_SOURCE_HOSTS are also active.'
                : ''}
            </span>
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
          <Info size={13} className="text-accent" />
          About the sources
        </h2>
        <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-white/45">
          <p>
            Show metadata, schedules and scores come from AniList and AniDB public APIs. Episodes are
            resolved on the server via the built-in hianime/ZokoAnime resolver and muxed with ffmpeg —
            streamed live or saved into the shared local library under{' '}
            <code className="text-white/60">Anime Name/Season 01/Anime Name - S01E01.mp4</code> for
            offline playback.
          </p>
          <p className="flex flex-wrap gap-3">
            <a
              href="https://github.com/pystardust/ani-cli"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent transition hover:underline"
            >
              Provider protocol reference (ani-cli)
              <ExternalLink size={10} />
            </a>
            <a
              href="https://anidb.net/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent transition hover:underline"
            >
              AniDB
              <ExternalLink size={10} />
            </a>
          </p>
          <p>
            Streaming and download rules differ by country — use only for media you are authorized to
            access where you live.
          </p>
        </div>
      </section>
    </div>
  )
}
