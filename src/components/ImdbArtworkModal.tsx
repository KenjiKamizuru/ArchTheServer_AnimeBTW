import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Monitor,
  Search,
  Sparkles,
  SquareUser,
  Star,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import type {
  ArtworkFocus,
  ArtworkSlot,
  ArtworkTargetType,
  ImdbImageItem,
  ImdbSearchItem,
  ImdbTitleResult,
} from '../types'
import { api } from '../lib/api'
import {
  artworkForTarget,
  claimArtworkSlot,
  claimArtworkSlots,
  focusObjectClass,
  parseImdbIdClient,
  removeArtwork,
  setArtworkFocus,
  useArtwork,
} from '../lib/artwork'
import { refreshLibraryNow } from '../lib/downloads'
import { useToast } from './Toasts'

export interface DraftImdbSelection {
  imdbId: string
  imdbTitle: string
  slots: Partial<Record<ArtworkSlot, string>>
  previews: Partial<Record<ArtworkSlot, string>>
  applyTitle?: boolean
}

export interface ImdbArtworkModalProps {
  open: boolean
  onClose: () => void
  /** Display name of the item being customized (e.g. movie title, anime title, or "AnimeVault App"). */
  targetLabel: string
  targetType: ArtworkTargetType
  targetKey: string
  /** Optional pre-filled IMDb ID (e.g. `tt0234144`) or search hint. */
  initialImdbId?: string | null
  searchHint?: string | null
  /** Offer "Also rename display title from IMDb" when targeting a local file. */
  allowApplyTitle?: boolean
  defaultAsMovie?: boolean
  /**
   * When provided, operates in staged/draft mode (for pre-upload movie setup):
   * returns the chosen IMDb photo URLs to attach as soon as upload completes.
   */
  onSelectDraft?: (draft: DraftImdbSelection) => void
  initialDraft?: DraftImdbSelection | null
}

type GalleryFilter = 'all' | 'banner' | 'poster' | 'icon'

const KIND_LABELS: Record<ImdbImageItem['kind'], string> = {
  poster: 'Poster',
  backdrop: 'Backdrop',
  still: 'Still',
  video: 'Trailer',
  logo: 'Logo',
  gallery: 'Photo',
}

const FOCUS_OPTIONS: { value: ArtworkFocus; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
]

