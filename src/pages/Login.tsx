// Login page (AV-102).
// Sign in with username/email + password. Links to registration and
// password-reset flows.

import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogIn, Mail, User, AlertCircle, Lock } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/Toasts'

interface LoginFormValues {
  username: string
  password: string
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, loading } = useAuth()
  const pushToast = useToast()
  const [values, setValues] = useState<LoginFormValues>({ username: '', password: '' })
  const [error, setError] = useState('')

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError('')
      try {
        await login(values.username, values.password)
        navigate('/')
        pushToast('Welcome back!')
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to sign in. Please try again.',
        )
      }
    },
    [login, navigate, values.username, values.password],
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <LogIn size={24} className="text-accent" />
            <span className="text-2xl font-bold tracking-tight text-white">Sign in</span>
          </div>
          <p className="text-sm text-white/50">
            Enter your AnimeVault account credentials
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
                placeholder="Username or email"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 p-2.5 ring-1 ring-white/10">
              <Lock size={16} className="text-white/40" />
              <input
                type="password"
                autoComplete="current-password"
                value={values.password}
                onChange={(event) =>
                  setValues({ ...values, password: event.target.value })
                }
                placeholder="Password"
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
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 2 5.373 2 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Signing in…
              </>
            ) : (
              <>
                <LogIn size={16} />
                Sign in
              </>
            )}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-white/5"></span>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2 bg-ink-950 text-white/40">Or continue with</span>
          </div>
        </div>

        <button
          type="button"
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-3 text-sm text-white ring-1 ring-white/10 hover:bg-white/10 transition"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.8 3.28-8.1m-8.84-3.69v2.77H8.51v-2.18c0-.52-.21-1.01-.59-1.37s-.82-.46-1.37-.16l-1.13.64c-.23-.66-.39-1.39-.39-2.16 0-1.61.88-2.99 2.27-3.89 1.39-.9 3.16-1.19 5.02-.91v1.44c-1.29-.2-2.31-.56-3.07-1.04-.97-.61-1.48-1.56-1.48-2.69 0-1.29.81-2.39 2.09-2.89 1.48-.58 3.36-.37 4.85.84 1.18.97 1.89 2.34 1.89 3.86 0 .98-.21 1.88-.59 2.62-.59.96-1.55 1.42-2.29 1.43zm5.4-1.73c-.27-.46-.73-.75-1.29-.75-.51 0-1.02.24-1.39.7l1.19 1.14c.3-.38.6-.81.8-1.31.29-.73.3-1.57.02-2.36l-.53-.51c-.58-.57-1.3-.89-2.07-.89-.77 0-1.49.32-2.08.89l-1.1-1.05c.45-.47.88-1.06 1.39-1.39l1.06 1.01c.67-.64 1.57-1.05 2.57-1.05 1.04 0 1.95.43 2.6 1.17l.51-.47c-.8-.9-1.88-1.48-3.12-1.48-1.23 0-2.33.58-3.11 1.48m-7.06-1.29c-1.04 0-1.93.61-2.29 1.56h-.01c-.03.09-.06 1.01.07 2.04l1.62-1.61c.09-.41.24-.79.44-1.11.31-.52.77-.99 1.38-1.36.98-.59 2.23-.92 3.58-.92 1.06 0 2.09.26 3.03.73v2.09c-1.2-.59-2.64-.93-4.22-.93m0 4.42c-1.81 0-3.47.63-4.7 1.76l1.43 1.4c.77-.7 1.85-1.12 3.03-1.12 1.18 0 2.27.43 3.04 1.2l1.34-1.31c-1.06-1.09-2.47-1.74-4.04-1.74-1.38 0-2.61.57-3.49 1.52-.88.94-1.33 2.12-1.33 3.38 0 1.28.46 2.47 1.33 3.4.88.95 2.11 1.52 3.49 1.52s2.61-.57 3.49-1.52l1.33 1.28c-1.05 1.04-2.43 1.64-3.92 1.64-1.37 0-2.62-.47-3.63-1.34-.99-.86-1.52-2.04-1.52-3.28-.01-1.24.53-2.42 1.5-3.27"/>
          </svg>
          Passkey / WebAuthn
        </button>

        <p className="text-center text-sm text-white/50">
          Don't have an account?{' '}
          <Link
            to="/register"
            className="text-accent hover:text-accent/90 font-medium"
          >
            Create an account
          </Link>
        </p>

        <p className="text-center text-sm text-white/50">
          Forgot your password?{' '}
          <Link
            to="/forgot-password"
            className="text-accent hover:text-accent/90 font-medium"
          >
            Reset it
          </Link>
        </p>
      </div>
    </div>
  )
}
