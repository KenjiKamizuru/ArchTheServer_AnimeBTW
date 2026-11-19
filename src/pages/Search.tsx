import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bookmark,
  Clock,
  CornerDownLeft,
  HardDrive,
  History,
  Loader2,
  Search as SearchIcon,
  SearchX,
  Settings2,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { api, type AdvancedSearchResponse, type SearchCollectionsResponse, type SearchLibraryResponse, type SearchSuggestion } from '../lib/api'
import { CardSkeletons, MediaGrid } from '../components/MediaCard'
import { useSearchHistory } from '../lib/searchHistory'

const GROUP_LABEL: Record<string, string> = {
  TV: 'TV series',
  MOVIE: 'Movies',
  OVA: 'OVAs',
  ONA: 'ONA / web',
  SPECIAL: 'Specials',
  OTHER: 'Other',
}

/** Renders a title with the matched fragment highlighted (AV-071). */
function Highlighted({ segments, fallback }: { segments: { text: string; match: boolean }[]; fallback: string }) {
  if (!segments?.length) return <span>{fallback}</span>
  return (
    <span>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-sm bg-accent/25 px-0.5 text-accent">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  )
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const query = (params.get('q') ?? '').trim()
  const tab = params.get('in') === 'library' ? 'library' : params.get('in') === 'collections' ? 'collections' : 'catalog'
  const history = useSearchHistory()

  const [term, setTerm] = useState(query)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [results, setResults] = useState<AdvancedSearchResponse | null>(null)
  const [libraryHits, setLibraryHits] = useState<SearchLibraryResponse | null>(null)
  const [collectionHits, setCollectionHits] = useState<SearchCollectionsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [showHistorySettings, setShowHistorySettings] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    setTerm(query)
  }, [query])

  const commit = useCallback(
    (value: string, { tab: nextTab }: { tab?: 'catalog' | 'library' | 'collections' } = {}) => {
      const clean = value.trim()
      if (!clean) return
      const next = new URLSearchParams(params)
      next.set('q', clean)
      if (nextTab) {
        if (nextTab === 'library' || nextTab === 'collections') next.set('in', nextTab)
        else next.delete('in')
      }
      setParams(next, { replace: true })
      setSuggestOpen(false)
      setActiveIndex(-1)
      history.add(clean)
    },
    [params, setParams, history],
  )

  // Type-ahead: debounce 250 ms and cancel stale responses (AV-073).
  useEffect(() => {
    if (tab !== 'catalog' || !suggestOpen) return
    const draft = term.trim()
    if (draft.length < 2 || draft === query) {
      setSuggestions([])
      return
    }
    const seq = ++requestSeq.current
    setSuggestLoading(true)
    const handle = setTimeout(() => {
      api
        .suggest(draft)
        .then((res) => {
          if (seq !== requestSeq.current) return
          setSuggestions(res.suggestions ?? [])
        })
        .catch(() => {
          if (seq === requestSeq.current) setSuggestions([])
        })
        .finally(() => {
          if (seq === requestSeq.current) setSuggestLoading(false)
        })
    }, 250)
    return () => clearTimeout(handle)
  }, [term, tab, suggestOpen, query])

  // Main result fetch.
  useEffect(() => {
    if (!query) {
      setResults(null)
      setLibraryHits(null)
      setCollectionHits(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    const job =
      tab === 'library'
        ? api.searchLibrary(query).then((res) => {
            if (!alive) return
            setLibraryHits(res)
            setResults(null)
            setCollectionHits(null)
          })
        : tab === 'collections'
          ? api.searchCollections(query).then((res) => {
              if (!alive) return
              setCollectionHits(res)
              setResults(null)
              setLibraryHits(null)
            })
          : api
              .searchAdvanced(query, { page })
              .then((res) => {
                if (!alive) return
                setResults(res)
                setLibraryHits(null)
                setCollectionHits(null)
              })
    job
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Search failed')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [query, page, tab])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!suggestOpen) setSuggestOpen(true)
      setActiveIndex((index) => (suggestions.length ? (index + 1) % suggestions.length : -1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        suggestions.length ? (index <= 0 ? suggestions.length - 1 : index - 1) : -1,
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        const pick = suggestions[activeIndex]
        setSuggestOpen(false)
        setActiveIndex(-1)
        navigate(`/anime/${pick.id}`)
        return
      }
      setPage(1)
      commit(term)
      return
    }
    if (event.key === 'Escape') {
      setSuggestOpen(false)
      setActiveIndex(-1)
    }
  }

  const grouped = useMemo(() => results?.groups ?? [], [results])
  const items = results?.media ?? []
  const shownHistory = history.entries.slice(0, 8)

  const emptyState = query && !loading && !error && (
    (tab === 'library' && (libraryHits?.count ?? 0) === 0) ||
    (tab === 'collections' && (collectionHits?.count ?? 0) === 0) ||
    (tab === 'catalog' && results && results.media.length === 0)
  )

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">
        {query ? `Results for “${query}”` : 'Search'}
      </h1>
      <p className="mt-0.5 text-xs text-white/40">
        {query
          ? tab === 'library'
            ? 'Searching your local library only'
            : tab === 'collections'
              ? 'Searching your bookmarks and custom lists only'
              : `${items.length} title${items.length === 1 ? '' : 's'} · official metadata`
          : 'Search by title, or use field filters like studio:shaft genre:action year:2009-2015'}
      </p>

      <div className="mt-4 space-y-3">
        <div className="relative">
          <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-white/30" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={suggestOpen && suggestions.length > 0}
            aria-controls="search-suggestions"
            aria-autocomplete="list"
            aria-label="Search titles"
            value={term}
            placeholder="Type a title…"
            onChange={(event) => {
              setTerm(event.target.value)
              setSuggestOpen(true)
              setActiveIndex(-1)
            }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
            onKeyDown={onKeyDown}
            className="w-full rounded-xl bg-ink-850 py-3 pr-3 pl-10 text-sm text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
          />
          {suggestLoading ? (
            <Loader2 size={14} className="absolute top-1/2 right-3.5 -translate-y-1/2 animate-spin text-white/30" />
          ) : null}

          {suggestOpen && suggestions.length > 0 ? (
            <ul
              id="search-suggestions"
              role="listbox"
              className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl bg-ink-850 shadow-xl ring-1 ring-white/10"
            >
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.id} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSuggestOpen(false)
                      navigate(`/anime/${suggestion.id}`)
                    }}
                    className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition ${
                      index === activeIndex ? 'bg-accent/15' : 'hover:bg-white/5'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">
                        <Highlighted segments={suggestion.hintText} fallback={suggestion.title} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-white/35">
                        {suggestion.sub} · {suggestion.reason}
                      </span>
                    </span>
                    <CornerDownLeft size={12} className="shrink-0 text-white/20" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-ink-850 p-1 ring-1 ring-white/5">
            {[
              { id: 'catalog' as const, label: 'Catalog', icon: SearchIcon },
              { id: 'library' as const, label: 'My library', icon: HardDrive },
              { id: 'collections' as const, label: 'Bookmarks & lists', icon: Bookmark },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={tab === option.id}
                onClick={() =>
                  setParams(
                    (prev) => {
                      const next = new URLSearchParams(prev)
                      if (option.id === 'library' || option.id === 'collections') next.set('in', option.id)
                      else next.delete('in')
                      return next
                    },
                    { replace: true },
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  tab === option.id ? 'bg-accent text-black' : 'text-white/55 hover:bg-white/5 hover:text-white'
                }`}
              >
                <option.icon size={12} />
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowHistorySettings((v) => !v)}
            aria-expanded={showHistorySettings}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-white/55 ring-1 ring-white/10 transition hover:text-white"
          >
            <Settings2 size={12} />
            History settings
          </button>
        </div>

        {showHistorySettings ? (
          <div className="rounded-xl bg-ink-900 p-3.5 ring-1 ring-white/6">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[11px] text-white/60">
                <input
                  type="checkbox"
                  checked={history.settings.enabled}
                  onChange={(event) => history.setEnabled(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                Remember my searches
              </label>
              <label className="flex items-center gap-2 text-[11px] text-white/60">
                Expire after
                <select
                  value={history.settings.expiryDays}
                  onChange={(event) => history.setExpiryDays(Number(event.target.value))}
                  disabled={!history.settings.enabled}
                  className="rounded-md bg-ink-800 px-2 py-1 text-[11px] text-white ring-1 ring-white/10 outline-none focus:ring-accent/60 disabled:opacity-40"
                >
                  <option value={0}>never</option>
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
              {history.entries.length > 0 ? (
                <button
                  type="button"
                  onClick={history.clear}
                  className="ml-auto text-[11px] text-red-300/80 underline decoration-dotted transition hover:text-red-200"
                >
                  Clear history
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-white/25">
              History stays on this device. Turning it off also erases what is already stored.
            </p>
          </div>
        ) : null}

        {!query && shownHistory.length > 0 ? (
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <History size={12} className="text-white/35" />
              <span className="text-[11px] font-semibold tracking-wider text-white/35 uppercase">Recent searches</span>
              <button
                type="button"
                onClick={history.clear}
                className="ml-auto text-[10px] text-white/30 underline decoration-dotted transition hover:text-white/70"
              >
                clear
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {shownHistory.map((entry) => (
                <span
                  key={entry.query}
                  className="inline-flex items-center gap-1 rounded-full bg-white/5 py-0.5 pr-1 pl-2 text-[11px] text-white/65 ring-1 ring-white/10"
                >
                  <button
                    type="button"
                    onClick={() => commit(entry.query)}
                    className="inline-flex items-center gap-1 transition hover:text-white"
                  >
                    <Clock size={9} className="text-white/25" />
                    {entry.query}
                  </button>
                  <button
                    type="button"
                    onClick={() => history.remove(entry.query)}
                    aria-label={`Remove ${entry.query} from history`}
                    className="rounded-full p-0.5 text-white/25 transition hover:bg-white/10 hover:text-red-300"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        {!query ? (
          <div className="rounded-xl bg-ink-900 p-8 text-center ring-1 ring-white/5">
            <SearchX size={28} className="mx-auto text-white/25" />
            <p className="mt-2 text-sm text-white/45">
              Search across the whole catalogue, then watch or bookmark from any result.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link
                to="/browse"
                className="inline-block rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600"
              >
                Browse this season instead
              </Link>
              <span className="text-[11px] text-white/30">
                try <code className="rounded bg-white/8 px-1">studio:ghibli year:2001</code>
              </span>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">{error}</div>
        ) : loading && !results && !libraryHits && !collectionHits ? (
          <CardSkeletons />
        ) : tab === 'library' ? (
          libraryHits && libraryHits.count > 0 ? (
            <div>
              <p className="mb-3 text-xs text-white/40">
                {libraryHits.count} file{libraryHits.count === 1 ? '' : 's'} of {libraryHits.totalLibrary} in your
                library
              </p>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-ink-900 ring-1 ring-white/6">
                {libraryHits.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">
                        <Highlighted segments={item.highlight} fallback={item.animeTitle || item.fileName} />
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-white/30">
                        {[item.seriesTitle, item.season !== null ? `season ${item.season}` : null, item.episode !== null ? `episode ${item.episode}` : null, item.quality]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Link
                      to="/downloaded"
                      className="shrink-0 rounded-lg bg-white/6 px-2.5 py-1.5 text-[11px] text-white/70 transition hover:text-white"
                    >
                      Open library
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl bg-ink-900 p-6 text-center ring-1 ring-white/5">
              <p className="text-sm text-white/60">Nothing in your library matches “{query}”.</p>
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.delete('in')
                  setParams(next, { replace: true })
                }}
                className="mt-3 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600"
              >
                Search the catalog instead
              </button>
            </div>
          )
        ) : tab === 'collections' ? (
          collectionHits && collectionHits.count > 0 ? (
            <div>
              <p className="mb-3 text-xs text-white/40">
                {collectionHits.count} title{collectionHits.count === 1 ? '' : 's'} across your bookmarks and lists
              </p>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-ink-900 ring-1 ring-white/6">
                {collectionHits.items.map((hit) => (
                  <li key={hit.media.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">
                        <Highlighted segments={hit.highlight} fallback={hit.media.title} />
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-white/30">
                        {[hit.inBookmarks ? 'Bookmarks' : null, ...hit.lists].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Link
                      to={`/anime/${hit.media.id}`}
                      className="shrink-0 rounded-lg bg-white/6 px-2.5 py-1.5 text-[11px] text-white/70 transition hover:text-white"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl bg-ink-900 p-6 text-center ring-1 ring-white/5">
              <p className="text-sm text-white/60">Nothing in your bookmarks or lists matches “{query}”.</p>
            </div>
          )
        ) : emptyState ? (
          <div className="rounded-xl bg-ink-900 p-6 text-center ring-1 ring-white/5">
            <SearchX size={24} className="mx-auto text-white/25" />
            <p className="mt-2 text-sm text-white/60">No anime matched “{query}”.</p>
            {results?.correction ? (
              <p className="mt-2 text-xs text-white/40">
                Did you mean{' '}
                <button
                  type="button"
                  onClick={() => commit(results.correction!.suggestion)}
                  className="font-medium text-accent underline decoration-dotted"
                >
                  {results.correction.suggestion}
                </button>
                ? <span className="text-white/25">(showing “{results.correction.original}” for reference)</span>
              </p>
            ) : null}
            {results?.removed ? (
              <p className="mt-1 text-[11px] text-white/30">
                {results.removed} result{results.removed === 1 ? ' was' : 's were'} excluded by your field filters.
              </p>
            ) : null}
            {results?.alternatives?.length ? (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                <Wand2 size={12} className="text-accent" />
                {results.alternatives.map((alternative) =>
                  alternative.kind === 'browse' ? (
                    <Link
                      key={alternative.label}
                      to="/browse"
                      className="rounded-full bg-white/6 px-2.5 py-1 text-[11px] text-white/70 ring-1 ring-white/10 transition hover:text-white"
                    >
                      {alternative.label}
                    </Link>
                  ) : (
                    <button
                      key={alternative.label}
                      type="button"
                      onClick={() => commit(alternative.query)}
                      className="rounded-full bg-white/6 px-2.5 py-1 text-[11px] text-white/70 ring-1 ring-white/10 transition hover:text-white"
                    >
                      {alternative.label}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {results?.correction ? (
              <div className="mb-4 rounded-xl bg-amber-950/30 px-3.5 py-2.5 text-[11px] text-amber-200 ring-1 ring-amber-500/25">
                Showing close matches for “{results.correction.original}”. Did you mean{' '}
                <button type="button" onClick={() => commit(results.correction!.suggestion)} className="underline">
                  {results.correction.suggestion}
                </button>
                ?
              </div>
            ) : null}

            {grouped.length > 1 ? (
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                {grouped.map((group) => (
                  <a
                    key={group.format}
                    href={`#group-${group.format}`}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:text-white"
                  >
                    {GROUP_LABEL[group.format] ?? group.format} ({group.items.length})
                  </a>
                ))}
              </div>
            ) : null}

            {grouped.length > 1 ? (
              <div className="space-y-8">
                {grouped.map((group) => (
                  <section key={group.format} id={`group-${group.format}`} aria-labelledby={`group-h-${group.format}`}>
                    <h2 id={`group-h-${group.format}`} className="mb-2 text-[11px] font-semibold tracking-widest text-white/35 uppercase">
                      {GROUP_LABEL[group.format] ?? group.format} · {group.items.length}
                    </h2>
                    <MediaGrid items={group.items} />
                  </section>
                ))}
              </div>
            ) : (
              <MediaGrid items={items} />
            )}

            {results?.hasNextPage ? (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                  Load more results
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
