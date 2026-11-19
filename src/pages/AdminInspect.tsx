// Admin metadata inspector (AV-025b): raw provider payload beside the
// normalized record, with field-by-field comparison rows from the server.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminInspect, type InspectionResponse } from '../lib/api'

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '—' : JSON.stringify(value)
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

export default function AdminInspect() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [data, setData] = useState<InspectionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function inspect(target: string) {
    const value = target.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      setData(await adminInspect(value))
      navigate(`/admin/inspect/${encodeURIComponent(value)}`, { replace: true })
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Inspection failed')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (id) {
      setInput(id)
      void inspect(id)
    }
    // Intentionally keyed on the route id only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-white">Admin · Metadata inspector</h1>
        <p className="mt-1 text-xs text-white/50">Raw provider payload beside the normalized record.</p>
      </header>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void inspect(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="AniList id (e.g. 21)"
          inputMode="numeric"
          className="w-48 rounded-lg bg-ink-900 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-white/20"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:opacity-50"
        >
          {busy ? 'Inspecting…' : 'Inspect'}
        </button>
      </form>
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <section className="overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-white/6">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-white/40">
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Raw</th>
                  <th className="px-3 py-2 font-medium">Normalized</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.map((row) => (
                  <tr key={row.field} className={row.changed ? 'bg-amber-400/5' : undefined}>
                    <td className="px-3 py-1.5 font-medium text-white/70">{row.field}</td>
                    <td className={`px-3 py-1.5 ${row.changed ? 'text-amber-300/80' : 'text-white/45'}`}>{cell(row.raw)}</td>
                    <td className={`px-3 py-1.5 ${row.changed ? 'text-amber-300/80' : 'text-white/45'}`}>
                      {cell(row.normalized)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            {([['Raw payload', data.raw], ['Normalized record', data.record]] as const).map(([label, value]) => (
              <details key={label} className="rounded-2xl bg-ink-900 p-3 ring-1 ring-white/6">
                <summary className="cursor-pointer text-xs font-medium text-white/70">{label}</summary>
                <pre className="mt-2 max-h-96 overflow-auto text-[10px] leading-relaxed text-white/50">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
