import { db } from '../config/db.js'
import { getOrgId, safeMoney } from "../lib/reqContext.js";
import { isOwned } from "../lib/tenant.js";
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'

const patientSelect = { ...PATIENT_NAME_SELECT, mrn: true, phonePrimary: true }

// Statuses that consume the policy's coverage limit.
const CONSUMING = ['approved', 'settled']

// The only valid claim statuses. Anything outside this set is junk and rejected
// with 400 (previously any string was stored verbatim).
const CLAIM_STATUSES = ['pending', 'submitted', 'approved', 'rejected', 'settled']

// A claim's effective consumption against coverage — mirrors withUsage: the
// approved amount once known, otherwise the claimed amount.
function effectiveAmount(claim) {
  return claim.approvedAmount ?? claim.claimAmount ?? 0
}

// Money-safety guard: block a CONSUMING (approved/settled) claim from pushing a
// case's total usage past its coverageLimit (which would drive `balance`
// unboundedly negative). Sums the effective amount of OTHER consuming claims on
// the case and rejects if adding this one exceeds the limit.
// coverageLimit of 0/null is treated as NO coverage (limit 0), consistent with
// withUsage's `coverageLimit || 0`, so any positive consuming amount is rejected —
// the safer reading for money safety. Returns an error string or null.
async function coverageError(caseId, orgId, newStatus, effAmount, excludeClaimId) {
  if (!CONSUMING.includes(newStatus)) return null
  const insCase = await db.insuranceCase.findFirst({
    where: { id: caseId, organizationId: orgId },
    select: {
      coverageLimit: true,
      claims: {
        where: excludeClaimId ? { id: { not: excludeClaimId } } : undefined,
        select: { status: true, claimAmount: true, approvedAmount: true },
      },
    },
  })
  if (!insCase) return null // case-existence is validated separately by the caller
  const limit = insCase.coverageLimit || 0
  const consumed = insCase.claims
    .filter((c) => CONSUMING.includes(c.status))
    .reduce((sum, c) => sum + effectiveAmount(c), 0)
  if (consumed + effAmount > limit) {
    return `Claim exceeds coverage limit: already consumed ${consumed} of ${limit}, this claim would add ${effAmount}`
  }
  return null
}

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

// Optional date field → { ok, value }: absent/empty is null; a valid string is
// a Date; anything unparseable is `ok:false` so the caller returns a clean 400.
// A bare `new Date("not-a-date")` is a truthy Invalid Date — handing that to
// Prisma threw, and (before the awaits above) killed the whole process.
function parseOptionalDate(v) {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return { ok: false }
  return { ok: true, value: d }
}

async function createCase(req, res, ORG_ID) {
  const { patientId, payerType, insurerName, tpaName, policyNumber, coverageLimit, status, validFrom, validTo, notes } = req.body
  if (!patientId) return res.status(400).json({ success: false, error: 'patientId is required' })
  if (!insurerName) return res.status(400).json({ success: false, error: 'insurerName is required' })
  const patient = await db.patient.findFirst({ where: { id: patientId, organizationId: ORG_ID }, select: { id: true } })
  if (!patient) return res.status(400).json({ success: false, error: 'Patient not found in this organization' })

  const coverageVal = safeMoney(coverageLimit)
  if (coverageVal === null) return res.status(400).json({ success: false, error: 'coverageLimit must be a non-negative number' })

  const vf = parseOptionalDate(validFrom)
  if (!vf.ok) return res.status(400).json({ success: false, error: 'validFrom is not a valid date' })
  const vt = parseOptionalDate(validTo)
  if (!vt.ok) return res.status(400).json({ success: false, error: 'validTo is not a valid date' })

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
      validFrom: vf.value,
      validTo: vt.value,
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
  if (req.body.validFrom !== undefined) {
    const vf = parseOptionalDate(req.body.validFrom)
    if (!vf.ok) return res.status(400).json({ success: false, error: 'validFrom is not a valid date' })
    data.validFrom = vf.value
  }
  if (req.body.validTo !== undefined) {
    const vt = parseOptionalDate(req.body.validTo)
    if (!vt.ok) return res.status(400).json({ success: false, error: 'validTo is not a valid date' })
    data.validTo = vt.value
  }

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
  if (!CLAIM_STATUSES.includes(st))
    return res.status(400).json({ success: false, error: `status must be one of: ${CLAIM_STATUSES.join(', ')}` })

  // Money-safety: a new approved/settled claim must not overrun the case coverage.
  const covErr = await coverageError(caseId, ORG_ID, st, approvedVal ?? claimVal ?? 0, null)
  if (covErr) return res.status(400).json({ success: false, error: covErr })

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
  // tampering with claimAmount / approvedAmount / status). Fetch its current
  // values too, so we can validate the RESULT of the edit against coverage.
  const existing = await db.insuranceClaim.findFirst({
    where: { id, organizationId: ORG_ID },
    select: { id: true, caseId: true, status: true, claimAmount: true, approvedAmount: true },
  })
  if (!existing) return res.status(404).json({ success: false, error: 'Insurance claim not found' })
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
    if (!CLAIM_STATUSES.includes(req.body.status))
      return res.status(400).json({ success: false, error: `status must be one of: ${CLAIM_STATUSES.join(', ')}` })
    data.status = req.body.status
    if (['submitted', 'approved', 'rejected', 'settled'].includes(req.body.status)) data.submittedAt = new Date()
    if (req.body.status === 'settled') data.settledAt = new Date()
  }

  // Money-safety: validate the claim's RESULTING state (post-edit status +
  // amounts) against the case coverage, excluding THIS claim from the already-
  // consumed sum so an in-place edit doesn't double-count itself.
  const resultStatus = data.status ?? existing.status
  const resultClaimAmount = data.claimAmount ?? existing.claimAmount
  const resultApprovedAmount = 'approvedAmount' in data ? data.approvedAmount : existing.approvedAmount
  const effAmount = resultApprovedAmount ?? resultClaimAmount ?? 0
  const covErr = await coverageError(existing.caseId, ORG_ID, resultStatus, effAmount, existing.id)
  if (covErr) return res.status(400).json({ success: false, error: covErr })

  const claim = await db.insuranceClaim.update({ where: { id }, data })
  res.json({ success: true, data: claim })
}

// ── Dispatchers (resource-based) ───────────────────────────────────────────────

// NOTE the `await` on every delegate below. Without it, an async rejection in
// createCase/updateCase (e.g. a bad date reaching Prisma) escaped this try/catch,
// became an unhandledRejection, and — with no process-level handler — KILLED the
// whole Node process, taking the entire API down for every tenant. Awaiting the
// delegate keeps its errors inside the try, so they become a clean 500 (or the
// 400 the date guard now returns) instead of a crash.
export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    return await getCases(req, res, ORG_ID) // only cases are listed (claims come nested)
  } catch (err) { next(err) }
}

export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (req.query.resource === 'claims') return await createClaim(req, res, ORG_ID)
    return await createCase(req, res, ORG_ID)
  } catch (err) { next(err) }
}

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (req.query.resource === 'claims') return await updateClaim(req, res, ORG_ID)
    return await updateCase(req, res, ORG_ID)
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
