import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GripVertical } from 'lucide-react'
import type { Media } from '../types'
import { saveSettings, useSettings } from '../lib/settings'

type ListSummary = { id: string; name: string; count: number; description?: string }
type Entry = { mediaId: number; media: Media; status: string | null; note: string; priority: number | null; rating: number | null }
type Overview = { statuses: ListSummary[]; lists: ListSummary[]; totalEntries: number; limits: { maxItems: number; maxLists: number } }
type List = ListSummary & { entries: Entry[]; custom: boolean }

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

function EntryNote({ entry, listId, busy, onSave }: { entry: Entry; listId: string; busy: boolean; onSave: (note: string) => void }) {
  const [note, setNote] = useState(entry.note ?? '')
  useEffect(() => setNote(entry.note ?? ''), [entry.note, listId])
  return <details className="w-full text-xs text-white/60">
    <summary className="cursor-pointer">
      {entry.note
        ? `Edit note: ${entry.note.length > 80 ? `${entry.note.slice(0, 80)}…` : entry.note}`
        : 'Add note'}
    </summary>
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); onSave(note) }}>
      <label className="sr-only" htmlFor={`note-${entry.mediaId}`}>Note for {entry.media.title}</label>
      <textarea id={`note-${entry.mediaId}`} className="min-w-48 flex-1 rounded-lg bg-black/20 p-2 text-white" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      <button className="rounded-lg bg-white/10 px-3 py-2 text-white disabled:opacity-50" disabled={busy || note === (entry.note ?? '')}>Save note</button>
      <span>{note.length}/1000</span>
    </form>
  </details>
}

