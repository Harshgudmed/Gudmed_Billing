// Purchase & Supply Chain — masters (read side for now).
//
// GET   /api/purchase?resource=units       the hospital's units of measure
// GET   /api/purchase?resource=categories  its category tree, nested, with item counts
// GET   /api/purchase?resource=vendors     vendor list (search, status, paging)
// GET   /api/purchase?resource=vendor&id=  one vendor
// GET   /api/purchase?resource=states      GST state codes, for the vendor form
// POST  /api/purchase {resource:'vendor'}  add a vendor
// PATCH /api/purchase {resource:'vendor'}  edit, or retire/restore (isActive)
//
// Purchase requests and approval rules are answered by
// purchaseRequestController.js, purchase orders by purchaseOrderController.js;
// each handler below passes those on first.
//
// Both make sure the hospital has the default units and categories first
// (lib/purchaseDefaults.js) — the first read is what plants them, so a
// hospital never opens Purchase to an empty screen. Every query is filtered by
// the caller's hospital (getOrgId); who may reach this route at all is decided
// where it is mounted (routes/index.js).
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor } from '../lib/reqContext.js'
import { ensurePurchaseDefaults } from '../lib/purchaseDefaults.js'
import { parseGstin, isValidPan, isValidIfsc, cleanId, GST_STATES, stateCodeByName } from '../lib/gst.js'
import { nextMasterCode } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { auditIpd } from '../inpatient/audit.js'
import { prGet, prCreate, prUpdate, prRemove, PR_READS, PR_WRITES } from './purchaseRequestController.js'
import { canManageMasters, canSeeVendors, hideMoney, MONEY } from '../lib/purchaseAccess.js'
import { poGet, poCreate, poUpdate, poRemove, PO_READS, PO_WRITES } from './purchaseOrderController.js'
import { grnGet, grnCreate, grnUpdate, RECEIPT_READS, RECEIPT_WRITES } from './purchaseReceiptController.js'
import { billGet, billCreate, billUpdate, billRemove, BILL_READS, BILL_WRITES } from './purchaseBillController.js'
import { indentGet, indentCreate, indentUpdate, indentRemove, INDENT_READS, INDENT_WRITES } from './purchaseIndentController.js'
import { paymentGet, paymentCreate, paymentUpdate, paymentRemove, PAYMENT_READS, PAYMENT_WRITES } from './purchasePaymentController.js'
import { returnGet, returnCreate, returnUpdate, returnRemove, RETURN_READS, RETURN_WRITES } from './purchaseReturnController.js'
import { rfqGet, rfqCreate, rfqUpdate, rfqRemove, RFQ_READS, RFQ_WRITES } from './purchaseRfqController.js'
import { reportGet, REPORT_READS } from './purchaseReportController.js'
import { loadPurchaseSettings } from '../lib/purchaseSettings.js'
import { itemSearchWhere } from '../lib/purchaseLines.js'
import { GST_RATES } from '../lib/purchaseOrders.js'

// ── Vendors ─────────────────────────────────────────────────────────────────

// Bank details are shown in full only to the people who pay vendors; everyone
// else who can open Purchase (a store keeper receiving goods) sees the last four
// digits. The list always masks: it is scanned, not used to make a payment.
const BANK_ROLES = new Set(['admin', 'super_admin', 'purchase_officer'])
const mask = (acct) => (acct ? `••••${String(acct).slice(-4)}` : acct)
const withBank = (vendor, full) => (full ? vendor : { ...vendor, bankAccountNumber: mask(vendor.bankAccountNumber) })
const canSeeBank = (req) => !req.user || BANK_ROLES.has(getActor(req).role)

const blank = (v) => v == null || String(v).trim() === ''
// A field left OUT of an edit stays as it is (undefined → untouched); a field
// sent empty is cleared (null). Collapsing both into null would wipe every
// field an edit form did not send.
const emptyToNull = (v) => (v === undefined ? undefined : blank(v) ? null : v)
const optText = (max) => z.string().trim().max(max).optional().nullable().transform(emptyToNull)
// A select left on "none" sends '' — that is "not set", not an invalid choice.
const optEnum = (values) => z.preprocess(emptyToNull, z.enum(values).nullable().optional())
// Landlines are normal for suppliers (0522-2345678), so this is not the
// mobile-only rule patients use: 8 to 15 digits, with the usual separators.
const phone = z.string().trim().optional().nullable()
  .refine((v) => blank(v) || (/^[0-9+\-()\s]+$/.test(v) && v.replace(/\D/g, '').length >= 8 && v.replace(/\D/g, '').length <= 15),
    'Enter a phone number of 8 to 15 digits')
  .transform(emptyToNull)

