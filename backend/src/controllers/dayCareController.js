import { db } from '../config/db.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { patientSearchWhere } from '../lib/patientSearch.js'
import { dayRange, todayRange } from '../lib/dates.js'
import { getOrgId, safeMoney } from "../lib/reqContext.js";
import { isOwned } from "../lib/tenant.js";
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'
import { billsOfRecords, invoiceOfOrder, orderCancelCheck, changeRecordCharge, withBill, refusalError } from '../lib/invoiceFulfillment.js'

const patientSelect = { ...PATIENT_NAME_SELECT, mrn: true, phonePrimary: true }
const caseInclude = {
  patient: { select: patientSelect },
  doctor: { select: { id: true, fullName: true } },
}

// A case's money is taken on its bill in Billing (the screen raises it with
// src/lib/billing.js createInvoiceWithPayment). A figure stored on the case
// itself was a second ledger that Billing, revenue and the patient's bills
// never saw — so the case no longer accepts one.
const MONEY_ON_BILL = 'Money for a day-care case is taken on its bill — save the case, then collect on its bill (here or in Billing).'

export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { search, status, paymentStatus, startDate, endDate } = req.query
    const where = { organizationId: ORG_ID }
    if (status && status !== 'all') where.status = status
    // Hospital-timezone day boundaries (see lib/dates.js) — the server's own
    // timezone must not decide where a day starts.
    if (startDate || endDate) {
      where.admissionDate = dayRange(startDate, endDate)
    } else if (req.query.today === 'true') {
      where.admissionDate = todayRange()
    }
    const searchWhere = patientSearchWhere(search, 'patient', (term) => [
      { caseNumber: { contains: term, mode: 'insensitive' } }, // the ID column (DC0002 / DAY-2026-27-…)
      { procedure: { contains: term, mode: 'insensitive' } },
      { notes: { contains: term, mode: 'insensitive' } },
    ])
    if (searchWhere) Object.assign(where, searchWhere)
    const cases = await db.dayCareCase.findMany({
      where,
      include: caseInclude,
      orderBy: { admissionDate: 'desc' },
    })
    const bills = await billsOfRecords(db, ORG_ID, 'daycare', cases.map((c) => c.caseNumber))
    let rows = cases.map((c) => withBill(c, bills.get(c.caseNumber)))
    // The payment status is the bill's, so it is known only after the bills are
    // read. This list is not paged (it never was); filtering the rows already
    // read gives the same answer the database would.
    if (paymentStatus && paymentStatus !== 'all') rows = rows.filter((r) => r.paymentStatus === paymentStatus)
    res.json({ success: true, data: rows })
  } catch (err) {
    next(err)
  }
}

// Payment status of a case with no bill (one from before the sync, or a fee of
// 0) — derived from its stored figures, never trusted from the client.
function derivePaymentStatus(fee, paid) {
  if (fee <= 0) return 'paid'      // nothing to pay
  if (paid <= 0) return 'pending'
  return paid >= fee ? 'paid' : 'partial'
}

