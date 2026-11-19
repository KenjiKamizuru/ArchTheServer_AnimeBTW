// Public profile view (AV-111b): renders `GET /api/profile/:userId`, honoring
// the account's visibility (public / private / link-only via ?token=).
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Loader2, Shield } from 'lucide-react'
import { api } from '../lib/api'
import type { RegisteredUser } from '../types'

export default function ProfilePage() {
  const { userId } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [user, setUser] = useState<RegisteredUser | null>(null)
  const [visibility, setVisibility] = useState<string>('public')
  const [activity, setActivity] = useState<{ memberSince: number | null; activeSessions: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarBroken, setAvatarBroken] = useState(false)

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    setError(null)
    api
      .viewProfile(userId, token)
      .then((res) => {
        setUser(res.user)
        setVisibility(res.visibility)
        setActivity(res.activity)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Profile not found'))
      .finally(() => setLoading(false))
  }, [userId, token])

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 size={14} className="animate-spin" /> Loading profile…
        </p>
      ) : error || !user ? (
        <div className="rounded-xl bg-ink-800/60 p-6 text-center ring-1 ring-white/10">
          <h1 className="text-lg font-semibold text-white">Profile not found</h1>
          <p className="mt-1 text-sm text-white/50">{error ?? 'This profile is unavailable.'}</p>
        </div>
      ) : (
        <div className="rounded-xl bg-ink-800/60 p-6 ring-1 ring-white/10">
          <div className="flex items-center gap-4">
            {avatarBroken ? (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl font-semibold text-white">
                {(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}
              </div>
            ) : (
              <img
                src={`/api/auth/avatar/${user.id}`}
                alt=""
                onError={() => setAvatarBroken(true)}
                className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-white/10"
              />
            )}
            <div>
              <h1 className="text-lg font-semibold text-white">{user.displayName || user.username}</h1>
              <p className="text-sm text-white/50">@{user.username}</p>
            </div>
          </div>
          {user.bio ? <p className="mt-4 whitespace-pre-wrap text-sm text-white/80">{user.bio}</p> : null}
          {activity ? (
            <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-white/60">
              {activity.memberSince ? (
                <span>Member since {new Date(activity.memberSince).toLocaleDateString()}</span>
              ) : null}
              <span>
                {activity.activeSessions} active session{activity.activeSessions === 1 ? '' : 's'}
              </span>
            </div>
          ) : null}
          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-white/40">
            <Shield size={11} /> {visibility === 'link-only' ? 'Link-only profile' : visibility === 'private' ? 'Private profile' : 'Public profile'}
          </p>
        </div>
      )}
    </div>
  )
}
