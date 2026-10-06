// Vendor payments (step 4) — reached through /api/purchase, dispatched here by
// purchaseController for these resources:
//
// GET    ?resource=payables                  approved bills with something still due, by bill (or by=vendor),
//                                            with due day, days overdue, ageing bucket and the MSME flag
//                                            (view=overdue|due-week|msme, bucket, vendorId, billId, search, paging) + summary
// GET    ?resource=payments                  list (status, mode, vendorId, billId, from, to, search, paging) + summary
// GET    ?resource=payment&id=               one payment with its bill, vendor and the hospital (the voucher)
// POST   {resource:'payment'}                record a payment against one approved bill
// PATCH  {resource:'payment', action}        approve | reject (a pending one) | cancel (a posted one)
//
// Who pays is the hospital's choice (Settings → Purchase, lib/purchaseSettings
// paymentMode), read here on every action — lib/vendorPayments paymentRules:
//   finance          Finance (or an administrator) records → posted at once
//   officer_finance  the purchase officer (or an administrator) records → pending;
//                    Finance (or an administrator) approves or rejects, never
//                    a payment they recorded themselves (an administrator may)
//   admin            only an administrator records → posted
// Cancelling a posted payment is an administrator's, with a reason, in every mode.
//
// The rules it keeps:
//  • Only an approved bill of this hospital is paid, and never more than is
//    still due on it: payable − debit notes − posted payments. A pending
//    payment holds its amount too, so two pending ones cannot overpay.
//  • Every write takes the bill's row lock first, then reads; so two payments
//    (or two approvals) at once take turns and the second sees the first.
//    VendorBill.amountPaid is re-summed from its posted payments in the same
//    transaction, so the bill and its payments can never disagree.
//  • The store sees nothing here (purchaseAccess canSeePayments).
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { round2, formatRupee } from '../lib/money.js'
import { parseUserDate, ymdInZone, dayRange, HOSPITAL_TZ } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse, getPagination, paginationMeta } from '../lib/pagination.js'
import { auditIpd } from '../inpatient/audit.js'
import { canSeePayments, isAdmin, blank, validationError, sendError } from '../lib/purchaseAccess.js'
import { loadPurchaseSettings } from '../lib/purchaseSettings.js'
import { notify, notifyRoles } from '../lib/notify.js'
import { hospital } from './purchaseOrderController.js'
import {
  PAY_MODES, REFERENCE_NAME, BUCKETS, BUCKET_KEYS, MSME_MAX_DAYS, MSME_WARN_DAYS, DEFAULT_TERMS_DAYS,
  paymentRules, stillDue, payableNow,
} from '../lib/vendorPayments.js'

export const PAYMENT_READS = new Set(['payments', 'payment', 'payables'])
export const PAYMENT_WRITES = new Set(['payment'])