export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const {
      patientId, doctorId, procedure, admissionDate, dischargeTime,
      fee, amountPaid, status, notes,
    } = req.body

    if (!patientId) return res.status(400).json({ success: false, error: 'patientId is required' })
    const patient = await db.patient.findFirst({ where: { id: patientId, organizationId: ORG_ID }, select: { id: true } })
    if (!patient) return res.status(400).json({ success: false, error: 'Patient not found in this organization' })

    // Snapshot the doctor name; only link the FK if the user exists in this org.
    let safeDoctorId = null
    let doctorName = req.body.doctorName || null
    if (doctorId) {
      const doc = await db.user.findFirst({ where: { id: doctorId, organizationId: ORG_ID }, select: { id: true, fullName: true } })
      if (doc) { safeDoctorId = doc.id; doctorName = doc.fullName }
    }

    // Reject negative / NaN money before it poisons stored totals.
    const feeVal = safeMoney(fee)
    if (feeVal === null) return res.status(400).json({ success: false, error: 'fee must be a non-negative number' })
    if (Number(amountPaid) > 0) return res.status(400).json({ success: false, error: MONEY_ON_BILL })

    const dayCase = await db.$transaction(async (tx) => {
      // Prefix is 'DAY', not 'DC': death certificates already own the 'DC-' prefix,
      // and a number must identify which kind of record it belongs to. The series
      // key stays 'DAYCARE_CASE' so the existing counter does not restart.
      const caseNumber = await nextSeriesNumber(tx, ORG_ID, 'DAYCARE_CASE', 'DAY')
      return tx.dayCareCase.create({
        data: {
          organizationId: ORG_ID,
          caseNumber,
        patientId,
        doctorId: safeDoctorId,
        doctorName,
        procedure: procedure || null,
        admissionDate: admissionDate ? new Date(admissionDate) : new Date(),
        dischargeTime: dischargeTime || null,
        fee: feeVal,
        paymentStatus: derivePaymentStatus(feeVal, 0),
        amountPaid: 0,
        status: status || 'admitted',
        notes: notes || null,
        createdById: req.user?.userId || null,
        },
        include: caseInclude,
      })
    })
    res.json({ success: true, data: withBill(dayCase, null) })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.body
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })

    // Tenant guard: only touch a case that belongs to this org (no cross-tenant write).
    const existing = await db.dayCareCase.findFirst({ where: { id, organizationId: ORG_ID }, select: { fee: true, amountPaid: true, caseNumber: true, status: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Day-care case not found' })
    if (Number(req.body.amountPaid) > 0) return res.status(400).json({ success: false, error: MONEY_ON_BILL })

    const data = {}
    // paymentStatus is intentionally NOT client-settable — it is the bill's.
    const allowed = ['procedure', 'dischargeTime', 'status', 'notes']
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || null
    if (req.body.fee !== undefined) {
      const v = safeMoney(req.body.fee)
      if (v === null) return res.status(400).json({ success: false, error: 'fee must be a non-negative number' })
      // A case from before the sync keeps what it recorded as paid.
      const paidBefore = Number(existing.amountPaid) || 0
      if (v < paidBefore) return res.status(400).json({ success: false, error: `₹${paidBefore} was already paid on this case — the fee cannot be less than that` })
      data.fee = v
      data.paymentStatus = derivePaymentStatus(v, paidBefore)
    }
    if (req.body.admissionDate !== undefined) data.admissionDate = new Date(req.body.admissionDate)
    if (req.body.doctorId !== undefined) {
      let safeDoctorId = null, doctorName = null
      if (req.body.doctorId) {
        const doc = await db.user.findFirst({ where: { id: req.body.doctorId, organizationId: ORG_ID }, select: { id: true, fullName: true } })
        if (doc) { safeDoctorId = doc.id; doctorName = doc.fullName }
      }
      data.doctorId = safeDoctorId
      data.doctorName = doctorName
    }

    const cancelling = data.status === 'cancelled' && existing.status !== 'cancelled'
    const reopening = existing.status === 'cancelled' && data.status && data.status !== 'cancelled'
    const feeChanged = data.fee !== undefined && data.fee !== Number(existing.fee)
    const result = await db.$transaction(async (tx) => {
      // Its bill went with the cancellation and one case has one bill, so a
      // billed case does not come back to life with nothing to pay on.
      if (reopening && await invoiceOfOrder(tx, ORG_ID, 'daycare', existing.caseNumber)) {
        throw refusalError({ title: 'Cancelled', error: 'This case was cancelled together with its bill. Register a new day-care case instead.' })
      }
      if (cancelling) {
        // The lab order's rule (lib/invoiceFulfillment.js orderCancelCheck):
        // money taken → refused, Billing's "Cancel & refund" gives it back; an
        // unpaid bill is cancelled with the case, or the patient is still asked to pay.
        const check = await orderCancelCheck(tx, ORG_ID, 'daycare', existing.caseNumber)
        if (check.refusal) throw refusalError(check.refusal)
        if (check.cancelBill) {
          await tx.invoice.updateMany({
            where: { id: check.cancelBill.id, organizationId: ORG_ID, amountPaid: { lte: 0 }, status: { not: 'cancelled' } },
            data: { status: 'cancelled', paymentStatus: 'cancelled', cancelledAt: new Date(), cancellationReason: `Day-care case ${existing.caseNumber} cancelled` },
          })
        }
      } else if (feeChanged) {
        const change = await changeRecordCharge(tx, { organizationId: ORG_ID, kind: 'daycare', number: existing.caseNumber, charge: data.fee })
        if (change.refusal) throw refusalError(change.refusal)
      }
      const dayCase = await tx.dayCareCase.update({ where: { id }, data, include: caseInclude })
      return withBill(dayCase, await invoiceOfOrder(tx, ORG_ID, 'daycare', existing.caseNumber))
    })
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.query
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })
    const existing = await db.dayCareCase.findFirst({ where: { id, organizationId: ORG_ID }, select: { caseNumber: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Day-care case not found' })
    // A billed case is not deleted out from under its bill (the bill would
    // stand for a case that no longer exists). It is cancelled instead.
    const bill = await invoiceOfOrder(db, ORG_ID, 'daycare', existing.caseNumber)
    if (bill && bill.status !== 'cancelled') {
      return res.status(409).json({ success: false, error: `This case is billed on ${bill.invoiceNumber}. Set it to Cancelled instead — an unpaid bill is cancelled with it; a paid one is cancelled in Billing with "Cancel & refund".` })
    }
    const { count } = await db.dayCareCase.deleteMany({ where: { id, organizationId: ORG_ID } })
    if (count === 0) return res.status(404).json({ success: false, error: 'Day-care case not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}
