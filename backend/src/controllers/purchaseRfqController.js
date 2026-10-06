// Requests for quotation (RFQ) — the same items asked of several vendors, their
// rates entered side by side, and the chosen vendor's rates turned into a
// purchase order. Reached through /api/purchase, dispatched here by
// purchaseController for these resources:
//
// GET    ?resource=rfqs              list (view=draft|open|due|awarded, status, search, paging) + summary for the tiles
// GET    ?resource=rfq&id=           one RFQ: lines, vendors with their quotes, the comparison, who is cheaper
// POST   {resource:'rfq'}            a new DRAFT: title, dueDate, notes, vendorIds (2+), lines
//                                    (from one approved request's lines not yet ordered, or by hand)
// PATCH  {resource:'rfq', action}    save | send | quote | award | cancel | email
// DELETE ?resource=rfq&id=           a draft that was never sent
// GET    ?resource=email-settings    the hospital's e-mail (SMTP) settings, without the password (administrator)
// PATCH  {resource:'email-settings'} save them (administrator); a blank password keeps the saved one
// POST   {resource:'email-test', to} send a test e-mail with the saved settings (administrator)
//
// The life of an RFQ:
//   draft ─send→ open ─(quotes entered per vendor)─ award→ awarded (a draft PO is made)
//   draft / open ─cancel→ cancelled
//
// The rules it keeps:
//  • The purchase officer (and an administrator) makes, sends, enters quotes
//    and awards; Finance reads; the store has no part (lib/purchaseAccess.js).
//    A draft is its author's until it is sent (an administrator may look).
//  • Every id comes from the body, so each is checked against this hospital:
//    vendors (active), items, units, request lines.
//  • Request lines: one approved request per RFQ, lines not already on a live
//    order or on another live RFQ.
//  • Rates are always entered and compared here (lib/rfqCompare.js — the same
//    arithmetic as the order the award makes). When the hospital's Purchase
//    setting rfqEmailVendors is on, sending also e-mails each vendor the RFQ —
//    after the commit, never inside it; each vendor row records emailedAt or
//    emailError in words, and the RFQ is sent either way.
//  • Award: to one vendor, for every line it quoted. Not the cheapest for those
//    lines → a reason (awardNote) is required. The award makes a DRAFT purchase
//    order through the same code as a hand-made one (insertDraftOrder), so the
//    request becomes "ordered" exactly as then, and the order then follows the
//    hospital's PO approval rules when the officer sends it. A request line
//    ordered meanwhile refuses the award, naming the order. Two awards at once
//    take turns on the RFQ's row lock: exactly one wins.
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { startOfToday, ymdInZone, HOSPITAL_TZ } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { round2, formatRupee } from '../lib/money.js'
import { auditIpd } from '../inpatient/audit.js'
import { canRfq, canSeeRfqs, isAdmin, ownsOrAdmin, othersDraftsHidden, blank, validationError, sendError } from '../lib/purchaseAccess.js'
import { resolveLines } from '../lib/purchaseLines.js'
import { gstTypeFor, GST_RATES } from '../lib/purchaseOrders.js'
import { compareQuotes, cheaperThan } from '../lib/rfqCompare.js'
import { purchaseSettings } from '../lib/purchaseSettings.js'
import { notify } from '../lib/notify.js'
import { NOTIFY_WARNING } from '../lib/purchaseNotify.js'
import { emailSettingsOf, publicEmailSettings, emailSetupProblem, sendMail, sealSecret, escapeHtml } from '../lib/mailer.js'
import { HOLDING, hospital, checkVendor, buildLines, insertDraftOrder } from './purchaseOrderController.js'

export const RFQ_READS = new Set(['rfqs', 'rfq', 'email-settings'])
export const RFQ_WRITES = new Set(['rfq', 'email-settings', 'email-test'])

// An award does a dozen statements (the order, its number, its request); the
// default 5 s left no room on a slow connection.
const TX = { maxWait: 10000, timeout: 30000 }
// RFQs still in play: a request line on one of these is not put on another.
const LIVE = ['draft', 'open']

// ── Validation ───────────────────────────────────────────────────────────────

const ymd = (label) => z.string({ required_error: `Enter ${label}`, invalid_type_error: `Enter ${label}` }).trim()
  // The round trip refuses 2026-02-31 (which Date would roll into March).
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) && new Date(v).toISOString().slice(0, 10) === v,`${label[0].toUpperCase()}${label.slice(1)} must be a date like 2026-10-15`)
  .transform((v) => new Date(v))
const optYmd = (label) => z.preprocess((v) => (blank(v) ? null : v), ymd(label).nullable().optional())
const num = (label, { min = 0, max = 1e9 } = {}) => z.preprocess((v) => (blank(v) ? undefined : Number(v)),
  z.number({ invalid_type_error: `${label} must be a number` }).finite().min(min, `${label} cannot be below ${min}`).max(max, `${label} is too large`).optional())

