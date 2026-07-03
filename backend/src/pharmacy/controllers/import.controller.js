import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import { handleServiceError, makeError } from '../utils.js'
import { recordStockChange } from '../stockService.js'

// Bulk import of a medicine catalog / purchase list.
//
// The frontend parses the uploaded .xlsx/.csv into JSON rows (SheetJS) and POSTs
// them here — so this endpoint is dependency-free. Two modes:
//   - mode 'validate' (default): dry run — validates + flags duplicates, writes nothing.
//   - mode 'commit': creates PharmacyDrug (+ a PharmacyBatch and a stock-in ledger
//     row when an opening quantity is given). Existing barcodes/names are skipped.
//
// Accepted column aliases per row (case-insensitive, trimmed) are mapped in normalizeRow.

const num = (v) => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

const str = (v) => {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

// Parse a date that may arrive as "YYYY-MM-DD", "DD/MM/YYYY", "MM/YY", or an Excel serial.
const parseDate = (v) => {
  if (v === null || v === undefined || v === '') return undefined
  if (v instanceof Date) return isNaN(v) ? undefined : v
  const s = String(v).trim()
  // MM/YY or MM/YYYY (common on medicine strips) -> last day of that month
  let m = s.match(/^(\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    const mm = parseInt(m[1], 10)
    let yy = parseInt(m[2], 10)
    if (yy < 100) yy += 2000
    return new Date(yy, mm, 0) // day 0 of next month = last day of this month
  }
  // DD/MM/YYYY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let yy = parseInt(m[3], 10)
    if (yy < 100) yy += 2000
    return new Date(yy, parseInt(m[2], 10) - 1, parseInt(m[1], 10))
  }
  const d = new Date(s)
  return isNaN(d) ? undefined : d
}

// Map a raw row (whatever the user's column headers are) to our normalized shape.
function normalizeRow(raw) {
  // Lower-case, strip non-alphanumerics from every key for forgiving matching.
  const k = {}
  for (const [key, val] of Object.entries(raw)) {
    k[String(key).toLowerCase().replace(/[^a-z0-9]/g, '')] = val
  }
  const pick = (...names) => {
    for (const n of names) if (k[n] !== undefined && k[n] !== '') return k[n]
    return undefined
  }

  return {
    drugName: str(pick('drugname', 'medicinename', 'name', 'productname', 'item')),
    genericName: str(pick('genericname', 'generic', 'saltname', 'salt', 'composition')),
    brandName: str(pick('brandname', 'brand')),
    manufacturer: str(pick('manufacturer', 'company', 'companyname', 'mfr', 'mfg')),
    drugCategory: str(pick('drugcategory', 'category', 'type')),
    dosageForm: str(pick('dosageform', 'form', 'dosage')),
    strength: str(pick('strength', 'power', 'mg')),
    unitOfMeasure: str(pick('unitofmeasure', 'unit', 'uom')),
    barcode: str(pick('barcode', 'barcodeno', 'ean', 'upc')),
    hsnCode: str(pick('hsncode', 'hsn')),
    mrp: num(pick('mrp', 'maxretailprice')),
    sellingPrice: num(pick('sellingprice', 'salerate', 'saleprice', 'rate', 'price')),
    purchasePrice: num(pick('purchaseprice', 'purchaserate', 'costprice', 'cost', 'ptr')),
    gstRate: num(pick('gstrate', 'gst', 'tax', 'taxpercent')),
    reorderLevel: num(pick('reorderlevel', 'reorder', 'minstock', 'minimumstock')),
    quantity: num(pick('quantity', 'currentstock', 'stock', 'qty', 'openingstock', 'openingqty')),
    batchNumber: str(pick('batchnumber', 'batch', 'batchno', 'lot')),
    expiryDate: parseDate(pick('expirydate', 'expiry', 'exp', 'expdate')),
    manufactureDate: parseDate(pick('manufacturedate', 'mfgdate', 'mfg')),
    supplierName: str(pick('suppliername', 'supplier', 'vendor', 'distributor')),
  }
}

export async function importDrugs(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const createdById = req.user?.userId ?? null
    const mode = req.body?.mode === 'commit' ? 'commit' : 'validate'
    const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : null
    if (!rawRows) throw makeError('Body must include a "rows" array', 400, 'NO_ROWS')
    if (rawRows.length > 5000) throw makeError('Too many rows (max 5000 per upload)', 400, 'TOO_MANY_ROWS')

    // Normalize every row once, up front (reused in the loop below).
    const normRows = rawRows.map(normalizeRow)

    // Duplicate detection must SCALE. Loading the ENTIRE drug table on every
    // chunk is O(n²) across a 20-lakh import (each of ~1000 chunks re-reading
    // millions of rows). Instead, load only the existing drugs that could
    // actually collide with THIS chunk — matched by the chunk's barcodes/names.
    // (Relies on the @@index([barcode]) and @@index([drugName]) already present.)
    const nameKey = (n, s) => `${(n || '').toLowerCase()}|${(s || '').toLowerCase()}`
    const chunkBarcodes = [...new Set(normRows.map((r) => r.barcode).filter(Boolean))]
    const chunkNames = [...new Set(normRows.map((r) => r.drugName).filter(Boolean))]
    const orClauses = []
    if (chunkBarcodes.length) orClauses.push({ barcode: { in: chunkBarcodes } })
    if (chunkNames.length) orClauses.push({ drugName: { in: chunkNames } })
    const existing = orClauses.length
      ? await db.pharmacyDrug.findMany({
          where: { organizationId: ORGANIZATION_ID, OR: orClauses },
          select: { barcode: true, drugName: true, strength: true },
        })
      : []
    const existingBarcodes = new Set(existing.filter((d) => d.barcode).map((d) => d.barcode))
    const existingNames = new Set(existing.map((d) => nameKey(d.drugName, d.strength)))

    // Track duplicates WITHIN the file too.
    const seenBarcodes = new Set()
    const seenNames = new Set()

    const report = []   // per-row outcome
    let created = 0, duplicates = 0, errors = 0

    for (let i = 0; i < rawRows.length; i++) {
      const rowNo = i + 2 // +2: header row is line 1, data starts at line 2
      const row = normRows[i]

      if (!row.drugName) {
        errors++
        report.push({ rowNo, status: 'error', message: 'Missing medicine name', name: null })
        continue
      }

      const nKey = nameKey(row.drugName, row.strength)
      const isDupBarcode = row.barcode && (existingBarcodes.has(row.barcode) || seenBarcodes.has(row.barcode))
      const isDupName = existingNames.has(nKey) || seenNames.has(nKey)
      if (isDupBarcode || isDupName) {
        duplicates++
        report.push({ rowNo, status: 'duplicate', name: row.drugName, message: isDupBarcode ? 'Barcode already exists' : 'Name + strength already exists' })
        continue
      }

      // Reserve BOTH keys so a later row that repeats either the barcode OR the
      // name+strength of this one is caught as a duplicate.
      if (row.barcode) seenBarcodes.add(row.barcode)
      seenNames.add(nKey)

      if (mode === 'validate') {
        created++ // "would create"
        report.push({ rowNo, status: 'ok', name: row.drugName, message: row.quantity ? `Stock ${row.quantity}` : 'No opening stock' })
        continue
      }

      // commit
      try {
        await db.$transaction(async (tx) => {
          const drug = await tx.pharmacyDrug.create({
            data: {
              organizationId: ORGANIZATION_ID,
              drugName: row.drugName,
              genericName: row.genericName,
              brandName: row.brandName,
              manufacturer: row.manufacturer,
              drugCategory: row.drugCategory,
              dosageForm: row.dosageForm,
              strength: row.strength,
              unitOfMeasure: row.unitOfMeasure,
              barcode: row.barcode ?? null,
              hsnCode: row.hsnCode,
              mrp: row.mrp,
              sellingPrice: row.sellingPrice ?? row.mrp,
              costPrice: row.purchasePrice,
              purchasePrice: row.purchasePrice,
              gstRate: row.gstRate,
              reorderLevel: row.reorderLevel ?? 10,
              quantityInStock: 0, // set via ledger below so it stays consistent
              isActive: true,
            },
          })

          if (row.quantity && row.quantity > 0) {
            let batchId = null
            if (row.batchNumber || row.expiryDate) {
              const batch = await tx.pharmacyBatch.create({
                data: {
                  organizationId: ORGANIZATION_ID,
                  drugId: drug.id,
                  batchNumber: row.batchNumber || `IMP-${Date.now()}-${i}`,
                  expiryDate: row.expiryDate || new Date(Date.now() + 365 * 864e5),
                  manufactureDate: row.manufactureDate,
                  quantityReceived: row.quantity,
                  quantityRemaining: row.quantity,
                  costPricePerUnit: row.purchasePrice,
                  totalCost: row.purchasePrice ? row.purchasePrice * row.quantity : undefined,
                  supplierName: row.supplierName,
                  status: 'active',
                },
              })
              batchId = batch.id
            }
            await recordStockChange(tx, {
              organizationId: ORGANIZATION_ID,
              drugId: drug.id,
              batchId,
              changeType: 'import',
              quantityDelta: row.quantity,
              reference: 'bulk-import',
              note: `Imported opening stock`,
              createdById,
            })
          }
        })
        created++
        report.push({ rowNo, status: 'ok', name: row.drugName, message: 'Created' })
      } catch (e) {
        errors++
        report.push({ rowNo, status: 'error', name: row.drugName, message: e.message.split('\n').pop().slice(0, 120) })
      }
    }

    res.json({
      success: true,
      mode,
      summary: { total: rawRows.length, created, duplicates, errors },
      report,
      message: mode === 'validate'
        ? `Validation: ${created} ready, ${duplicates} duplicates, ${errors} errors`
        : `Imported ${created} medicines (${duplicates} duplicates skipped, ${errors} errors)`,
    })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}
