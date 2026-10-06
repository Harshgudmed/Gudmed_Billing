// In-app notifications — the bell in the header, for every module.
//
// A row per person in the Notification table, then the same "something
// changed" push the screens already use (lib/realtime.js), with the topic
// 'notifications'. The push carries no data: each open screen re-reads its own
// inbox through GET /api/notifications/inbox, which only ever returns the
// signed-in person's rows of their own hospital. So nothing about one person
// crosses the socket to another, and no hospital sees another's.
//
// A notification follows a write that has already succeeded, so it must never
// undo it — but nor may a failure pass unnoticed: swallowed here, an approver
// was never told and the person who acted believed they had been. So these
// functions THROW when the rows cannot be written, and the caller decides what
// the person is told (Purchase: lib/purchaseNotify.js answers "saved, but tell
// them directly").
import { db } from '../config/db.js'
import { emitDataChanged } from './realtime.js'

/** The active people of this hospital in any of these roles (an administrator role reaches super_admin too). */
export async function usersWithRoles(orgId, roles) {
  const want = new Set(roles.filter(Boolean))
  if (want.has('admin')) want.add('super_admin')
  if (!orgId || !want.size) return []
  const users = await db.user.findMany({ where: { organizationId: orgId, isActive: true, role: { in: [...want] } }, select: { id: true } })
  return users.map((u) => u.id)
}

/**
 * Tells these people about something. `except` is the person who did it — they
 * know already. Only active users of `orgId` receive it, whatever ids are given.
 *
 *   notify(orgId, [po.createdById], {
 *     type: 'purchase.order.approved', title: 'PO-2026-27-000004 approved',
 *     message: 'Send it to Surgimed.', entityType: 'purchase.order', entityId: po.id,
 *   }, { except: actor.id })
 */
export async function notify(orgId, userIds, { type, title, message, entityType = null, entityId = null, priority = 'normal' }, { except } = {}) {
  const ids = [...new Set(userIds.filter(Boolean))].filter((id) => id !== except)
  if (!orgId || !ids.length) return 0
  const people = await db.user.findMany({ where: { organizationId: orgId, isActive: true, id: { in: ids } }, select: { id: true } })
  if (!people.length) return 0
  const now = new Date()
  await db.notification.createMany({
    data: people.map((u) => ({
      organizationId: orgId, userId: u.id, notificationType: type,
      title: String(title).slice(0, 150), message: String(message || '').slice(0, 500),
      entityType, entityId, deliveryMethod: 'in_app', priority, sendAt: now, sentAt: now,
    })),
  })
  emitDataChanged(orgId, 'notifications')
  return people.length
}

/** notify() to everyone in these roles. */
export async function notifyRoles(orgId, roles, payload, options) {
  return notify(orgId, await usersWithRoles(orgId, roles), payload, options)
}
