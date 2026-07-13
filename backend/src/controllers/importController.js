import { db } from '../config/db.js'
import crypto from 'crypto'

// Full data import endpoint — runs the FK-ordered, self-healing migration
// server-side (where the DB is reachable internally). Protected by a secret that
// lives ONLY in the IMPORT_SECRET env var (the old hardcoded 'GudMed…' fallback was
// a repo-visible master key — able to create admins / wipe data — and is removed).
//
// POST /api/import  with header x-import-secret
// Body: { organizations, departments, users, patients, wards, beds, ... }
//
// Fails CLOSED: if IMPORT_SECRET is not configured, every request is rejected.
// Uses a constant-time comparison so the secret can't be guessed by timing.
function importSecretValid(provided) {
  const expected = process.env.IMPORT_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function importData(req, res) {
  if (!importSecretValid(req.headers['x-import-secret'])) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const b = req.body || {}
  const results = {}
  const errors = []

  // Upsert an array of rows with an optional per-row fix() that can null
  // FK fields or return null to skip the row.
  async function copy(model, rows, fix) {
    let ok = 0, fail = 0, skip = 0
    for (const row of (rows || [])) {
      const data = fix ? fix({ ...row }) : { ...row }
      if (data === null) { skip++; continue }
      try {
        await db[model].upsert({ where: { id: row.id }, update: data, create: data })
        ok++
      } catch (e) {
        fail++
        if (errors.length < 25) errors.push(`${model}/${row.id}: ${e.message.split('\n').pop().slice(0, 120)}`)
      }
    }
    results[model] = { ok, fail, skip, total: (rows || []).length }
  }

  async function ids(model) {
    const rows = await db[model].findMany({ select: { id: true } })
    return new Set(rows.map(r => r.id))
  }

  try {
    // Optional purge of previously-seeded demo rows (by id prefix) so
    // re-uploading gives a clean slate instead of accumulating orphans.
    if (b.purgeDemo) {
      const del = async (model, prefix) => {
        try { const r = await db[model].deleteMany({ where: { id: { startsWith: prefix } } }); return r.count }
        catch { return 0 }
      }
      results._purged = {
        appointments: await del('appointment', 'appt-demo-'),
        invoices:     await del('invoice', 'inv-demo-'),
        pharmacyDrugs:await del('pharmacyDrug', 'drug-demo-'),
      }
    }

    // Stage 1 — core
    await copy('organization', b.organizations)
    await copy('department', b.departments, r => { r.headId = null; return r })
    const deptIds = await ids('department')
    await copy('user', b.users, r => {
      if (r.departmentId && !deptIds.has(r.departmentId)) r.departmentId = null
      r.invitedById = null
      return r
    })
    await copy('patient', b.patients)
    const patientIds = await ids('patient')

    // Stage 2 — inpatient
    await copy('ward', b.wards, r => {
      if (r.departmentId && !deptIds.has(r.departmentId)) r.departmentId = null
      return r
    })
    const wardIds = await ids('ward')
    await copy('bed', b.beds, r => {
      if (!wardIds.has(r.wardId)) return null
      if (r.currentPatientId && !patientIds.has(r.currentPatientId)) r.currentPatientId = null
      return r
    })
    const bedIds = await ids('bed')
    await copy('admission', b.admissions, r => {
      if (!patientIds.has(r.patientId)) return null
      if (r.bedId && !bedIds.has(r.bedId)) r.bedId = null
      return r
    })

    // Stage 3 — clinical
    await copy('appointment', b.appointments, r => patientIds.has(r.patientId) ? r : null)
    const apptIds = await ids('appointment')
    await copy('consultation', b.consultations, r => {
      if (!patientIds.has(r.patientId)) return null
      if (r.appointmentId && !apptIds.has(r.appointmentId)) r.appointmentId = null
      return r
    })
    const consultIds = await ids('consultation')

    // Stage 4 — pharmacy
    await copy('pharmacyDrug', b.pharmacyDrugs)
    await copy('prescription', b.prescriptions, r => {
      if (!patientIds.has(r.patientId)) return null
      if (r.consultationId && !consultIds.has(r.consultationId)) r.consultationId = null
      return r
    })
    const prescriptionIds = await ids('prescription')
    await copy('pharmacySale', b.pharmacySales, r => {
      if (r.patientId && !patientIds.has(r.patientId)) r.patientId = null
      if (r.prescriptionId && !prescriptionIds.has(r.prescriptionId)) r.prescriptionId = null
      return r
    })

    // Stage 5 — lab & radiology (catalogs first: testId/examId FKs)
    await copy('labTest', b.labTests)
    const labTestIds = await ids('labTest')
    await copy('radiologyExam', b.radiologyExams)
    const examIds = await ids('radiologyExam')

    await copy('labOrder', b.labOrders, r => {
      if (!patientIds.has(r.patientId)) return null
      if (r.consultationId && !consultIds.has(r.consultationId)) r.consultationId = null
      return r
    })
    const labOrderIds = await ids('labOrder')
    await copy('labResult', b.labResults, r => {
      if (!labOrderIds.has(r.orderId)) return null
      if (!labTestIds.has(r.testId)) return null
      return r
    })
    await copy('radiologyOrder', b.radiologyOrders, r => {
      if (!patientIds.has(r.patientId)) return null
      if (!examIds.has(r.examId)) return null
      if (r.consultationId && !consultIds.has(r.consultationId)) r.consultationId = null
      return r
    })
    const radOrderIds = await ids('radiologyOrder')
    await copy('radiologyReport', b.radiologyReports, r => radOrderIds.has(r.orderId) ? r : null)

    // Stage 6 — billing
    await copy('invoice', b.invoices, r => {
      if (!patientIds.has(r.patientId)) return null
      if (r.consultationId && !consultIds.has(r.consultationId)) r.consultationId = null
      return r
    })
    const invoiceIds = await ids('invoice')
    await copy('payment', b.payments, r => {
      if (!invoiceIds.has(r.invoiceId)) return null
      if (r.patientId && !patientIds.has(r.patientId)) r.patientId = null
      return r
    })

    // Stage 7 — records & commissions
    const userIds = await ids('user')
    await copy('doctorCommissionConfig', b.doctorCommissionConfigs, r => userIds.has(r.doctorId) ? r : null)
    await copy('doctorCommission', b.doctorCommissions, r => {
      if (!userIds.has(r.doctorId)) return null
      if (r.invoiceId && !invoiceIds.has(r.invoiceId)) r.invoiceId = null
      return r
    })

    return res.json({ success: true, results, errors, message: 'Import complete!' })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, results, errors })
  }
}

