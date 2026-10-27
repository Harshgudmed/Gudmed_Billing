import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'
import { parseGstin } from '../lib/gst.js'
import { nextMasterCode } from '../lib/counters.js'

// Column headers in the template (lowercased for matching).
// A trailing " *" marks required — stripped during parse.
const HEADER_MAP = {
  'name':               'name',
  'contact person':     'contactPerson',
  'phone':              'phone',
  'email':              'email',
  'gstin':              'gstNumber',
  'pan':                'pan',
  'vendor type':        'vendorType',       // goods | services | both
  'payment terms days': 'paymentTermsDays',
  'city':               'city',
  'state code':         'stateCode',        // 2-char GST state code
  'msme no':            'msmeNumber',
  'tds section':        'defaultTdsSection',
}
const REQUIRED_HEADERS = ['name']
const VENDOR_TYPES = new Set(['goods', 'services', 'both'])
const TDS_SECTIONS = new Set(['194C', '194J', '194I', '194H', '194Q'])

// GST state codes accepted by the system (same set as gst.js GST_STATES)
const STATES_BY_CODE = Object.fromEntries(
  Object.entries({
    '01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
    '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
    '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
    '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
    '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
    '24':'Gujarat','26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra',
    '28':'Andhra Pradesh (old)','29':'Karnataka','30':'Goa','31':'Lakshadweep',
    '32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman and Nicobar Islands',
    '36':'Telangana','37':'Andhra Pradesh','38':'Ladakh','97':'Other Territory',
  })
)

function parseFile(buffer) {
  const wb  = XLSX.read(buffer, { type: 'buffer', raw: false })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (!raw || raw.length < 2) return { headers: [], rows: [] }

  const headerRow = raw[0].map((h) => String(h).replace(/\*/g, '').trim().toLowerCase())
  const dataRows  = raw.slice(1)

  const rows = dataRows.map((cells, idx) => {
    const obj = { _rowNumber: idx + 2 }
    headerRow.forEach((h, col) => {
      const field = HEADER_MAP[h]
      if (field) obj[field] = String(cells[col] ?? '').trim()
    })
    return obj
  })

  const populated = rows.filter((r) =>
    Object.values(HEADER_MAP).some((f) => r[f] && r[f].length > 0)
  )
  return { headers: headerRow, rows: populated }
}

