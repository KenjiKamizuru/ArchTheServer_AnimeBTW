import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { HardDrive, Play, RefreshCw, Save, Trash2, X } from 'lucide-react'
import type { LibraryEntry } from '../types'
import { api } from '../lib/api'
import { useJobs } from '../lib/downloads'
import { useAsync } from '../lib/hooks'
import { bytes, exactDate } from '../lib/format'
import { useSettings } from '../lib/settings'
import { DownloadsTabs } from '../components/DownloadsTabs'
import { useDetail } from '../components/MediaModal'
import { usePlayer } from '../components/Player'
import { useToast } from '../components/Toasts'

interface Group {
  mediaId: number
  files: LibraryEntry[]
}

const byEpisode = (a: LibraryEntry, b: LibraryEntry) =>
  (a.episode ?? 0) - (b.episode ?? 0) || a.filename.localeCompare(b.filename)

export default function Downloaded() {
  const jobs = useJobs()
  const settings = useSettings()
  const toast = useToast()
  const openDetail = useDetail()
  const player = usePlayer()
  const [items, setItems] = useState<LibraryEntry[]>([])
  const [dir, setDir] = useState('')
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)

  const completed = jobs.filter((j) => j.status === 'completed').length

  const load = useCallback(() => {
    let alive = true
    setLoading(true)
    api
      .library()
      .then((res) => {
        if (!alive) return
        setItems(res.items)
        setDir(res.dir)
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(load, [load, completed, version])

  const { matched, others } = useMemo(() => {
    const map = new Map<number, LibraryEntry[]>()
    const loose: LibraryEntry[] = []
    for (const item of items) {
      if (item.mediaId) {
        const list = map.get(item.mediaId) ?? []
        list.push(item)
        map.set(item.mediaId, list)
      } else {
        loose.push(item)
      }
    }
    const groups: Group[] = [...map.entries()]
      .map(([mediaId, files]) => ({ mediaId, files: files.sort(byEpisode) }))
      .sort((a, b) => {
        const latest = (g: Group) => Math.max(...g.files.map((f) => f.finishedAt ?? 0))
        return latest(b) - latest(a)
      })
    return { matched: groups, others: loose.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)) }
  }, [items])

  const idsKey = matched.map((g) => g.mediaId).join(',')
  const { data: meta, reload: reloadMeta } = useAsync(
    () => api.mediaMany(matched.map((g) => g.mediaId)),
    [idsKey],
  )
  const metaMap = useMemo(() => new Map((meta?.media ?? []).map((m) => [m.id, m])), [meta])

  const totalSize = items.reduce((sum, entry) => sum + (entry.size || 0), 0)

  async function removeFile(entry: LibraryEntry) {
    if (!window.confirm(`Delete "${entry.filename}" from the library?`)) return
    try {
      if (entry.tracked) await api.removeDownload(entry.id)
      else await api.removeExtra(entry.relPath ?? '')
      setItems((list) => list.filter((i) => i.id !== entry.id))
      setVersion((v) => v + 1)
      toast('File deleted')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the file', 'err')
    }
  }

  async function removeGroup(group: Group) {
    if (!window.confirm(`Delete all ${group.files.length} file(s) for this show?`)) return
    let removed = 0
    for (const entry of group.files) {
      try {
        if (entry.tracked) await api.removeDownload(entry.id)
        else await api.removeExtra(entry.relPath ?? '')
        removed += 1
      } catch {
        /* keep going; report the count below */
      }
    }
    setVersion((v) => v + 1)
    setItems((list) => list.filter((i) => !group.files.some((f) => f.id === i.id)))
    toast(removed === group.files.length ? 'Show removed from the library' : `Removed ${removed} of ${group.files.length}`)
  }

  return (
    <div>
      <DownloadsTabs />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Downloaded</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {items.length
              ? `${items.length} file${items.length === 1 ? '' : 's'} on disk · ${bytes(totalSize)}`
              : 'Everything you download shows up here.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setVersion((v) => v + 1)
              reloadMeta()
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-850 px-2.5 py-1.5 text-[11px] text-white/55 ring-1 ring-white/5 transition hover:text-white"
          >
            <RefreshCw size={12} />
            Rescan
          </button>
        </div>
      </div>

      {dir ? (
        <p className="mt-2 flex items-center gap-1.5 truncate text-[11px] text-white/25" title={dir}>
          <HardDrive size={12} className="shrink-0" />
          {dir}
        </p>
      ) : null}

      {loading && !items.length ? (
        <div className="mt-6 h-28 animate-pulse rounded-xl bg-ink-900" />
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl bg-ink-900 p-10 text-center ring-1 ring-white/5">
          <HardDrive size={30} className="mx-auto text-white/20" />
          <h2 className="mt-3 text-sm font-medium text-white/70">No downloaded files yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/40">
            Queue an episode and it appears here with its show, episode number and size. Files you copy into{' '}
            <span className="text-white/60">{settings.libraryDir || 'library/'}</span> are picked up too.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
          >
            Browse this season
          </Link>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {matched.map((group) => {
            const media = metaMap.get(group.mediaId)
            const size = group.files.reduce((sum, f) => sum + (f.size || 0), 0)

            return (
              <div key={group.mediaId} className="rounded-xl bg-ink-900 p-3 ring-1 ring-white/5">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => openDetail(group.mediaId)}
                    className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/5"
                    aria-label={`Open ${media?.title ?? 'show'}`}
                  >
                    {media?.cover ? (
                      <img
                        src={media.cover}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openDetail(group.mediaId)}
                        className="min-w-0 text-left"
                      >
                        <p className="truncate text-sm font-medium text-white/90 transition hover:text-accent">
                          {media?.title ?? group.files[0]?.title ?? 'Unknown show'}
                        </p>
                        <p className="text-[11px] text-white/40">
                          {group.files.length} file{group.files.length === 1 ? '' : 's'} · {bytes(size)}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeGroup(group)}
                        className="shrink-0 rounded-md p-1.5 text-white/35 transition hover:bg-white/5 hover:text-red-300"
                        aria-label="Delete all files for this show"
                        title="Delete all files for this show"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="mt-2 space-y-1">
                      {group.files.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
                        >
                          <span className="shrink-0 text-[11px] font-medium text-white/70">
                            {file.episode ? `EP ${file.episode}` : 'FILE'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-white/35" title={file.filename}>
                            {file.filename}
                          </span>
                          <span className="shrink-0 text-[11px] text-white/30 tabular-nums">
                            {bytes(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              player.open(
                                file.tracked
                                  ? {
                                      kind: 'job',
                                      id: file.id,
                                      title: file.title,
                                      episode: file.episode,
                                      filename: file.filename,
                                    }
                                  : {
                                      kind: 'file',
                                      relPath: file.relPath ?? '',
                                      title: file.title,
                                      filename: file.filename,
                                    },
                              )
                            }
                            className="shrink-0 rounded p-1 text-white/35 transition hover:text-accent"
                            aria-label={`Play ${file.filename}`}
                            title="Play"
                          >
                            <Play size={13} className="fill-current" />
                          </button>
                          <a
                            href={
                              file.tracked
                                ? api.fileUrl(file.id)
                                : api.extraFileUrl(file.relPath ?? '')
                            }
                            className="shrink-0 rounded p-1 text-white/35 transition hover:text-accent"
                            aria-label="Save to device"
                            title="Save to device"
                          >
                            <Save size={13} />
                          </a>
                          <button
                            type="button"
                            onClick={() => void removeFile(file)}
                            className="shrink-0 rounded p-1 text-white/35 transition hover:text-red-300"
                            aria-label={`Delete ${file.filename}`}
                            title="Delete file"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {others.length ? (
            <div className="rounded-xl bg-ink-900 p-3 ring-1 ring-white/5">
              <p className="text-sm font-medium text-white/80">Other files</p>
              <p className="text-[11px] text-white/40">
                Added by hand to {settings.libraryDir || 'library/'}
              </p>
              <div className="mt-2 space-y-1">
                {others.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-white/50">{file.filename}</span>
                    <span className="shrink-0 text-[11px] text-white/30 tabular-nums">{bytes(file.size)}</span>
                    <span className="shrink-0 text-[10px] text-white/25">{exactDate(file.finishedAt)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        player.open({
                          kind: 'file',
                          relPath: file.relPath ?? '',
                          title: file.title,
                          filename: file.filename,
                        })
                      }
                      className="shrink-0 rounded p-1 text-white/35 transition hover:text-accent"
                      aria-label={`Play ${file.filename}`}
                      title="Play"
                    >
                      <Play size={13} className="fill-current" />
                    </button>
                    <a
                      href={api.extraFileUrl(file.relPath ?? '')}
                      className="shrink-0 rounded p-1 text-white/35 transition hover:text-accent"
                      aria-label="Save to device"
                    >
                      <Save size={13} />
                    </a>
                    <button
                      type="button"
                      onClick={() => void removeFile(file)}
                      className="shrink-0 rounded p-1 text-white/35 transition hover:text-red-300"
                      aria-label={`Delete ${file.filename}`}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
