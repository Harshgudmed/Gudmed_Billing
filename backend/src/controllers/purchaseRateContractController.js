// Rate contracts — a negotiated vendor+item rate held for a date range.
// Reached through /api/purchase, dispatched here by purchaseController for:
//
// GET    ?resource=rate-contracts        list (search, vendorId, itemId, status: active|expired|all, paging)
// GET    ?resource=rate-contract&id=     one
// GET    ?resource=rate-contract-for     the active contract for one item+vendor, or null —
//                                        OrderForm calls this as soon as a line has both,
//                                        to offer the contracted rate (sir: "auto-trigger")
// POST   {resource:'rate-contract'}      new
// PATCH  {resource:'rate-contract'}      edit, or end early ({ id, isActive:false })
//
// Same people who manage vendors/items may keep these (lib/purchaseAccess.js
// canManageMasters); Finance and the purchase officer may read them
// (canSeeVendors) — the store never sees a rate.
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad } from '../lib/reqContext.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { canManageMasters, canSeeVendors, blank, validationError, sendError } from '../lib/purchaseAccess.js'

export const RATE_CONTRACT_READS = new Set(['rate-contracts', 'rate-contract', 'rate-contract-for'])
export const RATE_CONTRACT_WRITES = new Set(['rate-contract'])

const ymd = (label) => z.string({ required_error: `Enter ${label}`, invalid_type_error: `Enter ${label}` }).trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) && new Date(v).toISOString().slice(0, 10) === v,
    `${label[0].toUpperCase()}${label.slice(1)} must be a date like 2026-10-15`)
  .transform((v) => new Date(v))

const createSchema = z.object({
  vendorId: z.string().min(1, 'Choose the vendor'),
  itemId: z.string().min(1, 'Choose the item'),
  rate: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ required_error: 'Enter the contracted rate', invalid_type_error: 'Rate must be a number' }).finite().positive('Rate must be more than 0').max(1e9)),
  gstRate: z.preprocess((v) => (blank(v) ? undefined : Number(v)), z.number().finite().min(0).max(100).optional()),
  validFrom: ymd('the start date'),
  validTo: ymd('the end date'),
  notes: z.string().trim().max(500).optional().nullable(),
}).refine((d) => d.validTo >= d.validFrom, { message: 'The end date cannot be before the start date', path: ['validTo'] })

const updateSchema = z.object({
  id: z.string().min(1),
  rate: z.preprocess((v) => (v === undefined ? undefined : blank(v) ? undefined : Number(v)),
    z.number().finite().positive('Rate must be more than 0').max(1e9).optional()),
  gstRate: z.preprocess((v) => (v === undefined ? undefined : blank(v) ? null : Number(v)), z.number().finite().min(0).max(100).nullable().optional()),
  validFrom: z.preprocess((v) => (v === undefined ? undefined : v), ymd('the start date').optional()),
  validTo: z.preprocess((v) => (v === undefined ? undefined : v), ymd('the end date').optional()),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
})

async function ownedVendor(orgId, id) {
  return db.vendor.findFirst({ where: { id, organizationId: orgId, isActive: true }, select: { id: true, name: true } })
}
async function ownedItem(orgId, id) {
  return db.item.findFirst({
    where: { id, organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, stockUnitId: true, stockUnit: { select: { code: true } } },
  })
}

export async function rcGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canSeeVendors(req)) return res.status(403).json({ success: false, error: 'Rate contracts are for the purchase team and Finance' })
    const { resource } = req.query

    if (resource === 'rate-contracts') {
      const { search, vendorId, itemId, status } = req.query
      const where = { organizationId: ORG_ID }
      if (vendorId) where.vendorId = String(vendorId)
      if (itemId) where.itemId = String(itemId)
      const now = new Date()
      if (status === 'active') { where.isActive = true; where.validFrom = { lte: now }; where.validTo = { gte: now } }
      else if (status === 'expired') where.OR = [{ isActive: false }, { validTo: { lt: now } }]
      const term = String(search || '').trim()
      if (term) {
        where.AND = [...(where.AND || []), { OR: ['number', 'vendorName', 'itemName', 'itemCode'].map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })) }]
      }
      return res.json(await listResponse(db.rateContract, { where, orderBy: { createdAt: 'desc' }, req }))
    }

    if (resource === 'rate-contract') {
      const rc = await db.rateContract.findFirst({ where: { id: String(req.query.id || ''), organizationId: ORG_ID } })
      if (!rc) return res.status(404).json({ success: false, error: 'Rate contract not found' })
      return res.json({ success: true, data: rc })
    }

    if (resource === 'rate-contract-for') {
      const { itemId, vendorId } = req.query
      if (!itemId) return res.status(400).json({ success: false, error: 'itemId is required' })
      const now = new Date()
      const rc = await db.rateContract.findFirst({
        where: {
          organizationId: ORG_ID, itemId: String(itemId), ...(vendorId ? { vendorId: String(vendorId) } : {}),
          isActive: true, validFrom: { lte: now }, validTo: { gte: now },
        },
        orderBy: { rate: 'asc' }, // the best rate first, when more than one vendor holds one
      })
      return res.json({ success: true, data: rc || null })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource. Use: rate-contracts, rate-contract, rate-contract-for' })
  } catch (err) { next(err) }
}

export async function rcCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canManageMasters(req)) return res.status(403).json({ success: false, error: 'Only the purchase officer or an administrator can add a rate contract' })
    const { resource } = req.body
    if (resource !== 'rate-contract') return res.status(400).json({ success: false, error: 'Unknown resource. Use: rate-contract' })

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { vendorId, itemId, rate, gstRate, validFrom, validTo, notes } = parsed.data

    const vendor = await ownedVendor(ORG_ID, vendorId)
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' })
    const item = await ownedItem(ORG_ID, itemId)
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' })

    const actor = getActor(req)
    const data = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG_ID, 'RATE_CONTRACT', 'RC')
      return tx.rateContract.create({
        data: {
          organizationId: ORG_ID, number,
          vendorId: vendor.id, vendorName: vendor.name,
          itemId: item.id, itemCode: item.code, itemName: item.name,
          unitId: item.stockUnitId, unitCode: item.stockUnit.code,
          rate, gstRate: gstRate ?? null, validFrom, validTo, notes: notes || null,
          createdById: actor.id || null, createdByName: actor.name || 'Staff',
        },
      })
    })
    return res.json({ success: true, data })
  } catch (err) { sendError(res, err, next) }
}

export async function rcUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canManageMasters(req)) return res.status(403).json({ success: false, error: 'Only the purchase officer or an administrator can change a rate contract' })
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { id, ...fields } = parsed.data
    if (fields.validFrom && fields.validTo && fields.validTo < fields.validFrom) {
      throw bad('The end date cannot be before the start date')
    }

    const owned = await db.rateContract.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true, validFrom: true, validTo: true } })
    if (!owned) return res.status(404).json({ success: false, error: 'Rate contract not found' })
    if (fields.validFrom && !fields.validTo && fields.validFrom > owned.validTo) throw bad('The start date cannot be after the end date')
    if (fields.validTo && !fields.validFrom && fields.validTo < owned.validFrom) throw bad('The end date cannot be before the start date')

    const data = await db.rateContract.update({ where: { id }, data: fields })
    return res.json({ success: true, data })
  } catch (err) { sendError(res, err, next) }
}
