import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Clapperboard,
  Eye,
  EyeOff,
  FileText,
  Image,
  Loader2,
  ListOrdered,
  Users,
} from 'lucide-react'
import { api } from '../lib/api'

function SectionCard({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string
  title: string
  icon: typeof Users
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl bg-ink-900 p-4 ring-1 ring-white/6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon size={14} className="text-accent" />
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

export default function StaffDetailPage() {
  const { id } = useParams()
  const staffId = Number(id)
  const [staff, setStaff] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealDescription, setRevealDescription] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isInteger(staffId) || staffId <= 0) {
      setError('Invalid staff id')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.staff(staffId)
      setStaff(res)
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

  if (error) {
    return (
      <div className="rounded-xl bg-red-950/50 p-5 text-sm text-red-200 ring-1 ring-red-500/30">
        <p>{error}</p>
        <Link
          to="/browse"
          className="mt-3 inline-block rounded-lg bg-white/8 px-3 py-1.5 text-xs text-white/80"
        >
          Browse instead
        </Link>
      </div>
    )
  }

  if (loading && !staff) return <div className="p-8 text-center"><Loader2 size={24} /></div>
  if (!staff) return null

  const description = revealDescription ? staff.description : (staff.description ?? '').slice(0, 300)

  return (
    <article>
      <Link
        to="/browse"
        className="inline-flex items-center gap-1.5 text-xs text-white/45 transition hover:text-white"
      >
        <ArrowLeft size={13} /> Back to browse
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="relative mt-3 overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-white/6">
        {staff.image ? (
          <img
            src={staff.image}
            alt=""
            className="h-48 w-full object-cover opacity-45"
          />
        ) : (
          <div className="h-48 w-full bg-ink-850" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />
        <div className="flex flex-wrap items-start gap-4 p-4 md:-mt-16 md:p-5">
          {staff.image ? (
            <img
              src={staff.image}
              alt=""
              className="h-24 w-24 shrink-0 rounded-full object-cover shadow-xl ring-2 ring-ink-900 md:h-32 md:w-32"
            />
          ) : (
            <span className="h-24 w-24 shrink-0 rounded-full bg-ink-850 flex items-center justify-center">
              <Users size={20} className="text-white/20" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">
              {staff.name}
            </h1>
            {staff.nativeName && staff.nativeName !== staff.name ? (
              <p className="mt-0.5 text-xs text-white/35">{staff.nativeName}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
              {staff.gender ? <span>{staff.gender}</span> : null}
              {staff.age != null ? <span>· {staff.age} years old</span> : null}
              {staff.bloodType ? <span>· Blood type {staff.bloodType}</span> : null}
              {staff.primaryOccupations?.length ? (
                <>
                  <span>·</span>
                  <span>{staff.primaryOccupations.join(', ')}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {/* Description */}
          <SectionCard id="description" title="Description" icon={FileText}>
            {staff.description ? (
              <>
                <p className="text-[13px] leading-relaxed text-white/65">
                  {revealDescription ? staff.description : description.length < staff.description.length ? description + '…' : description}
                </p>
                {staff.description.length > 300 ? (
                  <button
                    type="button"
                    onClick={() => setRevealDescription((v) => !v)}
                    className="mt-2 text-[11px] text-accent underline decoration-dotted"
                  >
                    {revealDescription ? 'Show less' : 'Read more'}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-white/40">No description available.</p>
            )}
          </SectionCard>

          {/* Staff media */}
          {staff.media?.length ? (
            <SectionCard id="media" title="Staff media" icon={Clapperboard}>
              <ol className="space-y-2">
                {staff.media.map((entry: any, index: number) => (
                  <li key={`${entry.id}-${index}`} className="flex items-start gap-2.5 rounded-lg bg-ink-850 p-2 ring-1 ring-white/5">
                    <span className="w-8 shrink-0 text-center text-[11px] font-medium text-white/30 tabular-nums">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/anime/${entry.id}`}
                        className="block truncate text-xs font-medium text-white transition hover:text-accent"
                      >
                        {entry.title?.english || entry.title?.romaji || entry.title?.native || `Anime #${entry.id}`}
                      </Link>
                      <p className="mt-0.5 text-[10px] text-white/30">
                        {[entry.role, entry.format, entry.seasonYear].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </SectionCard>
          ) : null}
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-3">
          {staff.isFavourite ? (
            <div className="rounded-lg bg-amber-950/30 p-3 ring-1 ring-amber-500/25">
              <p className="text-[11px] font-medium text-amber-200">Favourite staff on AniList</p>
            </div>
          ) : null}

          {staff.siteUrl ? (
            <a
              href={staff.siteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="block rounded-lg bg-ink-850 px-3 py-2 ring-1 ring-white/5 text-[11px] text-white/60 underline decoration-dotted transition hover:text-accent"
            >
              View on AniList
            </a>
          ) : null}
        </div>
      </div>
    </article>
  )
}
