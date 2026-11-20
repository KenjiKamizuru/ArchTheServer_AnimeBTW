// Register page (AV-101).
// Create a new AnimeVault account. Requires username + password;
// email is optional unless the admin has enabled email verification.

import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, User, AlertCircle, Lock, Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toasts'

interface RegisterFormValues {
  username: string
  email: string
  password: string
  confirmPassword: string
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register, loading } = useAuth()
  const pushToast = useToast()
  const [values, setValues] = useState<RegisterFormValues>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError('')
      if (values.password !== values.confirmPassword) {
        setError('Passwords do not match')
        return
      }
      if (values.password.length < 8) {
        setError('Password must be at least 8 characters')
        return
      }
      try {
        await register(values.username, values.email || undefined, values.password)
        navigate('/')
        pushToast('Account created! You are now signed in.')
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to create account. Please try again.',
        )
      }
    },
    [register, navigate, values.username, values.email, values.password, values.confirmPassword],
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <User size={24} className="text-accent" />
            <span className="text-2xl font-bold tracking-tight text-white">Create account</span>
          </div>
          <p className="text-sm text-white/50">
            Join AnimeVault to sync your lists across devices
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
              <User size={16} className="text-white/40" />
              <input
                type="text"
                autoComplete="username"
                value={values.username}
                onChange={(event) =>
                  setValues({ ...values, username: event.target.value })
                }
                placeholder="Username (3–32 chars)"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
              <Mail size={16} className="text-white/40" />
              <input
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={(event) =>
                  setValues({ ...values, email: event.target.value })
                }
                placeholder="Email (optional)"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
              <Lock size={16} className="text-white/40" />
              <input
                type="password"
                autoComplete="new-password"
                value={values.password}
                onChange={(event) =>
                  setValues({ ...values, password: event.target.value })
                }
                placeholder="Password (8+ chars)"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
              <Lock size={16} className="text-white/40" />
              <input
                type="password"
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={(event) =>
                  setValues({ ...values, confirmPassword: event.target.value })
                }
                placeholder="Confirm password"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 ring-1 ring-red-500/30 border border-red-500/20">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="text-red-400 shrink-0" />
                <p className="text-sm text-red-100">{error}</p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-black shadow-lg shadow-accent/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Creating account…
              </>
            ) : (
              <>
                <User size={16} />
                Create account
              </>
            )}
          </button>
        </form>

        <p className="text-center text-sm text-white/50">
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-accent hover:text-accent/90 font-medium"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
