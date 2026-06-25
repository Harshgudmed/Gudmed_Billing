// Central JWT secret + production security validation (C7).
// In production we refuse to boot with a missing or well-known-default secret,
// so a misconfigured deploy fails loudly instead of accepting forgeable tokens.
const WEAK_SECRETS = new Set(['secret', 'change-me-in-production', 'changeme', 'jwt', ''])

export const JWT_SECRET = process.env.JWT_SECRET || 'secret'

export function assertSecurityConfig() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || WEAK_SECRETS.has(process.env.JWT_SECRET.trim())) {
      // Fatal: do not start an exploitable server.
      throw new Error('FATAL SECURITY: JWT_SECRET is missing or set to a known default in production. Set a strong, unique JWT_SECRET before starting.')
    }
  } else if (!process.env.JWT_SECRET) {
    console.warn('⚠ JWT_SECRET not set — using an insecure dev fallback. Fine for local dev only.')
  }
}
