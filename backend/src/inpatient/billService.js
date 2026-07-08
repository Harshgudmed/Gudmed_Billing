// Phase 1 IPD billing — persisted, numbered, immutable bills.
// One-to-many per admission; at most one open DRAFT (DB partial-unique enforced).
// A FINAL bill is never mutated; corrections use cancel-and-reissue / supplementary.
import { db } from '../config/db.js'
import { computeRunningBill } from './tariffService.js'
import { recalcBill, ensureLegacyDepositAdvance } from './billPaymentService.js'

const round2 = (n) => Math.round((n || 0) * 100) / 100

// Indian financial year for a date: Apr 1 → Mar 31 → "2026-27"
export function financialYear(d = new Date()) {
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1 // month 3 = April (0-indexed)
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

// The "current" bill for an admission: the open DRAFT if any, else the latest.
export async function getCurrentBill(organizationId, admissionId) {
  const draft = await db.bill.findFirst({
    where: { organizationId, admissionId, status: 'DRAFT' },
    include: { charges: { where: { status: 'ACTIVE' }, orderBy: { serviceDate: 'asc' } } },
  })
  if (draft) return draft
  return db.bill.findFirst({
    where: { organizationId, admissionId },
    orderBy: { createdAt: 'desc' },
    include: { charges: { orderBy: { serviceDate: 'asc' } } },
  })
}

// Create/refresh the open DRAFT bill: link unbilled ACTIVE charges, snapshot totals
// from the live running-bill computation. Never touches FINAL bills.
export async function generateBill(organizationId, admissionId, userId) {
  const live = await computeRunningBill(organizationId, admissionId)

  return db.$transaction(async (tx) => {
    let bill = await tx.bill.findFirst({ where: { organizationId, admissionId, status: 'DRAFT' } })
    if (!bill) {
      bill = await tx.bill.create({
        data: { organizationId, admissionId, status: 'DRAFT', createdById: userId || null },
      })
    }
    // Attach any ACTIVE charges not yet linked to a bill.
    await tx.ipdCharge.updateMany({
      where: { organizationId, admissionId, status: 'ACTIVE', billId: null },
      data: { billId: bill.id },
    })
    // Re-attach any floating SUCCESS payments (e.g. carried over from a cancelled bill).
    await tx.billPayment.updateMany({
      where: { organizationId, admissionId, status: 'SUCCESS', billId: null },
      data: { billId: bill.id },
    })
    // Migrate a legacy admission deposit into an ADVANCE ledger entry (once).
    await ensureLegacyDepositAdvance(tx, organizationId, admissionId, bill.id)
    // Snapshot totals from the live computation (bed + services + tax).
    const depositTotal = (await tx.admission.findUnique({ where: { id: admissionId }, select: { depositAmount: true } }))?.depositAmount || 0
    await tx.bill.update({
      where: { id: bill.id },
      data: {
        bedTotal: round2(live.bedCharges.total),
        serviceTotal: round2(live.serviceCharges.total),
        subtotal: round2(live.subtotal),
        taxTotal: round2(live.taxTotal),
        depositTotal: round2(depositTotal),
        payableTotal: round2(live.grandTotal),
      },
    })
    // Recompute paid/balance from the (now linked) ledger entries.
    await recalcBill(tx, bill.id)
    return tx.bill.findUnique({ where: { id: bill.id }, include: { charges: { where: { status: 'ACTIVE' }, orderBy: { serviceDate: 'asc' } }, payments: { where: { status: 'SUCCESS' }, orderBy: { paidAt: 'asc' } } } })
  })
}

// Finalize the open DRAFT: assign a per-org/FY number atomically, freeze, set FINAL.
export async function finalizeBill(organizationId, admissionId, { userId, billType = 'FINAL' } = {}) {
  // Refresh totals first (so the frozen snapshot is current).
  await generateBill(organizationId, admissionId, userId)
  const year = financialYear()

  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { organizationId, admissionId, status: 'DRAFT' } })
    if (!bill) throw Object.assign(new Error('No open draft bill to finalize'), { status: 409 })

    // Reconcile the counter with the REAL max IPD bill for this org+year before
    // incrementing. After a data migration the bills get copied but the BillCounter
    // does not, so it lags and the generated IPD-<FY>-NNNNNN collides on the unique
    // billNumber (P2002), and the failed tx rolls back the increment → deadlock.
    // (Same class as the OPD invoice-number fix.) Numbers are zero-padded, so
    // lexicographic DESC == numeric order → top row is the true max.
    const prefix = `IPD-${year}-`
    const lastBill = await tx.bill.findFirst({
      where: { organizationId, billNumber: { startsWith: prefix } },
      orderBy: { billNumber: 'desc' },
      select: { billNumber: true },
    })
    const lastSeq = lastBill ? (parseInt(lastBill.billNumber.slice(prefix.length), 10) || 0) : 0

    await tx.billCounter.upsert({
      where: { organizationId_series_year: { organizationId, series: 'IPD', year } },
      create: { organizationId, series: 'IPD', year, value: lastSeq },
      update: {},
    })
    const counter = await tx.billCounter.update({
      where: { organizationId_series_year: { organizationId, series: 'IPD', year } },
      data: { value: { increment: 1 } },
    })
    // If the counter had lagged behind migrated bills, jump past the real max.
    let seq = counter.value
    if (seq <= lastSeq) {
      const fixed = await tx.billCounter.update({
        where: { organizationId_series_year: { organizationId, series: 'IPD', year } },
        data: { value: lastSeq + 1 },
      })
      seq = fixed.value
    }
    const billNumber = `${prefix}${String(seq).padStart(6, '0')}`

    return tx.bill.update({
      where: { id: bill.id },
      data: { status: 'FINAL', billType, billNumber, finalizedAt: new Date() },
      include: { charges: { where: { status: 'ACTIVE' }, orderBy: { serviceDate: 'asc' } } },
    })
  })
}