const ACTIONS = ['approve', 'reject', 'cancel']
const TX = { maxWait: 10000, timeout: 30000 }
const STATUS_WORDS = { pending_approval: 'waiting for approval', posted: 'posted', rejected: 'rejected', cancelled: 'cancelled' }
const statusWords = (s) => STATUS_WORDS[s] || s
const MODE_WORDS = { neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', upi: 'UPI', cheque: 'Cheque', dd: 'Demand draft', cash: 'Cash' }
const VIEWS = ['all', 'overdue', 'due-week', 'msme']

// With login switched off (the demo) there is no user and everything is
// allowed, as everywhere else in Purchase.
const roleIn = (req, roles) => !req.user || roles.includes(getActor(req).role)

const WHO_RECORDS = {
  finance: 'In this hospital Finance records vendor payments (Settings → Purchase)',
  officer_finance: 'In this hospital the purchase officer records vendor payments and Finance approves them (Settings → Purchase)',
  admin: 'In this hospital only an administrator records vendor payments (Settings → Purchase)',
}
const WHO_DECIDES = {
  finance: 'Only Finance or an administrator approves or rejects a vendor payment',
  officer_finance: 'Only Finance or an administrator approves or rejects a vendor payment',
  admin: 'In this hospital only an administrator approves or rejects a vendor payment (Settings → Purchase)',
}

// ── Validation ───────────────────────────────────────────────────────────────

const text = (max, label) => z.preprocess((v) => (blank(v) ? null : String(v).trim()),
  z.string().max(max, `${label} can be at most ${max} characters`).nullable())

const createSchema = z.object({
  billId: z.preprocess((v) => (blank(v) ? undefined : String(v)),
    z.string({ required_error: 'Choose the bill this payment is for' })),
  amount: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ required_error: 'Enter the amount paid', invalid_type_error: 'The amount must be a number' })
      .finite('The amount must be a number').max(1e10, 'The amount is too large')
      // Paid in rupees and paise: rounded before it is compared or stored.
      .transform(round2).refine((v) => v > 0, 'The amount paid must be more than 0')),
  mode: z.enum(PAY_MODES, { errorMap: () => ({ message: 'Choose how it was paid: NEFT, RTGS, IMPS, UPI, cheque, demand draft or cash' }) }),
  reference: text(60, 'The reference'),
  paidOn: z.preprocess((v) => (blank(v) ? undefined : v),
    z.string({ required_error: 'Enter the date it was paid', invalid_type_error: 'Enter the date paid like 2026-10-01' })),
  notes: text(500, 'Notes').optional(),
}).superRefine((d, ctx) => {
  // A bank payment is traced by its reference; without one the vendor's
  // "not received" cannot be answered.
  if (d.mode !== 'cash' && !d.reference) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reference'], message: `Enter the ${REFERENCE_NAME[d.mode]} — every payment except cash needs one` })
  }
})

/** The day it was paid: a real calendar date, not after today (the hospital's calendar). */
function paidOnOf(value) {
  const date = parseUserDate(value, 'The date paid', { minYear: 2000 })
  if (ymdInZone(date) > ymdInZone(new Date())) throw bad('The payment date cannot be in the future')
  return date
}

// ── Shared steps ─────────────────────────────────────────────────────────────

const BILL_FIELDS = {
  id: true, number: true, status: true, vendorId: true, vendorName: true, vendorInvoiceNumber: true, vendorInvoiceDate: true,
  total: true, tdsAmount: true, payable: true, debitNoteTotal: true, amountPaid: true, dueDate: true,
}
const PAYMENT_INCLUDE = {
  bill: { select: { ...BILL_FIELDS, order: { select: { id: true, number: true } } } },
  vendor: {
    select: {
      id: true, name: true, code: true, gstNumber: true, pan: true, msmeNumber: true, phone: true,
      houseNumber: true, street: true, locality: true, city: true, district: true, pincode: true,
      bankName: true, bankAccountName: true, bankAccountNumber: true, bankIfsc: true,
    },
  },
}
// A payment is read by Finance and the purchase team; the account it went to
// is shown by its last four digits (the vendor record holds the full number,
// for those allowed to see it).
const masked = (acct) => (acct ? `••••${String(acct).slice(-4)}` : acct)

async function readFull(ORG_ID, id, client = db) {
  const p = await client.vendorPayment.findFirst({ where: { id, organizationId: ORG_ID }, include: PAYMENT_INCLUDE })
  if (!p) return null
  return {
    ...p,
    bill: p.bill && { ...p.bill, stillDue: stillDue(p.bill) },
    vendor: p.vendor && { ...p.vendor, bankAccountNumber: masked(p.vendor.bankAccountNumber) },
    hospital: await hospital(ORG_ID, client),
  }
}

/**
 * The bill, row-locked, then read: every payment write starts here, so writes
 * on one bill take turns. The bill's own controller locks the order first and
 * then the bill; a payment locks only the bill, so the two never wait on each
 * other in a circle.
 */
