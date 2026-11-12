// Asset Management: the hospital's equipment/furniture/IT/vehicle register.
//
// GET    /api/assets                 list (status, category, departmentId, dueSoon, search, paging) + summary tiles
// GET    /api/assets/:id             one asset with its maintenance history
// POST   /api/assets                 create (Admin / Purchase / Store only)
// PATCH  /api/assets/:id             edit (Admin / Purchase / Store only)
// PATCH  /api/assets/:id/retire      status -> DISPOSED, never a hard delete (Admin / Purchase / Store only)
// POST   /api/assets/:id/maintenance log a service visit; reschedules nextMaintenanceDue off
//                                    the actual completion date (Admin / Purchase / Store only)
//
// Reading is open to every role that can reach the module at all
// (roleModules.js); writing is gated here by assetAccess.js — the same
// read-open/write-gated split billingAccess.js uses for invoices.
import { db } from '../config/db.js'
import { getOrgId, bad, notFound } from '../lib/reqContext.js'
import { dayRange } from '../lib/dates.js'
import { listResponse } from '../lib/pagination.js'
import { nextMasterCode } from '../lib/counters.js'
import { notifyRoles } from '../lib/notify.js'
import { depreciationFor } from '../lib/assetDepreciation.js'
import { canManageAssets, ASSET_MANAGERS } from '../lib/assetAccess.js'

const STATUSES = ['ACTIVE', 'UNDER_REPAIR', 'RETIRED', 'DISPOSED']
const DUE_SOON_DAYS = 10

function requireManager(req) {
  if (!canManageAssets(req)) {
    const err = new Error('Only an administrator or the Purchase/Store team can change assets')
    err.status = 403
    throw err
  }
}

// Read-time flags — never stored, so they can never drift from the dates they
// come from (the same reason rate-contract "expired" is a query, not a column).
function withComputed(asset, now = new Date()) {
  const soon = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
  return {
    ...asset,
    maintenanceOverdue: !!(asset.nextMaintenanceDue && asset.nextMaintenanceDue < now),
    maintenanceDueSoon: !!(asset.nextMaintenanceDue && asset.nextMaintenanceDue >= now && asset.nextMaintenanceDue <= soon),
    warrantyExpired: !!(asset.warrantyExpiry && asset.warrantyExpiry < now),
    amcExpired: !!(asset.amcExpiry && asset.amcExpiry < now),
    ...depreciationFor(asset, now),
  }
}

