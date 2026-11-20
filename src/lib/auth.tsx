// Auth state management (AV-101 through AV-125).
//
// Tracks the logged-in user across the app via React context. The session
// token is stored in an httpOnly cookie by the backend, so the frontend
// only needs to keep the user object in memory. On app start, /api/auth/me
// is called to restore the user from the session cookie.

import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'
import type { User } from '../types'

interface AuthContextType {
  user: User | null
  loading: boolean
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string | undefined, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshUser() {
    try {
      const currentUser = await api.authMe()
      setUser(currentUser)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  // Restore user from session cookie on mount.
  useEffect(() => {
    refreshUser()
  }, [])

  async function login(username: string, password: string) {
    const response = await api.authLogin({ username, password })
    setUser(response.user)
  }

  async function register(username: string, email: string | undefined, password: string) {
    const response = await api.authRegister({ username, email, password })
    setUser(response.user)
  }

  async function logout() {
    try {
      await api.authLogout()
    } catch {
      // Ignore logout errors — clear local state regardless.
    }
    setUser(null)
  }

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshUser,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
