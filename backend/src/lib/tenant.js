import { db } from '../config/db.js'

// Tenant-ownership guard. Returns true only if a row with `id` exists AND belongs
// to `organizationId`. Use before any write-by-id so one org can never mutate/delete
// another org's record (the cross-tenant IDOR class). Centralised so no handler has
// to re-remember the org filter:
//   if (!(await isOwned('ambulanceTrip', id, orgId)))
//     return res.status(404).json({ success: false, error: 'Not found' })
export async function isOwned(model, id, organizationId) {
  if (!id || !organizationId) return false
  const row = await db[model].findFirst({
    where: { id, organizationId },
    select: { id: true },
  })
  return !!row
}