async function lockBill(tx, ORG_ID, billId) {
  const locked = await tx.$queryRaw`SELECT "id" FROM "VendorBill" WHERE "id" = ${billId} AND "organizationId" = ${ORG_ID} FOR UPDATE`
  if (!locked.length) throw notFound('Vendor bill not found')
  return tx.vendorBill.findFirst({ where: { id: billId, organizationId: ORG_ID }, select: BILL_FIELDS })
}

const pendingOn = async (tx, ORG_ID, billId) => round2((await tx.vendorPayment.aggregate({
  where: { organizationId: ORG_ID, billId, status: 'pending_approval' }, _sum: { amount: true },
}))._sum.amount)

/** amountPaid = the bill's posted payments, summed again — never added to, so it cannot drift. */
async function syncPaid(tx, ORG_ID, billId) {
  const sum = await tx.vendorPayment.aggregate({ where: { organizationId: ORG_ID, billId, status: 'posted' }, _sum: { amount: true } })
  await tx.vendorBill.update({ where: { id: billId }, data: { amountPaid: round2(sum._sum.amount) } })
}

function assertPayable(bill) {
  if (bill.status !== 'approved') {
    throw conflict(`${bill.number} is ${bill.status.replace('_', ' ')} — only an approved bill is paid`)
  }
}

/**
 * Runs `work(tx)` (which returns the payment id), reads the payment back and
 * writes the audit row in the same transaction, so the answer is exactly what
 * committed.
 */
function writePayment(req, ORG_ID, action, work) {
  return db.$transaction(async (tx) => {
    const { id, before } = await work(tx)
    const after = await readFull(ORG_ID, id, tx)
    await auditIpd(req, ORG_ID, { action, entityType: 'purchase.payment', entityId: id, before, after }, tx)
    return after
  }, TX)
}

// ── Notifications ────────────────────────────────────────────────────────────

const NOTIFY_WARNING = 'Saved — but the people who act next could not be notified on the bell. Tell them directly.'
const link = (p) => ({ entityType: 'purchase.payment', entityId: p.id })
const paidHow = (p) => `${MODE_WORDS[p.mode] || p.mode}${p.reference ? ` ${p.reference}` : ''}`

/**
 *   recorded, waiting for approval → Finance (nobody in Finance → the administrators)
 *   approved / rejected            → whoever recorded it
 *   cancelled                      → whoever recorded it
 * Called after the commit; a failed bell never undoes the payment, it comes
 * back as a warning for the screen.
 */
async function paymentChanged(ORG_ID, action, p, actor, words) {
  try {
    const who = { except: actor.id }
    const what = `${p.vendorName}, ${formatRupee(p.amount)} by ${paidHow(p)} on bill ${p.bill?.number || ''}`
    if (action === 'create' && p.status === 'pending_approval') {
      const ask = {
        type: 'purchase.payment.to_approve', title: `Payment ${p.number} needs your approval`,
        message: `${what}. Recorded by ${p.createdByName}. Approve it once the money has gone, or reject it.`, priority: 'high', ...link(p),
      }
      if (!(await notifyRoles(ORG_ID, ['finance_controller'], ask, who))) await notifyRoles(ORG_ID, ['admin'], ask, who)
    } else if (action === 'approve') {
      await notify(ORG_ID, [p.createdById], {
        type: 'purchase.payment.approved', title: `Payment ${p.number} is approved`,
        message: `${what}. ${actor.name || 'Finance'} posted it${words ? `: ${words}` : ''}.`, ...link(p),
      }, who)
    } else if (action === 'reject') {
      await notify(ORG_ID, [p.createdById], {
        type: 'purchase.payment.rejected', title: `Payment ${p.number} was rejected`,
        message: `${what}. ${actor.name || 'Finance'}: ${words || 'no reason given'}.`, priority: 'high', ...link(p),
      }, who)
    } else if (action === 'cancel') {
      await notify(ORG_ID, [p.createdById], {
        type: 'purchase.payment.cancelled', title: `Payment ${p.number} was cancelled`,
        message: `${what}. ${actor.name || 'An administrator'}: ${words}. The bill shows it unpaid again.`, priority: 'high', ...link(p),
      }, who)
    }
    return null
  } catch (e) {
    console.error(`[notify] payment "${action}" on ${p?.number || p?.id} (hospital ${ORG_ID}): its bell notifications were not (all) sent — ${e.message}`)
    return NOTIFY_WARNING
  }
}