async function buildErrorWorkbook(failedRows) {
  const wb    = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Failed Rows')

  sheet.columns = [
    { header: 'Row #',               key: 'rowNumber',     width: 7  },
    { header: 'Name',                key: 'name',          width: 28 },
    { header: 'GSTIN',               key: 'gstNumber',     width: 18 },
    { header: 'Email',               key: 'email',         width: 32 },
    { header: 'Phone',               key: 'phone',         width: 14 },
    { header: 'Error Reason',        key: 'error',         width: 60 },
  ]

  const hdr = sheet.getRow(1)
  hdr.eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  hdr.height = 20

  for (const r of failedRows) {
    const row = sheet.addRow({
      rowNumber: r._rowNumber,
      name:      r.name       || '',
      gstNumber: r.gstNumber  || '',
      email:     r.email      || '',
      phone:     r.phone      || '',
      error:     r._error,
    })
    row.getCell('error').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F1' } }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  return wb.xlsx.writeBuffer()
}

// GET /purchase/vendor-import/template
export async function downloadVendorTemplate(req, res, next) {
  try {
    const wb    = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Vendors')

    sheet.columns = [
      { header: 'Name *',               key: 'name',              width: 30 },
      { header: 'Contact Person',       key: 'contactPerson',     width: 22 },
      { header: 'Phone',                key: 'phone',             width: 16 },
      { header: 'Email',                key: 'email',             width: 30 },
      { header: 'GSTIN',                key: 'gstNumber',         width: 18 },
      { header: 'PAN',                  key: 'pan',               width: 13 },
      { header: 'Vendor Type',          key: 'vendorType',        width: 16 },
      { header: 'Payment Terms Days',   key: 'paymentTermsDays',  width: 20 },
      { header: 'City',                 key: 'city',              width: 18 },
      { header: 'State Code',           key: 'stateCode',         width: 12 },
      { header: 'MSME No',              key: 'msmeNumber',        width: 22 },
      { header: 'TDS Section',          key: 'defaultTdsSection', width: 14 },
    ]

    const hdr = sheet.getRow(1)
    hdr.eachCell((cell) => {
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })
    hdr.height = 22

    // One sample row
    sheet.addRow({
      name:             'ABC Medical Supplies',
      contactPerson:    'Rajesh Kumar',
      phone:            '9876543210',
      email:            'rajesh@abcmed.com',
      gstNumber:        '27AAPFU0939F1ZV',
      pan:              '',
      vendorType:       'goods',
      paymentTermsDays: '30',
      city:             'Mumbai',
      stateCode:        '27',
      msmeNumber:       '',
      defaultTdsSection:'194Q',
    })

    // Instructions row
    const noteRow = sheet.addRow({
      name: 'Vendor Type: goods | services | both    |    TDS: 194C / 194J / 194I / 194H / 194Q    |    State Code: 2-digit GST state (27=Maharashtra, 07=Delhi, etc.)',
    })
    noteRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } }

    sheet.views = [{ state: 'frozen', ySplit: 1 }]

    const instructions = wb.addWorksheet('Instructions')
    instructions.columns = [
      { header: 'Topic', key: 'topic', width: 26 },
      { header: 'Instructions', key: 'instructions', width: 100 },
    ]
    instructions.addRows([
      { topic: 'Before you begin', instructions: 'Enter vendor records on the Vendors sheet. Keep Vendors as the first worksheet; the importer reads that sheet.' },
      { topic: 'Required field', instructions: 'Name is the only required column. Do not change or remove the column headers. The * marks a required field.' },
      { topic: 'Optional fields', instructions: 'Leave any optional field blank when you do not have that information.' },
      { topic: 'Vendor Type', instructions: 'Use goods, services, or both.' },
      { topic: 'GSTIN', instructions: 'Enter a valid GSTIN. Its state code and PAN are derived from the GSTIN when present.' },
      { topic: 'State Code', instructions: 'Use a valid 2-digit GST state code, for example 27 for Maharashtra or 07 for Delhi. This is mainly needed when GSTIN is blank.' },
      { topic: 'Payment Terms Days', instructions: 'Enter a whole number from 0 to 365.' },
      { topic: 'TDS Section', instructions: 'Use 194C, 194J, 194I, 194H, or 194Q.' },
      { topic: 'Duplicate vendors', instructions: 'A duplicate GSTIN is skipped. A duplicate vendor name is imported with a warning.' },
      { topic: 'Upload', instructions: 'Save the completed workbook as .xlsx and upload it from Import Vendors. The importer also accepts .csv files.' },
    ])
    const instructionHeader = instructions.getRow(1)
    instructionHeader.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })
    instructionHeader.height = 22
    instructions.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = { vertical: 'top', wrapText: true }
        row.height = 32
      }
    })
    instructions.views = [{ state: 'frozen', ySplit: 1 }]

    const buffer = await wb.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="vendor-import-template.xlsx"')
    res.send(buffer)
  } catch (err) { next(err) }
}

