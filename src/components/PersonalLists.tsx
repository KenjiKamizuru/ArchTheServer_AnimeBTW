import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Media } from '../types'

type ListSummary = { id: string; name: string; count: number; description?: string }
type Entry = { mediaId: number; media: Media; status: string | null }
type Overview = { statuses: ListSummary[]; lists: ListSummary[] }
type List = ListSummary & { entries: Entry[]; custom: boolean }

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

/** Lists are shared across this installation until account support exists. */
export default function PersonalLists({ bookmarks }: { bookmarks: Media[] }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [active, setActive] = useState('status:planned')
  const [list, setList] = useState<List | null>(null)
  const [name, setName] = useState('')
  const [bookmarkId, setBookmarkId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    setList(null)
    Promise.all([request<Overview>('/api/lists'), request<List>(`/api/lists/${encodeURIComponent(active)}`)])
      .then(([summary, selected]) => { if (!cancelled) { setOverview(summary); setList(selected); setError('') } })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [active, revision])
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('')
    try { await action(); setRevision((value) => value + 1) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update lists') }
    finally { setBusy(false) }
  }
  const button = 'rounded-lg bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20 disabled:opacity-50'
  const input = 'rounded-lg bg-ink-900 px-3 py-2 text-sm text-white ring-1 ring-white/10'
  return (
    <section className="mt-8 rounded-xl bg-ink-900 p-4 ring-1 ring-white/10" aria-labelledby="lists-heading">
      <h2 id="lists-heading" className="text-lg font-semibold text-white">Your lists</h2>
      <p className="mt-1 text-xs text-white/50">Lists are shared on this installation. Bookmarks remain separate.</p>
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
        const result = await request<{ list: ListSummary }>('/api/lists', 'POST', { name }); setName(''); setActive(result.list.id)
      }) }}>
        <label className="sr-only" htmlFor="new-list-name">New list name</label>
        <input id="new-list-name" className={input} placeholder="New list name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <button className={button} disabled={busy || !name.trim()}>Create list</button>
        <button type="button" className={button} disabled={busy || !bookmarks.length} onClick={() => void perform(async () => {
          const result = await request<{ migrated: number; skipped: number }>('/api/lists/migrate', 'POST')
          setMessage(`Copied ${result.migrated} bookmarks to Planned; ${result.skipped} already present or skipped.`)
        })}>Copy bookmarks to Planned</button>
      </form>
      {list && <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-white">{list.name}</h3>
          {list.custom && <button type="button" className={button} disabled={busy} onClick={() => {
            if (window.confirm(`Delete list “${list.name}”? Titles will remain in their status lists.`)) void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}`, 'DELETE'); setActive('status:planned') })
          }}>Delete list</button>}
        </div>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const media = bookmarks.find((item) => String(item.id) === bookmarkId); if (media) void perform(async () => { await request(`/api/lists/${encodeURIComponent(active)}/entries`, 'POST', { media }); setBookmarkId('') }) }}>
          <label className="sr-only" htmlFor="list-bookmark">Choose a bookmark to add</label>
          <select id="list-bookmark" className={input} value={bookmarkId} onChange={(e) => setBookmarkId(e.target.value)}>
            <option value="">Choose a bookmark</option>
            {bookmarks.map((media) => <option key={media.id} value={media.id}>{media.title}</option>)}
          </select>
          <button className={button} disabled={busy || !bookmarkId}>Add to list</button>
        </form>
        {list.entries.length === 0 ? <p className="mt-3 text-sm text-white/50">No titles in this list yet.</p> : <ul className="mt-3 divide-y divide-white/10">
          {list.entries.map((entry) => <li key={entry.mediaId} className="flex flex-wrap items-center gap-2 py-2">
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
          </li>)}
        </ul>}
      </div>}
    </section>
  )
}
