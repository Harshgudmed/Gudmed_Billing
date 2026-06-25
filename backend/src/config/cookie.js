// Centralised auth-cookie configuration.
//
// In production the frontend (Vercel) and backend (Render) live on different
// domains, so the session cookie must be cross-site: SameSite=None + Secure.
// Secure cookies are only sent over HTTPS — exactly what we want in prod.
// In local dev (http://localhost) we relax to SameSite=Lax and Secure=false so
// the cookie still works without TLS.

const isProd = process.env.NODE_ENV === 'production'

export const TOKEN_COOKIE = 'token'

// 8 hours, matching the JWT expiry
const MAX_AGE_MS = 8 * 60 * 60 * 1000

export const authCookieOptions = {
  httpOnly: true,                       // not readable by JS → mitigates XSS token theft
  secure: isProd,                       // HTTPS-only in production
  sameSite: isProd ? 'none' : 'lax',    // cross-site in prod, lax locally
  maxAge: MAX_AGE_MS,
  path: '/',
}

// Used when clearing the cookie — must match attributes (minus maxAge)
export const clearCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
}
