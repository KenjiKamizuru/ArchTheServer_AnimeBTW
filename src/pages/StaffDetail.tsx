import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Film, Mic, Users } from 'lucide-react'
import { api } from '../lib/api'
import type { StaffDetail as StaffData } from '../types'

/** Staff detail page (AV-086b) — names, occupations and media credits. */
export function StaffDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const staffId = Number(id)
  const [staff, setStaff] = useState<StaffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!Number.isInteger(staffId) || staffId <= 0) {
      setError('Invalid staff id')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setStaff(await api.staff(staffId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this staff member')
    } finally {
      setLoading(false)
    }
  }, [staffId])

  useEffect(() => {
    void load()
  }, [load])

  // Shareable-route polish (AV-076 pattern): reflect the name in the tab title.
  useEffect(() => {
    if (!staff) return
    document.title = `${staff.name} · AnimeVault`
    return () => {
      document.title = 'AnimeVault'
    }
  }, [staff])

  if (error) {
    return (
      <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">{error}</div>
    )
  }

  if (loading || !staff) {
    return (
      <div className="grid min-h-64 place-items-center text-sm text-white/40" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-xs text-white/40 transition hover:text-white/70"
      >
        <ArrowLeft size={13} /> Back
      </button>

      <header className="mt-4 flex items-start gap-4 rounded-2xl bg-ink-900 p-5 ring-1 ring-white/6">
        {staff.image ? (
          <img src={staff.image} alt="" className="h-28 w-28 shrink-0 rounded-xl object-cover ring-1 ring-white/10" />
        ) : (
          <span className="grid h-28 w-28 shrink-0 place-items-center rounded-xl bg-white/5 text-white/20">
            <Users size={28} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">{staff.name}</h1>
          {staff.nativeName ? <p className="mt-0.5 text-xs text-white/35">{staff.nativeName}</p> : null}
          {staff.primaryOccupations.length ? (
            <p className="mt-1 text-[11px] text-white/30">{staff.primaryOccupations.join(' · ')}</p>
          ) : null}
          {staff.alternativeNames.length ? (
            <p className="mt-1 text-[11px] text-white/30">Also known as {staff.alternativeNames.join(' · ')}</p>
          ) : null}
          {staff.siteUrl ? (
            <a
              href={staff.siteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent transition hover:text-accent-600"
            >
              <ExternalLink size={11} /> View on AniList
            </a>
          ) : null}
        </div>
      </header>

      {staff.description ? (
        <p className="mt-4 whitespace-pre-wrap text-[13px] leading-relaxed text-white/65">{staff.description}</p>
      ) : null}

      {staff.characterCredits.length ? (
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/35">
            <Mic size={12} /> Voice roles · {staff.characterCredits.length}
          </h2>
          <ul className="mt-2 divide-y divide-white/5 rounded-xl bg-ink-900 ring-1 ring-white/6">
            {staff.characterCredits.map((credit) => (
              <li key={`${credit.characterId}:${credit.mediaId}`} className="flex items-baseline gap-2 px-4 py-2.5">
                <Link
                  to={`/characters/${credit.characterId}`}
                  className="min-w-0 flex-1 truncate text-xs text-white/80 transition hover:text-white"
                >
                  {credit.characterName}
                </Link>
                <Link
                  to={`/anime/${credit.mediaId}`}
                  className="min-w-0 max-w-40 truncate text-[10px] text-white/30 transition hover:text-white/60"
                >
                  {credit.mediaTitle}
                </Link>
                <span className="shrink-0 text-[10px] text-white/25">{credit.role?.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/35">
          <Film size={12} /> Credits{staff.media.length ? ` · ${staff.media.length}` : ''}
        </h2>
        <ul className="mt-2 divide-y divide-white/5 rounded-xl bg-ink-900 ring-1 ring-white/6">
          {staff.media.map((credit) => (
            <li key={credit.id}>
              <Link
                to={`/anime/${credit.id}`}
                className="group flex items-baseline gap-2 px-4 py-2.5 transition hover:bg-white/[0.02]"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-white/80 group-hover:text-white">
                  {credit.title}
                </span>
                <span className="shrink-0 text-[10px] text-white/30">
                  {[credit.role, credit.format, credit.year].filter(Boolean).join(' · ')}
                </span>
              </Link>
            </li>
          ))}
          {staff.media.length === 0 ? (
            <li className="px-4 py-3 text-xs text-white/30">No known credits yet.</li>
          ) : null}
        </ul>
      </section>
    </div>
  )
}
