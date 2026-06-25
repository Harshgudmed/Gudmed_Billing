import axios from 'axios'

// ─────────────────────────────────────────────────────────────────────────────
// ONE LINE TO CHANGE FOR PROD:
//   In .env.production → VITE_API_URL=https://gudmed-api.onrender.com/api
//   In .env.development → VITE_API_URL=http://localhost:5000/api  (or use proxy)
// ─────────────────────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.VITE_API_URL || '/api'

const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  // Send/receive the httpOnly auth cookie on every request (cross-site in prod).
  withCredentials: true,
  // 60s to tolerate Render free-tier cold starts (backend spins down after
  // ~15 min idle and takes 30-60s to wake on the first request).
  timeout: 60000,
})

// The httpOnly cookie is the primary auth transport and is sent automatically.
// We still attach a Bearer header when a token is present (e.g. older sessions
// or non-cookie environments) as a fallback for multi-tenancy.
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status  = error.response?.status
    const data    = error.response?.data
    const message = data?.error || data?.message || error.message || 'Request failed'

    // Session expired / not authenticated: clear the stale token and bounce to the
    // matching role login. Skip the auth probes themselves (so logged-out /auth/me
    // doesn't trigger a redirect) and skip when already on a login page.
    if (status === 401 && typeof window !== 'undefined') {
      const reqUrl  = error.config?.url || ''
      const path    = window.location.pathname
      const isProbe = reqUrl.includes('/auth/me') || reqUrl.includes('/auth/login')
      const onLogin = /\/login\/?$/.test(path)
      if (!isProbe && !onLogin) {
        localStorage.removeItem('token')
        const role = path.split('/').filter(Boolean)[0]
        window.location.assign(role ? `/${role}/login` : '/')
      }
    }

    const err     = new Error(message)
    err.status    = status
    err.code      = data?.code || data?.errorCode
    err.details   = data?.details
    return Promise.reject(err)
  }
)

export default client
