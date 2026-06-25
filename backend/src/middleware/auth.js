import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/security.js'

// Access-control master switch.
// FAIL-CLOSED IN PRODUCTION (C7): in production the API is enforced UNLESS you
// explicitly opt out with AUTH_ENFORCED=false. Outside production it stays
// tolerant by default so local dev / the demo keep working without a login.
// This prevents a missing env var from silently serving the API unauthenticated.
const IS_PROD = process.env.NODE_ENV === 'production'
const AUTH_ENFORCED = IS_PROD
  ? process.env.AUTH_ENFORCED !== 'false' // prod: on unless explicitly disabled
  : process.env.AUTH_ENFORCED === 'true' // dev/demo: off unless explicitly enabled

const DEFAULT_ORG = process.env.ORGANIZATION_ID || 'org-demo'

/**
 * Decode the JWT (httpOnly cookie preferred, Authorization header as fallback)
 * and attach `req.user` + `req.organizationId`.
 *
 * - AUTH_ENFORCED off: missing/invalid token is tolerated and we fall back to
 *   the demo org (legacy behaviour).
 * - AUTH_ENFORCED on: a valid token is required, otherwise 401. The hospital is
 *   taken strictly from the token (no demo-org fallback).
 */
export function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1]

  if (!token) {
    if (AUTH_ENFORCED) {
      return res.status(401).json({ success: false, error: 'Authentication required', code: 'NO_TOKEN' })
    }
    req.organizationId = DEFAULT_ORG
    return next()
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    req.organizationId = decoded.organizationId || (AUTH_ENFORCED ? undefined : DEFAULT_ORG)
    if (AUTH_ENFORCED && !req.organizationId) {
      return res.status(401).json({ success: false, error: 'Session is missing a hospital. Please sign in again.', code: 'NO_ORG' })
    }
    return next()
  } catch {
    if (AUTH_ENFORCED) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session', code: 'BAD_TOKEN' })
    }
    // Legacy tolerance: bad token → still serve the demo org.
    req.organizationId = DEFAULT_ORG
    return next()
  }
}

/**
 * Route guard: allow only the given roles. `admin` and `super_admin` always pass.
 * Call with no roles to mean "any authenticated user".
 *
 * No-op while AUTH_ENFORCED is off, so adding it to routes now is safe.
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!AUTH_ENFORCED) return next()

    const role = req.user?.role
    if (!role) {
      return res.status(401).json({ success: false, error: 'Authentication required', code: 'NO_TOKEN' })
    }
    // Patients are confined to the patient portal — never the staff API.
    if (role === 'patient') {
      return res.status(403).json({ success: false, error: 'You do not have access to this resource', code: 'FORBIDDEN' })
    }
    if (role === 'admin' || role === 'super_admin') return next()
    if (roles.length === 0 || roles.includes(role)) return next()

    return res.status(403).json({ success: false, error: 'You do not have access to this resource', code: 'FORBIDDEN' })
  }
}

/**
 * Guard for the patient portal — requires a patient session (JWT with patientId).
 * Always enforced (the portal is inherently patient-scoped), regardless of AUTH_ENFORCED.
 */
export function requirePatient(req, res, next) {
  if (req.user?.role === 'patient' && req.user.patientId) return next()
  return res.status(403).json({ success: false, error: 'Patient access only', code: 'FORBIDDEN' })
}