const vendorFields = {
  name: z.string().trim().min(2, 'Vendor name is required').max(120),
  contactPerson: optText(80),
  phone,
  email: z.string().trim().optional().nullable()
    .refine((v) => blank(v) || z.string().email().safeParse(v).success, 'Enter a valid email address')
    .transform((v) => { const t = emptyToNull(v); return t ? t.toLowerCase() : t }),
  gstNumber: optText(20),
  pan: optText(10),
  stateCode: optText(2),
  address: optText(300), // the older one-line address; the form now uses the parts below
  houseNumber: optText(60),
  street: optText(150),
  locality: optText(100),
  city: optText(80),
  district: optText(80),
  pincode: z.string().trim().optional().nullable()
    .refine((v) => blank(v) || /^[1-9][0-9]{5}$/.test(v), 'Enter a valid 6-digit PIN code')
    .transform(emptyToNull),
  bankAccountName: optText(120),
  bankName: optText(100),
  bankAccountNumber: z.string().trim().optional().nullable()
    .refine((v) => blank(v) || v.includes('•') || /^[0-9]{9,18}$/.test(v), 'Account number must be 9 to 18 digits'),
  bankIfsc: optText(11),
  // An empty box is "not set", never 0 days — coercing '' gives 0.
  paymentTermsDays: z.preprocess((v) => (v === undefined ? undefined : blank(v) ? null : Number(v)),
    z.number({ invalid_type_error: 'Payment terms must be a number of days' }).int().min(0).max(365).nullable().optional()),
  vendorType: optEnum(['goods', 'services', 'both']),
  msmeNumber: optText(30),
  defaultTdsSection: optEnum(['194C', '194J', '194I', '194H', '194Q']),
}
const vendorCreateSchema = z.object(vendorFields)
const vendorUpdateSchema = z.object({ id: z.string().min(1), isActive: z.boolean().optional(), ...vendorFields }).partial({ name: true })

/**
 * The checks a format cannot express, and the fields that follow from others.
 * A GSTIN decides the state (CGST+SGST vs IGST on every bill) and carries the
 * PAN (TDS), so both come from it rather than being typed twice and disagreeing.
 * Returns { data } or { error }.
 */
function tidyVendor(input) {
  const data = { ...input }
  if (data.gstNumber) {
    const g = parseGstin(data.gstNumber)
    if (!g.ok) return { error: g.error }
    data.gstNumber = g.gstin
    data.stateCode = g.stateCode
    if (data.pan && cleanId(data.pan) !== g.pan) return { error: `PAN ${cleanId(data.pan)} does not match the GSTIN, which is for PAN ${g.pan}` }
    data.pan = g.pan
  } else if (data.stateCode && !GST_STATES[data.stateCode]) {
    return { error: 'Choose the vendor\'s state from the list' }
  }
  if (data.pan) {
    if (!isValidPan(data.pan)) return { error: 'PAN must look like AAPFU0939F' }
    data.pan = cleanId(data.pan)
  }
  if (data.bankIfsc) {
    if (!isValidIfsc(data.bankIfsc)) return { error: 'IFSC must look like SBIN0001234' }
    data.bankIfsc = cleanId(data.bankIfsc)
  }
  // The edit form sends back the masked number it was shown; that is "leave it
  // as it is", not a new account number.
  if (typeof data.bankAccountNumber === 'string' && data.bankAccountNumber.includes('•')) delete data.bankAccountNumber
  else if (data.bankAccountNumber !== undefined && blank(data.bankAccountNumber)) data.bankAccountNumber = null
  // Prisma treats undefined as "leave alone"; drop them so the intent is plain.
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k]
  return { data }
}

/** Another vendor of this hospital already holding the GSTIN, if any. */
async function gstinTaken(ORG_ID, gstNumber, exceptId) {
  if (!gstNumber) return null
  return db.vendor.findFirst({
    where: { organizationId: ORG_ID, gstNumber, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true, code: true },
  })
}

/** Answers 409 naming the vendor that holds this GSTIN; falsy when it is free. */
async function refuseTakenGstin(res, ORG_ID, gstNumber, exceptId) {
  const dup = await gstinTaken(ORG_ID, gstNumber, exceptId)
  return dup && res.status(409).json({ success: false, error: `${dup.name} (${dup.code || 'no code'}) already has GSTIN ${gstNumber}` })
}

// The database's own refusal (one vendor per GSTIN in a hospital): two people
// saving the same vendor at once both pass the check above, and one is turned back here.
const isGstinClash = (e) => e?.code === 'P2002' && JSON.stringify(e.meta?.target || '').includes('gstNumber')

const validationError = (res, error) => res.status(400).json({ success: false, error: 'Validation error', details: error.issues })

// ── Shared lists ────────────────────────────────────────────────────────────

const PURCHASE_TYPES = ['product', 'service', 'licence', 'personnel', 'raw_material']

// ── Units and categories (Settings → Purchase) ──────────────────────────────

// Units and categories are the hospital's purchase SETUP — changing a
// category's GST or retiring a unit reaches every future order — so only an
// administrator changes them. Purchase officers and store keepers read them.
const isAdmin = (req) => !req.user || ['admin', 'super_admin'].includes(getActor(req).role)
const adminOnly = (res) => res.status(403).json({ success: false, error: 'Only an administrator can change units and categories (Settings → Integrations → Purchase Setup)' })

