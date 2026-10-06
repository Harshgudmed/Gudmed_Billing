// Phase 2 — IPD payment ledger. Signed, immutable, numbered receipts.
// paidTotal/balanceDue are recomputed on the Bill from its SUCCESS payments.
import { db } from '../config/db.js'
import { dayRange } from '../lib/dates.js'
import { financialYear, round2, formatRupee } from '../lib/money.js'
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE']
// What may be collected here. A REFUND is its own entry (refund() below), never
// a positive "payment" of type REFUND.
const COLLECT_TYPES = ['PAYMENT', 'ADVANCE']
const PAISA = 0.005

// The bill row, locked for the rest of the transaction: two collections or
// refunds at once take turns, so each is checked against the true balance.
function lockBill(tx, organizationId, billId) {
  return tx.$executeRaw`SELECT 1 FROM "Bill" WHERE "id" = ${billId} AND "organizationId" = ${organizationId} FOR UPDATE`
}

// Recompute Bill.paidTotal/balanceDue/paymentStatus from its SUCCESS payments. Call inside a tx.
export async function recalcBill(tx, billId) {
  const bill = await tx.bill.findUnique({ where: { id: billId }, select: { payableTotal: true } })
  if (!bill) return
  const agg = await tx.billPayment.aggregate({
    where: { billId, status: 'SUCCESS' }, _sum: { amount: true },
  })
  const paid = round2(agg._sum.amount || 0)
  const balance = round2(bill.payableTotal - paid)
  const hasRefund = (await tx.billPayment.count({ where: { billId, status: 'SUCCESS', type: 'REFUND' } })) > 0
  let paymentStatus = 'UNPAID'
  if (balance <= 0 && paid > 0) paymentStatus = hasRefund && paid < bill.payableTotal ? 'REFUNDED' : 'PAID'
  else if (paid > 0) paymentStatus = 'PARTIAL'
  await tx.bill.update({ where: { id: billId }, data: { paidTotal: paid, balanceDue: balance, paymentStatus } })
  return { paidTotal: paid, balanceDue: balance, paymentStatus }
}

// Atomic per-org/FY receipt number (RCP-2026-27-000001).
async function nextReceiptNumber(tx, organizationId) {
  const year = financialYear()
  await tx.billCounter.upsert({
    where: { organizationId_series_year: { organizationId, series: 'RCP', year } },
    create: { organizationId, series: 'RCP', year, value: 0 },
    update: {},
  })
  const c = await tx.billCounter.update({
    where: { organizationId_series_year: { organizationId, series: 'RCP', year } },
    data: { value: { increment: 1 } },
  })
  return `RCP-${year}-${String(c.value).padStart(6, '0')}`
}

// Collect a payment (or ADVANCE). Idempotent on idempotencyKey.
export async function collectPayment(organizationId, { billId, amount, method, reference, type = 'PAYMENT', note, idempotencyKey, userId, userName }) {
  if (!billId) throw Object.assign(new Error('billId required'), { status: 400 })
  const amt = round2(amount)
  if (!(amt > 0)) throw Object.assign(new Error('amount must be > 0'), { status: 400 })
  if (!METHODS.includes(method)) throw Object.assign(new Error(`method must be one of ${METHODS.join(', ')}`), { status: 400 })
  if (!COLLECT_TYPES.includes(type)) throw Object.assign(new Error(`type must be one of ${COLLECT_TYPES.join(', ')}`), { status: 400 })

  if (idempotencyKey) {
    const dup = await db.billPayment.findFirst({ where: { organizationId, idempotencyKey } }).catch(() => null)
    if (dup) return { payment: dup, deduped: true }
  }
  const bill = await db.bill.findFirst({ where: { id: billId, organizationId }, select: { id: true, admissionId: true, status: true } })
  if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 })
  if (bill.status === 'CANCELLED') throw Object.assign(new Error('Cannot collect against a cancelled bill'), { status: 409 })

  return db.$transaction(async (tx) => {
    await lockBill(tx, organizationId, billId)
    // A payment settles what is due, no more: ₹7,001 against ₹2,001 due was
    // taken and then shown as "Refund Due ₹5,000". Money taken ahead of the
    // charges is an ADVANCE, which is what that type is for.
    if (type === 'PAYMENT') {
      const { balanceDue } = await recalcBill(tx, billId)
      if (!(balanceDue > PAISA)) throw Object.assign(new Error('Nothing is due on this bill'), { status: 409 })
      if (amt > balanceDue + PAISA) throw Object.assign(new Error(`${formatRupee(amt)} is more than the ${formatRupee(balanceDue)} due on this bill — collect ${formatRupee(balanceDue)}`), { status: 400 })
    }
    const receiptNumber = await nextReceiptNumber(tx, organizationId)
    const payment = await tx.billPayment.create({
      data: {
        organizationId, billId, admissionId: bill.admissionId, receiptNumber,
        type, amount: amt, method, reference: reference || null, note: note || null,
        idempotencyKey: idempotencyKey || null, status: 'SUCCESS',
        receivedById: userId || null, receivedByName: userName || null,
      },
    })
    const totals = await recalcBill(tx, billId)
    return { payment, totals }
  })
}