// Fires one bell notification per asset the first time it's found due within
// DUE_SOON_DAYS, guarded by maintenanceReminderSentAt so it never repeats on
// every page load. There is no scheduler anywhere in this backend, so this is
// the closest this codebase gets to a reminder: it fires the next time anyone
// with access opens the asset list, not at a fixed time of day.
async function fireMaintenanceReminders(organizationId) {
  const soon = new Date(Date.now() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
  const due = await db.asset.findMany({
    where: {
      organizationId,
      status: { not: 'DISPOSED' },
      nextMaintenanceDue: { lte: soon },
      maintenanceReminderSentAt: null,
    },
    select: { id: true, assetTag: true, name: true, nextMaintenanceDue: true },
  })
  for (const a of due) {
    try {
      await notifyRoles(organizationId, ASSET_MANAGERS, {
        type: 'asset.maintenance.due',
        title: `Maintenance due soon — ${a.assetTag} ${a.name}`,
        message: `Scheduled for ${a.nextMaintenanceDue.toDateString()}`,
        entityType: 'asset',
        entityId: a.id,
        priority: a.nextMaintenanceDue < new Date() ? 'high' : 'normal',
      })
    } catch (e) {
      console.error(`[notify] asset maintenance reminder for ${a.assetTag}: ${e.message}`)
    }
    // Stamped even if the notify above failed — a resend would just repeat the
    // same failure every page load; the due-soon badge on screen still shows it.
    await db.asset.update({ where: { id: a.id }, data: { maintenanceReminderSentAt: new Date() } }).catch(() => {})
  }
}

export async function list(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    fireMaintenanceReminders(organizationId).catch((e) => console.error('[assets] reminder sweep failed:', e.message))

    const { status, category, departmentId, search, dueSoon, overdue, startDate, endDate } = req.query
    const where = { organizationId }
    if (status) where.status = status
    if (category) where.category = category
    if (departmentId) where.departmentId = departmentId
    // Filters by purchase date — the one date on an asset a register is
    // naturally browsed by (when was this bought), same as every other
    // list's date filter (purchaseController.js, billingController.js).
    if (startDate || endDate) where.purchaseDate = dayRange(startDate, endDate)
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { assetTag: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
      ]
    }
    // Two distinct tiles (Due Soon / Overdue) need two distinct filters — a
    // single combined one would show the same list under both tiles. Neither
    // clobbers an explicit status filter the caller already set.
    if (overdue === 'true') {
      if (!status) where.status = { not: 'DISPOSED' }
      where.nextMaintenanceDue = { lt: new Date() }
    } else if (dueSoon === 'true') {
      if (!status) where.status = { not: 'DISPOSED' }
      where.nextMaintenanceDue = { gte: new Date(), lte: new Date(Date.now() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000) }
    }

    const body = await listResponse(db.asset, {
      where, req, orderBy: [{ createdAt: 'desc' }],
      include: { department: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } } },
      summary: async () => {
        const groups = await db.asset.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } })
        const summary = Object.fromEntries(STATUSES.map((s) => [s, 0]))
        for (const g of groups) summary[g.status] = g._count._all
        summary.total = Object.values(summary).reduce((s, n) => s + n, 0)
        const now = new Date()
        const soon = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
        summary.dueSoon = await db.asset.count({ where: { organizationId, status: { not: 'DISPOSED' }, nextMaintenanceDue: { gte: now, lte: soon } } })
        summary.overdue = await db.asset.count({ where: { organizationId, status: { not: 'DISPOSED' }, nextMaintenanceDue: { lt: now } } })
        return summary
      },
    })
    body.data = body.data.map((a) => withComputed(a))
    res.json(body)
  } catch (err) {
    next(err)
  }
}

export async function getOne(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const asset = await db.asset.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        department: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        amcVendor: { select: { id: true, name: true } },
        maintenanceLogs: { orderBy: { performedAt: 'desc' }, include: { vendor: { select: { id: true, name: true } }, documents: true } },
      },
    })
    if (!asset) throw notFound('Asset not found')
    res.json({ success: true, data: withComputed(asset) })
  } catch (err) {
    next(err)
  }
}

const EDITABLE_FIELDS = [
  'name', 'category', 'serialNumber', 'departmentId', 'location', 'status',
  'vendorId', 'purchaseDate', 'purchaseCost', 'warrantyExpiry',
  'amcVendorId', 'amcStartDate', 'amcExpiry', 'amcCost',
  'usefulLifeYears', 'residualValue', 'maintenanceIntervalDays', 'nextMaintenanceDue',
  'assignedToUserId', 'notes',
]
const DATE_FIELDS = new Set(['purchaseDate', 'warrantyExpiry', 'amcStartDate', 'amcExpiry', 'nextMaintenanceDue'])
// The form sends these as strings (<input type="number">) — Prisma's Float/Int
// columns reject a string outright, so they must be coerced here, not just
// passed through like the rest of EDITABLE_FIELDS.
const NUMBER_FIELDS = new Set(['purchaseCost', 'amcCost', 'usefulLifeYears', 'residualValue', 'maintenanceIntervalDays'])

function pickFields(body) {
  const data = {}
  for (const f of EDITABLE_FIELDS) {
    if (body[f] === undefined) continue
    if (body[f] === null || body[f] === '') {
      // residualValue is NOT NULL (@default(0)) — "left blank" means zero,
      // never a null that Prisma would reject.
      data[f] = f === 'residualValue' ? 0 : null
      continue
    }
    data[f] = DATE_FIELDS.has(f) ? new Date(body[f]) : NUMBER_FIELDS.has(f) ? Number(body[f]) : body[f]
  }
  return data
}

