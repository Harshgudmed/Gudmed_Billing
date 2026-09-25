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

// The server's `error` as words. Most endpoints send a string, but some send a
// validation summary object ({ formErrors, fieldErrors } from zod's flatten()),
// and `new Error(object)` turned that into the toast "[object Object]" — the
// person saw no reason at all. Each field's first message is named instead.
function errorText(e) {
  if (!e) return ''
  if (typeof e === 'string') return e
  if (typeof e === 'object') {
    const fields = Object.entries(e.fieldErrors || {}).map(([k, v]) => `${k}: ${[].concat(v)[0]}`)
    return [...(e.formErrors || []), ...fields].join('; ') || e.message || 'Please check the details entered'
  }
  return String(e)
}

// Guards the 401→login redirect so simultaneous 401s can't stack navigations into
// a refresh loop. Resets naturally on the next full page load.
let redirectingToLogin = false

client.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status  = error.response?.status
    const data    = error.response?.data
    const message = errorText(data?.error) || data?.message || error.message || 'Request failed'

    // Session expired / not authenticated: clear the stale token and bounce to the
    // matching role login. Skip the auth probes themselves (so logged-out /auth/me
    // doesn't trigger a redirect) and skip when already on a login page.
    //
    // LOOP-PROOF: a page usually fires several API calls at once, so an invalid
    // token yields several simultaneous 401s. Without guards each one calls
    // window.location.assign — and if the target equals the current path (e.g. a
    // 401 at '/' redirecting to '/'), the page reloads, 401s again, and refreshes
    // forever. So: redirect at most ONCE per page load, and NEVER reload the URL
    // we're already on.
    if (status === 401 && typeof window !== 'undefined' && !redirectingToLogin) {
      const reqUrl  = error.config?.url || ''
      const path    = window.location.pathname
      const isProbe = reqUrl.includes('/auth/me') || reqUrl.includes('/auth/login')
      const onLogin = /\/login\/?$/.test(path)
      const role    = path.split('/').filter(Boolean)[0]
      const target  = role ? `/${role}/login` : '/'
      if (!isProbe && !onLogin && path !== target) {
        redirectingToLogin = true
        localStorage.removeItem('token')
        window.location.assign(target)
      }
    }

    const err     = new Error(message)
    err.status    = status
    err.code      = data?.code || data?.errorCode
    err.details   = data?.details
    err.title     = data?.title // a short heading for the toast, when the server sends one
    return Promise.reject(err)
  }
)

export default client
