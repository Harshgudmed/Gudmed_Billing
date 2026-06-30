import { db } from '../config/db.js'

// Generic bulk importer for simple catalogs (lab tests, radiology exams).
// The frontend parses the uploaded .xlsx/.csv into JSON rows and POSTs them, so
// this stays dependency-free. Two modes:
//   - 'validate' (default): dry run — validates + flags duplicates, writes nothing.
//   - 'commit': creates each catalog row.
// Duplicate detection is by the (case-insensitive) display name.

// ── tolerant field coercion ──────────────────────────────────────────────────
export const str = (v) => {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}
export const num = (v) => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(String(v).replace(/[, ₹]/g, ''))
  return Number.isFinite(n) ? n : undefined
}
export const int = (v) => {
  const n = num(v)
  return n === undefined ? undefined : Math.round(n)
}
export const bool = (v) => {
  if (v === null || v === undefined || v === '') return undefined
  return /^(y|yes|true|1|required)$/i.test(String(v).trim())
}

// Build a forgiving accessor over a raw row: lowercases + strips non-alphanumerics
// from every header so "Body Part", "body_part", "BodyPart" all match "bodypart".
export function keyed(raw) {
  const k = {}
  for (const [key, val] of Object.entries(raw)) {
    k[String(key).toLowerCase().replace(/[^a-z0-9]/g, '')] = val
  }
  return (...names) => {
    for (const n of names) if (k[n] !== undefined && k[n] !== '') return k[n]
    return undefined
  }
}

/**
 * @param model        Prisma model name, e.g. 'labTest' | 'radiologyExam'
 * @param organizationId
 * @param rows         raw row objects from the spreadsheet
 * @param mode         'validate' | 'commit'
 * @param nameField    the unique-ish display field, e.g. 'testName' | 'examName'
 * @param normalizeRow (rawRow) => normalized data object (incl. nameField)
 */
export async function importCatalog({ model, organizationId, rows, mode, nameField, normalizeRow }) {
  if (!Array.isArray(rows)) throw Object.assign(new Error('Body must include a "rows" array'), { status: 400 })
  if (rows.length > 5000) throw Object.assign(new Error('Too many rows (max 5000 per upload)'), { status: 400 })

  const existing = await db[model].findMany({ where: { organizationId }, select: { [nameField]: true } })
  const existingNames = new Set(existing.map((r) => String(r[nameField] || '').toLowerCase()))
  const seen = new Set()

  const report = []
  let created = 0, duplicates = 0, errors = 0

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2 // header is line 1
    const row = normalizeRow(rows[i])
    const name = row[nameField]

    if (!name) {
      errors++
      report.push({ rowNo, status: 'error', name: null, message: 'Missing name' })
      continue
    }
    const key = name.toLowerCase()
    if (existingNames.has(key) || seen.has(key)) {
      duplicates++
      report.push({ rowNo, status: 'duplicate', name, message: 'Already exists' })
      continue
    }
    seen.add(key)

    if (mode === 'validate') {
      created++
      report.push({ rowNo, status: 'ok', name, message: 'Ready' })
      continue
    }

    try {
      await db[model].create({ data: { ...row, organizationId, isActive: true } })
      created++
      report.push({ rowNo, status: 'ok', name, message: 'Created' })
    } catch (e) {
      errors++
      report.push({ rowNo, status: 'error', name, message: e.message.split('\n').pop().slice(0, 120) })
    }
  }

  return { summary: { total: rows.length, created, duplicates, errors }, report }
}
