import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/security.js'
import { db } from '../config/db.js'

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
/**
 * Is this staff account still allowed in, and in what role?
 *
 * A token said everything: it was signed for eight hours and nothing looked at
 * the account again. Turning someone off in Settings, or moving them out of an
 * admin role, changed nothing until their token expired — a dismissed employee
 * kept full access for the rest of the day.
 *
 * So the account is re-read, and the answer is cached briefly: a busy screen
 * fires several requests a second, and a database round-trip on each of them
 * would be paid by every user to catch a rare event. The cache is deliberately
 * short — being locked out takes effect within a few seconds, not a shift.
 */
const ACCOUNT_TTL_MS = 15_000
const accountCache = new Map() // userId → { at, isActive, role }

async function currentAccount(userId) {
  const hit = accountCache.get(userId)
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true },
  }).catch(() => null)
  // A lookup that fails (database blip) must not lock the hospital out; the
  // token alone carries the request through, exactly as it used to.
  if (!user) return null
  const fresh = { at: Date.now(), isActive: user.isActive, role: user.role }
  accountCache.set(userId, fresh)
  if (accountCache.size > 5000) accountCache.clear()
  return fresh
}

/** Drop a user from the cache so a change to their account applies at once. */
export function forgetAccount(userId) {
  if (userId) accountCache.delete(userId)
}

export async function authenticate(req, res, next) {
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
    // Staff only: a patient-portal session has no staff row to re-read.
    const staffId = decoded.role !== 'patient' ? (decoded.id || decoded.userId) : null
    if (staffId) {
      const account = await currentAccount(staffId)
      if (account && !account.isActive) {
        return res.status(401).json({
          success: false,
          error: 'This account has been deactivated. Please contact your administrator.',
          code: 'ACCOUNT_DISABLED',
        })
      }
      // The role comes from the account, not from the token — a demotion has to
      // take hold without waiting for the old token to run out.
      if (account && account.role && account.role !== decoded.role) req.user.role = account.role
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