const lineSchema = z.object({
  itemId: z.string().min(1, 'Choose an item on every line'),
  unitId: z.string().optional().nullable(),
  quantity: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ required_error: 'Enter a quantity on every line', invalid_type_error: 'Quantity must be a number' })
      .finite().positive('Quantity must be more than 0').max(1e7, 'Quantity is too large')),
  requestLineId: z.string().optional().nullable(),
})
const headerFields = {
  title: z.string({ required_error: 'Give the RFQ a title' }).trim().min(3, 'Give the RFQ a title — what is being bought').max(150, 'The title is too long'),
  dueDate: ymd('the date quotes are due by'),
  notes: z.string().trim().max(1000).optional().nullable(),
  vendorIds: z.array(z.string().min(1)).min(2, 'Invite at least two vendors — one quote is not a comparison').max(20, 'At most 20 vendors on one RFQ'),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(100, 'At most 100 items on one RFQ'),
}
const createSchema = z.object(headerFields)
const saveSchema = z.object({ id: z.string().min(1), ...headerFields }).partial({ title: true, dueDate: true, notes: true, vendorIds: true, lines: true })

const quoteSchema = z.object({
  rfqVendorId: z.string().min(1, 'Choose the vendor whose quote this is'),
  declined: z.boolean().optional().default(false),
  deliveryDays: z.preprocess((v) => (blank(v) ? null : Number(v)),
    z.number({ invalid_type_error: 'Delivery days must be a number' }).int('Delivery days must be a whole number').min(0).max(365, 'Delivery days cannot be more than 365').nullable().optional()),
  validTill: optYmd('the valid-till date'),
  notes: z.string().trim().max(500).optional().nullable(),
  quotes: z.array(z.object({
    rfqLineId: z.string().min(1),
    available: z.boolean().optional().default(true),
    rate: num('Rate'),
    discountPct: num('Discount', { max: 100 }),
    gstRate: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
      z.number().refine((v) => GST_RATES.includes(v), `GST must be one of ${GST_RATES.join(', ')}%`).optional()),
  })).max(100).optional().default([]),
})

const emailSchema = z.object({
  enabled: z.boolean().optional().default(true),
  host: z.string({ required_error: 'Enter the mail server (SMTP host)' }).trim().min(1, 'Enter the mail server (SMTP host)').max(200)
    .regex(/^[A-Za-z0-9.-]+$/, 'The mail server is a name like smtp.gmail.com — no spaces or http://'),
  port: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ required_error: 'Enter the port (587, or 465 when secure)', invalid_type_error: 'Port must be a number' }).int().min(1, 'Port must be 1 to 65535').max(65535, 'Port must be 1 to 65535')),
  secure: z.boolean().optional().default(false),
  user: z.string().trim().max(200).optional().nullable(),
  password: z.string().max(500).optional().nullable(),
  fromName: z.string().trim().max(100).optional().nullable(),
  fromAddress: z.string({ required_error: 'Enter the address e-mails are sent from' }).trim().email('Enter the address e-mails are sent from, like purchase@hospital.in'),
})

// ── Reading ──────────────────────────────────────────────────────────────────

const RFQ_INCLUDE = {
  request: { select: { id: true, number: true, status: true, requestedById: true, requestedByName: true, requiredBy: true, department: { select: { name: true } } } },
  order: { select: { id: true, number: true, status: true, total: true } },
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: {
      item: { select: { gstRate: true, hsnCode: true } },
      // Whether the request line has been ordered since — the award would refuse it.
      requestLine: { select: { id: true, orderLines: { where: { order: { status: { in: HOLDING } } }, select: { order: { select: { number: true, status: true, createdById: true } } } } } },
    },
  },
  vendors: {
    orderBy: { vendorName: 'asc' },
    include: {
      vendor: { select: { id: true, code: true, name: true, email: true, phone: true, contactPerson: true, gstNumber: true, stateCode: true, city: true, isActive: true } },
      quotes: true,
    },
  },
}

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: HOSPITAL_TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '')

/** The comparison of these vendors' quotes, each vendor with the GST it charges. */
function compare(rfq, hospitalStateCode) {
  const vendors = rfq.vendors.map((v) => ({ id: v.id, status: v.status, gstType: gstTypeFor(v.vendor, hospitalStateCode) }))
  const comparison = compareQuotes({
    lines: rfq.lines.map((l) => ({ id: l.id, quantity: l.quantity })),
    vendors,
    quotes: rfq.vendors.flatMap((v) => v.quotes.map((q) => ({ ...q, vendorId: v.id, lineId: q.rfqLineId }))),
  })
  return { vendors, comparison }
}

/**
 * One RFQ as the screen shows it: its vendors with the GST each charges, the
 * comparison, and for each vendor who would be cheaper for the same lines (so
 * the award dialog knows when a reason is needed). `req` hides the number of
 * someone else's draft order on a request line.
 */
async function readFull(ORG_ID, id, client = db, req = null) {
  const rfq = await client.rfq.findFirst({ where: { id, organizationId: ORG_ID }, include: RFQ_INCLUDE })
  if (!rfq) return null
  const [h, org] = await Promise.all([hospital(ORG_ID, client), client.organization.findUnique({ where: { id: ORG_ID }, select: { settings: true } })])
  const { vendors, comparison } = compare(rfq, h.stateCode)
  const cheaper = Object.fromEntries(vendors.map((v) => [v.id, cheaperThan(comparison, vendors, v.id)]))
  const lines = rfq.lines.map(({ requestLine, ...l }) => ({
    ...l,
    // The live order each request line is on now, if any.
    orderedOn: (requestLine?.orderLines || []).map(({ order }) => ({
      status: order.status,
      number: order.status === 'draft' && req && !ownsOrAdmin(req, order.createdById) ? null : order.number,
    })),
  }))
  return {
    ...rfq,
    lines,
    vendors: rfq.vendors.map((v, i) => ({ ...v, gstType: vendors[i].gstType })),
    comparison,
    cheaper,
    hospital: h,
    // What sending will do: e-mail the vendors or not, and whether it can.
    email: { on: purchaseSettings(org).rfqEmailVendors, problem: emailSetupProblem(emailSettingsOf(org?.settings)) },
  }
}

