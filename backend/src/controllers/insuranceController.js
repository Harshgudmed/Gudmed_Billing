import { db } from '../config/db.js'
import { getOrgId, safeMoney } from "../lib/reqContext.js";
import { isOwned } from "../lib/tenant.js";
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'

const patientSelect = { ...PATIENT_NAME_SELECT, mrn: true, phonePrimary: true }

// Statuses that consume the policy's coverage limit.
const CONSUMING = ['approved', 'settled']

function withUsage(insCase) {
  const claims = insCase.claims || []
  const amountUsed = claims
    .filter((c) => CONSUMING.includes(c.status))
    .reduce((sum, c) => sum + (c.approvedAmount ?? c.claimAmount ?? 0), 0)
  const claimsPending = claims.filter((c) => ['pending', 'submitted'].includes(c.status)).length
  return { ...insCase, amountUsed, balance: (insCase.coverageLimit || 0) - amountUsed, claimsPending }
}

async function nextClaimNumber(orgId) {
  const count = await db.insuranceClaim.count({ where: { organizationId: orgId } })
  return `CLM${String(count + 1).padStart(4, '0')}`
}

// ── Cases ────────────────────────────────────────────────────────────────────

async function getCases(req, res, ORG_ID) {
  const { search, payerType, status } = req.query
  const where = { organizationId: ORG_ID }
  if (payerType && payerType !== 'all') where.payerType = payerType
  if (status && status !== 'all') where.status = status
  if (search) {
    where.OR = [
      { insurerName: { contains: search, mode: 'insensitive' } },
      { tpaName: { contains: search, mode: 'insensitive' } },
      { policyNumber: { contains: search, mode: 'insensitive' } },
      { patient: { firstName: { contains: search, mode: 'insensitive' } } },
      { patient: { lastName: { contains: search, mode: 'insensitive' } } },
      { patient: { mrn: { contains: search, mode: 'insensitive' } } },
    ]
  }
  const cases = await db.insuranceCase.findMany({
    where,
    include: {
      patient: { select: patientSelect },
      claims: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const data = cases.map(withUsage)
  const stats = {
    tpaPatients: data.filter((c) => c.payerType === 'TPA').length,
    insurancePatients: data.filter((c) => c.payerType === 'INSURANCE').length,
    claimsPending: data.reduce((sum, c) => sum + c.claimsPending, 0),
  }
  res.json({ success: true, data, stats })
}

async function createCase(req, res, ORG_ID) {
  const { patientId, payerType, insurerName, tpaName, policyNumber, coverageLimit, status, validFrom, validTo, notes } = req.body
  if (!patientId) return res.status(400).json({ success: false, error: 'patientId is required' })
  if (!insurerName) return res.status(400).json({ success: false, error: 'insurerName is required' })
  const patient = await db.patient.findFirst({ where: { id: patientId, organizationId: ORG_ID }, select: { id: true } })
  if (!patient) return res.status(400).json({ success: false, error: 'Patient not found in this organization' })

  const coverageVal = safeMoney(coverageLimit)
  if (coverageVal === null) return res.status(400).json({ success: false, error: 'coverageLimit must be a non-negative number' })

  const insCase = await db.insuranceCase.create({
    data: {
      organizationId: ORG_ID,
      patientId,
      payerType: payerType === 'TPA' ? 'TPA' : 'INSURANCE',
      insurerName,
      tpaName: tpaName || null,
      policyNumber: policyNumber || null,
      coverageLimit: coverageVal,
      status: status || 'Active',
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo: validTo ? new Date(validTo) : null,
      notes: notes || null,
      createdById: req.user?.userId || null,
    },
    include: { patient: { select: patientSelect }, claims: true },
  })
  res.json({ success: true, data: withUsage(insCase) })
}

async function updateCase(req, res, ORG_ID) {
  const { id } = req.body
  if (!id) return res.status(400).json({ success: false, error: 'id is required' })
  // Tenant guard: only touch a case that belongs to this org (no cross-tenant write).
  if (!(await isOwned('insuranceCase', id, ORG_ID))) return res.status(404).json({ success: false, error: 'Insurance case not found' })
  const data = {}
  const allowed = ['insurerName', 'tpaName', 'policyNumber', 'status', 'notes']
  for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || null
  if (req.body.payerType !== undefined) data.payerType = req.body.payerType === 'TPA' ? 'TPA' : 'INSURANCE'
  if (req.body.coverageLimit !== undefined) {
    const v = safeMoney(req.body.coverageLimit)
    if (v === null) return res.status(400).json({ success: false, error: 'coverageLimit must be a non-negative number' })
    data.coverageLimit = v
  }
  if (req.body.validFrom !== undefined) data.validFrom = req.body.validFrom ? new Date(req.body.validFrom) : null
  if (req.body.validTo !== undefined) data.validTo = req.body.validTo ? new Date(req.body.validTo) : null

  const insCase = await db.insuranceCase.update({
    where: { id },
    data,
    include: { patient: { select: patientSelect }, claims: { orderBy: { createdAt: 'desc' } } },
  })
  res.json({ success: true, data: withUsage(insCase) })
}

// ── Claims ───────────────────────────────────────────────────────────────────

async function createClaim(req, res, ORG_ID) {
  const { caseId, claimAmount, approvedAmount, status, diagnosis, remarks } = req.body
  if (!caseId) return res.status(400).json({ success: false, error: 'caseId is required' })
  const insCase = await db.insuranceCase.findFirst({ where: { id: caseId, organizationId: ORG_ID }, select: { id: true } })
  if (!insCase) return res.status(400).json({ success: false, error: 'Insurance case not found' })

  const claimVal = safeMoney(claimAmount)
  const approvedVal = (approvedAmount == null || approvedAmount === '') ? null : safeMoney(approvedAmount)
  if (claimVal === null || approvedVal === null && !(approvedAmount == null || approvedAmount === ''))
    return res.status(400).json({ success: false, error: 'claimAmount / approvedAmount must be non-negative numbers' })

  const st = status || 'pending'
  const claim = await db.insuranceClaim.create({
    data: {
      organizationId: ORG_ID,
      caseId,
      claimNumber: await nextClaimNumber(ORG_ID),
      claimAmount: claimVal,
      approvedAmount: approvedVal,
      status: st,
      diagnosis: diagnosis || null,
      remarks: remarks || null,
      submittedAt: ['submitted', 'approved', 'rejected', 'settled'].includes(st) ? new Date() : null,
      settledAt: st === 'settled' ? new Date() : null,
      createdById: req.user?.userId || null,
    },
  })
  res.json({ success: true, data: claim })
}

async function updateClaim(req, res, ORG_ID) {
  const { id } = req.body
  if (!id) return res.status(400).json({ success: false, error: 'id is required' })
  // Tenant guard: only touch a claim that belongs to this org (blocks cross-tenant
  // tampering with claimAmount / approvedAmount / status).
  if (!(await isOwned('insuranceClaim', id, ORG_ID))) return res.status(404).json({ success: false, error: 'Insurance claim not found' })
  const data = {}
  if (req.body.diagnosis !== undefined) data.diagnosis = req.body.diagnosis || null
  if (req.body.remarks !== undefined) data.remarks = req.body.remarks || null
  if (req.body.claimAmount !== undefined) {
    const v = safeMoney(req.body.claimAmount)
    if (v === null) return res.status(400).json({ success: false, error: 'claimAmount must be a non-negative number' })
    data.claimAmount = v
  }
  if (req.body.approvedAmount !== undefined) {
    if (req.body.approvedAmount === '' || req.body.approvedAmount == null) {
      data.approvedAmount = null
    } else {
      const v = safeMoney(req.body.approvedAmount)
      if (v === null) return res.status(400).json({ success: false, error: 'approvedAmount must be a non-negative number' })
      data.approvedAmount = v
    }
  }
  if (req.body.status !== undefined) {
    data.status = req.body.status
    if (['submitted', 'approved', 'rejected', 'settled'].includes(req.body.status)) data.submittedAt = new Date()
    if (req.body.status === 'settled') data.settledAt = new Date()
  }
  const claim = await db.insuranceClaim.update({ where: { id }, data })
  res.json({ success: true, data: claim })
}

// ── Dispatchers (resource-based) ───────────────────────────────────────────────

export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    return getCases(req, res, ORG_ID) // only cases are listed (claims come nested)
  } catch (err) { next(err) }
}

export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (req.query.resource === 'claims') return createClaim(req, res, ORG_ID)
    return createCase(req, res, ORG_ID)
  } catch (err) { next(err) }
}

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (req.query.resource === 'claims') return updateClaim(req, res, ORG_ID)
    return updateCase(req, res, ORG_ID)
  } catch (err) { next(err) }
}

export async function remove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id, resource } = req.query
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })
    // Tenant-scoped delete: the org filter ensures we can only delete OUR rows.
    const { count } = resource === 'claims'
      ? await db.insuranceClaim.deleteMany({ where: { id, organizationId: ORG_ID } })
      : await db.insuranceCase.deleteMany({ where: { id, organizationId: ORG_ID } }) // claims cascade
    if (count === 0) return res.status(404).json({ success: false, error: 'Not found' })
    res.json({ success: true })
  } catch (err) { next(err) }
}
