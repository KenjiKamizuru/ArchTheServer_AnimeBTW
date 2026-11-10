import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Info, Loader2, RefreshCw, Save, Terminal, Zap } from 'lucide-react'
import { api } from '../lib/api'
import { useSettings } from '../lib/settings'
import { useToast } from '../components/Toasts'
import type { AniCliStatus, AppSettings, PlayerTarget } from '../types'

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
    anicliBin: s.anicliBin,
    anicliQuality: s.anicliQuality,
    anicliDub: s.anicliDub,
    anicliResultIndex: s.anicliResultIndex,
    playerTarget: s.playerTarget,
  }
}

type Draft = ReturnType<typeof editable>

export default function SettingsPage() {
  const settings = useSettings()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => editable(settings))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AniCliStatus | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(settings))

  function checkStatus() {
    setStatusBusy(true)
    api
      .anicliStatus()
      .then((next) => setStatus(next))
      .catch(() => setStatus(null))
      .finally(() => setStatusBusy(false))
  }

  useEffect(() => {
    checkStatus()
  }, [])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function onSave() {
    setBusy(true)
    try {
      const next = await api.saveSettings(draft)
      setDraft(editable(next))
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
            Which player opens the episode, and how ani-cli runs on this machine.
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

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
          <Zap size={13} className="text-accent" />
          Player
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => set('playerTarget', 'mpv')}
            className={`flex flex-col rounded-xl p-3 text-left ring-1 transition ${
              draft.playerTarget === 'mpv'
                ? 'bg-accent/10 ring-accent/50'
                : 'bg-ink-850 ring-white/10 hover:bg-ink-800'
            }`}
          >
            <span
              className={`flex items-center gap-2 text-sm font-semibold ${
                draft.playerTarget === 'mpv' ? 'text-accent' : 'text-white/80'
              }`}
            >
              mpv (like ani-cli)
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                recommended
              </span>
              {draft.playerTarget === 'mpv' ? <Check size={14} className="ml-auto" /> : null}
            </span>
            <span className="mt-1 text-[11px] leading-relaxed text-white/40">
              Runs <span className="font-mono text-white/55">ani-cli -q … -S … -e …</span> on this machine
              and opens the stream in mpv. English subtitles are a track — press v.
            </span>
          </button>

          <button
            type="button"
            onClick={() => set('playerTarget', 'app')}
            className={`flex flex-col rounded-xl p-3 text-left ring-1 transition ${
              draft.playerTarget === 'app'
                ? 'bg-accent/10 ring-accent/50'
                : 'bg-ink-850 ring-white/10 hover:bg-ink-800'
            }`}
          >
            <span
              className={`flex items-center gap-2 text-sm font-semibold ${
                draft.playerTarget === 'app' ? 'text-accent' : 'text-white/80'
              }`}
            >
              In-app player
              {draft.playerTarget === 'app' ? <Check size={14} className="ml-auto" /> : null}
            </span>
            <span className="mt-1 text-[11px] leading-relaxed text-white/40">
              Streams in the browser; the server remuxes the stream with ffmpeg. No mpv needed.
            </span>
          </button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/35">
          <Check size={11} className="text-accent" />
          Updated {new Date(settings.updatedAt).toLocaleString()}
        </p>
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
            <Terminal size={13} className="text-accent" />
            ani-cli
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
          status.available ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent">
              <Check size={12} />
              ani-cli v{status.version} installed · {status.path}
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
                status.curl
                  ? 'bg-accent/10 text-accent ring-accent/25'
                  : 'bg-red-500/10 text-red-300 ring-red-500/25'
              }`}
            >
              {status.curl ? <Check size={10} /> : <AlertTriangle size={10} />}
              curl
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ring-1 ${
                status.mpv
                  ? 'bg-accent/10 text-accent ring-accent/25'
                  : 'bg-red-500/10 text-red-300 ring-red-500/25'
              }`}
            >
              {status.mpv ? <Check size={10} /> : <AlertTriangle size={10} />}
              mpv
            </span>
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
            <span className="mb-1 block text-[11px] text-white/45">Quality</span>
            <select
              value={draft.anicliQuality}
              onChange={(event) => set('anicliQuality', event.target.value)}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              {QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-white/35">
              Falls back to the best stream when the requested quality is unavailable.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Default search result number</span>
            <input
              type="number"
              min={1}
              max={100}
              value={draft.anicliResultIndex}
              onChange={(event) => set('anicliResultIndex', Number(event.target.value))}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              Which search hit to use before you pick one per show.
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-white/45">ani-cli binary</span>
            <input
              type="text"
              value={draft.anicliBin}
              onChange={(event) => set('anicliBin', event.target.value)}
              placeholder="ani-cli or /usr/local/bin/ani-cli"
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 font-mono text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.anicliDub}
              onChange={(event) => set('anicliDub', event.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-white/70">Prefer the English dub</span>
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
            Show metadata, schedules and scores come from AniList and AniDB public APIs. Nothing is
            downloaded: each watch runs the ani-cli binary on this machine and streams the chosen
            episode.
          </p>
          <p className="flex flex-wrap gap-3">
            <a
              href="https://github.com/pystardust/ani-cli"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent transition hover:underline"
            >
              ani-cli on GitHub
              <ExternalLink size={10} />
            </a>
            <a
              href="https://anidb.net/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent transition hover:underline"
            >
              AniDB
              <ExternalLink size={10} />
            </a>
          </p>
          <p>
            Streaming rules differ by country — use it only for media you are allowed to watch where
            you live. The app merely runs the binary and streams the episode.
          </p>
        </div>
      </section>
    </div>
  )
}