// Void a payment (audit-safe; never deletes). Recomputes balance.
export async function voidPayment(organizationId, paymentId, { reason } = {}) {
  const p = await db.billPayment.findFirst({ where: { id: paymentId, organizationId } })
  if (!p) throw Object.assign(new Error('Payment not found'), { status: 404 })
  if (p.status === 'VOID') throw Object.assign(new Error('Already void'), { status: 409 })
  // A refund request is Finance's to decide; voiding it at the desk would
  // take the decision away from them.
  if (p.status === 'PENDING_APPROVAL') throw Object.assign(new Error('This refund is waiting for approval — Finance approves or rejects it in Billing › Refund Approvals'), { status: 409 })
  if (p.status !== 'SUCCESS') throw Object.assign(new Error('Only a completed receipt can be voided'), { status: 409 })
  return db.$transaction(async (tx) => {
    const voided = await tx.billPayment.update({ where: { id: paymentId }, data: { status: 'VOID', voidReason: reason || null } })
    if (p.billId) await recalcBill(tx, p.billId)
    return voided
  })
}

// Refund requests still waiting for Finance, as a positive sum. They move no
// money, but they hold their amount: two requests may not promise the same rupee.
async function pendingRefundTotal(tx, billId) {
  const agg = await tx.billPayment.aggregate({ where: { billId, type: 'REFUND', status: 'PENDING_APPROVAL' }, _sum: { amount: true } })
  return round2(-(agg._sum.amount || 0))
}

// Refund — a signed-negative ledger entry against the bill. (Credit Note linkage in Phase 3.)
//
// `needsApproval` comes from the hospital's refund setting (lib/refundPolicy.js),
// read by the caller from the organisation — never from the request. With it the
// entry is written PENDING_APPROVAL, without a receipt number, and leaves the
// bill's totals alone (recalcBill counts SUCCESS only) until decideRefund().
export async function refund(organizationId, { billId, amount, reason, method = 'CASH', userId, userName, needsApproval = false }) {
  const amt = round2(amount)
  if (!(amt > 0)) throw Object.assign(new Error('refund amount must be > 0'), { status: 400 })
  if (!METHODS.includes(method)) throw Object.assign(new Error(`method must be one of ${METHODS.join(', ')}`), { status: 400 })
  const bill = await db.bill.findFirst({ where: { id: billId, organizationId }, select: { id: true, admissionId: true, status: true } })
  if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 })
  if (bill.status === 'CANCELLED') throw Object.assign(new Error('This bill was cancelled — raise the refund on the current bill'), { status: 409 })
  return db.$transaction(async (tx) => {
    await lockBill(tx, organizationId, billId)
    // Only money actually held can go back: ₹99,999 was refunded against
    // ₹2,300 collected, leaving the bill "paid" −₹97,698. Requests already
    // waiting for approval hold their share.
    const { paidTotal } = await recalcBill(tx, billId)
    const pending = await pendingRefundTotal(tx, billId)
    const refundable = round2(paidTotal - pending)
    if (amt > refundable + PAISA) {
      const held = pending > PAISA ? ` (${formatRupee(pending)} is already waiting for approval)` : ''
      throw Object.assign(new Error(refundable > PAISA ? `Only ${formatRupee(refundable)} can be refunded on this bill${held} — the refund cannot be more` : `Nothing is left to refund on this bill${held}`), { status: 400 })
    }
    const receiptNumber = needsApproval ? null : await nextReceiptNumber(tx, organizationId)
    const payment = await tx.billPayment.create({
      data: {
        organizationId, billId, admissionId: bill.admissionId, receiptNumber,
        type: 'REFUND', amount: -amt, method, reference: null, note: reason || null,
        status: needsApproval ? 'PENDING_APPROVAL' : 'SUCCESS',
        receivedById: userId || null, receivedByName: userName || null,
      },
    })
    const totals = await recalcBill(tx, billId)
    return { payment, totals }
  })
}