// ── Payables and ageing ──────────────────────────────────────────────────────

const TZ = HOSPITAL_TZ
// A stored moment → the calendar day the hospital reads it on.
const localDay = (col) => Prisma.sql`((${Prisma.raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date`

/**
 * Every approved bill of the hospital with something still due, with its
 * figures worked out in the database — the same rules as lib/vendorPayments
 * ageOf (its API check compares the two): the due day is the bill's own,
 * else the vendor's terms from the bill's date; days overdue on the
 * hospital's calendar; the bucket; the MSME limit 45 days from the bill's
 * date. Bills pile up for years, so nothing here is read whole into memory.
 */
function payablesCte(ORG_ID, today) {
  const caseBucket = Prisma.raw(`CASE ${BUCKETS.filter((b) => b.max !== Infinity).map((b) => `WHEN "daysOverdue" <= ${b.max} THEN '${b.key}'`).join(' ')} ELSE '${BUCKETS[BUCKETS.length - 1].key}' END`)
  return Prisma.sql`
    WITH base AS (
      SELECT b."id", b."number", b."vendorId", b."vendorName", b."vendorInvoiceNumber",
        b."payable", b."debitNoteTotal", b."amountPaid",
        ROUND((b."payable" - b."debitNoteTotal" - b."amountPaid")::numeric, 2) AS "due",
        COALESCE(p."pending", 0) AS "pending",
        (btrim(COALESCE(v."msmeNumber", '')) <> '') AS "msme",
        ${localDay('b."vendorInvoiceDate"')} AS "invoiceDay",
        COALESCE(${localDay('b."dueDate"')}, ${localDay('b."vendorInvoiceDate"')} + COALESCE(v."paymentTermsDays", ${DEFAULT_TERMS_DAYS}::int)) AS "dueDay"
      FROM "VendorBill" b
      JOIN "Vendor" v ON v."id" = b."vendorId" AND v."organizationId" = ${ORG_ID}
      LEFT JOIN (
        SELECT "billId", ROUND(SUM("amount")::numeric, 2) AS "pending" FROM "VendorPayment"
        WHERE "organizationId" = ${ORG_ID} AND "status" = 'pending_approval' GROUP BY "billId"
      ) p ON p."billId" = b."id"
      WHERE b."organizationId" = ${ORG_ID} AND b."status" = 'approved'
        AND b."payable" - b."debitNoteTotal" - b."amountPaid" > 0.005
    ),
    aged AS (
      SELECT base.*, (${today}::date - "dueDay") AS "daysOverdue",
        ("invoiceDay" + ${MSME_MAX_DAYS}::int) AS "msmeDeadline",
        (("invoiceDay" + ${MSME_MAX_DAYS}::int) - ${today}::date) AS "msmeDaysLeft"
      FROM base
    ),
    a AS (
      SELECT aged.*, ${caseBucket} AS "bucket",
        CASE WHEN NOT "msme" THEN NULL WHEN "msmeDaysLeft" < 0 THEN 'past' WHEN "msmeDaysLeft" <= ${MSME_WARN_DAYS}::int THEN 'near' END AS "msmeFlag"
      FROM aged
    )`
}

