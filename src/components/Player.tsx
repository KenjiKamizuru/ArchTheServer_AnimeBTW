import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, Download, HardDrive, Loader2, Radio, RotateCw, X } from 'lucide-react'
import { api } from '../lib/api'
import { formatEpisodeCode } from '../lib/format'
import { useSettings } from '../lib/settings'
import { createProgressWriter } from '../lib/progressWriter'
import { concatBytes, Mp4BoxTracker, selectMseMimeType } from '../lib/mp4'
import type { LibraryItem } from '../types'

const BASE_MSE_TYPE = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'
const MAX_BUFFER_AHEAD = 90
const KEEP_BUFFER_BEHIND = 30
const EVICT_MIN_SECONDS = 15
const MAX_QUEUED_BYTES = 8 * 1024 * 1024

type MediaSourceCtor = typeof MediaSource

function getMediaSourceSupport(): { Ctor: MediaSourceCtor; managed: boolean } | null {
  if (typeof window === 'undefined') return null
  if (typeof MediaSource === 'function' && MediaSource.isTypeSupported(BASE_MSE_TYPE)) {
    return { Ctor: MediaSource, managed: false }
  }
  const managed = (globalThis as { ManagedMediaSource?: MediaSourceCtor }).ManagedMediaSource
  if (typeof managed === 'function' && managed.isTypeSupported(BASE_MSE_TYPE)) {
    return { Ctor: managed, managed: true }
  }
  return null
}

function bufferedAheadSeconds(video: HTMLVideoElement): number {
  const now = video.currentTime
  const ranges = video.buffered
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i)
    const end = ranges.end(i)
    if (now >= start - 0.5 && now <= end + 0.5) {
      return Math.max(0, end - now)
    }
  }
  return 0
}

export type PlaybackSource =
  | {
      kind: 'live'
      title: string
      episode?: number | null
      query: string
      resultIndex?: number
      quality?: string
      dub?: boolean
      mediaId?: number | null
      seasonKey?: string
      onNext?: () => void
    }
  | {
      kind: 'local'
      id: string
      title: string
      fileName: string
      season?: number | null
      episode?: number | null
      hasSubtitle: boolean
      directPlayable: boolean
      mediaId?: number | null
      seasonKey?: string
      onNext?: () => void
    }

export function localItemToPlayback(item: LibraryItem): PlaybackSource {
  return {
    kind: 'local',
    id: item.id,
    title: item.animeTitle || item.seriesTitle || item.fileName,
    fileName: item.fileName,
    season: item.season,
    episode: item.episode,
    hasSubtitle: item.hasSubtitle,
    directPlayable: item.directPlayable,
  }
}

interface PlayerControls {
  open: (source: PlaybackSource) => void
  close: () => void
}

const PlayerContext = createContext<PlayerControls>({
  open: () => {},
  close: () => {},
})

export function usePlayer() {
  return useContext(PlayerContext)
}

