// NABH audit trail (H8). Records who/what/when + before/after for every IPD
// mutation into the existing AuditLog table. Best-effort: a logging failure must
// never break the clinical action, so it's swallowed with a warning.
import { db } from '../config/db.js'

export async function auditIpd(req, orgId, { action, entityType, entityId, before, after }) {
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
  try {
    await db.auditLog.create({ data: { ...base, userId } })
  } catch (e) {
    // An audit entry must never be lost (NABH). If the userId FK can't resolve
    // (synthetic/deleted user), retry with userId=null — who is still captured
    // via userEmail + userRole.
    try {
      await db.auditLog.create({ data: { ...base, userId: null, metadata: userId ? JSON.stringify({ unresolvedUserId: userId }) : null } })
    } catch (e2) {
      console.warn('IPD audit log failed:', e2.message)
    }
  }
}