// POST /purchase/vendor-import  (multipart: file = xlsx/csv)
export async function bulkImportVendors(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file attached. Please upload an .xlsx or .csv file.' })

    const ORG_ID = getOrgId(req)
    const { headers, rows } = parseFile(req.file.buffer)

    if (rows.length === 0) return res.status(400).json({ success: false, error: 'The file is empty or has no data rows.' })

    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h))
    if (missingHeaders.length) {
      return res.status(400).json({
        success: false,
        error: `Missing required column(s): ${missingHeaders.map((h) => `"${h}"`).join(', ')}. Download the template for the correct format.`,
      })
    }

    // Load existing vendors' GSTINs and names for duplicate detection
    const existingVendors = await db.vendor.findMany({
      where:  { organizationId: ORG_ID },
      select: { gstNumber: true, name: true },
    })
    const existingGstins = new Set(existingVendors.map((v) => v.gstNumber?.toUpperCase()).filter(Boolean))
    const existingNames  = new Set(existingVendors.map((v) => v.name.toLowerCase()))

    const toInsert = []
    const warnings = []
    const failed   = []

    for (const row of rows) {
      const { _rowNumber, name, contactPerson, phone, email, gstNumber, pan, vendorType, paymentTermsDays, city, stateCode, msmeNumber, defaultTdsSection } = row
      const rowErrors = []

      if (!name) { rowErrors.push('Name is required') }

      // GSTIN validation
      let resolvedState = stateCode?.trim() || null
      let resolvedPan   = pan?.trim()       || null
      let cleanGstin    = null
      if (gstNumber) {
        cleanGstin = gstNumber.replace(/\s+/g, '').toUpperCase()
        const parsed = parseGstin(cleanGstin)
        if (!parsed.ok) {
          rowErrors.push(`GSTIN "${cleanGstin}" is invalid — check the format and check digit`)
        } else {
          resolvedState = cleanGstin.slice(0, 2)
          resolvedPan   = cleanGstin.slice(2, 12)
          if (existingGstins.has(cleanGstin)) {
            warnings.push({ row: _rowNumber, name, reason: `GSTIN ${cleanGstin} already exists — row skipped` })
            continue
          }
        }
      }

      if (vendorType && !VENDOR_TYPES.has(vendorType.toLowerCase())) {
        rowErrors.push(`Vendor Type "${vendorType}" is not valid — use: goods, services, or both`)
      }

      if (defaultTdsSection && !TDS_SECTIONS.has(defaultTdsSection.toUpperCase())) {
        rowErrors.push(`TDS Section "${defaultTdsSection}" is not recognised — use: 194C, 194J, 194I, 194H, or 194Q`)
      }

      if (resolvedState && !STATES_BY_CODE[resolvedState]) {
        rowErrors.push(`State Code "${resolvedState}" is not a valid GST state code`)
      }

      const terms = paymentTermsDays ? Number(paymentTermsDays) : null
      if (paymentTermsDays && (isNaN(terms) || terms < 0 || terms > 365)) {
        rowErrors.push(`Payment Terms Days must be a number between 0 and 365`)
      }

      if (rowErrors.length) { failed.push({ ...row, _error: rowErrors.join(' | ') }); continue }

      // Warn if a vendor with the same name already exists (not an error — could be a branch)
      if (existingNames.has(name.toLowerCase())) {
        warnings.push({ row: _rowNumber, name, reason: `A vendor named "${name}" already exists — a new record will be created` })
      }

      toInsert.push({
        _rowNumber,
        name:                name.trim(),
        contactPerson:       contactPerson  || null,
        phone:               phone          || null,
        email:               email          || null,
        gstNumber:           cleanGstin     || null,
        pan:                 resolvedPan    || null,
        stateCode:           resolvedState  || null,
        vendorType:          vendorType ? vendorType.toLowerCase() : null,
        paymentTermsDays:    terms,
        city:                city           || null,
        msmeNumber:          msmeNumber     || null,
        defaultTdsSection:   defaultTdsSection ? defaultTdsSection.toUpperCase() : null,
      })
    }

    let successCount = 0
    const insertErrors = []

    for (const r of toInsert) {
      try {
        const code = await nextMasterCode(ORG_ID, 'VENDOR')
        await db.vendor.create({
          data: {
            organizationId:    ORG_ID,
            code,
            name:              r.name,
            contactPerson:     r.contactPerson,
            phone:             r.phone,
            email:             r.email,
            gstNumber:         r.gstNumber,
            pan:               r.pan,
            stateCode:         r.stateCode,
            vendorType:        r.vendorType,
            paymentTermsDays:  r.paymentTermsDays,
            city:              r.city,
            msmeNumber:        r.msmeNumber,
            defaultTdsSection: r.defaultTdsSection,
            isActive:          true,
          },
        })
        successCount++
      } catch (err) {
        const isDuplicate = err?.code === 'P2002'
        insertErrors.push({
          _rowNumber:     r._rowNumber,
          name:           r.name,
          gstNumber:      r.gstNumber || '',
          email:          r.email     || '',
          phone:          r.phone     || '',
          _error: isDuplicate
            ? 'Duplicate GSTIN detected during save — this vendor already exists'
            : `Database error: ${err.message}`,
        })
      }
    }

    const allFailed = [...failed, ...insertErrors]

    let errorFile = null
    if (allFailed.length > 0) {
      const buf = await buildErrorWorkbook(allFailed)
      errorFile = {
        filename: 'vendor-import-errors.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64:   buf.toString('base64'),
      }
    }

    return res.json({
      success: true,
      summary: { total: rows.length, imported: successCount, warnings: warnings.length, failed: allFailed.length },
      warnings,
      errors: allFailed.map((r) => ({ row: r._rowNumber, name: r.name || '', reason: r._error })),
      errorFile,
    })
  } catch (err) { next(err) }
}