/** The RFQ row-locked for the rest of the transaction, with what every action checks. */
async function lockRfq(tx, ORG_ID, id) {
  await tx.$executeRaw`SELECT 1 FROM "Rfq" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
  const rfq = await tx.rfq.findFirst({
    where: { id, organizationId: ORG_ID },
    include: {
      lines: { orderBy: { sortOrder: 'asc' }, include: { item: { select: { gstRate: true } } } },
      vendors: { include: { quotes: true, vendor: true } },
      request: { select: { requiredBy: true } },
    },
  })
  if (!rfq) throw notFound('RFQ not found')
  return rfq
}

/** Runs `work` and reads the RFQ back in the same transaction, with its audit row. */
function writeRfq(ORG_ID, id, audit, work, req) {
  return db.$transaction(async (tx) => {
    await work(tx)
    const after = await readFull(ORG_ID, id, tx, req)
    await audit(tx, after)
    return after
  }, TX)
}

/**
 * The vendors and lines as sent, checked against this hospital: 2+ distinct
 * active vendors; items and units (lib/purchaseLines); request lines from one
 * approved request, not on a live order or another live RFQ. Returns the rows
 * to store and the request they came from.
 */
async function checkContent(ORG_ID, { vendorIds, lines }, rfqId = null) {
  const ids = [...new Set(vendorIds)]
  if (ids.length < 2) throw bad('Invite at least two different vendors — one quote is not a comparison')
  const vendors = await db.vendor.findMany({ where: { organizationId: ORG_ID, id: { in: ids } }, select: { id: true, name: true, isActive: true } })
  if (vendors.length !== ids.length) throw bad('Choose the vendors from the list')
  const retired = vendors.find((v) => !v.isActive)
  if (retired) throw bad(`${retired.name} is retired — choose another vendor`)

  const resolved = await resolveLines(db, ORG_ID, lines, { noun: 'RFQ' })
  const rows = resolved.map(({ line: l, item, unit }, i) => ({
    organizationId: ORG_ID,
    itemId: item.id, itemCode: item.code, itemName: item.name,
    unitId: unit.id, unitCode: unit.code, unitFactor: unit.factor,
    quantity: l.quantity, requestLineId: l.requestLineId || null, sortOrder: i,
  }))

  const rlIds = [...new Set(rows.map((r) => r.requestLineId).filter(Boolean))]
  let requestId = null
  if (rlIds.length) {
    const found = await db.purchaseRequestLine.findMany({
      where: { organizationId: ORG_ID, id: { in: rlIds } },
      include: {
        request: { select: { id: true, number: true, status: true } },
        orderLines: { where: { order: { status: { in: HOLDING } } }, select: { order: { select: { number: true } } } },
        rfqLines: { where: { rfq: { status: { in: LIVE } }, ...(rfqId ? { rfqId: { not: rfqId } } : {}) }, select: { rfq: { select: { number: true } } } },
      },
    })
    const byId = new Map(found.map((f) => [f.id, f]))
    for (const r of rows.filter((x) => x.requestLineId)) {
      const rl = byId.get(r.requestLineId)
      if (!rl) throw bad(`${r.itemName}: the request line it comes from was not found`)
      if (rl.itemId !== r.itemId) throw bad(`${r.itemName} does not match the item on ${rl.request.number}`)
      if (rl.orderLines.length) throw conflict(`${r.itemName} from ${rl.request.number} is already on ${rl.orderLines[0].order.number} — it cannot go on an RFQ`)
      if (rl.request.status !== 'approved') throw conflict(`${rl.request.number} is ${rl.request.status} — only an approved request's items go on an RFQ`)
      if (rl.rfqLines.length) throw conflict(`${r.itemName} from ${rl.request.number} is already on ${rl.rfqLines[0].rfq.number}`)
    }
    const requests = [...new Set(found.map((f) => f.request.number))]
    if (requests.length > 1) throw bad(`One request per RFQ — these items come from ${requests.join(' and ')}`)
    requestId = found[0].request.id
  }
  return { rows, vendors, requestId }
}

// ── E-mail ───────────────────────────────────────────────────────────────────

const NAVY = '#1e3a5f'
const TD = 'padding:6px 8px;border-bottom:1px solid #e8e8e8;font-size:13px'
const TH = `padding:6px 8px;background:${NAVY};color:#fff;font-size:12px;text-align:left`