// The tiles' rules, once: the summary counts with them and a tile's view
// filters with them, so a tile is always the number of rows it opens.
const VIEW_SQL = {
  overdue: Prisma.sql`"daysOverdue" > 0`,
  'due-week': Prisma.sql`"daysOverdue" BETWEEN -6 AND 0`, // due today or within the next six days
  msme: Prisma.sql`"msmeFlag" IS NOT NULL`,
}

function payablesWhere({ view, bucket, vendorId, billId, search }) {
  const conds = [Prisma.sql`TRUE`]
  if (view && view !== 'all') conds.push(VIEW_SQL[view])
  if (bucket) conds.push(Prisma.sql`"bucket" = ${bucket}`)
  if (vendorId) conds.push(Prisma.sql`"vendorId" = ${vendorId}`)
  if (billId) conds.push(Prisma.sql`"id" = ${billId}`)
  const term = String(search || '').trim()
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    conds.push(Prisma.sql`("vendorName" ILIKE ${like} OR "number" ILIKE ${like} OR "vendorInvoiceNumber" ILIKE ${like})`)
  }
  return Prisma.join(conds, ' AND ')
}

const num = (v) => round2(v)
const pair = (count, amount) => ({ count: Number(count) || 0, amount: num(amount) })

/** The hospital's payables in figures: total, buckets, the tiles. One query. */
async function payablesSummary(ORG_ID, today) {
  const bucketCols = Prisma.raw(BUCKET_KEYS.map((k) =>
    `COUNT(*) FILTER (WHERE "bucket" = '${k}') AS "${k}Count", COALESCE(SUM("due") FILTER (WHERE "bucket" = '${k}'), 0) AS "${k}Amount"`).join(', '))
  const tileCols = Prisma.join(Object.entries(VIEW_SQL).map(([k, cond]) =>
    Prisma.sql`COUNT(*) FILTER (WHERE ${cond}) AS ${Prisma.raw(`"${k}Count"`)}, COALESCE(SUM("due") FILTER (WHERE ${cond}), 0) AS ${Prisma.raw(`"${k}Amount"`)}`), ', ')
  const [[s], pending] = await Promise.all([
    db.$queryRaw`${payablesCte(ORG_ID, today)} SELECT COUNT(*) AS "count", COALESCE(SUM("due"), 0) AS "due", ${bucketCols}, ${tileCols} FROM a`,
    db.vendorPayment.aggregate({ where: { organizationId: ORG_ID, status: 'pending_approval' }, _count: { _all: true }, _sum: { amount: true } }),
  ])
  return {
    totalDue: pair(s.count, s.due),
    buckets: Object.fromEntries(BUCKET_KEYS.map((k) => [k, pair(s[`${k}Count`], s[`${k}Amount`])])),
    overdue: pair(s.overdueCount, s.overdueAmount),
    dueWeek: pair(s['due-weekCount'], s['due-weekAmount']),
    msmeAtRisk: pair(s.msmeCount, s.msmeAmount),
    pendingApproval: pair(pending._count._all, pending._sum.amount),
  }
}

/**
 * The Purchase dashboard's payment figures — overdue, due this week, MSME at
 * risk, waiting for approval — counted as the Payments tab's tiles count them.
 */
export async function paymentFigures(ORG_ID) {
  const s = await payablesSummary(ORG_ID, ymdInZone())
  return { overdue: s.overdue, dueWeek: s.dueWeek, msmeAtRisk: s.msmeAtRisk, pendingApproval: s.pendingApproval, totalDue: s.totalDue }
}

const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d)

