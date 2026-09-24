import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import client from '@/api/client'
import { clearOrgCache } from '@/lib/orgSettings'
import { clearBookingSourceCache } from '@/components/common/hooks/useBookingSource'
import { resetRealtime } from '@/lib/realtimeSocket'

// Auth state for the web app. Restores the session from the httpOnly cookie via
// /auth/me on mount, and exposes login/logout. The login response token is also
// stored in localStorage as the Bearer fallback used by the API client.

// Everything the app keeps in memory about ONE hospital — its name, logo and
// address (printed on bills, reports and the QR poster) and its departments.
// Signing out and in again does not reload the page, so without this a second
// hospital signing in on the same tab saw the first hospital's name in the
// sidebar and printed it on their bills.
function forgetHospital() {
  clearOrgCache()
  clearBookingSourceCache()
  // Including which hospital's live updates this browser is listening to. Left
  // behind, the next person to sign in here kept receiving the previous
  // hospital's socket room, so their own screens stopped updating by themselves.
  resetRealtime()
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const checkAuth = async () => {
      try {
        const res = await client.get('/auth/me')
        if (active && res?.user) {
          setUser(res.user)
        }
      } catch (err) {
        // Not logged in — fine
        if (active) console.debug('Auth check: user not logged in')
      } finally {
        if (active) setLoading(false)
      }
    }

    checkAuth()
    return () => { active = false }
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await client.post('/auth/login', { email, password })
    if (res?.token) localStorage.setItem('token', res.token)
    forgetHospital()
    setUser(res.user)
    return res.user
  }, [])

  // Patient portal login — identifier is a phone number, UHID/MRN, or email.
  const patientLogin = useCallback(async (identifier, password) => {
    const res = await client.post('/auth/patient-login', { identifier, password })
    if (res?.token) localStorage.setItem('token', res.token)
    forgetHospital()
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try { await client.post('/auth/logout') } catch { /* ignore */ }
    localStorage.removeItem('token')
    forgetHospital()
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