// Finance's decision on a refund request. APPROVE pays it out: receipt number,
// SUCCESS, paidAt = now (the day the money left), bill totals recomputed — all
// under the bill's row lock, re-checked against what is collected now. REJECT
// releases what it held. The status is re-read under the lock, so of two
// decisions at once exactly one acts and the other gets a 409.
//
// `selfProblem(requestedById)` returns why this person may not approve, or null
// (lib/refundPolicy.js selfApprovalProblem, bound to the hospital's setting).
export async function decideRefund(organizationId, { paymentId, action, reason, selfProblem }) {
  if (!['APPROVE', 'REJECT'].includes(action)) throw Object.assign(new Error('action must be APPROVE or REJECT'), { status: 400 })
  const found = await db.billPayment.findFirst({ where: { id: paymentId || '', organizationId, type: 'REFUND' }, select: { billId: true } })
  if (!found) throw Object.assign(new Error('Refund request not found'), { status: 404 })
  if (!found.billId) throw Object.assign(new Error('The bill this refund was raised on was cancelled — generate the new bill first, then decide the refund'), { status: 409 })
  return db.$transaction(async (tx) => {
    await lockBill(tx, organizationId, found.billId)
    const p = await tx.billPayment.findFirst({ where: { id: paymentId, organizationId } })
    if (p.status !== 'PENDING_APPROVAL') throw Object.assign(new Error('This refund was already decided — refresh to see what happened'), { status: 409 })
    if (p.billId !== found.billId) throw Object.assign(new Error('The bill changed while this was being decided — refresh and try again'), { status: 409 })
    if (action === 'REJECT') {
      const payment = await tx.billPayment.update({ where: { id: p.id }, data: { status: 'REJECTED', voidReason: reason || null } })
      return { payment, totals: await recalcBill(tx, p.billId) }
    }
    const problem = selfProblem?.(p.receivedById)
    if (problem) throw Object.assign(new Error(problem), { status: 403 })
    const bill = await tx.bill.findUnique({ where: { id: p.billId }, select: { status: true } })
    if (bill?.status === 'CANCELLED') throw Object.assign(new Error('The bill this refund was raised on was cancelled — reject the request and raise it on the current bill'), { status: 409 })
    const { paidTotal } = await recalcBill(tx, p.billId)
    if (-p.amount > paidTotal + PAISA) {
      throw Object.assign(new Error(`Only ${formatRupee(paidTotal)} is collected on this bill now — reject this ${formatRupee(-p.amount)} request and raise it again`), { status: 409 })
    }
    const receiptNumber = await nextReceiptNumber(tx, organizationId)
    const payment = await tx.billPayment.update({ where: { id: p.id }, data: { status: 'SUCCESS', receiptNumber, paidAt: new Date() } })
    return { payment, totals: await recalcBill(tx, p.billId) }
  })
}

// IPD refunds for Finance's queue (Billing › Refund Approvals), paged in the
// database. status: PENDING_APPROVAL | SUCCESS (approved) | REJECTED | all.
export async function refundRequests(organizationId, { status = 'all', skip = 0, take = 15 } = {}) {
  const where = { organizationId, type: 'REFUND', status: status === 'all' ? { in: ['PENDING_APPROVAL', 'SUCCESS', 'REJECTED'] } : status }
  const [rows, total] = await Promise.all([
    db.billPayment.findMany({
      where, orderBy: { createdAt: 'desc' }, skip, take,
      include: {
        bill: { select: { billNumber: true, status: true } },
        admission: { select: { admissionDate: true, patient: { select: PATIENT_NAME_SELECT } } },
      },
    }),
    db.billPayment.count({ where }),
  ])
  return { rows, total }
}

// One-time: migrate a legacy Admission.depositAmount into an ADVANCE ledger entry.
// Guarded by the partial unique index (type=ADVANCE, reference='legacy-deposit').
export async function ensureLegacyDepositAdvance(tx, organizationId, admissionId, billId) {
  const adm = await tx.admission.findUnique({ where: { id: admissionId }, select: { depositAmount: true } })
  const dep = round2(adm?.depositAmount || 0)
  if (dep <= 0) return null
  const existing = await tx.billPayment.findFirst({ where: { organizationId, admissionId, type: 'ADVANCE', reference: 'legacy-deposit' } })
  if (existing) {
    if (!existing.billId && billId) await tx.billPayment.update({ where: { id: existing.id }, data: { billId } })
    return existing
  }
  return tx.billPayment.create({
    data: { organizationId, admissionId, billId: billId || null, type: 'ADVANCE', amount: dep, method: 'ADVANCE', reference: 'legacy-deposit', status: 'SUCCESS', note: 'Admission advance deposit (migrated)' },
  }).catch(() => null) // partial unique index makes this race-safe
}

// Daily / shift collection report for cashier reconciliation.
export async function collections(organizationId, { from, to, cashierId } = {}) {
  const where = { organizationId, status: 'SUCCESS' }
  // Whole calendar days in the HOSPITAL's timezone (see lib/dates.js) — a
  // collections report must not shift by 5h30m just because prod runs in UTC.
  if (from || to) {
    where.paidAt = dayRange(from, to)
  }
  if (cashierId) where.receivedById = cashierId
  const rows = await db.billPayment.findMany({ where, select: { amount: true, method: true, type: true, receivedById: true, receivedByName: true } })
  const byMethod = {}
  const byCashier = {}
  let payments = 0, refunds = 0, advances = 0, net = 0
  for (const r of rows) {
    byMethod[r.method] = round2((byMethod[r.method] || 0) + r.amount)
    const ck = r.receivedById || 'unknown'
    byCashier[ck] = byCashier[ck] || { receivedById: r.receivedById, name: r.receivedByName, total: 0, count: 0 }
    byCashier[ck].total = round2(byCashier[ck].total + r.amount); byCashier[ck].count++
    if (r.type === 'REFUND') refunds++; else if (r.type === 'ADVANCE') advances++; else payments++
    net = round2(net + r.amount)
  }
  return { byMethod, byCashier: Object.values(byCashier), payments, refunds, advances, net, count: rows.length }
}