/** Lists are shared across this installation until account support exists. */
export default function PersonalLists({ bookmarks }: { bookmarks: Media[] }) {
  const settings = useSettings()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [active, setActive] = useState('status:planned')
  const [sort, setSort] = useState('added')
  const [list, setList] = useState<List | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [bookmarkId, setBookmarkId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [pick, setPick] = useState<Entry | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [moveTarget, setMoveTarget] = useState('')
  useEffect(() => {
    let cancelled = false
    setList(null)
    setPick(null)
    Promise.all([request<Overview>('/api/lists'), request<List>(`/api/lists/${encodeURIComponent(active)}?sort=${encodeURIComponent(sort)}`)])
      .then(([summary, selected]) => { if (!cancelled) { setOverview(summary); setList(selected); setError('') } })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [active, revision, sort])
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('')
    try { await action(); setRevision((value) => value + 1) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update lists') }
    finally { setBusy(false) }
  }
  // Drag-and-drop ordering (AV-128b): persist the FULL permutation via the
  // order API; the revision bump re-reads the list in 'order' sort.
  async function reorder(from: number, to: number) {
    if (!list || from === to) return
    const ids = list.entries.map((entry) => entry.mediaId)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    await perform(async () => {
      await request(`/api/lists/${encodeURIComponent(active)}/order`, 'PUT', { mediaIds: ids })
    })
  }
  // Bulk move (AV-134): one round-trip per move, memberships and per-list
  // notes/ratings travel together (server-side transfer).
  async function moveSelected() {
    if (!moveTarget || selected.size === 0) return
    const ids = [...selected]
    setSelected(new Set())
    setSelectMode(false)
    await perform(async () => {
      const result = await request<{ moved: number }>(`/api/lists/${encodeURIComponent(active)}/move`, 'POST', { to: moveTarget, mediaIds: ids })
      setMessage(`Moved ${result.moved} entr${result.moved === 1 ? 'y' : 'ies'}.`)
    })
  }
  const button = 'rounded-lg bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20 disabled:opacity-50'
  // Capacity warnings (AV-140): surface at 90% of the installation caps so
  // users can clean up before adds start failing; users can disable them.
  const nearCapacity = overview !== null && (
    overview.totalEntries >= Math.floor(overview.limits.maxItems * 0.9)
    || overview.lists.length >= Math.floor(overview.limits.maxLists * 0.9)
  )
  const input = 'rounded-lg bg-ink-900 px-3 py-2 text-sm text-white ring-1 ring-white/10'
  return (
    <section className="mt-8 rounded-xl bg-ink-900 p-4 ring-1 ring-white/10" aria-labelledby="lists-heading">
      <h2 id="lists-heading" className="text-lg font-semibold text-white">Your lists</h2>
      <p className="mt-1 text-xs text-white/50">Lists are shared on this installation. Bookmarks remain separate.</p>
      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-white/40">
        <input
          type="checkbox"
          checked={!settings.hideListCapacityWarnings}
          onChange={(event) => void saveSettings({ hideListCapacityWarnings: !event.target.checked })}
        />
        Warn when lists are near capacity
      </label>
      {nearCapacity && !settings.hideListCapacityWarnings ? (
        <p role="status" className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-400/20">
          Lists are nearing this installation&apos;s capacity
          {overview ? ` (${overview.totalEntries}/${overview.limits.maxItems} titles, ${overview.lists.length}/${overview.limits.maxLists} custom lists)` : ''}
          . Remove entries or lists to keep adding.
        </p>
      ) : null}
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="mt-2 text-sm text-white/70">{message}</p>}
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Lists">
        {[...(overview?.statuses ?? []), ...(overview?.lists ?? [])].map((item) => (
          <button type="button" key={item.id} onClick={() => setActive(item.id)} aria-pressed={active === item.id} className={`${button} ${active === item.id ? 'ring-2 ring-accent' : ''}`}>
            {item.name} ({item.count})
          </button>
        ))}
      </div>
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void perform(async () => {
        const result = await request<{ list: ListSummary }>('/api/lists', 'POST', { name, description })
        setName(''); setDescription(''); setActive(result.list.id)
      }) }}>
        <label className="sr-only" htmlFor="new-list-name">New list name</label>
        <input id="new-list-name" className={input} placeholder="New list name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="new-list-description">New list description (optional)</label>
        <input id="new-list-description" className={input} placeholder="Description (optional)" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        <button className={button} disabled={busy || !name.trim()}>Create list</button>
        <button type="button" className={button} disabled={busy || !bookmarks.length} onClick={() => void perform(async () => {
          const result = await request<{ migrated: number; skipped: number }>('/api/lists/migrate', 'POST')
          setMessage(`Copied ${result.migrated} bookmarks to Planned; ${result.skipped} already present or skipped.`)
        })}>Copy bookmarks to Planned</button>
      </form>
      <div className="mt-4">
        <label htmlFor="list-import" className="text-xs text-white/70">Import an AnimeVault JSON list (up to 400 KB)</label>
        <input id="list-import" type="file" accept="application/json,.json" disabled={busy} className="mt-1 block max-w-full text-xs text-white/70" onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          void perform(async () => {
            if (file.size > 400_000) throw new Error('The file exceeds the 400 KB import limit')
            let document: unknown
            try { document = JSON.parse(await file.text()) } catch { throw new Error('The file is not valid JSON') }
            const result = await request<{ list: ListSummary; imported: number }>('/api/lists/import', 'POST', document)
            setActive(result.list.id)
            setMessage(`Imported ${result.imported} titles into ${result.list.name}. Existing titles keep their status.`)
          })
        }} />
      </div>
      {list && <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium text-white">{list.name}</h3>
            {list.description ? <p className="mt-1 text-xs text-white/50">{list.description}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy || list.count === 0} onClick={() => {
              setBusy(true); setError('')
              void request<{ pick: Entry | null }>(`/api/lists/${encodeURIComponent(active)}/random`)
                .then((result) => setPick(result.pick))
                .catch((err: Error) => setError(err.message))
                .finally(() => setBusy(false))
            }}>Random pick</button>
            {(['json', 'csv'] as const).map((format) => <button key={format} type="button" className={button} disabled={busy} onClick={() => void perform(async () => {
              const response = await fetch(`/api/lists/${encodeURIComponent(active)}/export?format=${format}`)
              if (!response.ok) throw new Error(`Export failed (${response.status})`)
              const blob = await response.blob()
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              // Name the file after the list (path-unsafe characters stripped,
              // Unicode preserved) so exports of different lists don't collide.
              const slug = list.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'list'
              anchor.download = `animevault-list-${slug}.${format}`
              document.body.appendChild(anchor); anchor.click(); anchor.remove()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            })}>Export {format.toUpperCase()}</button>)}
          </div>
          {list.custom && <button type="button" className={button} disabled={busy || list.count === 0} onClick={() => {
            setSelectMode((value) => !value)
            setSelected(new Set())
          }}>{selectMode ? 'Exit select' : 'Select'}</button>}
          {selectMode ? (
            <>
              <label className="sr-only" htmlFor="move-target">Move selected entries to list</label>
              <select id="move-target" className={input} value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)}>
                <option value="">Move to…</option>
                {(overview?.lists ?? []).filter((item) => item.id !== active).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <button type="button" className={button} disabled={busy || !moveTarget || selected.size === 0} onClick={() => void moveSelected()}>
                Move {selected.size > 0 ? `${selected.size} selected` : 'selected'}
              </button>
            </>
          ) : null}
          {list.custom && <button type="button" className={button} disabled={busy} onClick={() => {
            if (window.confirm(`Delete list “${list.name}”? Titles with a status will remain in their status lists.`)) void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}`, 'DELETE'); setActive('status:planned') })
          }}>Delete list</button>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="text-sm text-white/70" htmlFor="list-sort">Sort by</label>
          <select id="list-sort" className={input} value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="added">Recently added</option>
            <option value="oldest">Oldest added</option>
            <option value="title">Title</option>
            <option value="score">Highest score</option>
            <option value="year">Newest season</option>
            <option value="order">Custom order</option>
          </select>
        </div>
        {pick && <p role="status" className="mt-3 text-sm text-white/70">Try <Link className="text-white underline" to={`/anime/${pick.mediaId}`}>{pick.media.title}</Link></p>}
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const media = bookmarks.find((item) => String(item.id) === bookmarkId); if (media) void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}/entries`, 'POST', { media }); setBookmarkId('') }) }}>
          <label className="sr-only" htmlFor="list-bookmark">Choose a bookmark to add</label>
          <select id="list-bookmark" className={input} value={bookmarkId} onChange={(e) => setBookmarkId(e.target.value)}>
            <option value="">Choose a bookmark</option>
            {bookmarks.map((media) => <option key={media.id} value={media.id}>{media.title}</option>)}
          </select>
          <button className={button} disabled={busy || !bookmarkId}>Add to list</button>
        </form>
        {list.entries.length === 0 ? <p className="mt-3 text-sm text-white/50">No titles in this list yet.</p> : <ul className="mt-3 divide-y divide-white/10">
          {list.entries.map((entry, index) => <li
            key={entry.mediaId}
            onDragOver={(event) => { if (dragFrom !== null && dragFrom !== index) { event.preventDefault(); setDropAt(index) } }}
            onDrop={(event) => {
              event.preventDefault()
              if (dragFrom !== null && dragFrom !== index) void reorder(dragFrom, index)
              setDragFrom(null); setDropAt(null)
            }}
            className={`flex flex-wrap items-center gap-2 py-2 ${dropAt === index && dragFrom !== null && dragFrom !== index ? 'ring-1 ring-accent/60' : ''}`}
          >
            {selectMode ? (
              <input
                type="checkbox"
                aria-label={`Select ${entry.media.title}`}
                checked={selected.has(entry.mediaId)}
                onChange={() => setSelected((prev) => {
                  const next = new Set(prev)
                  if (next.has(entry.mediaId)) next.delete(entry.mediaId)
                  else next.add(entry.mediaId)
                  return next
                })}
                className="shrink-0"
              />
            ) : null}
            {list.custom && sort === 'order' && !busy ? (
              <span
                draggable
                onDragStart={() => setDragFrom(index)}
                onDragEnd={() => { setDragFrom(null); setDropAt(null) }}
                title="Drag to reorder"
                aria-hidden
                className="cursor-grab select-none text-white/40"
              >
                <GripVertical size={14} />
              </span>
            ) : null}
            <Link className="min-w-0 flex-1 text-sm text-white hover:underline" to={`/anime/${entry.mediaId}`}>{entry.media.title}</Link>
            <label className="sr-only" htmlFor={`status-${entry.mediaId}`}>Status for {entry.media.title}</label>
            <select id={`status-${entry.mediaId}`} className={input} disabled={busy} value={entry.status ?? ''} onChange={(e) => {
              const status = e.target.value
              if (status) void perform(async () => { await request(`/api/lists/${encodeURIComponent(`status:${status}`)}/entries`, 'POST', { media: entry.media }) })
            }}>
              {!entry.status && <option value="">No status</option>}
              {overview?.statuses.map((status) => <option key={status.id} value={status.id.slice(7)}>{status.name}</option>)}
            </select>
            <button type="button" className={button} disabled={busy} aria-label={`Remove ${entry.media.title} from ${list.name}`} onClick={() => void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}/entries/${entry.mediaId}`, 'DELETE') })}>Remove</button>
            <label className="sr-only" htmlFor={`priority-${entry.mediaId}`}>Priority for {entry.media.title}</label>
            <select id={`priority-${entry.mediaId}`} className={input} disabled={busy} value={entry.priority ?? ''} onChange={(event) => {
              const priority = event.target.value ? Number(event.target.value) : null
              void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}/entries/${entry.mediaId}/rating`, 'PUT', { priority }) })
            }}>
              <option value="">No priority</option>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>Priority {value}</option>)}
            </select>
            <label className="sr-only" htmlFor={`rating-${entry.mediaId}`}>Personal rating for {entry.media.title}</label>
            <select id={`rating-${entry.mediaId}`} className={input} disabled={busy} value={entry.rating ?? ''} onChange={(event) => {
              const rating = event.target.value ? Number(event.target.value) : null
              void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}/entries/${entry.mediaId}/rating`, 'PUT', { rating }) })
            }}>
              <option value="">Unrated</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}/10</option>)}
            </select>
            <EntryNote entry={entry} listId={active} busy={busy} onSave={(note) => void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}/entries/${entry.mediaId}/note`, 'PUT', { note }) })} />
          </li>)}
        </ul>}
      </div>}
    </section>
  )
}
