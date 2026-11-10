import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  HardDrive,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Terminal,
  Zap,
} from 'lucide-react'
import type { AniCliStatus, AppSettings, DownloadProvider } from '../types'
import { api } from '../lib/api'
import { resolveSource, saveSettings, useSettings } from '../lib/settings'
import { useToast } from '../components/Toasts'

const PLACEHOLDERS = [
  { token: '{title}', means: 'English/preferred title, URL-encoded' },
  { token: '{romaji}', means: 'Romaji title, URL-encoded' },
  { token: '{id}', means: 'AniList media id' },
  { token: '{episode}', means: 'Episode number (1, 2, 12)' },
  { token: '{ep2}', means: 'Zero-padded episode (01, 02, 12)' },
  { token: '{ep3}', means: 'Zero-padded episode (001, 012)' },
]

const QUALITIES = [
  { value: 'best', label: 'Best available' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: 'worst', label: 'Smallest available' },
]

const SAMPLE = { id: 195539, title: 'Cyberpunk: Edgerunners 2', romaji: 'Cyberpunk: Edgerunners 2' }

const editable = (s: AppSettings) => ({
  downloadProvider: s.downloadProvider,
  sourceTemplate: s.sourceTemplate,
  anicliBin: s.anicliBin,
  anicliQuality: s.anicliQuality,
  anicliDub: s.anicliDub,
  anicliResultIndex: s.anicliResultIndex,
})

