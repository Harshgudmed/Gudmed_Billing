import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { db } from '../config/db.js'
import { TOKEN_COOKIE, authCookieOptions, clearCookieOptions } from '../config/cookie.js'
import { JWT_SECRET } from '../config/security.js'
import { patientFullName } from '../lib/patientName.js'

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns a JWT containing userId, id, organizationId, role, fullName, email.
 * (`id` and `fullName` are included so server-side actor capture —
 *  Created/Acknowledged/Completed By, note authorship, audit — resolves from
 *  req.user without an extra DB lookup. `userId` is kept for backward compat.)
 *
 * The hospital (organization) is derived from the user record — there is no
 * hospital segment in the URL, so a staff email is unique across the system.
 */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'email and password are required' })
    }

    const user = await db.user.findUnique({ where: { email } })

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' })
    }

    const AUTH_ENFORCED = process.env.AUTH_ENFORCED === 'true'

    if (!AUTH_ENFORCED) {
      // Demo mode: Gudmed@123 is the master password for every account.
      // If the user types Gudmed@123 → always allow + normalise the stored hash.
      if (password === 'Gudmed@123') {
        const demoHash = await bcrypt.hash('Gudmed@123', 10)
        await db.user.update({ where: { id: user.id }, data: { passwordHash: demoHash } })
        user.passwordHash = demoHash
      } else if (!user.passwordHash) {
        // No hash at all and wrong password → block
        return res.status(401).json({ success: false, error: 'Invalid credentials' })
      }
    } else if (!user.passwordHash) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' })
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash)
    if (!passwordOk) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' })
    }

    if (user.isActive === false) {
      return res.status(403).json({ success: false, error: 'Your account has been deactivated. Contact your administrator.' })
    }

    const orgId = user.organizationId || process.env.ORGANIZATION_ID || 'org-demo'

    // Best-effort: record the sign-in time, never block login on this.
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {})

    const token = jwt.sign(
      {
        userId: user.id,
        id: user.id, // alias: lets req.user.id resolve for actor capture across modules
        organizationId: orgId,
        role: user.role,
        fullName: user.fullName, // actor display name (Created/Completed By, note author)
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    )

    // Primary auth transport: httpOnly Secure cookie (sent over HTTPS only in prod).
    res.cookie(TOKEN_COOKIE, token, authCookieOptions)

    res.json({
      success: true,
      token, // also returned for backward-compatibility / non-browser clients
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        organizationId: orgId,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/auth/patient-login
 * Body: { identifier, password }  — identifier is the patient's phone, UHID/MRN, or email.
 * Returns a JWT with { patientId, role: 'patient', organizationId }.
 */
export async function patientLogin(req, res, next) {
  try {
    const { identifier, password } = req.body
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'identifier (phone / UHID / email) and password are required' })
    }
    const id = String(identifier).trim()

    // The patient portal has no hospital selector — a patient signs in with just
    // phone/UHID/email, org unknown. mrn is only unique PER ORG (schema:
    // @@unique([organizationId, mrn])), and phonePrimary/email aren't unique at
    // all, so this identifier can legitimately match patients at more than one
    // hospital. findFirst() used to pick whichever candidate came back first and
    // check ONLY that one's password — if a second hospital's patient shared the
    // identifier and, e.g., a shared demo password, the wrong hospital's patient
    // record would be returned and their PHI exposed. Instead, check every
    // candidate's password and only proceed if exactly one matches.
    const candidates = await db.patient.findMany({
      where: { OR: [{ phonePrimary: id }, { mrn: id }, { email: id }] },
    })
    const matches = []
    for (const candidate of candidates) {
      if (candidate.passwordHash && await bcrypt.compare(password, candidate.passwordHash)) {
        matches.push(candidate)
      }
    }
    // Generic message so we don't reveal which identifiers exist.
    if (matches.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' })
    }
    if (matches.length > 1) {
      return res.status(409).json({ success: false, error: 'This ID matches records at more than one hospital. Please contact your hospital for help signing in.' })
    }
    const patient = matches[0]
    if (patient.isActive === false) {
      return res.status(403).json({ success: false, error: 'This account is inactive. Please contact the hospital.' })
    }

    const fullName = patientFullName(patient)
    const token = jwt.sign(
      { patientId: patient.id, organizationId: patient.organizationId, role: 'patient', name: fullName },
      JWT_SECRET,
      { expiresIn: '8h' }
    )
    res.cookie(TOKEN_COOKIE, token, authCookieOptions)

    res.json({
      success: true,
      token,
      user: { id: patient.id, role: 'patient', fullName, mrn: patient.mrn, organizationId: patient.organizationId },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/auth/logout
 * Clears the auth cookie.
 */
export async function logout(_req, res, next) {
  try {
    res.clearCookie(TOKEN_COOKIE, clearCookieOptions)
    res.json({ success: true, message: 'Logged out' })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /api/auth/me
 * Returns the currently authenticated user (staff OR patient) decoded from the cookie/header.
 */
export async function me(req, res, next) {
  try {
    // Patient session
    if (req.user?.role === 'patient' && req.user.patientId) {
      const patient = await db.patient.findUnique({ where: { id: req.user.patientId } })
      if (!patient) return res.status(401).json({ success: false, error: 'Not authenticated' })
      return res.json({
        success: true,
        user: {
          id: patient.id,
          role: 'patient',
          fullName: patientFullName(patient),
          mrn: patient.mrn,
          organizationId: req.user.organizationId,
        },
      })
    }

    // Staff session
    if (!req.user?.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' })
    }
    const user = await db.user.findUnique({ where: { id: req.user.userId } })
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' })
    res.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        organizationId: req.user.organizationId,
      },
    })
  } catch (err) {
    next(err)
  }
}