// Void a bill (FINAL or DRAFT) audit-safely: status=CANCELLED, release its ACTIVE
// charges back to unlinked so a corrected bill can be regenerated. Never deletes.
export async function cancelBill(organizationId, billId, { reason } = {}) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id: billId, organizationId } })
    if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 })
    if (bill.status === 'CANCELLED') throw Object.assign(new Error('Bill already cancelled'), { status: 409 })
    // Release still-ACTIVE charges so they can be re-billed on a new draft.
    await tx.ipdCharge.updateMany({
      where: { billId, organizationId, status: 'ACTIVE' },
      data: { billId: null },
    })
    // Carry SUCCESS payments forward: detach (float to admission) → re-link on next generate.
    await tx.billPayment.updateMany({
      where: { billId, organizationId, status: 'SUCCESS' },
      data: { billId: null },
    })
    return tx.bill.update({ where: { id: billId }, data: { status: 'CANCELLED', cancelReason: reason || null, paidTotal: 0, balanceDue: 0, paymentStatus: 'UNPAID' } })
  })
}

// Cancel / mark-returned a single charge (audit-safe; never deletes). Refuses if the
// charge sits on a FINAL bill (must cancel-and-reissue that bill instead).
export async function cancelCharge(organizationId, chargeId, { status = 'CANCELLED', reason, userId } = {}) {
  const charge = await db.ipdCharge.findFirst({ where: { id: chargeId, organizationId }, include: { bill: true } })
  if (!charge) throw Object.assign(new Error('Charge not found'), { status: 404 })
  if (charge.bill && charge.bill.status === 'FINAL') {
    throw Object.assign(new Error('Charge is on a FINAL bill — cancel & reissue the bill instead'), { status: 409, code: 'IPD_CHARGE_ON_FINAL_BILL' })
  }
  return db.ipdCharge.update({
    where: { id: chargeId },
    data: { status, cancelReason: reason || null, cancelledById: userId || null, cancelledAt: new Date(), billId: null },
  })
}