export async function create(req, res, next) {
  try {
    requireManager(req)
    const organizationId = getOrgId(req)
    const name = String(req.body.name || '').trim()
    const category = String(req.body.category || '').trim()
    if (!name) throw bad('Asset name is required')
    if (!category) throw bad('Category is required')

    // Spread first, then the validated/trimmed fields — otherwise pickFields'
    // untrimmed copies of name/category would silently win over these.
    const data = pickFields(req.body)
    const asset = await db.$transaction(async (tx) => {
      const assetTag = await nextMasterCode(tx, organizationId, 'ASSET', 'AST')
      return tx.asset.create({
        data: { ...data, organizationId, assetTag, name, category, createdById: req.user?.userId },
      })
    })
    res.status(201).json({ success: true, data: withComputed(asset) })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    requireManager(req)
    const organizationId = getOrgId(req)
    const existing = await db.asset.findFirst({ where: { id: req.params.id, organizationId } })
    if (!existing) throw notFound('Asset not found')

    const data = pickFields(req.body)
    // name/category/status are NOT NULL columns — a blank value here means the
    // caller sent nothing worth changing them to, not "clear the field".
    if (data.name === null) delete data.name
    if (data.category === null) delete data.category
    if (data.status === null) delete data.status
    const asset = await db.asset.update({ where: { id: existing.id }, data })
    res.json({ success: true, data: withComputed(asset) })
  } catch (err) {
    next(err)
  }
}

// Never a hard delete — an asset with maintenance history or a department
// relying on it should never just vanish (the same rule this codebase applies
// to store indents and GRNs).
export async function retire(req, res, next) {
  try {
    requireManager(req)
    const organizationId = getOrgId(req)
    const existing = await db.asset.findFirst({ where: { id: req.params.id, organizationId } })
    if (!existing) throw notFound('Asset not found')

    const asset = await db.asset.update({ where: { id: existing.id }, data: { status: 'DISPOSED' } })
    res.json({ success: true, data: withComputed(asset) })
  } catch (err) {
    next(err)
  }
}

export async function logMaintenance(req, res, next) {
  try {
    requireManager(req)
    const organizationId = getOrgId(req)
    const performedAt = req.body.performedAt ? new Date(req.body.performedAt) : new Date()
    if (Number.isNaN(performedAt.getTime())) throw bad('A valid performedAt date is required')

    const asset = await db.$transaction(async (tx) => {
      const existing = await tx.asset.findFirst({ where: { id: req.params.id, organizationId } })
      if (!existing) throw notFound('Asset not found')

      await tx.assetMaintenanceLog.create({
        data: {
          organizationId,
          assetId: existing.id,
          scheduledFor: existing.nextMaintenanceDue,
          performedAt,
          performedBy: req.body.performedBy || null,
          vendorId: req.body.vendorId || null,
          cost: req.body.cost != null && req.body.cost !== '' ? Number(req.body.cost) : null,
          notes: req.body.notes || null,
          createdById: req.user?.userId,
        },
      })

      // Re-anchored off when it was actually done, not the original schedule —
      // a late service does not push every future date later with it.
      const nextMaintenanceDue = existing.maintenanceIntervalDays
        ? new Date(performedAt.getTime() + existing.maintenanceIntervalDays * 24 * 60 * 60 * 1000)
        : null

      return tx.asset.update({
        where: { id: existing.id },
        data: { nextMaintenanceDue, maintenanceReminderSentAt: null },
        include: { maintenanceLogs: { orderBy: { performedAt: 'desc' } } },
      })
    })
    res.json({ success: true, data: withComputed(asset) })
  } catch (err) {
    next(err)
  }
}
