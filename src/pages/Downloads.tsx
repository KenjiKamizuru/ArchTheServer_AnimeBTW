import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDrive,
  Loader2,
  Play,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import { useJobs } from '../lib/downloads'
import { useSettings } from '../lib/settings'
import { bytes, percent, speed } from '../lib/format'
import { DownloadsTabs } from '../components/DownloadsTabs'
import { usePlayer } from '../components/Player'
import { useToast } from '../components/Toasts'

export default function Downloads() {
  const jobs = useJobs()
  const settings = useSettings()
  const toast = useToast()
  const player = usePlayer()

  const inFlight = jobs.filter((j) => j.status !== 'completed')
  const recent = jobs.filter((j) => j.status === 'completed').slice(0, 4)
  const missingSource = settings.downloadProvider === 'template' && !settings.sourceTemplate

  async function onCancel(id: string) {
    try {
      await api.cancelDownload(id)
      toast('Download canceled')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not cancel', 'err')
    }
  }

  async function onRemoveJob(id: string) {
    if (!window.confirm('Delete this file from the library?')) return
    try {
      await api.removeDownload(id)
      toast('Removed from the library')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove the file', 'err')
    }
  }

  return (
    <div>
      <DownloadsTabs />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Download queue</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {inFlight.length > 0
              ? `${inFlight.length} transfer${inFlight.length === 1 ? '' : 's'} in progress · saved straight to disk`
              : 'Nothing downloading right now.'}
          </p>
        </div>
        <Link
          to="/settings"
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-850 px-2.5 py-1 text-[11px] text-white/50 ring-1 ring-white/5 transition hover:text-accent"
        >
          <Settings2 size={12} />
          Source
        </Link>
      </div>

      {missingSource ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-ink-900 px-3.5 py-3 text-xs text-white/55 ring-1 ring-white/5">
          <Settings2 size={13} className="text-accent" />
          The URL template engine is selected but no template is set — bulk downloads stay off.
          <Link to="/settings" className="font-medium text-accent hover:underline">
            Set your source template
          </Link>
        </div>
      ) : null}

      {inFlight.length === 0 ? (
        <div className="mt-6 rounded-xl bg-ink-900 p-10 text-center ring-1 ring-white/5">
          <Download size={30} className="mx-auto text-white/20" />
          <h2 className="mt-3 text-sm font-medium text-white/70">The queue is empty</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/40">
            Open any anime and hit Download — or select episodes and queue a whole batch. Files land in{' '}
            <span className="text-white/60">{settings.libraryDir || 'library/'}</span> on this computer.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
          >
            Find something to download
          </Link>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {inFlight.map((job) => {
            const progress = job.progress ?? percent(job.received, job.total)
            const running = job.status === 'downloading'
            const queued = job.status === 'queued'
            const failed = job.status === 'error' || job.status === 'canceled'

            return (
              <div key={job.id} className="rounded-xl bg-ink-900 p-3.5 ring-1 ring-white/5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {running ? (
                        <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
                      ) : job.status === 'error' ? (
                        <AlertTriangle size={13} className="shrink-0 text-red-400" />
                      ) : job.status === 'canceled' ? (
                        <X size={13} className="shrink-0 text-white/35" />
                      ) : (
                        <Download size={13} className="shrink-0 text-white/35" />
                      )}
                      <p className="truncate text-sm font-medium text-white/90">
                        {job.title}
                        {job.episode ? ` · EP ${job.episode}` : ''}
                      </p>
                      {job.provider === 'anicli' ? (
                        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          ani-cli
                        </span>
                      ) : null}
                      {queued ? (
                        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/45">
                          queued
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-white/30">{job.filename}</p>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${
                          failed ? 'bg-white/20' : 'bg-accent'
                        }`}
                        style={{ width: `${failed ? 100 : progress}%` }}
                      />
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-[11px] text-white/40">
                      <span>
                        {job.status === 'error'
                          ? job.error
                          : job.status === 'canceled'
                            ? 'Canceled'
                            : `${bytes(job.received)}${job.total ? ` / ${bytes(job.total)}` : ''}`}
                      </span>
                      <span className="tabular-nums">
                        {running || queued ? speed(job.speed) : ''}
                        {job.total && running ? ` · ${progress.toFixed(0)}%` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {running || queued ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            player.open({
                              kind: 'job',
                              id: job.id,
                              title: job.title,
                              episode: job.episode,
                              filename: job.filename,
                              live: true,
                            })
                          }
                          className="rounded-md p-2 text-white/40 transition hover:bg-white/5 hover:text-accent"
                          aria-label="Watch while downloading"
                          title="Watch while downloading"
                        >
                          <Play size={15} className="fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onCancel(job.id)}
                          className="rounded-md p-2 text-white/40 transition hover:bg-white/5 hover:text-white"
                          aria-label="Cancel download"
                        >
                          <X size={15} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onRemoveJob(job.id)}
                        className="rounded-md p-2 text-white/40 transition hover:bg-white/5 hover:text-red-300"
                        aria-label="Remove entry"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {recent.length ? (
        <div className="mt-7">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold tracking-wider text-white/35 uppercase">Just finished</h2>
            <Link to="/downloaded" className="text-[11px] text-white/45 transition hover:text-accent">
              Open Downloaded →
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl bg-ink-900 ring-1 ring-white/5">
            {recent.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0"
              >
                <CheckCircle2 size={15} className="shrink-0 text-accent/80" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/85">
                    {job.title}
                    {job.episode ? ` · EP ${job.episode}` : ''}
                  </p>
                  <p className="truncate text-[11px] text-white/30">{job.filename}</p>
                </div>
                <span className="shrink-0 text-[11px] text-white/35 tabular-nums">{bytes(job.received)}</span>
                <button
                  type="button"
                  onClick={() =>
                    player.open({
                      kind: 'job',
                      id: job.id,
                      title: job.title,
                      episode: job.episode,
                      filename: job.filename,
                    })
                  }
                  className="shrink-0 rounded-md p-1.5 text-white/40 transition hover:bg-white/5 hover:text-accent"
                  aria-label={`Play ${job.title}`}
                  title="Play"
                >
                  <Play size={14} className="fill-current" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-8 flex items-center gap-1.5 text-[11px] text-white/25">
        <HardDrive size={12} />
        Files are stored on the machine running this app; nothing is uploaded anywhere.
      </p>
    </div>
  )
}