// POST /api/import/stock-refresh   (header: x-import-secret)
//
// Sets a realistic stock level on every active drug for this org in ONE SQL
// statement, and reports the before/after counts.
//
// This exists as an endpoint rather than a local script because the production
// database accepts no external connections (Render free tier allows no IP
// allowlist), so `update-stocks.js` can only ever reach the LOCAL db. Pushing the
// ~200k drug rows through the row-by-row /import path instead would take about an
// hour. Running the UPDATE server-side — where the DB *is* reachable — is instant.
export async function stockRefresh(req, res) {
  if (!importSecretValid(req.headers['x-import-secret'])) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const orgId = process.env.ORGANIZATION_ID || 'org-demo'
  const min = Math.max(0, Number(req.body?.min ?? 50))
  const max = Math.max(min + 1, Number(req.body?.max ?? 500))
  const span = max - min

  try {
    const [before] = await db.$queryRaw`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "quantityInStock" > 0)::int AS "withStock"
      FROM "PharmacyDrug"
      WHERE "organizationId" = ${orgId} AND "isActive" = true
    `
    const updated = await db.$executeRaw`
      UPDATE "PharmacyDrug"
      SET "quantityInStock" = floor(random() * ${span} + ${min})::int
      WHERE "organizationId" = ${orgId} AND "isActive" = true
    `
    const [after] = await db.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE "quantityInStock" > 0)::int AS "withStock"
      FROM "PharmacyDrug"
      WHERE "organizationId" = ${orgId} AND "isActive" = true
    `
    return res.json({
      success: true,
      orgId,
      drugsTotal: before.total,
      withStockBefore: before.withStock,
      updated,
      withStockAfter: after.withStock,
    })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}
