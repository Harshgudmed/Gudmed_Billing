import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import client from '@/api/client'

// Auth state for the web app. Restores the session from the httpOnly cookie via
// /auth/me on mount, and exposes login/logout. The login response token is also
// stored in localStorage as the Bearer fallback used by the API client.

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    client.get('/auth/me')
      .then((res) => { if (active && res?.user) setUser(res.user) })
      .catch(() => { /* not logged in — fine */ })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await client.post('/auth/login', { email, password })
    if (res?.token) localStorage.setItem('token', res.token)
    setUser(res.user)
    return res.user
  }, [])

  // Patient portal login — identifier is a phone number, UHID/MRN, or email.
  const patientLogin = useCallback(async (identifier, password) => {
    const res = await client.post('/auth/patient-login', { identifier, password })
    if (res?.token) localStorage.setItem('token', res.token)
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try { await client.post('/auth/logout') } catch { /* ignore */ }
    localStorage.removeItem('token')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, patientLogin, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