function sourcesFor(source: PlaybackSource, forceLocalRemux: boolean) {
  if (source.kind === 'local') {
    const needsRemux = !source.directPlayable || forceLocalRemux
    return {
      video: api.localStreamUrl(source.id, { remux: needsRemux }),
      subtitle: source.hasSubtitle ? api.localSubtitleUrl(source.id) : null,
      download: api.localDownloadUrl(source.id),
      fileName: source.fileName,
      live: false,
      streamedFmp4: needsRemux,
    }
  }
  const params = {
    query: source.query,
    resultIndex: source.resultIndex,
    episode: source.episode ?? 1,
    quality: source.quality,
    dub: source.dub,
  }
  return {
    video: api.liveStreamUrl(params),
    subtitle: api.liveSubtitleUrl(params),
    download: null,
    fileName: null,
    live: true,
    streamedFmp4: true,
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<PlaybackSource | null>(null)

  const open = useCallback((next: PlaybackSource) => setSource(next), [])
  const close = useCallback(() => setSource(null), [])
  const controls = useMemo(() => ({ open, close }), [open, close])

  return (
    <PlayerContext.Provider value={controls}>
      {children}
      {source ? <PlayerOverlay source={source} onClose={close} /> : null}
    </PlayerContext.Provider>
  )
}

function PlayerOverlay({ source, onClose }: { source: PlaybackSource; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mseFallback, setMseFallback] = useState(false)
  const [localRemuxFallback, setLocalRemuxFallback] = useState(false)
  const [ended, setEnded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const autoPlayedRef = useRef(false)
  const settings = useSettings()
  const urls = useMemo(() => sourcesFor(source, localRemuxFallback), [source, localRemuxFallback])

  // Standard local MP4 files play natively via HTTP byte-range requests (instant
  // seeking, zero transcoding). Fragmented MP4 remux streams (live playback or
  // non-native local containers) feed through MediaSource / ManagedMediaSource
  // so Firefox and Safari preserve both video and audio cleanly.
  const mseSupport = useMemo(() => getMediaSourceSupport(), [])
  const useMse = urls.streamedFmp4 && Boolean(mseSupport) && !mseFallback

  useEffect(() => {
    setAttempt(0)
    setLoading(true)
    setError(null)
    setMseFallback(false)
    setLocalRemuxFallback(false)
    setEnded(false)
    autoPlayedRef.current = false
  }, [source])



  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  const videoSrc = `${urls.video}${urls.video.includes('?') ? '&' : '?'}attempt=${attempt}`
  const subtitleSrc = urls.subtitle
    ? `${urls.subtitle}${urls.subtitle.includes('?') ? '&' : '?'}attempt=${attempt}`
    : null
  const heading =
    source.kind === 'local'
      ? source.episode
        ? `${source.title} · ${formatEpisodeCode(source.season, source.episode)}`
        : source.title
      : source.episode
        ? `${source.title} · EP ${source.episode}`
        : source.title

  // Playback-position writer (AV-153): stores the position at the
  // configured interval while playing, and flushes on stop/ended/unmount.
  // Only sources with a STABLE identity report (mediaId + season key + a
  // real episode number) — the server derives completion (AV-155) and
  // preserves manual marks (AV-154/156). Deps follow the <video> key
  // (videoSrc/useMse): a stream retry REMOUNTS the element, and the
  // listeners must re-bind to the new one.
  useEffect(() => {
    const video = videoRef.current
    const mediaId = source.mediaId
    const season = source.seasonKey
    const episode = source.episode
    if (!video || !mediaId || !season || !episode) return
    const writer = createProgressWriter({
      intervalSeconds: settings.progressSaveIntervalSeconds,
      save: (record) => api.saveProgress(record),
    })
    const report = () => {
      const duration = video.duration
      writer.report({
        mediaId,
        season,
        episode,
        positionSeconds: video.currentTime,
        runtimeSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
      })
    }
    const onEnded = () => {
      report()
      void writer.stop()
    }
    video.addEventListener('timeupdate', report)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('timeupdate', report)
      video.removeEventListener('ended', onEnded)
      void writer.stop()
    }
  }, [videoSrc, useMse, settings.progressSaveIntervalSeconds])

  // Completion (AV-159): track the ended state so the next-episode action
  // can appear; replaying hides it again. Same re-bind deps as the writer.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = () => setEnded(true)
    const onPlay = () => setEnded(false)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onPlay)
    return () => {
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('play', onPlay)
    }
  }, [videoSrc, useMse])

  useEffect(() => {
    autoPlayedRef.current = false
    if (!useMse || !mseSupport) return
    const video = videoRef.current
    if (!video) return

    const { Ctor } = mseSupport
    const mediaSource = new Ctor()
    const objectUrl = URL.createObjectURL(mediaSource)
    const controller = new AbortController()
    const tracker = new Mp4BoxTracker()
    const initChunks: Uint8Array[] = []
    const queue: Uint8Array[] = []
    let queuedBytes = 0
    let sourceBuffer: SourceBuffer | null = null
    let streamEnded = false
    let quotaBlocked = false
    let aborted = false
    let wakeReader: (() => void) | null = null

    const wake = () => {
      const fn = wakeReader
      if (fn) {
        wakeReader = null
        fn()
      }
    }

    const waitForDrain = () =>
      new Promise<void>((resolve) => {
        if (aborted) {
          resolve()
          return
        }
        wakeReader = resolve
      })

    const fail = (message?: string) => {
      if (aborted) return
      aborted = true
      controller.abort()
      wake()
      setLoading(false)
      setError(message || 'The stream ended before it could be played. Try again.')
    }

    const fallbackToDirect = () => {
      if (aborted) return
      aborted = true
      controller.abort()
      wake()
      setMseFallback(true)
    }

    const tryEvict = (keepBehind: number): boolean => {
      if (!sourceBuffer || sourceBuffer.updating || sourceBuffer.buffered.length === 0) return false
      const start = sourceBuffer.buffered.start(0)
      const removeEnd = video.currentTime - keepBehind
      if (removeEnd <= start + 1) return false
      try {
        sourceBuffer.remove(start, removeEnd)
        return true
      } catch {
        return false
      }
    }

    const flush = () => {
      if (aborted || !sourceBuffer || sourceBuffer.updating || mediaSource.readyState !== 'open') {
        return
      }

      if (
        queue.length > 0 &&
        tracker.atSegmentBoundary &&
        video.currentTime > KEEP_BUFFER_BEHIND + EVICT_MIN_SECONDS &&
        sourceBuffer.buffered.length > 0 &&
        video.currentTime - KEEP_BUFFER_BEHIND - sourceBuffer.buffered.start(0) >= EVICT_MIN_SECONDS
      ) {
        if (tryEvict(KEEP_BUFFER_BEHIND)) return
      }

      if (queue.length > 0) {
        const next = queue[0]
        try {
          sourceBuffer.appendBuffer(next as BufferSource)
          queue.shift()
          queuedBytes -= next.byteLength
          quotaBlocked = false
          tracker.push(next)
          if (queuedBytes < MAX_QUEUED_BYTES / 2) wake()
        } catch (err) {
          if (err instanceof DOMException && err.name === 'QuotaExceededError') {
            quotaBlocked = true
            tryEvict(5)
            return
          }
          if (video.readyState === 0) {
            fallbackToDirect()
          } else {
            fail()
          }
        }
        return
      }

      wake()
      if (streamEnded && mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream()
        } catch {
          /* already ended */
        }
      }
    }

    const onSourceBufferError = () => {
      if (aborted) return
      if (video.readyState === 0) {
        fallbackToDirect()
      } else {
        fail('Playback was interrupted while decoding the stream. Try again.')
      }
    }

    const onProgress = () => {
      if (aborted) return
      if (quotaBlocked) flush()
      if (bufferedAheadSeconds(video) < MAX_BUFFER_AHEAD * 0.75) wake()
    }

    const onSourceOpen = () => {
      if (aborted) return
      void (async () => {
        try {
          const response = await fetch(videoSrc, { signal: controller.signal })
          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null
            fail(payload?.error)
            return
          }
          if (!response.body) {
            fail()
            return
          }

          const reader = response.body.getReader()
          for (;;) {
            while (
              !aborted &&
              sourceBuffer &&
              (quotaBlocked ||
                queuedBytes >= MAX_QUEUED_BYTES ||
                bufferedAheadSeconds(video) >= MAX_BUFFER_AHEAD)
            ) {
              await waitForDrain()
            }
            if (aborted) break

            const { done, value } = await reader.read()
            if (done) break
            if (!value || value.byteLength === 0) continue

            if (!sourceBuffer) {
              initChunks.push(value)
              const merged = concatBytes(initChunks)
              const mime = selectMseMimeType(merged, (type) => Ctor.isTypeSupported(type))
              if (mime === 'need-more') continue
              if (!mime || mediaSource.readyState !== 'open') {
                fallbackToDirect()
                return
              }
              try {
                sourceBuffer = mediaSource.addSourceBuffer(mime)
              } catch {
                fallbackToDirect()
                return
              }
              initChunks.length = 0
              sourceBuffer.addEventListener('updateend', flush)
              sourceBuffer.addEventListener('error', onSourceBufferError)
              queue.push(merged)
              queuedBytes += merged.byteLength
              flush()
              continue
            }

            queue.push(value)
            queuedBytes += value.byteLength
            flush()
          }

          if (aborted) return
          if (!sourceBuffer) {
            fail()
            return
          }
          streamEnded = true
          flush()
        } catch {
          fail()
        }
      })()
    }

    video.addEventListener('timeupdate', onProgress)
    video.addEventListener('seeking', onProgress)
    video.addEventListener('ratechange', onProgress)
    mediaSource.addEventListener('sourceopen', onSourceOpen, { once: true })
    video.src = objectUrl

    return () => {
      aborted = true
      controller.abort()
      wake()
      mediaSource.removeEventListener('sourceopen', onSourceOpen)
      video.removeEventListener('timeupdate', onProgress)
      video.removeEventListener('seeking', onProgress)
      video.removeEventListener('ratechange', onProgress)
      if (sourceBuffer) {
        sourceBuffer.removeEventListener('updateend', flush)
        sourceBuffer.removeEventListener('error', onSourceBufferError)
        try {
          if (mediaSource.readyState === 'open' && sourceBuffer.updating) {
            sourceBuffer.abort()
          }
        } catch {
          /* already closed */
        }
      }
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(objectUrl)
    }
  }, [videoSrc, useMse, mseSupport])

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-ink-950/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-white/90 md:text-base">{heading}</p>
            {urls.live ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
                <Radio size={10} />
                Live
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300 uppercase">
                <HardDrive size={10} />
                Local
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-white/35">
            {urls.live ? 'Streaming' : `Shared library · ${urls.fileName}`}
          </p>
        </div>

        {urls.download ? (
          <a
            href={urls.download}
            download={urls.fileName ?? undefined}
            title="Download file to this device"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Save file</span>
          </a>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full bg-white/5 p-2 text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
          aria-label="Close player"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-2 md:p-6">
        <div className="relative w-full max-w-6xl">
          <video
            ref={videoRef}
            key={`${videoSrc}${useMse ? '-mse' : ''}`}
            src={useMse ? undefined : videoSrc}
            disableRemotePlayback={useMse && mseSupport?.managed ? true : undefined}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={() => setLoading(false)}
            onCanPlay={(event) => {
              setLoading(false)
              if (!autoPlayedRef.current) {
                autoPlayedRef.current = true
                const el = event.currentTarget
                if (el.paused) void el.play().catch(() => {})
              }
            }}
            onError={(event) => {
              if (useMse && event.currentTarget.readyState === 0) {
                setMseFallback(true)
                return
              }
              if (
                source.kind === 'local' &&
                source.directPlayable &&
                !localRemuxFallback &&
                event.currentTarget.readyState === 0
              ) {
                setLoading(true)
                setLocalRemuxFallback(true)
                return
              }
              setLoading(false)
              setError(
                source.kind === 'local'
                  ? 'This local file could not be decoded in the browser. You can still download it directly using "Save file" above.'
                  : 'This stream could not be played in the browser. Try again, or pick a different quality in Settings.',
              )
            }}
            className="max-h-[calc(100vh-8rem)] w-full rounded-xl bg-black shadow-2xl ring-1 ring-white/10"
          >
            {subtitleSrc ? (
              <track kind="subtitles" src={subtitleSrc} srcLang="en" default label="Subtitles" />
            ) : null}
          </video>

          {loading && !error ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/35">
              <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs text-white/70 ring-1 ring-white/10">
                <Loader2 size={14} className="animate-spin text-accent" />
                {urls.live ? 'Resolving stream…' : 'Opening local file…'}
              </div>
            </div>
          ) : null}

          {/* Completion (AV-159): the next-episode action after playback
              ends. The native controls stay usable underneath. */}
          {ended && !error && source.onNext ? (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center rounded-xl bg-gradient-to-t from-black/80 to-transparent pb-14">
              <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/80 px-5 py-3 ring-1 ring-white/10">
                <span className="text-sm text-white/80">Episode finished</span>
                <button
                  type="button"
                  onClick={() => {
                    setEnded(false)
                    source.onNext?.()
                  }}
                  className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-accent/85"
                >
                  Play next episode
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/20"
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/85 px-6 text-center">
              <AlertTriangle size={28} className="text-amber-300" />
              <p className="max-w-md text-sm leading-relaxed text-white/70">{error}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setLoading(true)
                    setMseFallback(false)
                    setLocalRemuxFallback(false)
                    setAttempt((value) => value + 1)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
                >
                  <RotateCw size={13} />
                  Try again
                </button>
                {urls.download ? (
                  <a
                    href={urls.download}
                    download={urls.fileName ?? undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/85 ring-1 ring-white/15 transition hover:bg-white/15"
                  >
                    <Download size={13} />
                    Save file to device
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
