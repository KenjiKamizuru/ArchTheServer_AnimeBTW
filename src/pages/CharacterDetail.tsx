import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
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
  Video,
} from 'lucide-react'
import { api } from '../lib/api'
import type { CharacterEntry } from '../types'

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

export default function CharacterDetailPage() {
  const { id } = useParams()
  const characterId = Number(id)
  const navigate = useNavigate()
  const [character, setCharacter] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealDescription, setRevealDescription] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isInteger(characterId) || characterId <= 0) {
      setError('Invalid character id')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await api.character(characterId)
      setCharacter(res)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this character')
    } finally {
      setLoading(false)
    }
  }, [characterId])

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

  if (loading && !character) return <div className="p-8 text-center"><Loader2 size={24} /></div>
  if (!character) return null

  const description = revealDescription ? character.description : (character.description ?? '').slice(0, 300)

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
        {character.image ? (
          <img
            src={character.image}
            alt=""
            className="h-48 w-full object-cover opacity-45"
          />
        ) : (
          <div className="h-48 w-full bg-ink-850" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />
        <div className="flex flex-wrap items-start gap-4 p-4 md:-mt-16 md:p-5">
          {character.image ? (
            <img
              src={character.image}
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
              {character.name}
            </h1>
            {character.nativeName && character.nativeName !== character.name ? (
              <p className="mt-0.5 text-xs text-white/35">{character.nativeName}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
              {character.gender ? <span>{character.gender}</span> : null}
              {character.age != null ? <span>· {character.age} years old</span> : null}
              {character.bloodType ? <span>· Blood type {character.bloodType}</span> : null}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {/* Description */}
          <SectionCard id="description" title="Description" icon={FileText}>
            {character.description ? (
              <>
                <p className="text-[13px] leading-relaxed text-white/65">
                  {revealDescription ? character.description : description.length < character.description.length ? description + '…' : description}
                </p>
                {character.description.length > 300 ? (
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

          {/* Media appearances */}
          {character.media?.length ? (
            <SectionCard id="media" title="Media appearances" icon={Clapperboard}>
              <ol className="space-y-2">
                {character.media.map((entry: any, index: number) => (
                  <li key={`${entry.id}-${index}`} className="flex items-start gap-2.5 rounded-lg bg-ink-850 p-2 ring-1 ring-white/5">
                    <span className="w-8 shrink-0 text-center text-[11px] font-medium text-white/30 tabular-nums">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/anime/${entry.id}`}
                        className="block truncate text-xs font-medium text-white transition hover:text-accent"
                      >
                        {entry.title?.english || entry.title?.romaji || entry.title?.native || `Character #${entry.id}`}
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

          {/* Voice actors */}
          {character.voiceActors?.length ? (
            <SectionCard id="voice-actors" title="Voice actors" icon={Users}>
              <ul className="space-y-1.5">
                {character.voiceActors.map((actor: any) => (
                  <li key={actor.id} className="flex items-center gap-2 rounded-lg bg-ink-850 p-2 ring-1 ring-white/5">
                    {actor.image ? (
                      <img
                        src={actor.image}
                        alt=""
                        loading="lazy"
                        className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                      />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded-full bg-white/5 flex items-center justify-center text-white/20">
                        <Users size={10} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-white">{actor.name}</span>
                      {actor.language ? (
                        <span className="block text-[10px] text-white/30">{actor.language}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-3">
          {character.isFavourite ? (
            <div className="rounded-lg bg-amber-950/30 p-3 ring-1 ring-amber-500/25">
              <p className="text-[11px] font-medium text-amber-200">Favourite character on AniList</p>
            </div>
          ) : null}

          {character.siteUrl ? (
            <a
              href={character.siteUrl}
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
