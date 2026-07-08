// Phase 2 — IPD payment ledger. Signed, immutable, numbered receipts.
// paidTotal/balanceDue are recomputed on the Bill from its SUCCESS payments.
import { db } from '../config/db.js'
import { financialYear } from './billService.js'
import { round2 } from '../lib/money.js'

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE']

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

  if (idempotencyKey) {
    const dup = await db.billPayment.findFirst({ where: { organizationId, idempotencyKey } }).catch(() => null)
    if (dup) return { payment: dup, deduped: true }
  }
  const bill = await db.bill.findFirst({ where: { id: billId, organizationId }, select: { id: true, admissionId: true, status: true } })
  if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 })
  if (bill.status === 'CANCELLED') throw Object.assign(new Error('Cannot collect against a cancelled bill'), { status: 409 })

  return db.$transaction(async (tx) => {
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
  return db.$transaction(async (tx) => {
    const voided = await tx.billPayment.update({ where: { id: paymentId }, data: { status: 'VOID', voidReason: reason || null } })
    if (p.billId) await recalcBill(tx, p.billId)
    return voided
  })
}

// Refund — a signed-negative ledger entry against the bill. (Credit Note linkage in Phase 3.)
export async function refund(organizationId, { billId, amount, reason, method = 'CASH', userId, userName }) {
  const amt = round2(amount)
  if (!(amt > 0)) throw Object.assign(new Error('refund amount must be > 0'), { status: 400 })
  const bill = await db.bill.findFirst({ where: { id: billId, organizationId }, select: { id: true, admissionId: true } })
  if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 })
  return db.$transaction(async (tx) => {
    const receiptNumber = await nextReceiptNumber(tx, organizationId)
    const payment = await tx.billPayment.create({
      data: {
        organizationId, billId, admissionId: bill.admissionId, receiptNumber,
        type: 'REFUND', amount: -amt, method, reference: null, note: reason || null,
        status: 'SUCCESS', receivedById: userId || null, receivedByName: userName || null,
      },
    })
    const totals = await recalcBill(tx, billId)
    return { payment, totals }
  })
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
  if (from || to) {
    where.paidAt = {}
    if (from) where.paidAt.gte = new Date(`${from}T00:00:00`)
    if (to) where.paidAt.lte = new Date(`${to}T23:59:59.999`)
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
