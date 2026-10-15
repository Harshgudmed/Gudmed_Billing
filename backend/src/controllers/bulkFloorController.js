import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_ROWS = 500
const MAX_NAME_LENGTH = 50

const HEADER_MAP = {
  'floor name': 'name',
  'sort order': 'sortOrder',
}

const REQUIRED_HEADERS = ['floor name']

function styleHeader(sheet, argb) {
  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

function parseFile(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!raw || raw.length < 1) return { headers: [], rows: [] }

  // Template headers carry a required marker ("Floor Name *") — drop it so they match HEADER_MAP
  const headerRow = raw[0].map((h) => String(h).replace(/\*/g, '').trim().toLowerCase())

  const rows = raw.slice(1).map((cells, idx) => {
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
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Failed Rows')

  sheet.columns = [
    { header: 'Row #',        key: 'rowNumber', width: 8  },
    { header: 'Floor Name',   key: 'name',      width: 26 },
    { header: 'Sort Order',   key: 'sortOrder', width: 12 },
    { header: 'Error Reason', key: 'error',     width: 50 },
  ]
  styleHeader(sheet, 'FFDC2626')

  for (const r of failedRows) {
    const row = sheet.addRow({
      rowNumber: r._rowNumber,
      name:      r.name      || '',
      sortOrder: r.sortOrder || '',
      error:     r._error,
    })
    row.getCell('error').fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F1' },
    }
  }

  return workbook.xlsx.writeBuffer()
}

export async function downloadFloorTemplate(req, res, next) {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Floors')

    sheet.columns = [
      { header: 'Floor Name *', key: 'name',      width: 26 },
      { header: 'Sort Order',   key: 'sortOrder', width: 14 },
    ]
    styleHeader(sheet, 'FF2563EB')

    sheet.addRow({ name: 'Ground Floor', sortOrder: 0 })
    sheet.addRow({ name: '1st Floor',    sortOrder: 1 })
    sheet.addRow({ name: '2nd Floor',    sortOrder: 2 })

    const help = workbook.addWorksheet('Instructions')
    help.columns = [{ header: 'Instructions', key: 'text', width: 90 }]
    styleHeader(help, 'FF2563EB')
    ;[
      `Floor Name is required, must be unique, and at most ${MAX_NAME_LENGTH} characters.`,
      'Sort Order is optional — a whole number 0 or above (Ground = 0, 1st = 1, ...).',
      'Leave Sort Order blank to add the floor after the existing floors.',
      'Floors that already exist are skipped and reported in the error file.',
      `Up to ${MAX_ROWS} rows per file. Delete the example rows before uploading.`,
    ].forEach((text) => help.addRow({ text }))

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', 'attachment; filename="floors_template.xlsx"')
    res.send(buffer)
  } catch (err) { next(err) }
}

export async function importFloors(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file attached. Please upload an .xlsx or .csv file.',
      })
    }

    const ORG_ID = getOrgId(req)
    const { headers, rows } = parseFile(req.file.buffer)

    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h))
    if (missingHeaders.length) {
      return res.status(400).json({
        success: false,
        error: `Missing required column(s): ${missingHeaders.map((h) => '"' + h + '"').join(', ')}. Download the template for the correct format.`,
      })
    }
    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'The file is empty or has no data rows.' })
    }
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ success: false, error: `Too many rows (${rows.length}). Maximum is ${MAX_ROWS} per file.` })
    }

    const existing = await db.floor.findMany({
      where:  { organizationId: ORG_ID },
      select: { name: true, sortOrder: true },
    })
    const existingNames = new Set(existing.map((f) => f.name.toLowerCase()))
    let nextSortOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1

    const seenInFile = new Map() // lowercase name -> first row number
    const toInsert = []
    const failed   = []

    for (const row of rows) {
      const { _rowNumber, name, sortOrder } = row
      let error = null
      const key = (name || '').toLowerCase()

      if (!name) error = 'Floor name is required'
      else if (name.length > MAX_NAME_LENGTH) error = `Floor name too long (max ${MAX_NAME_LENGTH} characters)`
      else if (seenInFile.has(key)) error = `Duplicate in file (row ${seenInFile.get(key)})`
      else if (existingNames.has(key)) error = 'Floor already exists'
      else if (sortOrder && !/^\d+$/.test(sortOrder)) error = 'Invalid sort order (must be a whole number 0 or above)'

      if (name && !seenInFile.has(key)) seenInFile.set(key, _rowNumber)

      if (error) {
        failed.push({ ...row, _error: error })
        continue
      }
      toInsert.push({ ...row, _sortOrder: sortOrder ? Number(sortOrder) : null })
    }

    // Blank sort orders go after everything — existing floors and any explicit
    // values in this file — in file order.
    const maxExplicit = toInsert.reduce((max, r) => (r._sortOrder != null ? Math.max(max, r._sortOrder) : max), -1)
    nextSortOrder = Math.max(nextSortOrder, maxExplicit + 1)
    for (const r of toInsert) {
      if (r._sortOrder == null) r._sortOrder = nextSortOrder++
    }

    let created = 0
    if (toInsert.length > 0) {
      const inserted = await db.floor.createManyAndReturn({
        data: toInsert.map((r) => ({ organizationId: ORG_ID, name: r.name, sortOrder: r._sortOrder })),
        skipDuplicates: true,
        select: { name: true },
      })
      created = inserted.length

      // A concurrent request may have created some of these names between our
      // read and the insert — skipDuplicates drops them silently, so report
      // any row whose name didn't come back.
      if (created < toInsert.length) {
        const insertedNames = new Set(inserted.map((f) => f.name))
        for (const r of toInsert) {
          if (!insertedNames.has(r.name)) failed.push({ ...r, _error: 'Floor already exists' })
        }
      }
    }

    failed.sort((a, b) => a._rowNumber - b._rowNumber)

    let errorFile = null
    if (failed.length > 0) {
      const buf = await buildErrorWorkbook(failed)
      errorFile = {
        filename: 'floor-upload-errors.xlsx',
        mimeType: XLSX_MIME,
        base64:   buf.toString('base64'),
      }
    }

    return res.json({
      success: true,
      summary: {
        total:   rows.length,
        success: created,
        failed:  failed.length,
      },
      errors: failed.map((r) => ({
        row:    r._rowNumber,
        name:   r.name || '',
        reason: r._error,
      })),
      errorFile,
    })
  } catch (err) { next(err) }
}

export async function exportFloors(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx'

    const floors = await db.floor.findMany({
      where:   { organizationId: ORG_ID },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { rooms: true } } },
    })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Floors')
    // First two columns match the template so an export can be edited and re-imported.
    sheet.columns = [
      { header: 'Floor Name', key: 'name',      width: 26 },
      { header: 'Sort Order', key: 'sortOrder', width: 12 },
      { header: 'Room Count', key: 'roomCount', width: 12 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ]
    for (const f of floors) {
      sheet.addRow({
        name:      f.name,
        sortOrder: f.sortOrder,
        roomCount: f._count.rooms,
        createdAt: f.createdAt.toISOString().slice(0, 10),
      })
    }

    const date = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      const buffer = await workbook.csv.writeBuffer()
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="floors_export_${date}.csv"`)
      return res.send(buffer)
    }

    styleHeader(sheet, 'FF2563EB')
    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="floors_export_${date}.xlsx"`)
    res.send(buffer)
  } catch (err) { next(err) }
}