async function payables(req, ORG_ID) {
  const { bucket, vendorId, billId, search, by } = req.query
  const view = req.query.view || 'all'
  if (!VIEWS.includes(view)) throw bad(`Unknown view. Use: ${VIEWS.join(', ')}`)
  if (bucket && !BUCKET_KEYS.includes(bucket)) throw bad(`Unknown bucket. Use: ${BUCKET_KEYS.join(', ')}`)
  const today = ymdInZone()
  const where = payablesWhere({ view, bucket, vendorId: vendorId && String(vendorId), billId: billId && String(billId), search })
  const { page, limit, skip } = getPagination(req.query)
  const cte = payablesCte(ORG_ID, today)

  let data, total
  if (by === 'vendor') {
    const bucketSums = Prisma.raw(BUCKET_KEYS.map((k) => `COALESCE(SUM("due") FILTER (WHERE "bucket" = '${k}'), 0) AS "${k}"`).join(', '))
    const [rows, [c]] = await Promise.all([
      db.$queryRaw`${cte}
        SELECT "vendorId", MAX("vendorName") AS "vendorName", BOOL_OR("msme") AS "msme", COUNT(*) AS "bills",
          SUM("due") AS "due", SUM("pending") AS "pending", MAX("daysOverdue") AS "maxDaysOverdue",
          COUNT(*) FILTER (WHERE "msmeFlag" IS NOT NULL) AS "msmeAtRisk", ${bucketSums}
        FROM a WHERE ${where} GROUP BY "vendorId"
        ORDER BY MAX("daysOverdue") DESC, SUM("due") DESC, MAX("vendorName") LIMIT ${limit} OFFSET ${skip}`,
      db.$queryRaw`${cte} SELECT COUNT(DISTINCT "vendorId") AS "n" FROM a WHERE ${where}`,
    ])
    total = Number(c.n)
    data = rows.map((r) => ({
      vendorId: r.vendorId, vendorName: r.vendorName, msme: r.msme, bills: Number(r.bills), due: num(r.due), pending: num(r.pending),
      maxDaysOverdue: Number(r.maxDaysOverdue), msmeAtRisk: Number(r.msmeAtRisk),
      ...Object.fromEntries(BUCKET_KEYS.map((k) => [k, num(r[k])])),
    }))
  } else {
    // Most overdue first; MSME bills by how little time is left.
    const order = view === 'msme' ? Prisma.sql`"msmeDaysLeft" ASC, "number"` : Prisma.sql`"daysOverdue" DESC, "number"`
    const [rows, [c]] = await Promise.all([
      db.$queryRaw`${cte} SELECT * FROM a WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${skip}`,
      db.$queryRaw`${cte} SELECT COUNT(*) AS "n" FROM a WHERE ${where}`,
    ])
    total = Number(c.n)
    data = rows.map((r) => ({
      id: r.id, number: r.number, vendorId: r.vendorId, vendorName: r.vendorName, vendorInvoiceNumber: r.vendorInvoiceNumber,
      payable: num(r.payable), debitNoteTotal: num(r.debitNoteTotal), amountPaid: num(r.amountPaid),
      due: num(r.due), pending: num(r.pending), payableNow: Math.max(0, round2(num(r.due) - num(r.pending))),
      invoiceDay: ymd(r.invoiceDay), dueDay: ymd(r.dueDay), daysOverdue: Number(r.daysOverdue), bucket: r.bucket,
      msme: r.msme, msmeDeadline: r.msme ? ymd(r.msmeDeadline) : null, msmeDaysLeft: r.msme ? Number(r.msmeDaysLeft) : null, msmeFlag: r.msmeFlag,
    }))
  }
  return {
    success: true, data, pagination: paginationMeta(page, limit, total), meta: { total, today },
    // For the whole hospital, not the filter: the tiles above the list.
    summary: await payablesSummary(ORG_ID, today),
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Counts and amounts by status for the whole hospital — the payments list's figures. */
async function paymentsSummary(ORG_ID) {
  const groups = await db.vendorPayment.groupBy({ by: ['status'], where: { organizationId: ORG_ID }, _count: { _all: true }, _sum: { amount: true } })
  const of = (s) => { const g = groups.find((x) => x.status === s); return pair(g?._count._all, g?._sum.amount) }
  return { posted: of('posted'), pending: of('pending_approval'), rejected: of('rejected'), cancelled: of('cancelled') }
}

export async function paymentGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canSeePayments(req)) throw forbidden('Vendor payments are for Finance and the purchase team')
    const { resource } = req.query

    if (resource === 'payables') return res.json(await payables(req, ORG_ID))

    if (resource === 'payments') {
      const { search, status, mode, vendorId, billId, from, to } = req.query
      const where = { organizationId: ORG_ID }
      if (status && status !== 'all') where.status = { in: String(status).split(',') }
      if (mode && mode !== 'all') where.mode = String(mode)
      if (vendorId) where.vendorId = String(vendorId)
      if (billId) where.billId = String(billId)
      if (from || to) where.paidOn = dayRange(from ? String(from) : undefined, to ? String(to) : undefined)
      const term = String(search || '').trim()
      if (term) {
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { vendorName: { contains: term, mode: 'insensitive' } },
          { reference: { contains: term, mode: 'insensitive' } },
          { bill: { number: { contains: term, mode: 'insensitive' } } },
          { bill: { vendorInvoiceNumber: { contains: term, mode: 'insensitive' } } },
        ]
      }
      const body = await listResponse(db.vendorPayment, {
        where, req, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        select: {
          id: true, number: true, status: true, vendorId: true, vendorName: true, billId: true, amount: true, mode: true, reference: true,
          paidOn: true, createdByName: true, createdById: true, createdAt: true, decidedByName: true, decidedAt: true, decisionRemark: true,
          cancelReason: true, bill: { select: { number: true, vendorInvoiceNumber: true } },
        },
      })
      body.summary = await paymentsSummary(ORG_ID)
      return res.json(body)
    }

    if (resource === 'payment') {
      const p = await readFull(ORG_ID, String(req.query.id || ''))
      if (!p) return res.status(404).json({ success: false, error: 'Payment not found' })
      return res.json({ success: true, data: p })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (e) {
    sendError(res, e, next)
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function paymentCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canSeePayments(req)) throw forbidden('Vendor payments are for Finance and the purchase team')
    const { paymentMode } = await loadPurchaseSettings(db, ORG_ID)
    const rules = paymentRules(paymentMode)
    if (!roleIn(req, rules.recorders)) throw forbidden(WHO_RECORDS[paymentMode])
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const input = parsed.data
    const paidOn = paidOnOf(input.paidOn)
    const actor = getActor(req)

    const payment = await writePayment(req, ORG_ID, 'create', async (tx) => {
      const bill = await lockBill(tx, ORG_ID, input.billId)
      assertPayable(bill)
      const pending = await pendingOn(tx, ORG_ID, bill.id)
      const due = stillDue(bill)
      const room = payableNow(bill, pending)
      if (room <= 0) {
        // Returns worth more than was left to pay: the vendor owes the hospital.
        const owed = round2(bill.debitNoteTotal + bill.amountPaid - bill.payable)
        throw conflict(owed > 0
          ? `${bill.vendorName} owes ${formatRupee(owed)} on ${bill.number} (its debit notes are more than was left to pay) — nothing is to be paid`
          : due <= 0
          ? `${bill.number} is fully paid — nothing is left to pay on it`
          : `${formatRupee(pending)} on ${bill.number} is already waiting for approval — nothing more can be recorded until Finance decides it`)
      }
      if (input.amount > room) {
        throw conflict(`Only ${formatRupee(room)} is left to pay on ${bill.number}${pending > 0 ? ` (${formatRupee(due)} due, ${formatRupee(pending)} already waiting for approval)` : ''} — ${formatRupee(input.amount)} would pay the vendor more than the bill`)
      }
      const number = await nextSeriesNumber(tx, ORG_ID, 'VENDOR_PAYMENT', 'VPAY')
      const created = await tx.vendorPayment.create({
        data: {
          organizationId: ORG_ID, number, status: rules.status,
          vendorId: bill.vendorId, vendorName: bill.vendorName, billId: bill.id,
          amount: input.amount, mode: input.mode, reference: input.reference, paidOn, notes: input.notes ?? null,
          createdById: actor.id, createdByName: actor.name || 'Staff',
        },
      })
      if (created.status === 'posted') await syncPaid(tx, ORG_ID, bill.id)
      return { id: created.id }
    })

    const warning = await paymentChanged(ORG_ID, 'create', payment, actor)
    return res.status(201).json({ success: true, data: payment, ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function paymentUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canSeePayments(req)) throw forbidden('Vendor payments are for Finance and the purchase team')
    const { action } = req.body
    const id = String(req.body.id || '')
    if (!ACTIONS.includes(action)) throw bad(`Unknown action. Use: ${ACTIONS.join(', ')}`)
    const actor = getActor(req)
    const words = String(req.body.remark || req.body.reason || '').trim()

    if (action === 'cancel') {
      if (!isAdmin(req)) throw forbidden('Only an administrator cancels a posted payment')
      if (words.length < 3) throw bad('Say why the payment is cancelled (a bounced cheque, a returned transfer…)')
    } else {
      const { paymentMode } = await loadPurchaseSettings(db, ORG_ID)
      if (!roleIn(req, paymentRules(paymentMode).deciders)) throw forbidden(WHO_DECIDES[paymentMode])
      if (action === 'reject' && words.length < 3) throw bad('Say why it is rejected — whoever recorded it needs to know what to correct')
    }

    const payment = await writePayment(req, ORG_ID, action, async (tx) => {
      const head = await tx.vendorPayment.findFirst({ where: { id, organizationId: ORG_ID }, select: { billId: true } })
      if (!head) throw notFound('Payment not found')
      const bill = await lockBill(tx, ORG_ID, head.billId)
      // Re-read under the bill's lock: another decision may have just committed.
      const before = await tx.vendorPayment.findFirst({ where: { id, organizationId: ORG_ID } })

      if (action === 'cancel') {
        if (before.status !== 'posted') throw conflict(`${before.number} is ${statusWords(before.status)} — only a posted payment is cancelled`)
        await tx.vendorPayment.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: words.slice(0, 300) } })
        await syncPaid(tx, ORG_ID, bill.id)
        return { id, before }
      }

      if (before.status !== 'pending_approval') throw conflict(`${before.number} is already ${statusWords(before.status)}`)
      // Whoever recorded a payment does not pass it too; a small hospital's
      // administrator may have to (as with every approval in Purchase).
      if (!isAdmin(req) && before.createdById && before.createdById === actor.id) {
        throw forbidden('You recorded this payment — someone else in Finance must approve or reject it')
      }
      if (action === 'approve') {
        assertPayable(bill)
        // Against what is due now: a debit note or another payment may have
        // come since it was recorded.
        const due = stillDue(bill)
        if (before.amount > due) {
          throw conflict(`Only ${formatRupee(due)} is still due on ${bill.number} — less than this payment of ${formatRupee(before.amount)}, because a debit note or another payment came after it was recorded. Reject it and record the right amount.`)
        }
      }
      await tx.vendorPayment.update({
        where: { id },
        data: {
          status: action === 'approve' ? 'posted' : 'rejected',
          decidedAt: new Date(), decidedById: actor.id, decidedByName: actor.name || 'Finance', decisionRemark: words.slice(0, 500) || null,
        },
      })
      if (action === 'approve') await syncPaid(tx, ORG_ID, bill.id)
      return { id, before }
    })

    const warning = await paymentChanged(ORG_ID, action, payment, actor, words)
    return res.json({ success: true, data: payment, ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

// A payment is money that left the bank: it is never deleted. A posted one is
// cancelled (an administrator, with the reason); a pending one is rejected.
export async function paymentRemove(req, res) {
  return res.status(405).json({ success: false, error: 'A vendor payment is never deleted — an administrator cancels a posted one, Finance rejects one waiting for approval' })
}