export default function SettingsPage() {
  const settings = useSettings()
  const toast = useToast()
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AniCliStatus | null>(null)
  const [statusBusy, setStatusBusy] = useState(true)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  async function checkStatus() {
    setStatusBusy(true)
    try {
      setStatus(await api.anicliStatus())
    } catch (err) {
      setStatus(null)
      toast(err instanceof Error ? err.message : 'Could not check ani-cli', 'err')
    } finally {
      setStatusBusy(false)
    }
  }

  useEffect(() => {
    void checkStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = editable(draft)
  const saved = editable(settings)
  const dirty = JSON.stringify(patch) !== JSON.stringify(saved)
  const preview = draft.sourceTemplate.trim() ? resolveSource(draft.sourceTemplate.trim(), SAMPLE, 7) : ''

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function pickProvider(provider: DownloadProvider) {
    set('downloadProvider', provider)
  }

  async function onSave() {
    setBusy(true)
    try {
      const next = await saveSettings(patch)
      setDraft(next)
      toast('Settings saved')
      if (next.downloadProvider === 'anicli') void checkStatus()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save settings', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Settings</h1>
          <p className="mt-0.5 text-xs text-white/40">
            How episodes are fetched, and where they are written on this machine.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-white/85">
          <Zap size={14} className="text-accent" />
          Download engine
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-white/45">
          ani-cli resolves episodes from the streaming site for you. The URL template engine remains available if you
          already have a file host.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ProviderCard
            active={draft.downloadProvider === 'anicli'}
            onClick={() => pickProvider('anicli')}
            title="ani-cli"
            badge="recommended"
            description="Search the title, pick the right match, and download any episode with yt-dlp or ffmpeg."
          />
          <ProviderCard
            active={draft.downloadProvider === 'template'}
            onClick={() => pickProvider('template')}
            title="URL template"
            description="Build one direct http(s) URL per episode from a template you control."
          />
        </div>
      </section>

      {draft.downloadProvider === 'anicli' ? (
        <section className="mt-4 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-white/85">
              <Terminal size={14} className="text-white/50" />
              ani-cli options
            </h2>
            <button
              type="button"
              onClick={() => void checkStatus()}
              disabled={statusBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-850 px-2.5 py-1 text-[11px] text-white/55 ring-1 ring-white/5 transition hover:text-white"
            >
              <RefreshCw size={12} className={statusBusy ? 'animate-spin' : ''} />
              Recheck
            </button>
          </div>

          <div className="mt-2 text-[11px] leading-relaxed">
            {statusBusy && !status ? (
              <span className="text-white/40">Checking the installed binary…</span>
            ) : status?.available ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-accent">
                <Check size={12} />
                ani-cli {status.version ? `v${status.version}` : 'installed'} · {status.downloader} · {status.path}
              </span>
            ) : (
              <span className="inline-flex flex-wrap items-start gap-1.5 text-red-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {status?.error ?? 'ani-cli is not available'}
              </span>
            )}
            {status ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Dependency ok={status.curl} label="curl" />
                <Dependency ok={Boolean(status.downloader)} label={status.downloader ?? 'yt-dlp / ffmpeg'} />
                <Dependency ok={status.menu} label="fzf (or rofi/dmenu)" />
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Preferred quality</span>
              <select
                value={draft.anicliQuality}
                onChange={(event) => set('anicliQuality', event.target.value)}
                className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
              >
                {QUALITIES.map((quality) => (
                  <option key={quality.value} value={quality.value}>
                    {quality.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] text-white/25">
                Falls back to the best stream when the requested quality is unavailable.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Default search result</span>
              <input
                type="number"
                min={1}
                max={100}
                value={draft.anicliResultIndex}
                onChange={(event) => set('anicliResultIndex', Number(event.target.value) || 1)}
                className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
              <span className="mt-1 block text-[10px] text-white/25">
                Which search hit to use before you pick one per show.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">ani-cli binary</span>
              <input
                value={draft.anicliBin}
                onChange={(event) => set('anicliBin', event.target.value)}
                spellCheck={false}
                placeholder="ani-cli or /usr/local/bin/ani-cli"
                className="w-full rounded-lg bg-ink-800 px-2.5 py-2 font-mono text-[12px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
            </label>

            <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
              <input
                type="checkbox"
                checked={draft.anicliDub}
                onChange={(event) => set('anicliDub', event.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="text-xs text-white/70">Prefer the English dub</span>
            </label>
          </div>
        </section>
      ) : null}

      <section className="mt-4 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5">
        <h2 className="text-sm font-semibold text-white/85">URL template {draft.downloadProvider !== 'template' ? '(inactive)' : ''}</h2>
        <p className="mt-1 text-xs leading-relaxed text-white/45">
          A URL template with placeholders. Every download — single or bulk — resolves against it when this engine is
          selected.
        </p>

        <div className="mt-3">
          <input
            value={draft.sourceTemplate}
            onChange={(event) => set('sourceTemplate', event.target.value)}
            spellCheck={false}
            placeholder="http://192.168.1.20:8096/anime/{title}/E{ep2}.mkv"
            className="w-full rounded-lg bg-ink-800 px-3 py-2.5 font-mono text-[13px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
          />
        </div>

        {preview ? (
          <p className="mt-2 break-all font-mono text-[11px] text-white/35">
            <span className="text-white/50">EP 7 →</span> {preview}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {draft.sourceTemplate ? (
            <button
              type="button"
              onClick={() => set('sourceTemplate', '')}
              className="rounded-lg bg-white/5 px-2.5 py-2 text-xs text-white/45 transition hover:text-white"
            >
              Clear
            </button>
          ) : null}
          {settings.updatedAt ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-white/30">
              <Check size={11} />
              Updated {new Date(settings.updatedAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        <div className="mt-4 overflow-hidden rounded-lg ring-1 ring-white/5">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-white/[0.03] text-white/40">
              <tr>
                <th className="px-3 py-1.5 font-medium">Placeholder</th>
                <th className="px-3 py-1.5 font-medium">Becomes</th>
              </tr>
            </thead>
            <tbody className="text-white/50">
              {PLACEHOLDERS.map((row) => (
                <tr key={row.token} className="border-t border-white/5">
                  <td className="px-3 py-1.5 font-mono text-white/75">{row.token}</td>
                  <td className="px-3 py-1.5">{row.means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-white/85">
          <HardDrive size={14} className="text-white/50" />
          Storage
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-white/45">
          Downloads are written on the machine running this server, in:
        </p>
        <p className="mt-1.5 break-all font-mono text-[11px] text-white/60">
          {settings.libraryDir || 'library/'}
        </p>
        <p className="mt-1.5 text-[11px] text-white/30">
          Two transfers run at once; the rest queue. ani-cli uses a hidden scratch folder inside that library and the
          finished video is renamed into place. Files you drop there by hand also appear in the Downloaded tab.
        </p>
      </section>

      <section className="mt-4 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-white/85">
          <Info size={14} className="text-accent" />
          About the sources
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-white/45">
          AniList supplies the season, title and air-date metadata; AniDB links are references only. ani-cli is a
          separate command-line tool that resolves streams from a third-party site — install it yourself and use it
          only for media you are allowed to download where you live. The app merely runs the binary and stores the file.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-medium">
          <a
            href="https://github.com/pystardust/ani-cli"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            ani-cli on GitHub
            <ExternalLink size={10} />
          </a>
          <a
            href="https://anidb.net/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            AniDB
            <ExternalLink size={10} />
          </a>
        </div>
      </section>
    </div>
  )
}

function ProviderCard({
  active,
  onClick,
  title,
  description,
  badge,
}: {
  active: boolean
  onClick: () => void
  title: string
  description: string
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl p-3 text-left ring-1 transition ${
        active ? 'bg-accent/10 ring-accent/50' : 'bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-white/80'}`}>{title}</span>
        {badge ? (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">{badge}</span>
        ) : null}
        {active ? <Check size={13} className="ml-auto text-accent" /> : null}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed text-white/40">{description}</span>
    </button>
  )
}

function Dependency({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1 ${
        ok ? 'bg-accent/10 text-accent ring-accent/25' : 'bg-red-500/10 text-red-300 ring-red-500/25'
      }`}
    >
      {ok ? <Check size={10} /> : <AlertTriangle size={10} />}
      {label}
    </span>
  )
}
