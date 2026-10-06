// NABH audit trail (H8). Records who/what/when + before/after for every IPD
// mutation into the existing AuditLog table.
//
// Two ways to call it:
//  • auditIpd(req, orgId, entry) — after the action, best-effort: a logging
//    failure must never break the clinical action, so it is swallowed with a
//    warning. (IPD, OT, lab, radiology.)
//  • auditIpd(req, orgId, entry, tx) — inside the action's own transaction
//    (Purchase): the row commits with the change or neither does, so a failure
//    throws and rolls the change back. Written after the commit, a failed row
//    left a change nobody could trace.
import { db } from '../config/db.js'

export async function auditIpd(req, orgId, { action, entityType, entityId, before, after }, tx = null) {
  const base = {
    organizationId: orgId,
    userEmail: req.user?.email || null,
    userRole: req.user?.role || null,
    action, // create | update | delete | discharge | transfer | clearance | charge ...
    entityType, // ipd.admission | ipd.bed | ipd.ward | ipd.charge | ipd.clearance ...
    entityId: entityId || null,
    oldValues: before !== undefined && before !== null ? JSON.stringify(before) : null,
    newValues: after !== undefined && after !== null ? JSON.stringify(after) : null,
    ipAddress: (req.headers?.['x-forwarded-for'] || req.ip || '').toString().slice(0, 100) || null,
    userAgent: (req.headers?.['user-agent'] || '').toString().slice(0, 300) || null,
  }
  const userId = req.user?.id || req.user?.userId || null
  // Who is still captured via userEmail + userRole when the userId cannot be
  // linked (a synthetic or deleted user); the id itself is kept in metadata.
  const unlinked = { ...base, userId: null, metadata: userId ? JSON.stringify({ unresolvedUserId: userId }) : null }

  if (tx) {
    // A failed statement aborts a Postgres transaction, so the fallback cannot
    // be a retry here: whether the user still exists is checked first.
    const known = userId && await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    await tx.auditLog.create({ data: known ? { ...base, userId } : unlinked })
    return
  }

  try {
    await db.auditLog.create({ data: { ...base, userId } })
  } catch {
    // An audit entry must never be lost (NABH): retry without the user link.
    try {
      await db.auditLog.create({ data: unlinked })
    } catch (e2) {
      console.warn('IPD audit log failed:', e2.message)
    }
  }
}
