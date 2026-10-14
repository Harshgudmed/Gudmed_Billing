import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'
import bcrypt from 'bcryptjs'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'

const DEFAULT_PASSWORD = 'Gudmed@123'

const HEADER_MAP = {
  'full name': 'fullName',
  'email': 'email',
  'password': 'password',
  'specialization': 'specialization',
  'phone': 'phone',
  'department': 'department',
}

const REQUIRED_HEADERS = ['full name', 'email']

function parseFile(buffer, originalname) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!raw || raw.length < 2) return { headers: [], rows: [] }

  // Template headers carry a required marker ("Full Name *") — drop it so they match HEADER_MAP
  const headerRow = raw[0].map((h) => String(h).replace(/\*/g, '').trim().toLowerCase())
  const dataRows = raw.slice(1)

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
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Failed Rows')

  sheet.columns = [
    { header: 'Row #',          key: 'rowNumber',     width: 8  },
    { header: 'Full Name',      key: 'fullName',      width: 24 },
    { header: 'Email',          key: 'email',         width: 30 },
    { header: 'Specialization', key: 'specialization',width: 22 },
    { header: 'Phone',          key: 'phone',         width: 16 },
    { header: 'Department',     key: 'department',    width: 22 },
    { header: 'Error Reason',   key: 'error',         width: 55 },
  ]

  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = 20

  for (const r of failedRows) {
    const row = sheet.addRow({
      rowNumber:      r._rowNumber,
      fullName:       r.fullName      || '',
      email:          r.email         || '',
      specialization: r.specialization|| '',
      phone:          r.phone         || '',
      department:     r.department    || '',
      error:          r._error,
    })
    row.getCell('error').fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F1' },
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  return workbook.xlsx.writeBuffer()
}

export async function downloadBulkDoctorTemplate(req, res, next) {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Doctors')

    sheet.columns = [
      { header: 'Full Name *',    key: 'fullName',      width: 26 },
      { header: 'Email *',        key: 'email',         width: 32 },
      { header: 'Specialization', key: 'specialization',width: 22 },
      { header: 'Phone',          key: 'phone',         width: 16 },
      { header: 'Department',     key: 'department',    width: 22 },
      { header: 'Password *',     key: 'password',      width: 20 },
    ]

    const headerRow = sheet.getRow(1)
    headerRow.eachCell((cell) => {
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })
    headerRow.height = 22

    sheet.addRow({
      fullName:       'Dr. John Smith',
      email:          'john.smith@hospital.com',
      specialization: 'Cardiology',
      phone:          '9876543210',
      department:     'Cardiology',
      password:       DEFAULT_PASSWORD,
    })

    sheet.views = [{ state: 'frozen', ySplit: 1 }]

    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="doctor-bulk-upload-template.xlsx"')
    res.send(buffer)
  } catch (err) { next(err) }
}