const UNIT_KINDS = ['count', 'pack', 'weight', 'length', 'volume', 'time']
const unitCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'Code: 1–8 letters or digits, starting with a letter (e.g. CYL)'),
  name: z.string().trim().min(2, 'Unit name is required').max(40),
  kind: z.enum(UNIT_KINDS),
  allowsFraction: z.boolean().optional().default(false),
})
const unitUpdateSchema = z.object({
  id: z.string().min(1), isActive: z.boolean().optional(),
  code: unitCreateSchema.shape.code.optional(), name: unitCreateSchema.shape.name.optional(),
  kind: z.enum(UNIT_KINDS).optional(), allowsFraction: z.boolean().optional(),
})

const categoryCreateSchema = z.object({
  name: z.string().trim().min(2, 'Category name is required').max(80),
  parentId: z.string().optional().nullable().transform(emptyToNull),
  purchaseType: z.enum(PURCHASE_TYPES),
  expenseHead: z.string().trim().min(2, 'Say how Finance reports it (e.g. Medical Consumables)').max(80),
  defaultGstRate: z.preprocess((v) => (v === undefined ? undefined : blank(v) ? null : Number(v)),
    z.number().refine((v) => GST_RATES.includes(v), 'Choose a GST rate from the list').nullable().optional()),
})
const categoryUpdateSchema = categoryCreateSchema.omit({ parentId: true }).partial()
  .extend({ id: z.string().min(1), isActive: z.boolean().optional() })

/** Where a unit is in use — a reason it cannot be retired or deleted. */
async function unitUse(ORG_ID, unitId) {
  const [asStock, asConversion] = await Promise.all([
    db.item.count({ where: { organizationId: ORG_ID, stockUnitId: unitId, isActive: true } }),
    db.itemUnitConversion.count({ where: { organizationId: ORG_ID, unitId } }),
  ])
  return { asStock, asConversion }
}