/** The RFQ as an e-mail to one vendor, in the look of the hospital's printed documents. */
function rfqEmail(rfq, rv, org) {
  const hospitalName = org.name || 'Hospital'
  const addr = [org.address, org.city].filter(Boolean).join(', ')
  const rows = rfq.lines.map((l, i) => `<tr><td style="${TD}">${i + 1}</td><td style="${TD}">${escapeHtml(l.itemName)}<br><span style="color:#666;font-size:11px">${escapeHtml(l.itemCode)}${l.item?.hsnCode ? ` · HSN ${escapeHtml(l.item.hsnCode)}` : ''}</span></td><td style="${TD};text-align:right;white-space:nowrap">${l.quantity} ${escapeHtml(l.unitCode)}</td></tr>`).join('')
  const contact = [org.phone && `call ${escapeHtml(org.phone)}`, org.email && `write to ${escapeHtml(org.email)}`].filter(Boolean).join(' or ')
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f6f9">
<div style="max-width:720px;margin:0 auto;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:3px solid ${NAVY};margin-bottom:12px"><tr>
    <td style="padding-bottom:8px"><div style="font-size:22px;font-weight:bold;color:${NAVY}">${escapeHtml(hospitalName)}</div>
      <div style="font-size:12px;color:#555">Purchase Department</div>${addr ? `<div style="font-size:12px;color:#555">${escapeHtml(addr)}</div>` : ''}</td>
    <td style="padding-bottom:8px;text-align:right;font-size:12px;color:#555;vertical-align:top">${escapeHtml(rfq.number)}<br>${day(rfq.sentAt || new Date())}</td>
  </tr></table>
  <div style="background:${NAVY};color:#fff;text-align:center;padding:6px 0;font-size:15px;font-weight:bold;letter-spacing:3px;margin-bottom:14px">REQUEST FOR QUOTATION</div>
  <p style="font-size:14px">Dear ${escapeHtml(rv.vendor.contactPerson || rv.vendorName)},</p>
  <p style="font-size:14px">${escapeHtml(hospitalName)} asks for your quotation for the items below — <b>${escapeHtml(rfq.title)}</b>. Please send it by <b>${day(rfq.dueDate)}</b>.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0">
    <thead><tr><th style="${TH}">#</th><th style="${TH}">Item</th><th style="${TH};text-align:right">Quantity</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="padding:8px 12px;background:#f0f4f8;border-left:4px solid ${NAVY};font-size:13px;margin-bottom:10px">
    For each item please give: the rate per unit before GST, any discount %, the GST %, whether you can supply it,
    the delivery time in days, and until when your rates are valid. Quote RFQ number <b>${escapeHtml(rfq.number)}</b>.
  </div>
  ${rfq.notes ? `<div style="padding:8px 12px;background:#f0f4f8;border-left:4px solid ${NAVY};font-size:13px;margin-bottom:10px"><b>Note:</b> ${escapeHtml(rfq.notes)}</div>` : ''}
  <p style="font-size:13px">Reply to this e-mail${contact ? `, or ${contact}` : ''}.</p>
  <p style="font-size:13px">Regards,<br>${escapeHtml(rfq.createdByName)}<br>Purchase Department, ${escapeHtml(hospitalName)}</p>
  <div style="margin-top:16px;border-top:1px solid #ccc;padding-top:6px;font-size:11px;color:#888;text-align:center">${escapeHtml(hospitalName)} — Purchase Department</div>
</div></body></html>`
  const text = [
    `${hospitalName} — Request for quotation ${rfq.number}`, '', `Dear ${rv.vendor.contactPerson || rv.vendorName},`,
    `Please quote for the items below (${rfq.title}) by ${day(rfq.dueDate)}.`, '',
    ...rfq.lines.map((l, i) => `${i + 1}. ${l.itemName} (${l.itemCode}) — ${l.quantity} ${l.unitCode}`), '',
    'For each item: rate per unit before GST, discount %, GST %, whether you can supply it, delivery days, and until when the rates are valid.',
    rfq.notes ? `Note: ${rfq.notes}` : '', '', `Regards, ${rfq.createdByName}, Purchase Department, ${hospitalName}`,
  ].join('\n')
  return { subject: `Request for quotation ${rfq.number} — ${hospitalName}`, html, text }
}

/**
 * E-mails the RFQ to its vendors — never inside a transaction: a slow mail
 * server must not hold the RFQ's lock. `only` (an RfqVendor id) re-sends to that
 * one vendor; otherwise every vendor not yet e-mailed (and not declined). Each
 * vendor row records emailedAt, or emailError in words. Returns { sent, failed }.
 */
async function emailVendors(ORG_ID, rfqId, { only = null } = {}) {
  const [rfq, org] = await Promise.all([
    readFull(ORG_ID, rfqId),
    db.organization.findUnique({ where: { id: ORG_ID }, select: { name: true, address: true, city: true, phone: true, email: true, settings: true } }),
  ])
  const block = emailSettingsOf(org?.settings)
  const setupProblem = emailSetupProblem(block)
  const targets = rfq.vendors.filter((v) => v.status !== 'declined' && (only ? v.id === only : !v.emailedAt))
  const results = await Promise.all(targets.map(async (v) => {
    if (!v.vendor.email) return { id: v.id, emailError: 'Vendor has no e-mail address — add one in Purchase → Vendors, or send the RFQ another way' }
    if (setupProblem) return { id: v.id, emailError: setupProblem }
    try {
      await sendMail(block, { to: v.vendor.email, ...rfqEmail(rfq, v, org) })
      return { id: v.id, emailedAt: new Date(), emailError: null }
    } catch (e) {
      return { id: v.id, emailError: String(e.message).slice(0, 300) }
    }
  }))
  // A failed re-send keeps the date of the e-mail that did go.
  await Promise.all(results.map(({ id, ...data }) => db.rfqVendor.updateMany({ where: { id, organizationId: ORG_ID }, data })))
  return { sent: results.filter((r) => r.emailedAt).length, failed: results.filter((r) => !r.emailedAt).length }
}

/** The request's raiser hears that its items are being ordered. Never fails the award. */
async function tellRaiser(ORG_ID, rfq, actor) {
  if (!rfq.request?.requestedById) return null
  const awarded = rfq.vendors.find((v) => v.vendorId === rfq.awardedVendorId)
  try {
    await notify(ORG_ID, [rfq.request.requestedById], {
      type: 'purchase.rfq.awarded', title: `Your request ${rfq.request.number} is being ordered`,
      message: `${rfq.number}: quotes compared, ${awarded?.vendorName || 'a vendor'} chosen. Purchase order ${rfq.order?.number || ''} is being prepared.`,
      entityType: 'purchase.request', entityId: rfq.request.id,
    }, { except: actor.id })
    return null
  } catch (e) {
    console.error(`[notify] RFQ award on ${rfq.number} (hospital ${ORG_ID}): the request's raiser was not told — ${e.message}`)
    return NOTIFY_WARNING
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function rfqGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const actor = getActor(req)
    const { resource } = req.query

    if (resource === 'email-settings') {
      if (!isAdmin(req)) throw forbidden('Only an administrator sees the e-mail settings')
      const org = await db.organization.findUnique({ where: { id: ORG_ID }, select: { settings: true } })
      return res.json({ success: true, data: publicEmailSettings(emailSettingsOf(org?.settings)) })
    }

    if (!canSeeRfqs(req)) throw forbidden('Requests for quotation are the purchase team\'s and Finance\'s')

    if (resource === 'rfqs') {
      const { view, status, search } = req.query
      const tomorrow = new Date(startOfToday().getTime() + 86400000)
      const where = { organizationId: ORG_ID, AND: [othersDraftsHidden(isAdmin(req), actor.id, 'createdById')] }
      if (view === 'draft' || view === 'open' || view === 'awarded') where.status = view
      else if (view === 'due') { where.status = 'open'; where.dueDate = { lt: tomorrow } }
      else if (status && status !== 'all') where.status = { in: String(status).split(',') }
      const term = String(search || '').trim()
      if (term) {
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { title: { contains: term, mode: 'insensitive' } },
          { lines: { some: { itemName: { contains: term, mode: 'insensitive' } } } },
          { vendors: { some: { vendorName: { contains: term, mode: 'insensitive' } } } },
        ]
      }
      // The tiles count the whole hospital, whatever the table shows; each is
      // exactly the rows its view opens.
      const base = { organizationId: ORG_ID, AND: [othersDraftsHidden(isAdmin(req), actor.id, 'createdById')] }
      const summary = async () => {
        const [draft, open, due, awarded, all] = await Promise.all([
          db.rfq.count({ where: { ...base, status: 'draft' } }),
          db.rfq.count({ where: { ...base, status: 'open' } }),
          db.rfq.count({ where: { ...base, status: 'open', dueDate: { lt: tomorrow } } }),
          db.rfq.count({ where: { ...base, status: 'awarded' } }),
          db.rfq.count({ where: base }),
        ])
        return { draft, open, due, awarded, all }
      }
      const body = await listResponse(db.rfq, {
        where, req, summary, orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { lines: true } },
          vendors: { select: { status: true, vendorId: true, vendorName: true } },
          request: { select: { number: true } },
          order: { select: { number: true, status: true } },
        },
      })
      body.data = body.data.map(({ _count, vendors, ...r }) => ({
        ...r,
        lineCount: _count.lines,
        vendorCount: vendors.length,
        quotedCount: vendors.filter((v) => v.status === 'quoted').length,
        declinedCount: vendors.filter((v) => v.status === 'declined').length,
        awardedVendorName: vendors.find((v) => v.vendorId === r.awardedVendorId)?.vendorName || null,
      }))
      return res.json(body)
    }

    if (resource === 'rfq') {
      const rfq = await readFull(ORG_ID, String(req.query.id || ''), db, req)
      // A draft is its author's until it is sent (an administrator may look).
      if (!rfq || (rfq.status === 'draft' && !ownsOrAdmin(req, rfq.createdById))) return res.status(404).json({ success: false, error: 'RFQ not found' })
      return res.json({ success: true, data: rfq })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (e) {
    sendError(res, e, next)
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function rfqCreate(req, res, next) {
  if (req.body?.resource === 'email-test') return emailTest(req, res, next)
  if (req.body?.resource === 'email-settings') return res.status(400).json({ success: false, error: 'Save the e-mail settings with PATCH' })
  try {
    const ORG_ID = getOrgId(req)
    if (!canRfq(req)) throw forbidden('Only the purchase officer or an administrator makes requests for quotation')
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { title, dueDate, notes, vendorIds, lines } = parsed.data
    if (dueDate < startOfToday()) throw bad('The due date is in the past')
    const { rows, vendors, requestId } = await checkContent(ORG_ID, { vendorIds, lines })
    const actor = getActor(req)

    const full = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG_ID, 'PURCHASE_RFQ', 'RFQ')
      const created = await tx.rfq.create({
        data: {
          organizationId: ORG_ID, number, status: 'draft', title, requestId, dueDate,
          notes: blank(notes) ? null : notes,
          createdById: actor.id, createdByName: actor.name || 'Staff',
          lines: { create: rows },
          vendors: { create: vendors.map((v) => ({ organizationId: ORG_ID, vendorId: v.id, vendorName: v.name })) },
        },
      })
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.rfq', entityId: created.id, after: created }, tx)
      return readFull(ORG_ID, created.id, tx, req)
    }, TX)
    return res.status(201).json({ success: true, data: full })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function rfqUpdate(req, res, next) {
  if (req.body?.resource === 'email-settings') return saveEmailSettings(req, res, next)
  if (req.body?.resource === 'email-test') return res.status(400).json({ success: false, error: 'Send a test e-mail with POST' })
  try {
    const ORG_ID = getOrgId(req)
    const { action } = req.body
    const id = String(req.body.id || '')
    const actor = getActor(req)
    if (!canRfq(req)) throw forbidden('Only the purchase officer or an administrator works on requests for quotation')
    let auditAction = action
    let before, after
    const audit = (tx, committed) => auditIpd(req, ORG_ID, { action: auditAction, entityType: 'purchase.rfq', entityId: id, before, after: committed }, tx)
    const write = (work) => writeRfq(ORG_ID, id, audit, work, req)
    const extra = {}

    if (action === 'save') {
      const parsed = saveSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { title, dueDate, notes, vendorIds, lines } = parsed.data
      if (dueDate && dueDate < startOfToday()) throw bad('The due date is in the past')
      after = await write(async (tx) => {
        const rfq = await lockRfq(tx, ORG_ID, id)
        before = rfq
        if (rfq.status !== 'draft') throw conflict(`This RFQ is ${rfq.status} — only a draft can be changed`)
        if (!ownsOrAdmin(req, rfq.createdById)) throw forbidden(`Only ${rfq.createdByName} or an administrator can change this draft`)
        const content = await checkContent(ORG_ID, {
          vendorIds: vendorIds || rfq.vendors.map((v) => v.vendorId),
          lines: lines || rfq.lines.map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: l.quantity, requestLineId: l.requestLineId })),
        }, id)
        await tx.rfqLine.deleteMany({ where: { rfqId: id, organizationId: ORG_ID } })
        await tx.rfqVendor.deleteMany({ where: { rfqId: id, organizationId: ORG_ID } })
        await tx.rfqLine.createMany({ data: content.rows.map((r) => ({ ...r, rfqId: id })) })
        await tx.rfqVendor.createMany({ data: content.vendors.map((v) => ({ organizationId: ORG_ID, rfqId: id, vendorId: v.id, vendorName: v.name })) })
        await tx.rfq.update({
          where: { id },
          data: {
            requestId: content.requestId,
            ...(title !== undefined ? { title } : {}),
            ...(dueDate !== undefined ? { dueDate } : {}),
            ...(notes !== undefined ? { notes: blank(notes) ? null : notes } : {}),
          },
        })
      })
    } else if (action === 'send') {
      after = await write(async (tx) => {
        const rfq = await lockRfq(tx, ORG_ID, id)
        before = rfq
        if (rfq.status !== 'draft') throw conflict(`This RFQ is already ${rfq.status}`)
        if (!ownsOrAdmin(req, rfq.createdById)) throw forbidden(`Only ${rfq.createdByName} or an administrator can send this RFQ`)
        if (!rfq.lines.length) throw bad('Add at least one item before sending')
        if (rfq.vendors.length < 2) throw bad('Invite at least two vendors before sending')
        const retired = rfq.vendors.find((v) => !v.vendor.isActive)
        if (retired) throw bad(`${retired.vendorName} has been retired since — take it off the RFQ first`)
        if (!rfq.dueDate || rfq.dueDate < startOfToday()) throw bad('The due date is in the past — change it before sending')
        await tx.rfq.update({ where: { id }, data: { status: 'open', sentAt: new Date() } })
      })
      // After the commit: the RFQ is out whatever the mail server does.
      if (after.email.on) {
        extra.emailed = await emailVendors(ORG_ID, id)
        after = await readFull(ORG_ID, id, db, req)
      }
    } else if (action === 'quote') {
      const parsed = quoteSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const q = parsed.data
      if (q.validTill && q.validTill < startOfToday()) throw bad('The valid-till date is in the past — this quote has already expired')
      after = await write(async (tx) => {
        const rfq = await lockRfq(tx, ORG_ID, id)
        before = rfq
        if (rfq.status !== 'open') throw conflict(rfq.status === 'draft' ? 'Send the RFQ to the vendors before entering their quotes' : `This RFQ is ${rfq.status} — its quotes can no longer change`)
        const rv = rfq.vendors.find((v) => v.id === q.rfqVendorId)
        if (!rv) throw bad('Choose a vendor on this RFQ')
        auditAction = `${q.declined ? 'decline' : 'quote'} ${rv.vendorName}`
        await tx.rfqQuote.deleteMany({ where: { rfqVendorId: rv.id, organizationId: ORG_ID } })
        if (q.declined) {
          await tx.rfqVendor.update({ where: { id: rv.id }, data: { status: 'declined', quotedAt: new Date(), deliveryDays: null, validTill: null, notes: blank(q.notes) ? null : q.notes } })
          return
        }
        const h = await hospital(ORG_ID, tx)
        const noGst = gstTypeFor(rv.vendor, h.stateCode) === 'none'
        const seen = new Set()
        const rows = q.quotes.map((x) => {
          const line = rfq.lines.find((l) => l.id === x.rfqLineId)
          if (!line) throw bad('A quote is for an item that is not on this RFQ')
          if (seen.has(line.id)) throw bad(`${line.itemName} is quoted twice — one rate per item`)
          seen.add(line.id)
          if (x.available && !(x.rate > 0)) throw bad(`Enter ${line.itemName}'s rate, or mark it not available`)
          return {
            organizationId: ORG_ID, rfqVendorId: rv.id, rfqLineId: line.id, available: x.available,
            rate: x.available ? round2(x.rate) : 0, discountPct: x.available ? (x.discountPct ?? 0) : 0,
            // An unregistered vendor cannot charge GST, whatever is typed.
            gstRate: noGst || !x.available ? 0 : (x.gstRate ?? line.item.gstRate),
          }
        })
        if (!rows.some((r) => r.available)) throw bad('Enter a rate for at least one item, or mark the vendor as declined')
        await tx.rfqQuote.createMany({ data: rows })
        await tx.rfqVendor.update({
          where: { id: rv.id },
          data: { status: 'quoted', quotedAt: new Date(), deliveryDays: q.deliveryDays ?? null, validTill: q.validTill ?? null, notes: blank(q.notes) ? null : q.notes },
        })
      })
    } else if (action === 'award') {
      const awardNote = String(req.body.awardNote || '').trim().slice(0, 500)
      const rfqVendorId = String(req.body.rfqVendorId || '')
      after = await write(async (tx) => {
        const rfq = await lockRfq(tx, ORG_ID, id)
        before = rfq
        if (rfq.status === 'awarded') {
          const won = rfq.vendors.find((v) => v.vendorId === rfq.awardedVendorId)
          throw conflict(`This RFQ is already awarded${won ? ` to ${won.vendorName}` : ''}`)
        }
        if (rfq.status !== 'open') throw conflict(rfq.status === 'draft' ? 'Send the RFQ and enter the quotes before awarding it' : `This RFQ is ${rfq.status} — it cannot be awarded`)
        const rv = rfq.vendors.find((v) => v.id === rfqVendorId)
        if (!rv) throw bad('Choose a vendor on this RFQ')
        if (rv.status !== 'quoted') throw conflict(`${rv.vendorName} has ${rv.status === 'declined' ? 'declined' : 'not quoted yet'} — enter its quote first`)
        if (rv.validTill && rv.validTill < startOfToday()) throw conflict(`${rv.vendorName}'s quote expired on ${day(rv.validTill)} — ask them to confirm it and update the valid-till date`)
        const h = await hospital(ORG_ID, tx)
        const { vendors, comparison } = compare(rfq, h.stateCode)
        const mine = comparison.vendors[rv.id]
        if (!mine?.lineIds.length) throw conflict(`${rv.vendorName} quoted no item it can supply`)
        const cheaper = cheaperThan(comparison, vendors, rv.id)
        if (cheaper.length && awardNote.length < 3) {
          const other = rfq.vendors.find((v) => v.id === cheaper[0].vendorId)
          throw bad(`${rv.vendorName} is not the cheapest for these items — ${other.vendorName} quoted ${formatRupee(cheaper[0].total)} against ${formatRupee(mine.total)}. Say why ${rv.vendorName} is chosen`)
        }
        const vendor = await checkVendor(ORG_ID, rv.vendorId)
        const gstType = gstTypeFor(vendor, h.stateCode)
        const quoted = mine.lineIds.map((lineId) => {
          const line = rfq.lines.find((l) => l.id === lineId)
          const quote = rv.quotes.find((x) => x.rfqLineId === lineId)
          return { itemId: line.itemId, unitId: line.unitId, quantity: line.quantity, rate: quote.rate, discountPct: quote.discountPct, gstRate: quote.gstRate, requestLineId: line.requestLineId }
        })
        const rows = await buildLines(ORG_ID, quoted, gstType)
        // When the goods should come: the vendor's delivery time from today,
        // else the request's "needed by" while it is still ahead.
        const expectedDate = rv.deliveryDays != null
          ? new Date(ymdInZone(new Date(Date.now() + rv.deliveryDays * 86400000)))
          : rfq.request?.requiredBy && rfq.request.requiredBy >= startOfToday() ? rfq.request.requiredBy : null
        const notes = `From ${rfq.number}${awardNote ? ` — ${awardNote}` : ''}`.slice(0, 500)
        const order = await insertDraftOrder(tx, req, ORG_ID, { vendor, h, gstType, rows, expectedDate, terms: null, notes, actor })
        auditAction = `award ${rv.vendorName} → ${order.number}`
        await tx.rfq.update({ where: { id }, data: { status: 'awarded', awardedVendorId: rv.vendorId, orderId: order.id, awardedAt: new Date(), awardNote: awardNote || null } })
      })
      const warning = await tellRaiser(ORG_ID, after, actor)
      if (warning) extra.warning = warning
    } else if (action === 'cancel') {
      const reason = String(req.body.reason || '').trim().slice(0, 300)
      after = await write(async (tx) => {
        const rfq = await lockRfq(tx, ORG_ID, id)
        before = rfq
        if (rfq.status === 'awarded') throw conflict('This RFQ is awarded — cancel its purchase order instead')
        if (!LIVE.includes(rfq.status)) throw conflict(`This RFQ is already ${rfq.status}`)
        if (!ownsOrAdmin(req, rfq.createdById)) throw forbidden(`Only ${rfq.createdByName} or an administrator can cancel this RFQ`)
        if (rfq.status === 'open' && reason.length < 3) throw bad('Say why it is cancelled — the vendors were already asked')
        await tx.rfq.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || null } })
      })
    } else if (action === 'email') {
      const rfq = await db.rfq.findFirst({ where: { id, organizationId: ORG_ID }, select: { status: true, vendors: { select: { id: true } } } })
      if (!rfq) throw notFound('RFQ not found')
      const org = await db.organization.findUnique({ where: { id: ORG_ID }, select: { settings: true } })
      if (!purchaseSettings(org).rfqEmailVendors) throw conflict('E-mailing RFQs to vendors is switched off — an administrator can turn it on in Settings → Purchase')
      if (rfq.status !== 'open') throw conflict('Only an RFQ that is out with the vendors can be e-mailed')
      const only = req.body.rfqVendorId ? String(req.body.rfqVendorId) : null
      if (only && !rfq.vendors.some((v) => v.id === only)) throw bad('Choose a vendor on this RFQ')
      extra.emailed = await emailVendors(ORG_ID, id, { only })
      after = await readFull(ORG_ID, id, db, req)
    } else {
      throw bad('Unknown action. Use: save, send, quote, award, cancel, email')
    }

    return res.json({ success: true, data: after, ...extra })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function rfqRemove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (req.query.resource !== 'rfq') return res.status(400).json({ success: false, error: 'Unknown resource' })
    if (!canRfq(req)) throw forbidden('Only the purchase officer or an administrator deletes RFQs')
    const id = String(req.query.id || '')
    await db.$transaction(async (tx) => {
      const rfq = await lockRfq(tx, ORG_ID, id)
      if (rfq.status !== 'draft') throw conflict('Only a draft can be deleted — cancel it instead')
      if (!ownsOrAdmin(req, rfq.createdById)) throw forbidden(`Only ${rfq.createdByName} or an administrator can delete this draft`)
      await tx.rfq.delete({ where: { id } })
      await auditIpd(req, ORG_ID, { action: 'delete', entityType: 'purchase.rfq', entityId: id, before: rfq }, tx)
    }, TX)
    return res.json({ success: true })
  } catch (e) {
    sendError(res, e, next)
  }
}

