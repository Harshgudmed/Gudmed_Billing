// The signed-in person's notifications — the bell in the header.
//
// GET   /api/notifications/inbox            the latest 30 and how many are unread
// PATCH /api/notifications/inbox  { ids }   mark these read   ({ all: true } marks every one)
//
// Always this person's own rows in this hospital: the user id comes from the
// login, never from the request, so nobody can read or clear another's.
import { db } from '../config/db.js'
import { getOrgId, getActor } from '../lib/reqContext.js'

const mine = (req) => ({ organizationId: getOrgId(req), userId: getActor(req).id ?? '__nobody__' })

export async function inbox(req, res, next) {
  try {
    const where = mine(req)
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
    const [data, unread] = await Promise.all([
      db.notification.findMany({
        where, orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, notificationType: true, title: true, message: true, entityType: true, entityId: true, priority: true, isRead: true, createdAt: true },
      }),
      db.notification.count({ where: { ...where, isRead: false } }),
    ])
    res.json({ success: true, data, unread })
  } catch (e) {
    next(e)
  }
}

export async function markRead(req, res, next) {
  try {
    const where = { ...mine(req), isRead: false }
    if (req.body?.all !== true) {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string').slice(0, 200) : []
      if (!ids.length) return res.status(400).json({ success: false, error: 'Say which notifications to mark read' })
      where.id = { in: ids }
    }
    const { count } = await db.notification.updateMany({ where, data: { isRead: true, readAt: new Date() } })
    // Only this person's bell changed, and it has already updated itself.
    res.locals.noLiveUpdate = true
    res.json({ success: true, data: { marked: count } })
  } catch (e) {
    next(e)
  }
}