/** Same name under the same parent (the unique index cannot see top-level twins). */
function categoryTwin(ORG_ID, name, parentId, exceptId) {
  return db.itemCategory.findFirst({
    where: { organizationId: ORG_ID, parentId: parentId ?? null, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
}

// ── Items ───────────────────────────────────────────────────────────────────

const finiteNum = (label) => z.preprocess((v) => (v === undefined ? undefined : blank(v) ? null : Number(v)),
  z.number({ invalid_type_error: `${label} must be a number` }).finite().nullable().optional())

const conversionSchema = z.object({
  unitId: z.string().min(1, 'Choose a unit for each conversion'),
  factor: z.coerce.number().finite().positive('A conversion must be more than 0'),
  isPurchaseDefault: z.boolean().optional().default(false),
})

const itemFields = {
  name: z.string().trim().min(2, 'Item name is required').max(150),
  aliases: optText(300),
  description: optText(500),
  categoryId: z.string().min(1, 'Choose a category'),
  purchaseType: optEnum(PURCHASE_TYPES),
  // HSN for goods is 4, 6 or 8 digits; SAC for services is 6 (starting 99).
  hsnCode: z.string().trim().optional().nullable()
    .refine((v) => blank(v) || /^\d{4}(\d{2}){0,2}$/.test(v), 'HSN / SAC must be 4, 6 or 8 digits')
    .transform(emptyToNull),
  gstRate: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number().refine((v) => GST_RATES.includes(v), `GST must be one of ${GST_RATES.join(', ')}%`).optional()),
  stockUnitId: z.string().min(1, 'Choose the unit it is counted in'),
  reorderLevel: finiteNum('Reorder level').refine((v) => v == null || v >= 0, 'Reorder level cannot be negative'),
  preferredVendorId: z.string().optional().nullable().transform(emptyToNull),
  conversions: z.array(conversionSchema).max(10).optional(),
}
const itemCreateSchema = z.object(itemFields)
const itemUpdateSchema = z.object({ id: z.string().min(1), isActive: z.boolean().optional(), ...itemFields })
  .partial({ name: true, categoryId: true, stockUnitId: true })

const ITEM_INCLUDE = {
  category: { select: { id: true, name: true, parent: { select: { name: true } } } },
  stockUnit: { select: { id: true, code: true, name: true, allowsFraction: true } },
  preferredVendor: { select: { id: true, name: true, code: true } },
  conversions: { select: { id: true, unitId: true, factor: true, isPurchaseDefault: true, unit: { select: { code: true, name: true } } } },
}

/**
 * Everything an item points at must be this hospital's own, live row — ids
 * come from the request. Also fills what follows from the category (purchase
 * type, a suggested GST) and the stock flags that follow from the type.
 * `before` is the item being edited (null on create). Returns { data, conversions } or { error, status }.
 */
async function checkItem(ORG_ID, input, before = null) {
  const data = { ...input }
  const conversions = data.conversions
  delete data.conversions

  const categoryId = data.categoryId ?? before?.categoryId
  const category = await db.itemCategory.findFirst({ where: { id: categoryId, organizationId: ORG_ID } })
  if (!category) return { error: 'Choose a category from the list', status: 400 }
  if (data.categoryId && !category.isActive) return { error: `The category "${category.name}" is retired`, status: 400 }

  const stockUnitId = data.stockUnitId ?? before?.stockUnitId
  const unit = await db.unit.findFirst({ where: { id: stockUnitId, organizationId: ORG_ID } })
  if (!unit) return { error: 'Choose a unit from the list', status: 400 }
  // Every quantity already recorded for the item — stock, receipts, orders,
  // requests — is counted in its stock unit; changing the unit afterwards
  // turned 200 pieces into 200 litres.
  if (before && stockUnitId !== before.stockUnitId) {
    const used = await db.item.findFirst({
      where: {
        id: before.id, organizationId: ORG_ID,
        OR: [{ requestLines: { some: {} } }, { orderLines: { some: {} } }, { receiptLines: { some: {} } }, { stockBatches: { some: {} } }, { stockMovements: { some: {} } }],
      },
      select: { id: true },
    })
    if (used) return { error: `${before.name} is already on purchase documents or in stock, so the unit it is counted in cannot change. Add a unit conversion instead.`, status: 409 }
  }

  if (data.preferredVendorId) {
    const vendor = await db.vendor.findFirst({ where: { id: data.preferredVendorId, organizationId: ORG_ID }, select: { isActive: true, name: true } })
    if (!vendor) return { error: 'Choose a vendor from the list', status: 400 }
    if (!vendor.isActive && data.preferredVendorId !== before?.preferredVendorId) return { error: `${vendor.name} is retired`, status: 400 }
  }

  // Filled from the category on create; on edit only when the category changes
  // and the request did not say otherwise.
  const categoryChanged = !before || (data.categoryId && data.categoryId !== before.categoryId)
  if (categoryChanged && data.purchaseType === undefined) data.purchaseType = category.purchaseType
  if (!before && data.gstRate === undefined) data.gstRate = category.defaultGstRate ?? 0

  if (conversions) {
    const seen = new Set()
    let defaults = 0
    for (const c of conversions) {
      if (c.unitId === stockUnitId) return { error: `${unit.name} is already the stock unit — a conversion is for a different unit`, status: 400 }
      if (seen.has(c.unitId)) return { error: 'Each unit can have only one conversion', status: 400 }
      seen.add(c.unitId)
      if (c.isPurchaseDefault) defaults++
    }
    if (defaults > 1) return { error: 'Only one unit can be the default for buying', status: 400 }
    const owned = await db.unit.count({ where: { organizationId: ORG_ID, id: { in: [...seen] } } })
    if (owned !== seen.size) return { error: 'Choose conversion units from the list', status: 400 }
  }

  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k]
  return { data, conversions, categoryName: category.name }
}

/** An active item of the same name already in this category, if any. */
function sameNameItem(ORG_ID, name, categoryId, exceptId) {
  return db.item.findFirst({
    where: { organizationId: ORG_ID, categoryId, isActive: true, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { code: true },
  })
}

export async function create(req, res, next) {
  if (PR_WRITES.has(req.body?.resource)) return prCreate(req, res, next)
  if (PO_WRITES.has(req.body?.resource)) return poCreate(req, res, next)
  if (RECEIPT_WRITES.has(req.body?.resource)) return grnCreate(req, res, next)
  if (BILL_WRITES.has(req.body?.resource)) return billCreate(req, res, next)
  if (INDENT_WRITES.has(req.body?.resource)) return indentCreate(req, res, next)
  if (PAYMENT_WRITES.has(req.body?.resource)) return paymentCreate(req, res, next)
  if (RETURN_WRITES.has(req.body?.resource)) return returnCreate(req, res, next)
  if (RFQ_WRITES.has(req.body?.resource)) return rfqCreate(req, res, next)
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.body
    // Vendors and items are kept by those who order (lib/purchaseAccess.js
    // canManageMasters); Finance reads them, the store raises requests from them.
    if ((resource === 'vendor' || resource === 'item') && !canManageMasters(req)) {
      return res.status(403).json({ success: false, error: 'Only the purchase officer or an administrator adds vendors and items' })
    }

    if (resource === 'vendor') {
      const parsed = vendorCreateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { data, error } = tidyVendor(parsed.data)
      if (error) return res.status(400).json({ success: false, error })
      if (await refuseTakenGstin(res, ORG_ID, data.gstNumber)) return

      let vendor
      try {
        vendor = await db.$transaction(async (tx) => {
          const code = await nextMasterCode(tx, ORG_ID, 'VENDOR', 'VEN')
          const created = await tx.vendor.create({ data: { ...data, organizationId: ORG_ID, code } })
          await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.vendor', entityId: created.id, after: withBank(created, false) }, tx)
          return created
        })
      } catch (e) {
        if (isGstinClash(e) && await refuseTakenGstin(res, ORG_ID, data.gstNumber)) return
        throw e
      }
      return res.status(201).json({ success: true, data: withBank(vendor, canSeeBank(req)) })
    }

    if (resource === 'unit') {
      if (!isAdmin(req)) return adminOnly(res)
      const parsed = unitCreateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const taken = await db.unit.findFirst({ where: { organizationId: ORG_ID, code: parsed.data.code }, select: { name: true } })
      if (taken) return res.status(409).json({ success: false, error: `Code ${parsed.data.code} is already used by ${taken.name}` })
      const unit = await db.$transaction(async (tx) => {
        const created = await tx.unit.create({ data: { ...parsed.data, organizationId: ORG_ID, isSystem: false } })
        await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.unit', entityId: created.id, after: created }, tx)
        return created
      })
      return res.status(201).json({ success: true, data: unit })
    }

    if (resource === 'category') {
      if (!isAdmin(req)) return adminOnly(res)
      const parsed = categoryCreateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { parentId } = parsed.data
      if (parentId) {
        // Two levels, as the screens show them: a group and its categories.
        const parent = await db.itemCategory.findFirst({ where: { id: parentId, organizationId: ORG_ID }, select: { parentId: true, isActive: true } })
        if (!parent) return res.status(400).json({ success: false, error: 'Choose the group from the list' })
        if (parent.parentId) return res.status(400).json({ success: false, error: 'A category can go under a group, not under another category' })
        if (!parent.isActive) return res.status(400).json({ success: false, error: 'That group is retired' })
      }
      if (await categoryTwin(ORG_ID, parsed.data.name, parentId)) {
        return res.status(409).json({ success: false, error: `"${parsed.data.name}" already exists ${parentId ? 'in this group' : 'as a group'}` })
      }
      const category = await db.$transaction(async (tx) => {
        const created = await tx.itemCategory.create({ data: { ...parsed.data, organizationId: ORG_ID, isSystem: false, sortOrder: 999 } })
        await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.category', entityId: created.id, after: created }, tx)
        return created
      })
      return res.status(201).json({ success: true, data: category })
    }

    if (resource === 'item') {
      const parsed = itemCreateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const checked = await checkItem(ORG_ID, parsed.data)
      if (checked.error) return res.status(checked.status).json({ success: false, error: checked.error })
      const twin = await sameNameItem(ORG_ID, checked.data.name, checked.data.categoryId)
      if (twin) return res.status(409).json({ success: false, error: `"${checked.data.name}" already exists in ${checked.categoryName} as ${twin.code}` })

      const item = await db.$transaction(async (tx) => {
        const code = await nextMasterCode(tx, ORG_ID, 'ITEM', 'ITM')
        const created = await tx.item.create({
          data: { ...checked.data, organizationId: ORG_ID, code, createdById: getActor(req).id },
        })
        if (checked.conversions?.length) {
          await tx.itemUnitConversion.createMany({
            data: checked.conversions.map((c) => ({ ...c, organizationId: ORG_ID, itemId: created.id })),
          })
        }
        const full = await tx.item.findUnique({ where: { id: created.id }, include: ITEM_INCLUDE })
        await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.item', entityId: full.id, after: full }, tx)
        return full
      })
      return res.status(201).json({ success: true, data: item })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource. Use: vendor, item' })
  } catch (err) {
    next(err)
  }
}

/**
 * DELETE /api/purchase?resource=unit|category&id=
 *
 * Only for a hospital's OWN unit or category that nothing uses — a typo made
 * a minute ago. A default one, or one anything points at, is retired instead
 * (PATCH isActive:false), so old orders keep their meaning.
 */
export async function remove(req, res, next) {
  if (PR_WRITES.has(req.query?.resource)) return prRemove(req, res, next)
  if (PO_WRITES.has(req.query?.resource)) return poRemove(req, res, next)
  if (BILL_WRITES.has(req.query?.resource)) return billRemove(req, res, next)
  if (INDENT_WRITES.has(req.query?.resource)) return indentRemove(req, res, next)
  if (PAYMENT_WRITES.has(req.query?.resource)) return paymentRemove(req, res, next)
  if (RETURN_WRITES.has(req.query?.resource)) return returnRemove(req, res, next)
  if (RFQ_WRITES.has(req.query?.resource)) return rfqRemove(req, res, next)
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query
    const id = String(req.query.id || '')
    if (!isAdmin(req)) return adminOnly(res)

    if (resource === 'unit') {
      const unit = await db.unit.findFirst({ where: { id, organizationId: ORG_ID } })
      if (!unit) return res.status(404).json({ success: false, error: 'Unit not found' })
      if (unit.isSystem) return res.status(409).json({ success: false, error: 'A default unit cannot be deleted — retire it instead' })
      const [stock, conv] = await Promise.all([
        db.item.count({ where: { organizationId: ORG_ID, stockUnitId: id } }),
        db.itemUnitConversion.count({ where: { organizationId: ORG_ID, unitId: id } }),
      ])
      if (stock || conv) return res.status(409).json({ success: false, error: 'This unit has been used by items — retire it instead' })
      await db.$transaction(async (tx) => {
        await tx.unit.delete({ where: { id } })
        await auditIpd(req, ORG_ID, { action: 'delete', entityType: 'purchase.unit', entityId: id, before: unit }, tx)
      })
      return res.json({ success: true })
    }

    if (resource === 'category') {
      const category = await db.itemCategory.findFirst({ where: { id, organizationId: ORG_ID } })
      if (!category) return res.status(404).json({ success: false, error: 'Category not found' })
      if (category.isSystem) return res.status(409).json({ success: false, error: 'A default category cannot be deleted — retire it instead' })
      const [items, children] = await Promise.all([
        db.item.count({ where: { organizationId: ORG_ID, categoryId: id } }),
        db.itemCategory.count({ where: { organizationId: ORG_ID, parentId: id } }),
      ])
      if (items || children) return res.status(409).json({ success: false, error: 'This category has items or categories in it — retire it instead' })
      await db.$transaction(async (tx) => {
        await tx.itemCategory.delete({ where: { id } })
        await auditIpd(req, ORG_ID, { action: 'delete', entityType: 'purchase.category', entityId: id, before: category }, tx)
      })
      return res.json({ success: true })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource. Use: unit, category' })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  if (PR_WRITES.has(req.body?.resource)) return prUpdate(req, res, next)
  if (PO_WRITES.has(req.body?.resource)) return poUpdate(req, res, next)
  if (RECEIPT_WRITES.has(req.body?.resource)) return grnUpdate(req, res, next)
  if (BILL_WRITES.has(req.body?.resource)) return billUpdate(req, res, next)
  if (INDENT_WRITES.has(req.body?.resource)) return indentUpdate(req, res, next)
  if (PAYMENT_WRITES.has(req.body?.resource)) return paymentUpdate(req, res, next)
  if (RETURN_WRITES.has(req.body?.resource)) return returnUpdate(req, res, next)
  if (RFQ_WRITES.has(req.body?.resource)) return rfqUpdate(req, res, next)
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.body
    if ((resource === 'vendor' || resource === 'item') && !canManageMasters(req)) {
      return res.status(403).json({ success: false, error: 'Only the purchase officer or an administrator changes vendors and items' })
    }

    if (resource === 'vendor') {
      const parsed = vendorUpdateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { id, ...fields } = parsed.data
      // Tenant guard: only a vendor of this hospital.
      const before = await db.vendor.findFirst({ where: { id, organizationId: ORG_ID } })
      if (!before) return res.status(404).json({ success: false, error: 'Vendor not found' })

      const { data, error } = tidyVendor(fields)
      if (error) return res.status(400).json({ success: false, error })
      if (await refuseTakenGstin(res, ORG_ID, data.gstNumber, id)) return

      let vendor
      try {
        vendor = await db.$transaction(async (tx) => {
          // A vendor made before Purchase existed has no code; it gets one the
          // first time it is edited here.
          const code = before.code || await nextMasterCode(tx, ORG_ID, 'VENDOR', 'VEN')
          const updated = await tx.vendor.update({ where: { id }, data: { ...data, code } })
          await auditIpd(req, ORG_ID, { action: 'update', entityType: 'purchase.vendor', entityId: id, before: withBank(before, false), after: withBank(updated, false) }, tx)
          return updated
        })
      } catch (e) {
        if (isGstinClash(e) && await refuseTakenGstin(res, ORG_ID, data.gstNumber, id)) return
        throw e
      }
      return res.json({ success: true, data: withBank(vendor, canSeeBank(req)) })
    }

    if (resource === 'unit') {
      if (!isAdmin(req)) return adminOnly(res)
      const parsed = unitUpdateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { id, ...data } = parsed.data
      const before = await db.unit.findFirst({ where: { id, organizationId: ORG_ID } })
      if (!before) return res.status(404).json({ success: false, error: 'Unit not found' })
      // A default unit's code is printed on every order and its kind decides
      // what conversions mean — its name and decimals can change, those cannot.
      if (before.isSystem && ((data.code && data.code !== before.code) || (data.kind && data.kind !== before.kind))) {
        return res.status(400).json({ success: false, error: 'A default unit keeps its code and kind — change its name instead, or add your own unit' })
      }
      if (data.code && data.code !== before.code) {
        const use = await unitUse(ORG_ID, id)
        if (use.asStock || use.asConversion) return res.status(409).json({ success: false, error: 'This unit is already used by items — its code can no longer change' })
        if (await db.unit.findFirst({ where: { organizationId: ORG_ID, code: data.code, id: { not: id } } })) return res.status(409).json({ success: false, error: `Code ${data.code} is already used` })
      }
      if (data.isActive === false && before.isActive) {
        const use = await unitUse(ORG_ID, id)
        if (use.asStock) return res.status(409).json({ success: false, error: `${use.asStock} active item(s) are counted in ${before.name} — change or retire them first` })
      }
      const unit = await db.$transaction(async (tx) => {
        const updated = await tx.unit.update({ where: { id }, data })
        await auditIpd(req, ORG_ID, { action: 'update', entityType: 'purchase.unit', entityId: id, before, after: updated }, tx)
        return updated
      })
      return res.json({ success: true, data: unit })
    }

    if (resource === 'category') {
      if (!isAdmin(req)) return adminOnly(res)
      const parsed = categoryUpdateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { id, ...data } = parsed.data
      const before = await db.itemCategory.findFirst({ where: { id, organizationId: ORG_ID } })
      if (!before) return res.status(404).json({ success: false, error: 'Category not found' })
      if (data.name && await categoryTwin(ORG_ID, data.name, before.parentId, id)) {
        return res.status(409).json({ success: false, error: `"${data.name}" already exists ${before.parentId ? 'in this group' : 'as a group'}` })
      }
      if (data.isActive === false && before.isActive) {
        const [items, children] = await Promise.all([
          db.item.count({ where: { organizationId: ORG_ID, categoryId: id, isActive: true } }),
          db.itemCategory.count({ where: { organizationId: ORG_ID, parentId: id, isActive: true } }),
        ])
        if (items) return res.status(409).json({ success: false, error: `${items} active item(s) are filed here — move or retire them first` })
        if (children) return res.status(409).json({ success: false, error: `Retire the ${children} categor${children === 1 ? 'y' : 'ies'} inside this group first` })
      }
      if (data.isActive === true && before.parentId) {
        const parent = await db.itemCategory.findFirst({ where: { id: before.parentId }, select: { isActive: true, name: true } })
        if (!parent?.isActive) return res.status(409).json({ success: false, error: `Restore the group "${parent?.name}" first` })
      }
      const category = await db.$transaction(async (tx) => {
        const updated = await tx.itemCategory.update({ where: { id }, data })
        await auditIpd(req, ORG_ID, { action: 'update', entityType: 'purchase.category', entityId: id, before, after: updated }, tx)
        return updated
      })
      return res.json({ success: true, data: category })
    }

    if (resource === 'item') {
      const parsed = itemUpdateSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { id, ...fields } = parsed.data
      const before = await db.item.findFirst({ where: { id, organizationId: ORG_ID }, include: ITEM_INCLUDE })
      if (!before) return res.status(404).json({ success: false, error: 'Item not found' })

      const checked = await checkItem(ORG_ID, fields, before)
      if (checked.error) return res.status(checked.status).json({ success: false, error: checked.error })
      const name = checked.data.name ?? before.name
      const categoryId = checked.data.categoryId ?? before.categoryId
      if (checked.data.name || checked.data.categoryId || checked.data.isActive) {
        const twin = await sameNameItem(ORG_ID, name, categoryId, id)
        if (twin) return res.status(409).json({ success: false, error: `"${name}" already exists in ${checked.categoryName} as ${twin.code}` })
      }

      const item = await db.$transaction(async (tx) => {
        await tx.item.update({ where: { id }, data: checked.data })
        // The conversion list is replaced whole when sent: the form edits it as
        // one table, and "the rows on screen" is the only state a person sees.
        if (checked.conversions) {
          await tx.itemUnitConversion.deleteMany({ where: { itemId: id, organizationId: ORG_ID } })
          if (checked.conversions.length) {
            await tx.itemUnitConversion.createMany({
              data: checked.conversions.map((c) => ({ ...c, organizationId: ORG_ID, itemId: id })),
            })
          }
        }
        const after = await tx.item.findUnique({ where: { id }, include: ITEM_INCLUDE })
        await auditIpd(req, ORG_ID, { action: 'update', entityType: 'purchase.item', entityId: id, before, after }, tx)
        return after
      })
      return res.json({ success: true, data: item })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource. Use: vendor, item' })
  } catch (err) {
    next(err)
  }
}

/** Flat category rows → a tree, children under their parent, in display order. */
function buildTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null
    // A parent filtered out (retired) leaves its children at the top rather
    // than hiding them — a live category must always be reachable.
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const order = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  const sortDeep = (list) => { list.sort(order); list.forEach((n) => sortDeep(n.children)); return list }
  return sortDeep(roots)
}

export async function getAll(req, res, next) {
  if (PR_READS.has(req.query?.resource)) return prGet(req, res, next)
  if (PO_READS.has(req.query?.resource)) return poGet(req, res, next)
  if (RECEIPT_READS.has(req.query?.resource)) return grnGet(req, res, next)
  if (BILL_READS.has(req.query?.resource)) return billGet(req, res, next)
  if (INDENT_READS.has(req.query?.resource)) return indentGet(req, res, next)
  if (PAYMENT_READS.has(req.query?.resource)) return paymentGet(req, res, next)
  if (RETURN_READS.has(req.query?.resource)) return returnGet(req, res, next)
  if (RFQ_READS.has(req.query?.resource)) return rfqGet(req, res, next)
  if (REPORT_READS.has(req.query?.resource)) return reportGet(req, res, next)
  // How this hospital runs payments, returns and RFQs (Settings → Purchase):
  // the screens show the right buttons from it; the server decides with it.
  if (req.query?.resource === 'purchase-settings') {
    return loadPurchaseSettings(db, getOrgId(req)).then((data) => res.json({ success: true, data })).catch(next)
  }
  if (req.query?.resource === 'setup-status') {
    // Single server-side check: is this hospital ready to buy?
    // Five parallel counts replace the five separate API calls the Settings
    // screen used to make — the checklist now reflects DB state, not a
    // frontend calculation from downloaded lists.
    try {
      const ORG_ID = getOrgId(req)
      await ensurePurchaseDefaults(ORG_ID)
      const [activeUnits, liveGroups, vendors, items, prRuleCount] = await Promise.all([
        db.unit.count({ where: { organizationId: ORG_ID, isActive: true } }),
        db.itemCategory.count({ where: { organizationId: ORG_ID, parentId: null, isActive: true } }),
        db.vendor.count({ where: { organizationId: ORG_ID, isActive: true } }),
        db.item.count({ where: { organizationId: ORG_ID, isActive: true } }),
        // rulesSet = at least one PR approval rule exists (mirrors isDefault: rows===0 in prGet)
        db.approvalRule.count({ where: { organizationId: ORG_ID, documentType: 'PR' } }),
      ])
      return res.json({
        success: true,
        data: { activeUnits, liveGroups, vendors, items, rulesSet: prRuleCount > 0 },
      })
    } catch (err) {
      return next(err)
    }
  }
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query
    // Retired rows are hidden unless asked for (a master screen showing them
    // greyed out); an old document still points at them either way.
    const activeOnly = req.query.includeInactive === 'true' ? {} : { isActive: true }

    if (resource === 'units') {
      await ensurePurchaseDefaults(ORG_ID)
      const data = await db.unit.findMany({
        where: { organizationId: ORG_ID, ...activeOnly },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      })
      return res.json({ success: true, data })
    }

    if (resource === 'categories') {
      await ensurePurchaseDefaults(ORG_ID)
      const rows = await db.itemCategory.findMany({
        where: { organizationId: ORG_ID, ...activeOnly },
        select: {
          id: true, parentId: true, name: true, isSystem: true, purchaseType: true,
          expenseHead: true, defaultGstRate: true, sortOrder: true, isActive: true,
          _count: { select: { items: true } },
        },
      })
      const data = buildTree(rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items })))
      return res.json({ success: true, data })
    }

    // The vendor list is for those who order and those who pay, not the store.
    if ((resource === 'vendors' || resource === 'vendor') && !canSeeVendors(req)) {
      return res.status(403).json({ success: false, error: 'Vendors are kept by the purchase team' })
    }

    if (resource === 'vendors') {
      const { search, status } = req.query
      const where = { organizationId: ORG_ID }
      if (status === 'active') where.isActive = true
      else if (status === 'inactive') where.isActive = false
      const term = String(search || '').trim()
      if (term) {
        where.OR = ['name', 'code', 'gstNumber', 'phone', 'city', 'locality', 'district', 'contactPerson']
          .map((f) => ({ [f]: { contains: term, mode: 'insensitive' } }))
      }
      const body = await listResponse(db.vendor, { where, orderBy: { name: 'asc' }, req })
      body.data = body.data.map((v) => withBank(v, false))
      return res.json(body)
    }

    if (resource === 'vendor') {
      const vendor = await db.vendor.findFirst({ where: { id: String(req.query.id || ''), organizationId: ORG_ID } })
      if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' })
      return res.json({ success: true, data: withBank(vendor, canSeeBank(req)) })
    }

    if (resource === 'items') {
      await ensurePurchaseDefaults(ORG_ID)
      const { search, status, categoryId } = req.query
      const where = { organizationId: ORG_ID }
      if (status === 'active') where.isActive = true
      else if (status === 'inactive') where.isActive = false
      itemSearchWhere(where, { search, categoryId })
      const body = await listResponse(db.item, { where, include: ITEM_INCLUDE, orderBy: { name: 'asc' }, req })
      // The store searches items to raise requests, without what the vendor was paid.
      body.data = body.data.map((i) => hideMoney(req, i, MONEY.item))
      return res.json(body)
    }

    if (resource === 'item') {
      const item = await db.item.findFirst({ where: { id: String(req.query.id || ''), organizationId: ORG_ID }, include: ITEM_INCLUDE })
      if (!item) return res.status(404).json({ success: false, error: 'Item not found' })
      return res.json({ success: true, data: hideMoney(req, item, MONEY.item) })
    }

    // With the hospital's GST state, so an order form can tell CGST + SGST from IGST.
    if (resource === 'gst-rates') {
      const org = await db.organization.findUnique({ where: { id: ORG_ID }, select: { region: true } })
      return res.json({ success: true, data: GST_RATES, meta: { hospitalStateCode: stateCodeByName(org?.region) } })
    }

    // The GST state list, from the one table the server validates against, so
    // the form's state picker can never offer a code the server refuses.
    if (resource === 'states') {
      const data = Object.entries(GST_STATES).map(([code, name]) => ({ code, name }))
      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource. Use: units, categories, vendors, vendor, items, item, states, gst-rates, requests, request, dashboard, approval-rules, orders, order, order-candidates' })
  } catch (err) {
    next(err)
  }
}
