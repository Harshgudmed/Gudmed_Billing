import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import { createDrugSchema, updateDrugSchema } from '../validations/drug.validation.js'
import { getPagination, paginationMeta, handleServiceError, makeError } from '../utils.js'
import { externalBarcodeLookup } from '../barcodeProvider.js'

const SORTABLE_FIELDS = ['drugName', 'drugCategory', 'quantityInStock', 'sellingPrice', 'reorderLevel', 'createdAt']

// App-level barcode uniqueness (no DB unique constraint — see schema note).
// Throws 409 if another active drug in the org already owns this barcode.
async function assertBarcodeFree(organizationId, barcode, excludeId) {
  const clash = await db.pharmacyDrug.findFirst({
    where: {
      organizationId,
      barcode,
      isActive: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, drugName: true },
  })
  if (clash) {
    throw makeError(
      `Barcode already assigned to "${clash.drugName}"`,
      409,
      'BARCODE_IN_USE',
      { barcode, existingDrugId: clash.id, existingDrugName: clash.drugName }
    )
  }
}

export async function list(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { search, category, sortBy, sortOrder } = req.query
    const { page, limit, skip } = getPagination(req.query)

    const where = { organizationId: ORGANIZATION_ID, isActive: true }
    if (category) where.drugCategory = category
    if (search) {
      where.OR = [
        { drugName: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
        { brandName: { contains: search, mode: 'insensitive' } },
        { drugCode: { contains: search, mode: 'insensitive' } },
      ]
    }

    const orderBy = SORTABLE_FIELDS.includes(sortBy)
      ? { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' }
      : { drugName: 'asc' }

    const [data, total] = await Promise.all([
      db.pharmacyDrug.findMany({
        where,
        include: {
          batches: {
            where: { status: 'active' },
            orderBy: { expiryDate: 'asc' },
            take: 1,
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      db.pharmacyDrug.count({ where }),
    ])

    res.json({ success: true, data, pagination: paginationMeta(page, limit, total) })
  } catch (err) {
    next(err)
  }
}

// GET /pharmacy/drugs/lookup?barcode=...
// Resolve a scanned barcode to a medicine in this org's master, including the
// soonest-expiry active batch so the form can also pre-fill batch # / expiry.
// A miss is NOT an error — it is the "new medicine" path (found:false, HTTP 200).
export async function lookupByBarcode(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const barcode = String(req.query.barcode || '').trim()
    if (!barcode) return res.json({ success: true, found: false })

    const drug = await db.pharmacyDrug.findFirst({
      where: { organizationId: ORGANIZATION_ID, barcode, isActive: true },
      include: {
        batches: { where: { status: 'active' }, orderBy: { expiryDate: 'asc' }, take: 1 },
      },
    })

    if (drug) return res.json({ success: true, found: true, source: 'local', data: drug })

    // Not in our master — try the online barcode database so a brand-new box
    // can still auto-fill. Partial (name/brand/manufacturer); user completes the rest.
    const external = await externalBarcodeLookup(barcode)
    if (external) {
      return res.json({ success: true, found: true, source: 'external', partial: true, data: { ...external, barcode } })
    }

    res.json({ success: true, found: false })
  } catch (err) {
    next(err)
  }
}

// GET /pharmacy/medicine-reference?q=...
// Type-ahead search over the open-source Indian medicine catalog (~254k rows,
// seeded via scripts/seed-medicine-reference.mjs). Raw query so it works without
// regenerating the Prisma client. Prefix matches rank above contains matches.
export async function searchReference(req, res, next) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase()
    if (q.length < 2) return res.json({ success: true, data: [] })
    const esc = q.replace(/[%_\\]/g, '\\$&')
    const prefix = esc + '%'
    const contains = '%' + esc + '%'
    const rows = await db.$queryRawUnsafe(
      `SELECT id, name, price, manufacturer, type, "packSize", composition
         FROM "MedicineReference"
        WHERE "nameLower" LIKE $1
        ORDER BY (CASE WHEN "nameLower" LIKE $2 THEN 0 ELSE 1 END), length(name), name
        LIMIT 20`,
      contains, prefix,
    )
    res.json({ success: true, data: rows })
  } catch (err) {
    next(err)
  }
}

export async function getById(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const drug = await db.pharmacyDrug.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      include: { batches: { orderBy: { expiryDate: 'asc' } } },
    })
    if (!drug) throw makeError('Drug not found', 404, 'DRUG_NOT_FOUND')
    res.json({ success: true, data: drug })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = createDrugSchema.parse(req.body)
    // A blank barcode is stored as null (not "") so barcode-less drugs don't clash.
    if (!parsed.barcode?.trim()) parsed.barcode = null
    if (parsed.barcode) await assertBarcodeFree(ORGANIZATION_ID, parsed.barcode, null)
    const data = await db.pharmacyDrug.create({
      data: { ...parsed, organizationId: ORGANIZATION_ID, isActive: true },
    })
    res.status(201).json({ success: true, data, message: 'Drug created successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = updateDrugSchema.parse(req.body)
    if ('barcode' in parsed && !parsed.barcode?.trim()) parsed.barcode = null

    const existing = await db.pharmacyDrug.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
    })
    if (!existing) throw makeError('Drug not found', 404, 'DRUG_NOT_FOUND')

    if (parsed.barcode) await assertBarcodeFree(ORGANIZATION_ID, parsed.barcode, req.params.id)

    const data = await db.pharmacyDrug.update({ where: { id: req.params.id }, data: parsed })
    res.json({ success: true, data, message: 'Drug updated successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const existing = await db.pharmacyDrug.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
    })
    if (!existing) throw makeError('Drug not found', 404, 'DRUG_NOT_FOUND')

    const data = await db.pharmacyDrug.update({
      where: { id: req.params.id },
      data: { isActive: false },
    })
    res.json({ success: true, data, message: 'Drug deactivated successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}
