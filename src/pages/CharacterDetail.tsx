import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Film, Users } from 'lucide-react'
import { api } from '../lib/api'
import type { CharacterDetail as CharacterData } from '../types'

/** Character detail page (AV-085b) — names, description and media appearances. */
export function CharacterDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const characterId = Number(id)
  const [character, setCharacter] = useState<CharacterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!Number.isInteger(characterId) || characterId <= 0) {
      setError('Invalid character id')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setCharacter(await api.character(characterId))
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

  // Shareable-route polish (AV-076 pattern): reflect the character in the tab title.
  useEffect(() => {
    if (!character) return
    document.title = `${character.name} · AnimeVault`
    return () => {
      document.title = 'AnimeVault'
    }
  }, [character])

  if (error) {
    return (
      <div className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-500/30">{error}</div>
    )
  }

  if (loading || !character) {
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
        {character.image ? (
          <img src={character.image} alt="" className="h-28 w-28 shrink-0 rounded-xl object-cover ring-1 ring-white/10" />
        ) : (
          <span className="grid h-28 w-28 shrink-0 place-items-center rounded-xl bg-white/5 text-white/20">
            <Users size={28} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">{character.name}</h1>
          {character.nativeName ? <p className="mt-0.5 text-xs text-white/35">{character.nativeName}</p> : null}
          {character.alternativeNames.length ? (
            <p className="mt-1 text-[11px] text-white/30">Also known as {character.alternativeNames.join(' · ')}</p>
          ) : null}
          {character.siteUrl ? (
            <a
              href={character.siteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent transition hover:text-accent-600"
            >
              <ExternalLink size={11} /> View on AniList
            </a>
          ) : null}
        </div>
      </header>

      {character.description ? (
        <p className="mt-4 whitespace-pre-wrap text-[13px] leading-relaxed text-white/65">{character.description}</p>
      ) : null}

      <section className="mt-6">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/35">
          <Film size={12} /> Appearances{character.media.length ? ` · ${character.media.length}` : ''}
        </h2>
        <ul className="mt-2 divide-y divide-white/5 rounded-xl bg-ink-900 ring-1 ring-white/6">
          {character.media.map((appearance) => (
            <li key={appearance.id}>
              <Link
                to={`/anime/${appearance.id}`}
                className="group flex items-baseline gap-2 px-4 py-2.5 transition hover:bg-white/[0.02]"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-white/80 group-hover:text-white">
                  {appearance.title}
                </span>
                <span className="shrink-0 text-[10px] text-white/30">
                  {[appearance.characterRole?.toLowerCase(), appearance.format, appearance.year]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            </li>
          ))}
          {character.media.length === 0 ? (
            <li className="px-4 py-3 text-xs text-white/30">No known appearances yet.</li>
          ) : null}
        </ul>
      </section>
    </div>
  )
}
