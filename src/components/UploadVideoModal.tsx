import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Clapperboard,
  FileVideo,
  Film,
  Pause,
  Play,
  RotateCcw,
  Subtitles,
  Trash2,
  Tv,
  Upload,
  X,
} from 'lucide-react'
import {
  SUPPORTED_SUBTITLE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  cancelUpload,
  cleanTitleFromFileName,
  clearFinishedUploads,
  dismissUpload,
  enqueueUploads,
  inferEpisodeFromFileName,
  pauseUpload,
  resumeUpload,
  useUploads,
  type UploadTask,
} from '../lib/uploads'
import { formatBytes, formatSpeed } from '../lib/format'
import type { LibraryItem, UploadCategory } from '../types'

interface PendingFile {
  key: string
  file: File
  title: string
  episode: number
  subtitleFile: File | null
}

interface UploadVideoModalProps {
  open: boolean
  initialCategory?: UploadCategory
  initialFiles?: File[]
  onClose: () => void
  onQueued?: (count: number, category: UploadCategory) => void
}

function isVideoFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return SUPPORTED_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function isSubtitleFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return SUPPORTED_SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function UploadVideoModal({
  open,
  initialCategory = 'movie',
  initialFiles,
  onClose,
  onQueued,
}: UploadVideoModalProps) {
  const [category, setCategory] = useState<UploadCategory>(initialCategory)
  const [pending, setPending] = useState<PendingFile[]>([])
  const [sharedSeries, setSharedSeries] = useState('')
  const [season, setSeason] = useState(1)
  const [dub, setDub] = useState(false)
  const [keepBoth, setKeepBoth] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setCategory(initialCategory)
    setError(null)
    setDragOver(false)
    if (initialFiles && initialFiles.length > 0) {
      addPickedFiles(initialFiles, true)
    } else {
      setPending([])
      setSharedSeries('')
      setSeason(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCategory, initialFiles])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function addPickedFiles(rawFiles: File[] | FileList, replace = false) {
    const arr = Array.from(rawFiles)
    const videos = arr.filter(isVideoFile)
    const subs = arr.filter(isSubtitleFile)

    if (videos.length === 0 && subs.length > 0 && pending.length > 0) {
      setPending((prev) =>
        prev.map((entry, idx) => (idx === 0 ? { ...entry, subtitleFile: subs[0] } : entry)),
      )
      setError(null)
      return
    }

    if (videos.length === 0) {
      setError(`Unsupported file type. Supported videos: ${SUPPORTED_VIDEO_EXTENSIONS.join(', ')}`)
      return
    }

    setError(null)
    videos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const findMatchingSub = (videoName: string): File | null => {
      if (subs.length === 1 && videos.length === 1) return subs[0]
      const stem = videoName.replace(/\.[^.]+$/, '').toLowerCase()
      return (
        subs.find((s) => {
          const subStem = s.name.replace(/\.[^.]+$/, '').toLowerCase()
          return subStem === stem || subStem.startsWith(`${stem}.`)
        }) ?? null
      )
    }

    const firstEpHint = inferEpisodeFromFileName(videos[0].name)
    if (firstEpHint && (replace || pending.length === 0)) {
      if (!sharedSeries) setSharedSeries(firstEpHint.title)
      setSeason(firstEpHint.season)
      if (videos.length > 1) setCategory('episode')
    } else if ((replace || pending.length === 0) && !sharedSeries) {
      setSharedSeries(cleanTitleFromFileName(videos[0].name))
    }

    setPending((prev) => {
      const base = replace ? [] : prev
      const startEp =
        base.length > 0 ? Math.max(...base.map((p) => p.episode)) + 1 : (firstEpHint?.episode ?? 1)
      const built: PendingFile[] = videos.map((file, idx) => {
        const epHint = inferEpisodeFromFileName(file.name)
        return {
          key: `${file.name}-${file.size}-${file.lastModified}-${idx}`,
          file,
          title: cleanTitleFromFileName(file.name),
          episode: epHint?.episode ?? startEp + idx,
          subtitleFile: findMatchingSub(file.name),
        }
      })
      return [...base, ...built]
    })
  }

  function startUpload() {
    if (pending.length === 0) {
      setError('Choose at least one movie or video file to upload.')
      return
    }
    if (category === 'episode' && !sharedSeries.trim()) {
      setError('Enter the anime series title.')
      return
    }

    const queued = enqueueUploads(
      pending.map((entry) => ({
        file: entry.file,
        category,
        title:
          category === 'episode'
            ? sharedSeries.trim()
            : category === 'movie'
              ? entry.title.trim() || cleanTitleFromFileName(entry.file.name)
              : undefined,
        season: category === 'episode' ? Math.max(1, season || 1) : 1,
        episode: category === 'episode' ? Math.max(1, entry.episode || 1) : 1,
        quality: 'local',
        dub,
        keepBoth,
        subtitleFile: entry.subtitleFile,
      })),
    )
    onQueued?.(queued.length, category)
    onClose()
  }

  const totalBytes = pending.reduce((sum, p) => sum + p.file.size, 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-slide-up relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-ink-900 shadow-2xl ring-1 ring-white/10"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Upload size={18} className="text-accent" />
              Upload Movie or Video to Library
            </h2>
            <p className="mt-0.5 text-xs text-white/45">
              Resumable chunked upload — bypasses HTTP 413 size limits, survives network drops, and keeps running while you browse.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/55 transition hover:bg-white/8 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wider text-white/45 uppercase">
              Save As
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  { id: 'movie' as const, label: 'Movie', hint: 'library/Movies/', icon: Clapperboard },
                  { id: 'episode' as const, label: 'Anime Episode(s)', hint: '<Anime>/Season 01/', icon: Tv },
                  { id: 'unknown' as const, label: 'Other Video', hint: 'library/Unsorted/', icon: FileVideo },
                ] as const
              ).map(({ id, label, hint, icon: Icon }) => {
                const active = category === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCategory(id)}
                    className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left ring-1 transition ${
                      active
                        ? 'bg-accent/15 text-white ring-accent/55'
                        : 'bg-ink-850 text-white/75 ring-white/8 hover:bg-ink-800 hover:text-white'
                    }`}
                  >
                    <Icon size={16} className={`shrink-0 ${active ? 'text-accent' : 'text-white/45'}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{label}</div>
                      <div className="truncate font-mono text-[10px] text-white/40">{hint}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Drop zone */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={[...SUPPORTED_VIDEO_EXTENSIONS, ...SUPPORTED_SUBTITLE_EXTENSIONS, 'video/*'].join(',')}
            className="hidden"
            onChange={(ev) => {
              if (ev.target.files && ev.target.files.length > 0) {
                addPickedFiles(ev.target.files, false)
              }
              ev.target.value = ''
            }}
          />

          <div
            onDragOver={(ev) => {
              ev.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(ev) => {
              ev.preventDefault()
              setDragOver(false)
              if (ev.dataTransfer.files?.length) {
                addPickedFiles(ev.dataTransfer.files, false)
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
              dragOver
                ? 'border-accent bg-accent/12 text-white'
                : 'border-white/12 bg-ink-850 text-white/75 hover:border-accent/50 hover:bg-ink-800'
            }`}
          >
            <Film size={28} className="mx-auto text-accent" />
            <p className="mt-2 text-sm font-medium text-white">
              Click to select movie / video files or drag &amp; drop here
            </p>
            <p className="mt-1 text-xs text-white/45">
              MP4, MKV, WebM, M4V, MOV, AVI, TS, M2TS · Multi-GB files supported · Optional .srt / .vtt / .ass subtitles
            </p>
          </div>

          {category === 'episode' && pending.length > 0 && (
            <div className="grid gap-3 rounded-xl bg-ink-850 p-3.5 ring-1 ring-white/8 sm:grid-cols-[1fr_110px]">
              <label className="block">
                <span className="text-[11px] font-medium text-white/50">Anime Series Title</span>
                <input
                  value={sharedSeries}
                  onChange={(ev) => setSharedSeries(ev.target.value)}
                  placeholder="e.g. Frieren Beyond Journey's End"
                  className="mt-1 w-full rounded-lg bg-ink-800 px-3 py-2 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-white/50">Season #</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={season}
                  onChange={(ev) => setSeason(Math.max(1, Number(ev.target.value) || 1))}
                  className="mt-1 w-full rounded-lg bg-ink-800 px-3 py-2 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
              </label>
            </div>
          )}

          {pending.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-white/50">
                <span>
                  {pending.length} file{pending.length === 1 ? '' : 's'} selected · {formatBytes(totalBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => setPending([])}
                  className="text-white/50 transition hover:text-white"
                >
                  Clear list
                </button>
              </div>

              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {pending.map((entry, idx) => (
                  <div
                    key={entry.key}
                    className="rounded-xl bg-ink-850 p-3 ring-1 ring-white/8"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[11px] text-white/70">{entry.file.name}</p>
                        <p className="text-[11px] text-white/40">{formatBytes(entry.file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPending((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded-md p-1 text-white/45 transition hover:bg-white/8 hover:text-white"
                        title="Remove from upload queue"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {category === 'movie' && (
                      <label className="mt-2 block">
                        <span className="text-[11px] text-white/50">Movie Title</span>
                        <input
                          value={entry.title}
                          onChange={(ev) =>
                            setPending((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, title: ev.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Movie title"
                          className="mt-1 w-full rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                        />
                      </label>
                    )}

                    {category === 'episode' && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] text-white/50">Episode #</span>
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={entry.episode}
                          onChange={(ev) =>
                            setPending((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, episode: Math.max(1, Number(ev.target.value) || 1) }
                                  : item,
                              ),
                            )
                          }
                          className="w-24 rounded-lg bg-ink-800 px-2.5 py-1 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                        />
                        <span className="truncate font-mono text-[11px] text-white/45">
                          → S{String(season).padStart(2, '0')}E{String(entry.episode).padStart(2, '0')}
                        </span>
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-white/6 px-2.5 py-1 text-[11px] text-white/75 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white">
                        <Subtitles size={12} className="text-accent" />
                        {entry.subtitleFile ? entry.subtitleFile.name : 'Attach Subtitle (.srt/.vtt/.ass)'}
                        <input
                          type="file"
                          accept=".vtt,.srt,.ass,.ssa"
                          className="hidden"
                          onChange={(ev) => {
                            const sub = ev.target.files?.[0] ?? null
                            if (sub) {
                              setPending((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, subtitleFile: sub } : item,
                                ),
                              )
                            }
                            ev.target.value = ''
                          }}
                        />
                      </label>
                      {entry.subtitleFile && (
                        <button
                          type="button"
                          onClick={() =>
                            setPending((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, subtitleFile: null } : item,
                              ),
                            )
                          }
                          className="text-[11px] text-white/45 hover:text-white"
                        >
                          Remove subtitle
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-850 px-3.5 py-2.5 ring-1 ring-white/8">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/50">Audio:</span>
              <button
                type="button"
                onClick={() => setDub(false)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  !dub ? 'bg-accent font-semibold text-black' : 'bg-white/6 text-white/70 hover:text-white'
                }`}
              >
                Sub / Original
              </button>
              <button
                type="button"
                onClick={() => setDub(true)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  dub ? 'bg-accent font-semibold text-black' : 'bg-white/6 text-white/70 hover:text-white'
                }`}
              >
                Dub
              </button>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/75">
              <input
                type="checkbox"
                checked={keepBoth}
                onChange={(ev) => setKeepBoth(ev.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-ink-800 accent-accent"
              />
              Keep both if name exists
            </label>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/12 px-3.5 py-2.5 text-xs text-red-200 ring-1 ring-red-500/30">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-white/8 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/6 px-4 py-2 text-xs font-medium text-white/75 transition hover:bg-white/12 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={startUpload}
            disabled={pending.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload size={14} />
            {pending.length > 1
              ? `Upload ${pending.length} ${category === 'movie' ? 'Movies' : 'Videos'}`
              : `Upload ${category === 'movie' ? 'Movie' : category === 'episode' ? 'Episode' : 'Video'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

interface UploadQueuePanelProps {
  onPlayItem?: (item: LibraryItem) => void
}

function statusBadge(task: UploadTask) {
  switch (task.status) {
    case 'uploading':
      return {
        label: task.resumed ? 'Uploading (resumed)' : 'Uploading',
        cls: 'bg-accent/15 text-accent ring-accent/35',
      }
    case 'retrying':
      return {
        label: `Reconnecting (${task.retryAttempt})…`,
        cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
      }
    case 'finalizing':
      return {
        label: 'Verifying & saving…',
        cls: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
      }
    case 'queued':
      return { label: 'Queued', cls: 'bg-white/8 text-white/70 ring-white/15' }
    case 'paused':
      return { label: 'Paused', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' }
    case 'completed':
      return { label: 'Saved to Library', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' }
    case 'failed':
      return { label: 'Failed (resumable)', cls: 'bg-red-500/15 text-red-300 ring-red-500/30' }
    case 'cancelled':
      return { label: 'Cancelled', cls: 'bg-white/6 text-white/45 ring-white/10' }
  }
}

export function UploadQueuePanel({ onPlayItem }: UploadQueuePanelProps) {
  const { tasks } = useUploads()
  if (tasks.length === 0) return null

  const hasFinished = tasks.some((t) => t.status === 'completed' || t.status === 'cancelled')

  return (
    <section className="rounded-xl bg-ink-900 p-4 ring-1 ring-white/8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Upload size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-white">Local Movie &amp; Video Uploads</h3>
          <span className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[11px] text-white/70 tabular-nums">
            {tasks.length}
          </span>
        </div>
        {hasFinished && (
          <button
            type="button"
            onClick={clearFinishedUploads}
            className="text-xs text-white/50 transition hover:text-white"
          >
            Clear finished
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {tasks.map((task) => {
          const badge = statusBadge(task)
          const speed = formatSpeed(task.speedBps)
          return (
            <div key={task.id} className="rounded-xl bg-ink-850 p-3 ring-1 ring-white/8">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">
                      {task.category === 'movie'
                        ? task.title
                        : task.category === 'episode'
                          ? `${task.title} · S${String(task.season).padStart(2, '0')}E${String(task.episode).padStart(2, '0')}`
                          : task.targetFileName}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-white/45 uppercase">
                      {task.category}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-white/40">
                    library/{task.targetFolder}/{task.targetFileName}
                    {task.subtitleName ? ` · + ${task.subtitleName}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  {task.status === 'completed' && task.item && onPlayItem && (
                    <button
                      type="button"
                      onClick={() => onPlayItem(task.item!)}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/40 transition hover:bg-emerald-500/30"
                    >
                      <Play size={12} className="fill-current" /> Play
                    </button>
                  )}
                  {(task.status === 'uploading' || task.status === 'retrying' || task.status === 'queued') && (
                    <button
                      type="button"
                      onClick={() => pauseUpload(task.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-white/8 px-2.5 py-1 text-xs text-white/80 transition hover:bg-white/12"
                    >
                      <Pause size={12} /> Pause
                    </button>
                  )}
                  {(task.status === 'paused' || task.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => resumeUpload(task.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-black transition hover:bg-accent-600"
                    >
                      <RotateCcw size={12} /> Resume
                    </button>
                  )}
                  {task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'finalizing' && (
                    <button
                      type="button"
                      onClick={() => cancelUpload(task.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-white/8 px-2 py-1 text-xs text-white/70 transition hover:bg-red-500/20 hover:text-red-200"
                      title="Cancel upload"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  {(task.status === 'completed' || task.status === 'cancelled') && (
                    <button
                      type="button"
                      onClick={() => dismissUpload(task.id)}
                      className="rounded-md p-1 text-white/45 transition hover:bg-white/8 hover:text-white"
                      title="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full transition-all duration-150 ${
                    task.status === 'completed'
                      ? 'bg-emerald-400'
                      : task.status === 'failed'
                        ? 'bg-red-400'
                        : task.status === 'paused' || task.status === 'retrying'
                          ? 'bg-amber-400'
                          : 'bg-accent'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
                />
              </div>

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-white/45 tabular-nums">
                <span>
                  {task.status === 'completed' && (
                    <CheckCircle2 size={12} className="mr-1 inline text-emerald-400" />
                  )}
                  {formatBytes(task.uploadedBytes)} / {formatBytes(task.totalSize)} ({task.progress}%)
                </span>
                <span>
                  {speed ? `${speed} · ` : ''}
                  chunk {formatBytes(task.chunkSize)}
                </span>
              </div>

              {task.error && <p className="mt-1.5 text-xs text-red-300">{task.error}</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