export function ImdbArtworkModal({
  open,
  onClose,
  targetLabel,
  targetType,
  targetKey,
  initialImdbId,
  searchHint,
  allowApplyTitle = false,
  defaultAsMovie = false,
  onSelectDraft,
  initialDraft,
}: ImdbArtworkModalProps) {
  const artwork = useArtwork()
  const toast = useToast()

  const isDraft = Boolean(onSelectDraft)
  const [activeScope, setActiveScope] = useState<'target' | 'app'>('target')

  const effectiveType: ArtworkTargetType = activeScope === 'app' ? 'app' : targetType
  const effectiveKey = activeScope === 'app' ? 'global' : targetKey
  const currentRecord = artworkForTarget(artwork, effectiveType, effectiveKey)

  const [input, setInput] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [result, setResult] = useState<ImdbTitleResult | null>(null)
  const [searchResults, setSearchResults] = useState<ImdbSearchItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>('all')
  const [claimBusy, setClaimBusy] = useState<string | null>(null)
  const [applyTitle, setApplyTitle] = useState(false)

  // Draft selections (when invoked from UploadVideoModal before upload completes)
  const [draftSlots, setDraftSlots] = useState<Partial<Record<ArtworkSlot, string>>>({})
  const [draftPreviews, setDraftPreviews] = useState<Partial<Record<ArtworkSlot, string>>>({})

  const slotLabels = useMemo<Record<ArtworkSlot, { name: string; desc: string }>>(() => {
    if (effectiveType === 'app') {
      return {
        banner: { name: 'App Banner', desc: 'Sidebar & home spotlight banner' },
        icon: { name: 'App Icon & Favicon', desc: 'Logo badge + browser tab icon' },
        poster: { name: 'Fallback Cover', desc: 'Default cover for untitled videos' },
      }
    }
    return {
      banner: { name: 'Banner', desc: 'Wide header / hero backdrop' },
      poster: { name: 'Poster', desc: 'Vertical cover card image' },
      icon: { name: 'Icon', desc: 'Square badge / thumbnail avatar' },
    }
  }, [effectiveType])

  useEffect(() => {
    if (!open) return
    setActiveScope('target')
    setError(null)
    setSearchResults([])
    setGalleryFilter('all')
    setApplyTitle(false)
    setDraftSlots(initialDraft?.slots ?? {})
    setDraftPreviews(initialDraft?.previews ?? {})

    const seedId =
      initialDraft?.imdbId ||
      initialImdbId ||
      artworkForTarget(artwork, targetType, targetKey)?.imdbId ||
      ''
    if (seedId) {
      setInput(seedId)
      void fetchByImdbId(seedId)
    } else {
      setInput('')
      setResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetType, targetKey, initialImdbId])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function fetchByImdbId(idOrUrl: string) {
    setLookupBusy(true)
    setError(null)
    setSearchResults([])
    try {
      const data = await api.imdbLookup(idOrUrl)
      setResult(data)
      setInput(data.imdbId)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Could not fetch photos from IMDb')
    } finally {
      setLookupBusy(false)
    }
  }

  async function runTitleSearch(q: string) {
    const clean = q.trim()
    if (!clean) return
    setLookupBusy(true)
    setError(null)
    try {
      const { results } = await api.imdbSearch(clean)
      setSearchResults(results)
      if (results.length === 0) {
        setError(`No IMDb titles found for "${clean}". Try an IMDb ID like tt0234144.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IMDb search failed')
    } finally {
      setLookupBusy(false)
    }
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    const raw = input.trim()
    if (!raw) {
      setError('Enter an IMDb ID (like tt0234144), an IMDb link, or a title to search.')
      return
    }
    const parsedId = parseImdbIdClient(raw)
    if (parsedId) {
      await fetchByImdbId(raw)
    } else {
      await runTitleSearch(raw)
    }
  }

  async function onClaimSingle(slot: ArtworkSlot, img: ImdbImageItem) {
    if (!result) return

    if (isDraft && activeScope === 'target') {
      setDraftSlots((prev) => ({ ...prev, [slot]: img.url }))
      setDraftPreviews((prev) => ({ ...prev, [slot]: img.previewUrl }))
      toast(`Selected ${slotLabels[slot].name} from ${result.imdbId}`)
      return
    }

    const busyKey = `${img.id}:${slot}`
    setClaimBusy(busyKey)
    try {
      await claimArtworkSlot({
        targetType: effectiveType,
        targetKey: effectiveKey,
        slot,
        imageUrl: img.url,
        imdbId: result.imdbId,
        imdbTitle: result.title,
        applyTitle: allowApplyTitle && applyTitle && effectiveType === 'file',
        asMovie: defaultAsMovie,
      })
      if (allowApplyTitle && applyTitle && effectiveType === 'file') {
        await refreshLibraryNow()
      }
      toast(`Claimed ${slotLabels[slot].name} from ${result.title} (${result.imdbId})`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not claim IMDb photo', 'err')
    } finally {
      setClaimBusy(null)
    }
  }

  async function onAutoClaimAll() {
    if (!result) return
    const slots: Partial<Record<ArtworkSlot, string>> = {}
    const previews: Partial<Record<ArtworkSlot, string>> = {}

    const findPreview = (url: string | null) =>
      url ? (result.images.find((i) => i.url === url)?.previewUrl ?? '') : ''

    if (result.recommended.banner) {
      slots.banner = result.recommended.banner
      previews.banner = findPreview(result.recommended.banner)
    }
    if (result.recommended.poster) {
      slots.poster = result.recommended.poster
      previews.poster = findPreview(result.recommended.poster)
    }
    if (result.recommended.icon) {
      slots.icon = result.recommended.icon
      previews.icon = findPreview(result.recommended.icon)
    }

    if (Object.keys(slots).length === 0) return

    if (isDraft && activeScope === 'target') {
      onSelectDraft?.({
        imdbId: result.imdbId,
        imdbTitle: result.title,
        slots,
        previews,
        applyTitle,
      })
      toast(`Claimed Banner, Poster & Icon from ${result.title} (${result.imdbId})`)
      onClose()
      return
    }

    setClaimBusy('bundle')
    try {
      await claimArtworkSlots({
        targetType: effectiveType,
        targetKey: effectiveKey,
        slots,
        imdbId: result.imdbId,
        imdbTitle: result.title,
        applyTitle: allowApplyTitle && applyTitle && effectiveType === 'file',
        asMovie: defaultAsMovie,
      })
      if (allowApplyTitle && applyTitle && effectiveType === 'file') {
        await refreshLibraryNow()
      }
      toast(`Claimed Banner, Poster & Icon from ${result.title} (${result.imdbId})`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not claim IMDb artwork set', 'err')
    } finally {
      setClaimBusy(null)
    }
  }

  async function onClearSlot(slot: ArtworkSlot) {
    if (isDraft && activeScope === 'target') {
      setDraftSlots((prev) => {
        const next = { ...prev }
        delete next[slot]
        return next
      })
      setDraftPreviews((prev) => {
        const next = { ...prev }
        delete next[slot]
        return next
      })
      return
    }
    setClaimBusy(`clear:${slot}`)
    try {
      await removeArtwork({ targetType: effectiveType, targetKey: effectiveKey, slot })
      toast(`Removed custom ${slotLabels[slot].name.toLowerCase()}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove photo', 'err')
    } finally {
      setClaimBusy(null)
    }
  }

  async function onChangeFocus(slot: ArtworkSlot, focus: ArtworkFocus) {
    try {
      await setArtworkFocus({ targetType: effectiveType, targetKey: effectiveKey, slot, focus })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update crop position', 'err')
    }
  }

  function saveDraftAndClose() {
    if (!onSelectDraft || !result) {
      onClose()
      return
    }
    onSelectDraft({
      imdbId: result.imdbId,
      imdbTitle: result.title,
      slots: draftSlots,
      previews: draftPreviews,
      applyTitle,
    })
    onClose()
  }

  const counts = {
    all: result?.images.length ?? 0,
    banner: result?.images.filter((i) => i.suggestedSlot === 'banner').length ?? 0,
    poster: result?.images.filter((i) => i.suggestedSlot === 'poster').length ?? 0,
    icon: result?.images.filter((i) => i.suggestedSlot === 'icon' || i.isPrimary).length ?? 0,
  }

  const visibleImages = (result?.images ?? []).filter((img) => {
    if (galleryFilter === 'all') return true
    if (galleryFilter === 'icon') return img.suggestedSlot === 'icon' || img.isPrimary
    return img.suggestedSlot === galleryFilter
  })

  const activeSlotsForDisplay: { slot: ArtworkSlot; previewSrc: string | null; focus: ArtworkFocus }[] = (
    ['banner', 'poster', 'icon'] as ArtworkSlot[]
  ).map((slot) => {
    if (isDraft && activeScope === 'target') {
      return {
        slot,
        previewSrc: draftPreviews[slot] ?? null,
        focus: slot === 'banner' ? 'top' : 'center',
      }
    }
    const saved = currentRecord?.[slot] ?? null
    return {
      slot,
      previewSrc: saved ? `${saved.url}?v=${saved.updatedAt}` : null,
      focus: saved?.focus ?? 'center',
    }
  })

  const hasAnyDraftSlot = Object.values(draftSlots).some(Boolean)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-slide-up relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-ink-900 shadow-2xl ring-1 ring-white/12"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white sm:text-lg">
              <ImagePlus size={18} className="shrink-0 text-accent" />
              <span className="truncate">Claim IMDb Photo — Banner, Poster &amp; Icon</span>
            </h2>
            <p className="mt-0.5 truncate text-xs text-white/45">
              Target:{' '}
              <span className="font-medium text-white/80">
                {activeScope === 'app' ? 'AnimeVault App Branding (Global)' : targetLabel}
              </span>{' '}
              · photos are saved locally for instant offline display
            </p>
          </div>

          <div className="flex items-center gap-2">
            {targetType !== 'app' && !isDraft ? (
              <div className="flex rounded-lg bg-ink-850 p-0.5 text-[11px] ring-1 ring-white/10">
                <button
                  type="button"
                  onClick={() => setActiveScope('target')}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    activeScope === 'target' ? 'bg-accent font-semibold text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  This Title
                </button>
                <button
                  type="button"
                  onClick={() => setActiveScope('app')}
                  title="Use the claimed IMDb photo as your server's global App Icon / Favicon or Banner"
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    activeScope === 'app' ? 'bg-accent font-semibold text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  App Icon / Banner
                </button>
              </div>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-lg text-white/55 transition hover:bg-white/8 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* IMDb ID input bar */}
          <form onSubmit={(ev) => void onSubmit(ev)} className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[10px] font-extrabold tracking-tight text-black">
                IMDb
              </span>
              <input
                value={input}
                onChange={(ev) => setInput(ev.target.value)}
                placeholder="Enter IMDb ID (e.g. tt0234144, tt5311514), URL, or title…"
                autoFocus
                className="w-full rounded-xl bg-ink-800 py-2.5 pr-3 pl-16 text-sm text-white placeholder:text-white/30 ring-1 ring-white/12 outline-none focus:ring-accent/70"
              />
            </div>

            <button
              type="submit"
              disabled={lookupBusy || !input.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lookupBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {parseImdbIdClient(input) ? 'Fetch ID Photos' : 'Find on IMDb'}
            </button>

            {searchHint && searchHint.trim() ? (
              <button
                type="button"
                disabled={lookupBusy}
                onClick={() => {
                  setInput(searchHint)
                  void runTitleSearch(searchHint)
                }}
                title={`Search IMDb for "${searchHint}" to find its tt number`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/6 px-3 py-2.5 text-xs font-medium text-white/75 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white disabled:opacity-40"
              >
                <Sparkles size={13} className="text-accent" />
                Lookup &ldquo;{searchHint.slice(0, 22)}
                {searchHint.length > 22 ? '…' : ''}&rdquo;
              </button>
            ) : null}
          </form>

          {/* Current claimed slots preview */}
          <div className="grid gap-2.5 sm:grid-cols-3">
            {activeSlotsForDisplay.map(({ slot, previewSrc, focus }) => {
              const info = slotLabels[slot]
              const SlotIcon = slot === 'banner' ? Monitor : slot === 'icon' ? SquareUser : ImageIcon
              return (
                <div
                  key={slot}
                  className="flex flex-col justify-between rounded-xl bg-ink-850 p-2.5 ring-1 ring-white/8"
                >
                  <div className="mb-2 flex items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
                      <SlotIcon size={12} className="text-accent" />
                      {info.name}
                    </span>
                    {previewSrc ? (
                      <button
                        type="button"
                        disabled={claimBusy === `clear:${slot}`}
                        onClick={() => void onClearSlot(slot)}
                        title={`Reset ${info.name}`}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-white/45 transition hover:bg-red-500/15 hover:text-red-300"
                      >
                        <Trash2 size={10} />
                        Reset
                      </button>
                    ) : null}
                  </div>

                  <div className="relative flex h-20 items-center justify-center overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8">
                    {previewSrc ? (
                      slot === 'icon' ? (
                        <img
                          src={previewSrc}
                          alt={info.name}
                          className={`h-14 w-14 rounded-xl object-cover ring-1 ring-white/15 ${focusObjectClass(focus)}`}
                        />
                      ) : slot === 'poster' ? (
                        <img
                          src={previewSrc}
                          alt={info.name}
                          className={`h-full w-14 object-cover ring-1 ring-white/10 ${focusObjectClass(focus)}`}
                        />
                      ) : (
                        <img
                          src={previewSrc}
                          alt={info.name}
                          className={`h-full w-full object-cover ${focusObjectClass(focus)}`}
                        />
                      )
                    ) : (
                      <span className="px-2 text-center text-[10px] text-white/30">{info.desc}</span>
                    )}
                  </div>

                  {previewSrc && !isDraft && (slot === 'banner' || slot === 'icon') ? (
                    <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px] text-white/40">
                      <span>Crop:</span>
                      <div className="flex gap-1">
                        {FOCUS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => void onChangeFocus(slot, opt.value)}
                            className={`rounded px-1.5 py-0.5 transition ${
                              focus === opt.value
                                ? 'bg-accent/20 font-medium text-accent'
                                : 'bg-white/5 text-white/45 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {error ? (
            <div className="rounded-xl bg-red-500/12 px-3.5 py-2.5 text-xs text-red-200 ring-1 ring-red-500/30">
              {error}
            </div>
          ) : null}

          {/* IMDb title search picker (when searching by title instead of tt number) */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-white/50">
                Click an IMDb match to load its photos:
              </p>
              <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {searchResults.map((item) => (
                  <button
                    key={item.imdbId}
                    type="button"
                    onClick={() => void fetchByImdbId(item.imdbId)}
                    className="flex items-center gap-3 rounded-xl bg-ink-850 p-2.5 text-left ring-1 ring-white/8 transition hover:bg-ink-800 hover:ring-accent/50"
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-ink-800 ring-1 ring-white/10">
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">{item.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/45">
                        <span className="rounded bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                          {item.imdbId}
                        </span>
                        {item.year ? <span>{item.year}</span> : null}
                        {item.type ? <span>· {item.type}</span> : null}
                      </p>
                      {item.stars ? (
                        <p className="mt-0.5 truncate text-[10px] text-white/35">{item.stars}</p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loaded IMDb title + photo gallery */}
          {result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-ink-850 p-3.5 ring-1 ring-white/10">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-white sm:text-base">{result.title}</h3>
                    <a
                      href={result.imdbUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded bg-amber-400/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300 ring-1 ring-amber-400/30 transition hover:bg-amber-400/25"
                    >
                      {result.imdbId}
                      <ExternalLink size={10} />
                    </a>
                    {result.rating ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300">
                        <Star size={11} className="fill-amber-300" />
                        {result.rating}
                      </span>
                    ) : null}
                    {result.year ? <span className="text-xs text-white/50">{result.year}</span> : null}
                    {result.type ? (
                      <span className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-white/60">
                        {result.type}
                      </span>
                    ) : null}
                  </div>
                  {result.originalTitle ? (
                    <p className="mt-0.5 text-xs text-white/40">{result.originalTitle}</p>
                  ) : null}
                  {result.plot ? (
                    <p className="mt-1 line-clamp-2 text-xs text-white/55">{result.plot}</p>
                  ) : null}

                  {(allowApplyTitle || isDraft) && activeScope === 'target' ? (
                    <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-white/75">
                      <input
                        type="checkbox"
                        checked={applyTitle}
                        onChange={(ev) => setApplyTitle(ev.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-accent"
                      />
                      Also set title to &ldquo;{result.title}&rdquo;
                    </label>
                  ) : null}
                </div>

                {result.images.length > 0 && (
                  <button
                    type="button"
                    disabled={claimBusy !== null}
                    onClick={() => void onAutoClaimAll()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                  >
                    {claimBusy === 'bundle' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Wand2 size={14} />
                    )}
                    Auto-Claim Banner + Poster + Icon
                  </button>
                )}
              </div>

              {/* Gallery filter tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      { id: 'all' as const, label: 'All Photos', count: counts.all },
                      { id: 'banner' as const, label: 'Banners / Wide', count: counts.banner },
                      { id: 'poster' as const, label: 'Posters', count: counts.poster },
                      { id: 'icon' as const, label: 'Icons / Logos', count: counts.icon },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setGalleryFilter(tab.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition ${
                        galleryFilter === tab.id
                          ? 'bg-white/12 font-medium text-white ring-1 ring-white/15'
                          : 'text-white/50 hover:bg-white/6 hover:text-white'
                      }`}
                    >
                      {tab.label}
                      <span className="font-mono text-[10px] opacity-65">{tab.count}</span>
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-white/40">
                  Any photo can be claimed as Banner, Poster, or Icon
                </span>
              </div>

              {/* Photo grid */}
              {visibleImages.length === 0 ? (
                <p className="rounded-xl bg-ink-850 p-6 text-center text-xs text-white/45">
                  No photos in this category — switch to &ldquo;All Photos&rdquo; to claim any image for any slot.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleImages.map((img) => {
                    const draftBanner = isDraft && draftSlots.banner === img.url
                    const draftPoster = isDraft && draftSlots.poster === img.url
                    const draftIcon = isDraft && draftSlots.icon === img.url
                    return (
                      <div
                        key={img.id}
                        className="group flex flex-col overflow-hidden rounded-xl bg-ink-850 ring-1 ring-white/8 transition hover:ring-accent/45"
                      >
                        <div className="relative aspect-video overflow-hidden bg-ink-950">
                          <img
                            src={img.previewUrl}
                            alt={img.caption || result.title}
                            loading="lazy"
                            decoding="async"
                            className={`h-full w-full ${
                              img.kind === 'poster' || img.kind === 'logo'
                                ? 'object-contain p-1'
                                : 'object-cover'
                            }`}
                          />
                          <div className="pointer-events-none absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                            <span className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
                              {img.isPrimary ? 'Primary Poster' : KIND_LABELS[img.kind]}
                            </span>
                          </div>
                          {img.width && img.height ? (
                            <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white/75 backdrop-blur-sm">
                              {img.width}×{img.height}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex flex-1 flex-col justify-between gap-2 p-2.5">
                          {img.caption ? (
                            <p className="line-clamp-1 text-[11px] text-white/55" title={img.caption}>
                              {img.caption}
                            </p>
                          ) : (
                            <p className="text-[11px] text-white/30">IMDb photo · {result.imdbId}</p>
                          )}

                          <div className="grid grid-cols-3 gap-1.5">
                            {(['banner', 'poster', 'icon'] as ArtworkSlot[]).map((slot) => {
                              const busy = claimBusy === `${img.id}:${slot}`
                              const pickedInDraft =
                                (slot === 'banner' && draftBanner) ||
                                (slot === 'poster' && draftPoster) ||
                                (slot === 'icon' && draftIcon)
                              const isSuggested = img.suggestedSlot === slot
                              return (
                                <button
                                  key={slot}
                                  type="button"
                                  disabled={claimBusy !== null}
                                  onClick={() => void onClaimSingle(slot, img)}
                                  className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium ring-1 transition disabled:opacity-40 ${
                                    pickedInDraft
                                      ? 'bg-emerald-500/20 font-semibold text-emerald-200 ring-emerald-500/45'
                                      : isSuggested
                                        ? 'bg-accent/18 font-semibold text-accent ring-accent/40 hover:bg-accent hover:text-black'
                                        : 'bg-white/6 text-white/80 ring-white/10 hover:bg-white/14 hover:text-white'
                                  }`}
                                >
                                  {busy ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : pickedInDraft ? (
                                    <Check size={11} />
                                  ) : null}
                                  {slot === 'banner' ? 'Banner' : slot === 'poster' ? 'Poster' : 'Icon'}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {!result && searchResults.length === 0 && !lookupBusy && !error && (
            <div className="rounded-xl bg-ink-850/70 px-4 py-6 text-center ring-1 ring-white/6">
              <p className="text-xs text-white/65">
                Paste any IMDb ID in the <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-amber-300">tt0234144</span> format (or a full <span className="font-mono text-white/80">imdb.com/title/tt…</span> URL) to browse and claim its official banners, posters, stills, and icons.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/8 px-5 py-3">
          {isDraft ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-white/6 px-4 py-1.5 text-xs font-medium text-white/75 transition hover:bg-white/12 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!hasAnyDraftSlot}
                onClick={saveDraftAndClose}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
              >
                <Check size={13} />
                Apply Selected Photos
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