// ── E-mail settings (Settings → Integrations → E-mail (SMTP)) ────────────────
// Here rather than in the settings controller because RFQs are the one thing
// that sends e-mail today; mailer.js holds everything that is not the route.

async function saveEmailSettings(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!isAdmin(req)) throw forbidden('Only an administrator changes the e-mail settings')
    const parsed = emailSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { password, ...fields } = parsed.data
    const saved = await db.$transaction(async (tx) => {
      // The settings JSON is one value; another save at the same moment must not be lost.
      await tx.$executeRaw`SELECT 1 FROM "Organization" WHERE "id" = ${ORG_ID} FOR UPDATE`
      const org = await tx.organization.findUnique({ where: { id: ORG_ID }, select: { settings: true } })
      let settings = {}
      try { settings = JSON.parse(org?.settings || '{}') || {} } catch { settings = {} }
      const old = settings.integrations?.email || {}
      const block = {
        enabled: fields.enabled, host: fields.host, port: fields.port, secure: fields.secure,
        user: blank(fields.user) ? null : fields.user, fromName: blank(fields.fromName) ? null : fields.fromName, fromAddress: fields.fromAddress.toLowerCase(),
      }
      // No user name: the server takes mail without a login, so no password is kept.
      // A blank password keeps the saved one — the screen never has it to send back.
      if (block.user) {
        if (!blank(password)) block.passwordEnc = sealSecret(password)
        else if (old.passwordEnc) block.passwordEnc = old.passwordEnc
      }
      settings.integrations = { ...(settings.integrations || {}), email: block }
      await tx.organization.update({ where: { id: ORG_ID }, data: { settings: JSON.stringify(settings) } })
      await auditIpd(req, ORG_ID, { action: 'update', entityType: 'settings.email', entityId: ORG_ID, before: publicEmailSettings(old), after: publicEmailSettings(block) }, tx)
      return block
    })
    return res.json({ success: true, data: publicEmailSettings(saved) })
  } catch (e) {
    sendError(res, e, next)
  }
}

async function emailTest(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!isAdmin(req)) throw forbidden('Only an administrator sends a test e-mail')
    const to = String(req.body.to || '').trim()
    if (!z.string().email().safeParse(to).success) throw bad('Enter the address to send the test e-mail to')
    const org = await db.organization.findUnique({ where: { id: ORG_ID }, select: { name: true, settings: true } })
    const block = emailSettingsOf(org?.settings)
    const problem = emailSetupProblem(block)
    if (problem) throw conflict(problem)
    try {
      await sendMail(block, {
        to, subject: `Test e-mail from ${org.name || 'GudMed HMS'}`,
        text: `This is a test e-mail from ${org.name || 'the hospital'}. E-mail (SMTP) is set up correctly.`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px"><div style="font-size:20px;font-weight:bold;color:${NAVY}">${escapeHtml(org.name || 'Hospital')}</div><p>This is a test e-mail. E-mail (SMTP) is set up correctly.</p></div>`,
      })
    } catch (e) {
      // The mail server's answer, in words — not a fault in the app.
      return res.status(502).json({ success: false, error: e.message })
    }
    return res.json({ success: true, data: { to } })
  } catch (e) {
    sendError(res, e, next)
  }
}
