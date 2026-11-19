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
import { AlertTriangle, ChevronLeft, ChevronRight, Download, HardDrive, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, Radio, RotateCw, Volume2, VolumeX, X } from 'lucide-react'
import { api } from '../lib/api'
import { formatEpisodeCode } from '../lib/format'
import { useSettings } from '../lib/settings'
import { createProgressWriter } from '../lib/progressWriter'
import { createWatchSession } from '../lib/watchSession'
import { playerLoadingPhase, readinessLabels } from '../lib/playerLoading'
import { recoveryActionLabel, recoveryActions } from '../lib/playerRecovery'
import { CENTER_BUTTON_IDLE_MS, canUsePictureInPicture, centerButtonVisible, controlBarVisible, escapeAction, formatClock, normalizePlaybackSpeed, PLAYBACK_SPEEDS, seekFractionToTime, shouldTogglePlayback, trackTapToTime } from '../lib/playerControls'
import { actionForKey, effectiveShortcuts } from '../lib/playerShortcuts'
import { saveSettings } from '../lib/settings'
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
      onPrev?: () => void
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
      onPrev?: () => void
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
  // AV-176: separate readiness signals — metadata (loadedmetadata), media
  // (canplay), and mid-play stalls.
  const [metaReady, setMetaReady] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null)
  const [autoCancelled, setAutoCancelled] = useState(false)
  const [pipActive, setPipActive] = useState(false)
  const [fsActive, setFsActive] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // AV-180: the custom control bar's media state.
  const [currentSeconds, setCurrentSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [paused, setPaused] = useState(true)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  // AV-186: idle tracking for the central button's fade.
  const [idle, setIdle] = useState(false)
  const idleTimerRef = useRef<number | null>(null)
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
    setAutoCancelled(false)
    autoPlayedRef.current = false
  }, [source])



  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // AV-179: configurable shortcuts with deterministic dispatch. Typing
      // surfaces keep their keys; a match suppresses the browser default
      // (space/arrows would otherwise act twice on the native controls).
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const action = actionForKey(effectiveShortcuts(settings.playerShortcuts), event.key)
      if (!action) return
      event.preventDefault()
      const video = videoRef.current
      if (action === 'close') {
        // AV-190: Escape exits fullscreen FIRST — never closes the player.
        if (escapeAction(Boolean(document.fullscreenElement)) === 'exit-fullscreen') {
          void document.exitFullscreen().catch(() => {})
        } else {
          onClose()
        }
      } else if (action === 'play-pause') {
        if (!video) return
        if (video.paused) void video.play().catch(() => {})
        else video.pause()
      } else if (action === 'seek-back' && video) {
        // AV-183/184: the skip intervals are user settings (5–600 s).
        video.currentTime = Math.max(0, video.currentTime - settings.skipBackwardSeconds)
      } else if (action === 'seek-forward' && video) {
        const step = settings.skipForwardSeconds
        video.currentTime = Math.min(video.duration || video.currentTime + step, video.currentTime + step)
      } else if (action === 'prev-episode') {
        source.onPrev?.()
      } else if (action === 'next-episode') {
        source.onNext?.()
      } else if (action === 'mute' && video) {
        video.muted = !video.muted
      }
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose, source, settings.playerShortcuts, settings.skipBackwardSeconds, settings.skipForwardSeconds])

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
    // AV-165: private-history mode — playback positions are not recorded.
    if (settings.privateHistoryMode) return
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
  }, [videoSrc, useMse, settings.progressSaveIntervalSeconds, settings.privateHistoryMode])

  // Completion (AV-159): track the ended state so the next-episode action
  // can appear; replaying hides it again. Same re-bind deps as the writer.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = () => {
      setEnded(true)
      setAutoCancelled(false)
    }
    const onPlay = () => setEnded(false)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onPlay)
    return () => {
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('play', onPlay)
    }
  }, [videoSrc, useMse])

  // Playback sessions (AV-166): one record per playback of this source —
  // armed at first play, saved once at ended/unmount. Private mode records
  // nothing (AV-165). Deps follow the <video> key like the writer's; a
  // stream retry remounts and honestly records a second session.
  useEffect(() => {
    const video = videoRef.current
    const mediaId = source.mediaId
    const season = source.seasonKey
    const episode = source.episode
    if (!video || !mediaId || !season || !episode || settings.privateHistoryMode) return
    const session = createWatchSession({
      save: (record) => {
        void api.saveSession({ mediaId, season, episode, ...record }).catch(() => {})
      },
    })
    const onPlay = () => session.play()
    const onTime = () => session.tick(video.currentTime)
    const onEnded = () => session.stop()
    video.addEventListener('play', onPlay)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('ended', onEnded)
      session.stop()
    }
  }, [videoSrc, useMse, settings.privateHistoryMode])

  // AV-176: readiness states reset exactly when the <video> remounts (the
  // element is keyed on videoSrc — source switches AND stream retries).
  useEffect(() => {
    setMetaReady(false)
    setMediaReady(false)
    setBuffering(false)
  }, [videoSrc])

  // AV-188: the remembered playback speed — applied to every element,
  // including the keyed <video> remounts (deps mirror the remount keys).
  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = normalizePlaybackSpeed(settings.playbackSpeed)
  }, [videoSrc, useMse, settings.playbackSpeed])

  // AV-193: the remembered volume level — applied on every keyed remount
  // (mirror of the playback-rate effect). Saved on slider RELEASE, not on
  // every step (see the volume input), so dragging never storms the API.
  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = Math.min(1, Math.max(0, settings.volume))
  }, [videoSrc, useMse, settings.volume])

  // AV-189: PiP state follows the element's own events (enter/leave),
  // re-bound on every keyed remount like the other listeners.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnter = () => setPipActive(true)
    const onLeave = () => setPipActive(false)
    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [videoSrc, useMse])

  // AV-180: the custom control bar's media state — time, duration, paused,
  // volume — re-bound on every keyed remount like the other listeners.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => {
      setCurrentSeconds(video.currentTime)
      setDurationSeconds(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0)
    }
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    const onVolume = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }
    sync()
    onVolume()
    setPaused(video.paused)
    video.addEventListener('timeupdate', sync)
    video.addEventListener('durationchange', sync)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('volumechange', onVolume)
    return () => {
      video.removeEventListener('timeupdate', sync)
      video.removeEventListener('durationchange', sync)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('volumechange', onVolume)
    }
  }, [videoSrc, useMse])

  // AV-186: activity resets a single fade timer — no interval, no
  // re-renders from pointer churn (only the timer outcome changes state).
  const noteActivity = useCallback(() => {
    setIdle(false)
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => setIdle(true), CENTER_BUTTON_IDLE_MS)
  }, [])
  useEffect(() => {
    noteActivity()
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    }
  }, [noteActivity])

  // AV-190: fullscreen state follows `fullscreenchange`, so the button,
  // Esc handling, and the browser's own exit (Esc, F11) never disagree.
  useEffect(() => {
    const onChange = () => setFsActive(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Auto-advance (AV-160): when the toggle is on, the next episode starts
  // after a short countdown the viewer can cancel — or take immediately.
  useEffect(() => {
    if (!ended || !source.onNext || !settings.autoplayNextEpisode || autoCancelled) {
      setAutoCountdown(null)
      return
    }
    let remaining = 5
    setAutoCountdown(remaining)
    const timer = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(timer)
        setAutoCountdown(null)
        source.onNext?.()
      } else {
        setAutoCountdown(remaining)
      }
    }, 1000)
    return () => {
      clearInterval(timer)
      setAutoCountdown(null)
    }
  }, [ended, source, settings.autoplayNextEpisode, autoCancelled])

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
      ref={containerRef}
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

        {/* Episode controls (AV-185): always available while a source
            knows its neighbours; the [source] reset handles the switch. */}
        {source.onPrev ? (
          <button
            type="button"
            onClick={() => source.onPrev?.()}
            className="shrink-0 rounded-full bg-white/5 p-2 text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
            aria-label="Previous episode"
            title="Previous episode"
          >
            <ChevronLeft size={18} />
          </button>
        ) : null}
        {source.onNext ? (
          <button
            type="button"
            onClick={() => source.onNext?.()}
            className="shrink-0 rounded-full bg-white/5 p-2 text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
            aria-label="Next episode"
            title="Next episode"
          >
            <ChevronRight size={18} />
          </button>
        ) : null}

        {/* AV-190: fullscreen with reliable exit (button AND Esc both
            leave fullscreen before the player can ever close). */}
        <button
          type="button"
          onClick={() => {
            void (async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen()
                else await containerRef.current?.requestFullscreen()
              } catch {
                // Best-effort: unsupported contexts refuse; state stays
                // truthful via fullscreenchange either way.
              }
            })()
          }}
          className="shrink-0 rounded-full bg-white/5 p-2 text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
          aria-label={fsActive ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={fsActive ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {fsActive ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>

        {/* AV-189: picture-in-picture, only where the browser allows it. */}
        {canUsePictureInPicture(document) ? (
          <button
            type="button"
            onClick={() => {
              const video = videoRef.current
              if (!video) return
              void (async () => {
                try {
                  if (document.pictureInPictureElement) await document.exitPictureInPicture()
                  else await video.requestPictureInPicture()
                } catch {
                  // Best-effort: gesture/autoplay policies can refuse; the
                  // control stays available and the state never lies.
                }
              })()
            }}
            className={`shrink-0 rounded-full p-2 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white ${
              pipActive ? 'bg-accent/20 text-accent' : 'bg-white/5 text-white/60'
            }`}
            aria-label="Picture in picture"
            title="Picture in picture"
          >
            <PictureInPicture2 size={18} />
          </button>
        ) : null}

        {/* AV-188: speed selection with a remembered preference. */}
        <select
          value={normalizePlaybackSpeed(settings.playbackSpeed)}
          onChange={(event) => {
            void saveSettings({ playbackSpeed: Number(event.target.value) })
          }}
          title="Playback speed"
          aria-label="Playback speed"
          className="shrink-0 rounded-lg bg-white/5 px-2 py-1.5 text-xs text-white/75 ring-1 ring-white/10 outline-none transition hover:bg-white/10"
        >
          {PLAYBACK_SPEEDS.map((speed) => (
            <option key={speed} value={speed} className="bg-ink-800 text-white">
              {speed}×
            </option>
          ))}
        </select>

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
        <div className="relative w-full max-w-6xl" onPointerMove={noteActivity}>
          <video
            ref={videoRef}
            key={`${videoSrc}${useMse ? '-mse' : ''}`}
            src={useMse ? undefined : videoSrc}
            disableRemotePlayback={useMse && mseSupport?.managed ? true : undefined}
            autoPlay
            playsInline
            onClick={(event) => {
              // AV-178: click the picture area to pause/resume — the
              // native-controls strip is excluded (it already acts).
              const el = event.currentTarget
              if (!shouldTogglePlayback(event.nativeEvent.offsetY, el.getBoundingClientRect().height)) return
              if (el.paused) void el.play().catch(() => {})
              else el.pause()
            }}
            onLoadedMetadata={() => {
              setLoading(false)
              setMetaReady(true)
            }}
            onCanPlay={(event) => {
              setLoading(false)
              setMediaReady(true)
              if (!autoPlayedRef.current) {
                autoPlayedRef.current = true
                const el = event.currentTarget
                if (el.paused) void el.play().catch(() => {})
              }
            }}
            onWaiting={() => setBuffering(true)}
            onStalled={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
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

          {/* AV-180: the custom control bar (replaces the native controls
              per the TODO subtask split) — play/pause, seek + times, and
              volume so nothing the native bar provided is lost. AV-186's
              centre button and AV-187's pointer-movement persistence
              share one chrome-visibility policy: the whole surface fades
              when idle while playing and reappears on movement (paused
              keeps it up). */}
          {!error ? (
            <div
              className={`absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-b-xl bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2 pt-7 text-white/85 transition-opacity duration-300 ${
                controlBarVisible(paused, idle) ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current
                  if (!video) return
                  if (video.paused) void video.play().catch(() => {})
                  else video.pause()
                }}
                className="shrink-0 rounded-full bg-white/10 p-2 transition hover:bg-white/20 hover:text-white"
                aria-label={paused ? 'Play' : 'Pause'}
                title={paused ? 'Play' : 'Pause'}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
              </button>
              <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-white/70">
                {formatClock(currentSeconds)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={durationSeconds > 0 ? Math.min(1, currentSeconds / durationSeconds) : 0}
                onChange={(event) => {
                  const video = videoRef.current
                  if (!video) return
                  video.currentTime = seekFractionToTime(Number(event.target.value), durationSeconds)
                }}
                onPointerDown={(event) => {
                  // AV-182: explicit tap-to-seek on touch — mobile range
                  // track-tap behavior varies by browser; this maps the
                  // touch point deterministically. Where the native jump
                  // also applies, both land on the same time (idempotent).
                  if (event.pointerType !== 'touch') return
                  const video = videoRef.current
                  if (!video) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  video.currentTime = trackTapToTime(event.clientX, rect.left, rect.width, durationSeconds)
                }}
                aria-label="Seek"
                className="h-1.5 flex-1 cursor-pointer accent-[var(--color-accent)]"
              />
              <span className="w-12 shrink-0 text-[11px] tabular-nums text-white/70">
                {formatClock(durationSeconds)}
              </span>
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current
                  if (!video) return
                  video.muted = !video.muted
                }}
                className="shrink-0 rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label={muted ? 'Unmute' : 'Mute'}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  const video = videoRef.current
                  if (!video) return
                  const next = Number(event.target.value)
                  video.volume = next
                  if (next > 0 && video.muted) video.muted = false
                }}
                onPointerUp={(event) => {
                  // AV-193: persist on release — one save per gesture.
                  void saveSettings({ volume: Number(event.currentTarget.value) })
                }}
                onKeyUp={(event) => {
                  // keyboard steps save on key release (same one-save rule).
                  void saveSettings({ volume: Number(event.currentTarget.value) })
                }}
                aria-label="Volume"
                className="h-1.5 w-16 shrink-0 cursor-pointer accent-[var(--color-accent)]"
              />
            </div>
          ) : null}

          {/* AV-186: the central play/pause — always shown when paused,
              fading after an idle window while playing. */}
          {!error ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current
                  if (!video) return
                  if (video.paused) void video.play().catch(() => {})
                  else video.pause()
                }}
                aria-label={paused ? 'Play' : 'Pause'}
                title={paused ? 'Play' : 'Pause'}
                className={`rounded-full bg-black/55 p-5 text-white/90 ring-1 ring-white/15 backdrop-blur-sm transition-opacity duration-300 hover:bg-black/70 ${
                  centerButtonVisible(paused, idle) ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                {paused ? <Play size={30} /> : <Pause size={30} />}
              </button>
            </div>
          ) : null}

          {/* AV-176: loading state with SEPARATE metadata and media
              readiness — the two signals are shown side by side, and the
              media line also covers mid-play stalls. */}
          {(() => {
            const phase = playerLoadingPhase(loading, metaReady, mediaReady, buffering)
            if (phase === 'ready' || error) return null
            const labels = readinessLabels(metaReady, mediaReady, buffering)
            return (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/35">
                <div className="flex flex-col gap-1 rounded-2xl bg-black/70 px-4 py-2.5 text-xs text-white/70 ring-1 ring-white/10">
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    <span>{labels.metadata}</span>
                  </div>
                  <div className="flex items-center gap-2 pl-[22px]">
                    <span>
                      {phase === 'resolving'
                        ? urls.live
                          ? 'Resolving stream…'
                          : 'Opening local file…'
                        : labels.media}
                    </span>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Completion (AV-159/160): the next-episode action after
              playback ends — auto-advance countdown when enabled, manual
              otherwise. The native controls stay usable underneath. */}
          {ended && !error && source.onNext ? (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center rounded-xl bg-gradient-to-t from-black/80 to-transparent pb-14">
              <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/80 px-5 py-3 ring-1 ring-white/10">
                {autoCountdown !== null ? (
                  <>
                    <span className="text-sm text-white/80">Playing next episode in {autoCountdown}s</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAutoCancelled(true)
                        source.onNext?.()
                      }}
                      className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-accent/85"
                    >
                      Play now
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoCancelled(true)}
                      className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/20"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          ) : null}

          {/* AV-177: a real error screen — clear heading, the specific
              detail, and the ordered recovery actions (retry, path switch,
              escape hatches, close) from the tested selection logic. */}
          {error
            ? (() => {
                const actions = recoveryActions({
                  sourceKind: source.kind,
                  onPrimaryPath:
                    source.kind === 'live' ? useMse : Boolean(source.directPlayable && !localRemuxFallback),
                  downloadAvailable: Boolean(urls.download),
                })
                const act = (action: string) => {
                  if (action === 'retry') {
                    setError(null)
                    setLoading(true)
                    setMseFallback(false)
                    setLocalRemuxFallback(false)
                    setAttempt((value) => value + 1)
                  } else if (action === 'alternative') {
                    setError(null)
                    setLoading(true)
                    if (source.kind === 'live') setMseFallback(true)
                    else setLocalRemuxFallback(true)
                    setAttempt((value) => value + 1)
                  } else if (action === 'close') {
                    onClose()
                  }
                }
                return (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/85 px-6 text-center">
                    <AlertTriangle size={28} className="text-amber-300" />
                    <h3 className="text-sm font-semibold text-white">
                      Couldn't play this {source.kind === 'local' ? 'file' : 'stream'}
                    </h3>
                    <p className="max-w-md text-sm leading-relaxed text-white/70">{error}</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {actions.map((action) =>
                        action === 'download' ? (
                          <a
                            key={action}
                            href={urls.download ?? undefined}
                            download={urls.fileName ?? undefined}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/85 ring-1 ring-white/15 transition hover:bg-white/15"
                          >
                            <Download size={13} />
                            {recoveryActionLabel(action, source.kind)}
                          </a>
                        ) : (
                          <button
                            key={action}
                            type="button"
                            onClick={() => act(action)}
                            className={
                              action === 'retry'
                                ? 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition hover:bg-accent-600'
                                : 'inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/85 ring-1 ring-white/15 transition hover:bg-white/15'
                            }
                          >
                            {action === 'retry' ? <RotateCw size={13} /> : null}
                            {action === 'close' ? <X size={13} /> : null}
                            {recoveryActionLabel(action, source.kind)}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )
              })()
            : null}
        </div>
      </div>
    </div>
  )
}
