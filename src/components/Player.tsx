import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, Loader2, Radio, RotateCw, X } from 'lucide-react'
import { api } from '../lib/api'

export type PlaybackSource =
  | {
      kind: 'job'
      id: string
      title: string
      episode?: number | null
      filename: string
      live?: boolean
    }
  | {
      kind: 'file'
      relPath: string
      title: string
      filename: string
    }
  | {
      kind: 'live'
      title: string
      episode?: number | null
      query: string
      resultIndex?: number
      quality?: string
      dub?: boolean
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

const DIRECT_CONTAINER = /\.(mp4|m4v|webm|mov)$/i

function sourcesFor(source: PlaybackSource) {
  if (source.kind === 'job') {
    if (source.live) {
      return {
        video: api.liveJobUrl(source.id),
        subtitle: api.liveJobSubtitleUrl(source.id),
        download: null,
        live: true,
      }
    }
    const remux = !DIRECT_CONTAINER.test(source.filename)
    return {
      video: remux ? api.transcodeUrl(source.id) : api.streamUrl(source.id),
      subtitle: api.subtitleUrl(source.id),
      download: api.fileUrl(source.id),
      live: false,
    }
  }

  if (source.kind === 'file') {
    const remux = !DIRECT_CONTAINER.test(source.filename)
    return {
      video: remux ? api.extraTranscodeUrl(source.relPath) : api.extraStreamUrl(source.relPath),
      subtitle: api.extraSubtitleUrl(source.relPath),
      download: api.extraFileUrl(source.relPath),
      live: false,
    }
  }

  return {
    video: api.liveStreamUrl({
      query: source.query,
      resultIndex: source.resultIndex,
      episode: source.episode ?? 1,
      quality: source.quality,
      dub: source.dub,
    }),
    subtitle: api.liveSubtitleUrl({
      query: source.query,
      resultIndex: source.resultIndex,
      episode: source.episode ?? 1,
      quality: source.quality,
      dub: source.dub,
    }),
    download: null,
    live: true,
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
  const urls = useMemo(() => sourcesFor(source), [source])

  useEffect(() => {
    setAttempt(0)
    setLoading(true)
    setError(null)
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
  const subtitleSrc = `${urls.subtitle}${urls.subtitle.includes('?') ? '&' : '?'}attempt=${attempt}`
  const heading =
    'episode' in source && source.episode ? `${source.title} · EP ${source.episode}` : source.title

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-950/95 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-white/90 md:text-base">{heading}</p>
            {urls.live ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
                <Radio size={10} />
                Live
              </span>
            ) : null}
          </div>
          <p className="truncate text-[11px] text-white/35">
            {urls.live ? 'Streaming from ani-cli while it downloads' : 'Playing from the local library'}
          </p>
        </div>
        {urls.download ? (
          <a
            href={urls.download}
            className="hidden shrink-0 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-white/55 ring-1 ring-white/10 transition hover:text-white sm:block"
          >
            Save file
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
            key={`${videoSrc}`}
            src={videoSrc}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            onError={() =>
              setError(
                'This file could not be played in the browser. Try again, or use the Save file button and open it in a local player.',
              )
            }
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
                {urls.live ? 'Resolving stream…' : 'Loading…'}
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
                    className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/15"
                  >
                    Save file
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
