// Shared helpers for spreadsheet bulk import/export (floors, room setup).

import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * First sheet → { headers, rows }. Headers are lowercased with the template's
 * required marker ("Floor *") stripped, then mapped to field names through
 * `headerMap`; unknown columns are ignored. Fully blank rows are dropped, and
 * each row keeps its Excel row number as `_rowNumber` for error reporting.
 */
export function parseSheet(buffer, headerMap) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!raw || raw.length < 1) return { headers: [], rows: [] }

  const headers = raw[0].map((h) => String(h).replace(/\*/g, '').trim().toLowerCase())
  const fields = Object.values(headerMap)

  const rows = raw.slice(1).map((cells, idx) => {
    const obj = { _rowNumber: idx + 2 }
    headers.forEach((h, col) => {
      const field = headerMap[h]
      if (field) obj[field] = String(cells[col] ?? '').trim()
    })
    return obj
  }).filter((r) => fields.some((f) => r[f] && r[f].length > 0))

  return { headers, rows }
}

/** Bold coloured header row, frozen. */
export function styleHeader(sheet, argb = 'FF2563EB') {
  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

/**
 * Failed-rows workbook, returned as the `errorFile` payload the frontend
 * decodes. `columns` are ExcelJS column defs for the row's own fields; Row #
 * and Error Reason are added around them.
 */
export async function buildErrorFile(columns, failedRows, filename) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Failed Rows')
  sheet.columns = [
    { header: 'Row #', key: '_rowNumber', width: 8 },
    ...columns,
    { header: 'Error Reason', key: '_error', width: 60 },
  ]
  styleHeader(sheet, 'FFDC2626')
  for (const r of failedRows) {
    const row = sheet.addRow(r)
    row.getCell('_error').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F1' } }
  }
  const buf = await workbook.xlsx.writeBuffer()
  return { filename, mimeType: XLSX_MIME, base64: Buffer.from(buf).toString('base64') }
}

/** Send a workbook as an .xlsx or .csv download. */
export async function sendWorkbook(res, workbook, filename, format = 'xlsx') {
  if (format === 'csv') {
    const buffer = await workbook.csv.writeBuffer()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`)
    return res.send(buffer)
  }
  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader('Content-Type', XLSX_MIME)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`)
  return res.send(buffer)
}