export async function bulkUploadDoctors(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file attached. Please upload an .xlsx or .csv file.',
      })
    }

    const ORG_ID = getOrgId(req)
    const { buffer, originalname } = req.file

    const { headers, rows } = parseFile(buffer, originalname)

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'The file is empty or has no data rows.' })
    }

    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h))
    if (missingHeaders.length) {
      return res.status(400).json({
        success: false,
        error: `Missing required column(s): ${missingHeaders.map((h) => '"' + h + '"').join(', ')}. Download the template for the correct format.`,
      })
    }

    const [departments, existingDoctors] = await Promise.all([
      db.department.findMany({
        where:  { organizationId: ORG_ID },
        select: { id: true, name: true },
      }),
      db.user.findMany({
        where:  { organizationId: ORG_ID, role: 'doctor' },
        select: { id: true, email: true, departmentId: true, specialization: true },
      }),
    ])

    const deptByName    = new Map(departments.map((d) => [d.name.toLowerCase(), d]))
    const deptById      = new Map(departments.map((d) => [d.id, d]))
    const doctorByEmail = new Map(existingDoctors.map((u) => [u.email.toLowerCase(), u]))

    const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

    const toInsert = []
    const warnings = []
    const failed   = []

    for (const row of rows) {
      const { _rowNumber, fullName, email, specialization, phone, department, password } = row
      const rowErrors = []

      if (!fullName) rowErrors.push('Full Name is required')
      if (!email)    rowErrors.push('Email is required')
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        rowErrors.push('Email format is invalid')

      if (rowErrors.length) {
        failed.push({ ...row, _error: rowErrors.join(' | ') })
        continue
      }

      let deptId = null
      if (department) {
        const found = deptByName.get(department.toLowerCase())
        if (!found) {
          failed.push({
            ...row,
            _error: 'Department "' + department + '" does not exist. Create it in Settings first or check the spelling.',
          })
          continue
        }
        deptId = found.id
      }

      const existing = doctorByEmail.get(email.toLowerCase())
      if (existing) {
        const sameSpec = (existing.specialization || '').toLowerCase() === (specialization || '').toLowerCase()
        const sameDept = existing.departmentId === deptId

        if (sameSpec && sameDept) {
          failed.push({
            ...row,
            _error: 'Doctor with this email, department, and specialization already exists.',
          })
          continue
        }

        const existingDeptName = existing.departmentId
          ? (deptById.get(existing.departmentId)?.name || existing.departmentId)
          : 'N/A'
        warnings.push({
          row:    _rowNumber,
          email,
          reason: 'Doctor already exists in department "' + existingDeptName + '" with specialization "' + (existing.specialization || 'N/A') + '". A new account will be created with the uploaded values.',
        })
        toInsert.push({ fullName, email, specialization: specialization || null, phone: phone || null, deptId, password, _rowNumber, department })
        continue
      }

      toInsert.push({ fullName, email, specialization: specialization || null, phone: phone || null, deptId, password, _rowNumber, department })
    }

    let successCount = 0
    const insertErrors = []

    if (toInsert.length > 0) {
      const hashed = await Promise.all(
        toInsert.map(async (r) => {
          const pwd  = r.password?.trim() || DEFAULT_PASSWORD
          const hash = pwd === DEFAULT_PASSWORD ? defaultHash : await bcrypt.hash(pwd, 10)
          return { ...r, passwordHash: hash }
        })
      )

      await db.$transaction(async (tx) => {
        for (const r of hashed) {
          try {
            await tx.user.create({
              data: {
                organizationId: ORG_ID,
                fullName:       r.fullName,
                email:          r.email,
                role:           'doctor',
                passwordHash:   r.passwordHash,
                departmentId:   r.deptId || null,
                phone:          r.phone  || null,
                specialization: r.specialization || null,
                isActive:       true,
              },
            })
            successCount++
          } catch (err) {
            const isDuplicate = err?.code === 'P2002'
            insertErrors.push({
              _rowNumber:     r._rowNumber,
              fullName:       r.fullName,
              email:          r.email,
              specialization: r.specialization || '',
              phone:          r.phone || '',
              department:     r.department || '',
              _error: isDuplicate
                ? 'Email already exists (duplicate detected during save).'
                : 'Database error: ' + err.message,
            })
          }
        }
      })
    }

    const allFailed = [...failed, ...insertErrors]

    let errorFile = null
    if (allFailed.length > 0) {
      const buf = await buildErrorWorkbook(allFailed)
      errorFile = {
        filename: 'bulk-upload-errors.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64:   buf.toString('base64'),
      }
    }

    return res.json({
      success: true,
      summary: {
        total:    rows.length,
        success:  successCount,
        warnings: warnings.length,
        failed:   allFailed.length,
      },
      warnings,
      errors: allFailed.map((r) => ({
        row:    r._rowNumber,
        email:  r.email    || '',
        name:   r.fullName || '',
        reason: r._error,
      })),
      errorFile,
    })
  } catch (err) { next(err) }
}
