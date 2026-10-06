// Store indents and issues: a department asks the store for goods it holds; the
// store issues all or part of it straight away — no approval step (the owner's
// decision) — and stock goes out oldest expiry first (lib/storeStock.js).
//
// The store's side, reached through /api/purchase (dispatched here by
// purchaseController.js by resource name):
//
// GET    ?resource=indents          list (status, departmentId, search, paging) + summary counts per status
// GET    ?resource=indent&id=       one indent: lines with what is pending and what the shelf holds, its issues
// GET    ?resource=issues           list of issues (indentId, departmentId, status, search, paging)
// GET    ?resource=issue&id=        one issue with its batch lines and the hospital (the printed slip)
// POST   {resource:'issue'}         give goods against an indent (store keeper / administrator)
// PATCH  {resource:'indent', action:'close'}   the store will not give the rest
// PATCH  {resource:'issue',  action:'cancel'}  undo an issue (administrator): goods back to the same batches
//
// The department's side, /api/store-indents (routes/storeIndentRoutes.js):
//
// GET    ?resource=form             the departments to raise for, and the person's own
// GET    ?resource=items            the store's items with "in stock" yes / no (no money)
// GET    ?resource=indents | indent its department's indents (an administrator: all)
// POST   {…}                        raise an indent
// PATCH  {id, action:'cancel'}      its author cancels it while nothing has been issued
//
// Every id in a request is checked against this hospital. An issue takes the
// indent's row lock first, then the items' stock lock (the same advisory lock
// goods receipts take) and the batches' row locks, so two issues at once can
// never hand out the same stock, and each ledger balance is the item's whole
// stock after the movement. The store keeper sees no money.
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { round2 } from '../lib/money.js'
import { startOfToday, ymdInZone } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { auditIpd } from '../inpatient/audit.js'
import { canIssue, canSeeIndents, isAdmin, blank, validationError, sendError, hideMoney } from '../lib/purchaseAccess.js'
import { resolveLines, itemSearchWhere } from '../lib/purchaseLines.js'
import { roundQty } from '../lib/purchaseReceipts.js'
import {
  NOT_STOCKED, issuableQty, expiredQty, planFifo, pendingOf, indentStatusAfter,
  checkIssueLine, issuedAfterUndo, lockItems, lockedBatches,
} from '../lib/storeStock.js'
import { notify, notifyRoles } from '../lib/notify.js'
import { hospital } from './purchaseOrderController.js'

export const INDENT_READS = new Set(['indents', 'indent', 'issues', 'issue'])
export const INDENT_WRITES = new Set(['indent', 'issue'])

const STATUSES = ['submitted', 'partly_issued', 'issued', 'closed', 'cancelled']
const PRIORITIES = ['normal', 'urgent', 'emergency']
// An issue's cost (at the batches' cost, before GST) is money: never the store's.
// Kept here, not in purchaseAccess MONEY (the lead's file).
const ISSUE_MONEY = { fields: ['totalValue'], lineFields: ['unitCost'] }
// An issue of many lines does many writes; give it room on a slow database.
const TX = { maxWait: 10000, timeout: 30000 }
const EPS = 1e-9

const optText = (max) => z.preprocess((v) => (blank(v) ? null : String(v).trim()), z.string().max(max).nullable().optional())
const reasonOf = (body) => String(body?.reason || '').trim().slice(0, 300)

// ── Notifications ────────────────────────────────────────────────────────────
// After the write has committed: the bell cannot undo it, and a failure comes
// back as `warning` for the screen (lib/purchaseNotify.js does the same).
const NOTIFY_WARNING = 'Saved — but the bell notification could not be sent. Tell the people concerned directly.'
async function safeNotify(what, doc, fn) {
  try {
    await fn()
    return null
  } catch (e) {
    console.error(`[notify] store indent "${what}" on ${doc?.number || doc?.id || 'a document'}: its bell notifications were not (all) sent — ${e.message}`)
    return NOTIFY_WARNING
  }
}
const names = (lines) => lines.slice(0, 3).map((l) => l.itemName).join(', ') + (lines.length > 3 ? ` and ${lines.length - 3} more` : '')
/** One name per item: an item spread over two batches is two issue lines. */
const dedupeItems = (lines) => [...new Map(lines.map((l) => [l.itemName, l])).values()]

// ── Shared reads ─────────────────────────────────────────────────────────────

const INDENT_INCLUDE = {
  department: { select: { id: true, name: true } },
  // allowsFraction: a line asked in BOX is given in whole boxes
  lines: { orderBy: { sortOrder: 'asc' }, include: { unit: { select: { allowsFraction: true } } } },
}
// What the department sees of an issue: what came, from which batch, who
// collected it. No cost.
const ISSUE_FOR_DEPT = {
  orderBy: { issuedAt: 'asc' },
  select: {
    id: true, number: true, status: true, issuedAt: true, issuedByName: true, receivedByName: true,
    cancelledAt: true, cancelledByName: true, cancelReason: true,
    lines: { select: { id: true, indentLineId: true, itemName: true, quantity: true, unitCode: true, batchNumber: true, expiryDate: true } },
  },
}

/** Per item: what can be issued now and what is expired, in stock units. */
async function shelfOf(client, ORG_ID, itemIds, today = startOfToday()) {
  const ids = [...new Set(itemIds)]
  const batches = ids.length
    ? await client.stockBatch.findMany({ where: { organizationId: ORG_ID, itemId: { in: ids }, quantity: { gt: 0 } }, select: { itemId: true, quantity: true, expiryDate: true } })
    : []
  const out = new Map(ids.map((id) => [id, { issuable: 0, expired: 0 }]))
  for (const id of ids) {
    const own = batches.filter((b) => b.itemId === id)
    out.set(id, { issuable: issuableQty(own, today), expired: expiredQty(own, today) })
  }
  return out
}

/** Locks the indent row for the rest of the transaction and reads it with its lines. */
async function lockIndent(tx, ORG_ID, id) {
  await tx.$executeRaw`SELECT 1 FROM "StoreIndent" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
  const indent = await tx.storeIndent.findFirst({ where: { id, organizationId: ORG_ID }, include: { lines: { include: { unit: { select: { allowsFraction: true } } } } } })
  if (!indent) throw notFound('Indent not found')
  return indent
}

const readIndent = (client, ORG_ID, id) => client.storeIndent.findFirst({ where: { id, organizationId: ORG_ID }, include: INDENT_INCLUDE })
const readIssue = (client, ORG_ID, id) => client.storeIssue.findFirst({
  where: { id, organizationId: ORG_ID },
  include: { lines: { orderBy: [{ itemName: 'asc' }, { expiryDate: 'asc' }] }, department: { select: { id: true, name: true } }, indent: { select: { id: true, number: true, requestedByName: true, status: true } } },
})

/** Indent list filters shared by the store's list and the department's. Status is applied by the caller. */
function indentWhere(ORG_ID, { departmentId, search }) {
  const where = { organizationId: ORG_ID }
  if (departmentId) where.departmentId = String(departmentId)
  const term = String(search || '').trim()
  if (term) {
    where.OR = [
      { number: { contains: term, mode: 'insensitive' } },
      { requestedByName: { contains: term, mode: 'insensitive' } },
      { purpose: { contains: term, mode: 'insensitive' } },
      { lines: { some: { itemName: { contains: term, mode: 'insensitive' } } } },
    ]
  }
  return where
}

/** "open" is a submitted indent nothing has been issued on yet. Several statuses comma-separated. */
function statusFilter(status) {
  const wanted = String(status || '').split(',').map((s) => (s === 'open' ? 'submitted' : s)).filter((s) => STATUSES.includes(s))
  return wanted.length ? { status: { in: wanted } } : {}
}

/**
 * A list of indents with a count per status of the same filters (search,
 * department, scope) — the tiles above the list, so a tile's number is the
 * rows it opens.
 */
async function indentList(req, baseWhere) {
  const where = { ...baseWhere, ...statusFilter(req.query.status) }
  const body = await listResponse(db.storeIndent, {
    where, req, orderBy: [{ createdAt: 'desc' }],
    include: {
      department: { select: { id: true, name: true } },
      lines: { orderBy: { sortOrder: 'asc' }, select: { itemName: true, quantity: true, issuedQty: true, unitCode: true } },
    },
    summary: async () => {
      const groups = await db.storeIndent.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } })
      const summary = Object.fromEntries(STATUSES.map((s) => [s, 0]))
      for (const g of groups) summary[g.status] = g._count._all
      summary.all = Object.values(summary).reduce((s, n) => s + n, 0)
      return summary
    },
  })
  body.data = body.data.map(({ lines, ...r }) => ({
    ...r, lineCount: lines.length,
    items: names(lines),
    pendingLines: lines.filter((l) => pendingOf(l) > EPS).length,
  }))
  return body
}

// ── The store's side (/api/purchase) ─────────────────────────────────────────

export async function indentGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query
    if (!canSeeIndents(req)) throw forbidden('Indents are the store\'s and the purchase officer\'s')

    if (resource === 'indents') {
      return res.json(await indentList(req, indentWhere(ORG_ID, req.query)))
    }

    if (resource === 'indent') {
      const indent = await readIndent(db, ORG_ID, String(req.query.id || ''))
      if (!indent) throw notFound('Indent not found')
      const [shelf, issues] = await Promise.all([
        shelfOf(db, ORG_ID, indent.lines.map((l) => l.itemId)),
        db.storeIssue.findMany({ where: { organizationId: ORG_ID, indentId: indent.id }, orderBy: { issuedAt: 'asc' }, include: { lines: true } }),
      ])
      const lines = indent.lines.map((l) => {
        const s = shelf.get(l.itemId)
        // In the indent's unit too, so the form can say "2 BOX in stock".
        return { ...l, pending: pendingOf(l), wholeOnly: !l.unit.allowsFraction, available: s.issuable, availableInUnit: roundQty(s.issuable / (l.unitFactor || 1)), expired: s.expired }
      })
      return res.json({ success: true, data: { ...indent, lines, issues: issues.map((i) => hideMoney(req, i, ISSUE_MONEY)) } })
    }

    if (resource === 'issues') {
      const { indentId, departmentId, status, search } = req.query
      const where = { organizationId: ORG_ID }
      if (indentId) where.indentId = String(indentId)
      if (departmentId) where.departmentId = String(departmentId)
      if (status && status !== 'all') where.status = String(status)
      const term = String(search || '').trim()
      if (term) {
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { receivedByName: { contains: term, mode: 'insensitive' } },
          { indent: { number: { contains: term, mode: 'insensitive' } } },
          { lines: { some: { itemName: { contains: term, mode: 'insensitive' } } } },
        ]
      }
      const body = await listResponse(db.storeIssue, {
        where, req, orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
        include: { department: { select: { name: true } }, indent: { select: { id: true, number: true } }, _count: { select: { lines: true } } },
      })
      body.data = body.data.map(({ _count, ...r }) => hideMoney(req, { ...r, lineCount: _count.lines }, ISSUE_MONEY))
      return res.json(body)
    }

    if (resource === 'issue') {
      const issue = await readIssue(db, ORG_ID, String(req.query.id || ''))
      if (!issue) throw notFound('Issue not found')
      return res.json({ success: true, data: hideMoney(req, { ...issue, hospital: await hospital(ORG_ID) }, ISSUE_MONEY) })
    }

    throw bad('Unknown resource')
  } catch (e) {
    sendError(res, e, next)
  }
}

const issueSchema = z.object({
  indentId: z.string().min(1, 'Choose the indent the goods are given against'),
  receivedByName: z.preprocess((v) => (blank(v) ? '' : String(v).trim()), z.string().min(2, 'Say who collected the goods').max(100)),
  notes: optText(500),
  lines: z.array(z.object({
    indentLineId: z.string().min(1),
    quantity: z.preprocess((v) => (blank(v) ? 0 : Number(v)),
      z.number({ invalid_type_error: 'Quantity must be a number' }).finite().min(0, 'Quantity cannot be below 0').max(1e7, 'Quantity is too large').transform(roundQty)),
  })).min(1, 'Nothing to issue').max(200),
})

/** POST {resource:'issue'} — goods handed to the department, stock out FIFO by expiry. */
export async function indentCreate(req, res, next) {
  try {
    if (req.body?.resource === 'indent') throw bad('Departments raise indents from Store Indent')
    const ORG_ID = getOrgId(req)
    if (!canIssue(req)) throw forbidden('Only the store keeper or an administrator issues goods')
    const parsed = issueSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { indentId, receivedByName, notes, lines } = parsed.data
    const actor = getActor(req)
    const today = startOfToday()

    const issue = await db.$transaction(async (tx) => {
      // The indent first: two issues on one indent take turns, so together
      // they never give more than was asked.
      const indent = await lockIndent(tx, ORG_ID, indentId)
      if (!['submitted', 'partly_issued'].includes(indent.status)) {
        throw conflict(indent.status === 'issued' ? `Everything on ${indent.number} has been issued`
          : `${indent.number} is ${indent.status} — nothing more is issued on it`)
      }
      const byId = new Map(indent.lines.map((l) => [l.id, l]))
      const seen = new Set()
      const wanted = []
      for (const l of lines) {
        const line = byId.get(l.indentLineId)
        if (!line) throw bad('A line is not on this indent — reload the indent and try again')
        if (seen.has(line.id)) throw bad(`${line.itemName} is on the issue twice`)
        seen.add(line.id)
        if (l.quantity > 0) wanted.push({ line, quantity: l.quantity })
      }
      if (!wanted.length) throw bad('Enter how much to give on at least one line')

      // Then the stock: the items (in sorted order, as receipts lock them) and
      // their batches, read under the lock so the figures are the latest.
      const itemIds = wanted.map((w) => w.line.itemId)
      await lockItems(tx, itemIds)
      const batches = await lockedBatches(tx, ORG_ID, itemIds)
      const left = new Map(batches.map((b) => [b.id, b.quantity])) // a line's take lowers it for the next line of the same item
      const plans = []
      for (const { line, quantity } of wanted) {
        const own = batches.filter((b) => b.itemId === line.itemId).map((b) => ({ ...b, quantity: left.get(b.id) }))
        const check = checkIssueLine({ line, quantity, available: issuableQty(own, today), wholeOnly: !line.unit.allowsFraction })
        if (check.error) throw conflict(check.error)
        const { takes, short } = planFifo(own, check.stockQty, today)
        if (short > 0) throw conflict(`${line.itemName}: the stock changed while you were issuing — reload the indent and try again`)
        for (const t of takes) left.set(t.batch.id, roundQty(left.get(t.batch.id) - t.qty))
        plans.push({ line, quantity, takes })
      }

      // Every item's whole stock before this issue (expired batches count: the
      // ledger balance is what is on the shelf).
      const balance = new Map()
      for (const b of batches) balance.set(b.itemId, roundQty((balance.get(b.itemId) || 0) + b.quantity))

      const number = await nextSeriesNumber(tx, ORG_ID, 'STORE_ISSUE', 'ISS')
      const dept = await tx.department.findFirst({ where: { id: indent.departmentId, organizationId: ORG_ID }, select: { name: true } })
      const created = await tx.storeIssue.create({
        data: {
          organizationId: ORG_ID, number, indentId: indent.id, departmentId: indent.departmentId,
          issuedById: actor.id, issuedByName: actor.name || 'Store', receivedByName, notes: notes || null,
          totalValue: round2(plans.reduce((s, p) => s + p.takes.reduce((x, t) => x + t.qty * t.batch.unitCost, 0), 0)),
        },
      })
      for (const { line, quantity, takes } of plans) {
        for (const { batch, qty } of takes) {
          await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: roundQty(left.get(batch.id) ?? 0) } })
          const after = roundQty(balance.get(line.itemId) - qty)
          balance.set(line.itemId, after)
          await tx.stockMovement.create({
            data: {
              organizationId: ORG_ID, itemId: line.itemId, batchId: batch.id, type: 'issue', quantity: -qty, balanceAfter: after,
              reference: number, referenceId: created.id, note: `Issued to ${dept?.name || 'a department'} on ${indent.number}`,
              createdById: actor.id, createdByName: actor.name,
            },
          })
          await tx.storeIssueLine.create({
            data: {
              organizationId: ORG_ID, issueId: created.id, indentLineId: line.id,
              itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName, unitCode: line.unitCode, unitFactor: line.unitFactor,
              quantity: roundQty(qty / (line.unitFactor || 1)), stockQty: qty,
              batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, unitCost: batch.unitCost,
            },
          })
        }
        await tx.storeIndentLine.update({ where: { id: line.id }, data: { issuedQty: roundQty(line.issuedQty + quantity) } })
      }
      // A batch updated twice (two lines of the same item) ends at its last figure, above.
      const after = await tx.storeIndentLine.findMany({ where: { indentId: indent.id }, select: { quantity: true, issuedQty: true } })
      const status = indentStatusAfter(indent.status, after)
      if (status !== indent.status) await tx.storeIndent.update({ where: { id: indent.id }, data: { status } })
      // Read back before the commit, so the answer is what was committed.
      const full = await readIssue(tx, ORG_ID, created.id)
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.issue', entityId: full.id, after: full }, tx)
      return { ...full, indentStatus: status, requestedById: indent.requestedById, indentNumber: indent.number }
    }, TX)

    const { requestedById, indentNumber, indentStatus, ...data } = issue
    const warning = await safeNotify('issue', data, () => notify(ORG_ID, [requestedById], {
      type: 'store.issue.posted', title: `Store issued goods on ${indentNumber}`,
      message: `${data.number}: ${names(dedupeItems(data.lines))}${indentStatus === 'issued' ? ' — everything asked for is issued.' : ' — the rest is still to come.'} Collected by ${data.receivedByName}.`,
      entityType: 'store.indent', entityId: data.indentId,
    }, { except: actor.id }))
    return res.status(201).json({ success: true, data: hideMoney(req, data, ISSUE_MONEY), ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

/** PATCH — {resource:'indent', action:'close'} or {resource:'issue', action:'cancel'}. */
export async function indentUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource, action } = req.body
    const id = String(req.body.id || '')
    const reason = reasonOf(req.body)
    const actor = getActor(req)

    if (resource === 'indent' && action === 'close') {
      if (!canIssue(req)) throw forbidden('Only the store keeper or an administrator closes an indent')
      if (reason.length < 3) throw bad('Say why the rest will not be issued — the department reads it')
      let before
      const after = await db.$transaction(async (tx) => {
        const indent = await lockIndent(tx, ORG_ID, id)
        before = indent
        if (!['submitted', 'partly_issued'].includes(indent.status)) throw conflict(`${indent.number} is ${indent.status.replace('_', ' ')} — there is nothing left to close`)
        await tx.storeIndent.update({ where: { id }, data: { status: 'closed', closedAt: new Date(), closedByName: actor.name || 'Store', closeReason: reason } })
        const full = await readIndent(tx, ORG_ID, id)
        await auditIpd(req, ORG_ID, { action: 'close', entityType: 'purchase.indent', entityId: id, before, after: full }, tx)
        return full
      })
      const warning = await safeNotify('close', after, () => notify(ORG_ID, [after.requestedById], {
        type: 'store.indent.closed', title: `${after.number}: the store will not issue the rest`,
        message: `${actor.name || 'The store'}: ${reason}`, priority: 'high', entityType: 'store.indent', entityId: after.id,
      }, { except: actor.id }))
      return res.json({ success: true, data: after, ...(warning ? { warning } : {}) })
    }

    if (resource === 'issue' && action === 'cancel') {
      if (!isAdmin(req)) throw forbidden('Only an administrator cancels an issue')
      if (reason.length < 3) throw bad('Say why the issue is cancelled')
      let before
      const after = await db.$transaction(async (tx) => {
        // The indent first, as issuing does, so a cancel and an issue on the
        // same indent take turns instead of waiting on each other.
        const head = await tx.storeIssue.findFirst({ where: { id, organizationId: ORG_ID }, select: { indentId: true } })
        if (!head) throw notFound('Issue not found')
        const indent = head.indentId ? await lockIndent(tx, ORG_ID, head.indentId) : null
        await tx.$executeRaw`SELECT 1 FROM "StoreIssue" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
        const issue = await tx.storeIssue.findFirst({ where: { id, organizationId: ORG_ID }, include: { lines: true } })
        before = issue
        if (issue.status !== 'posted') throw conflict(`${issue.number} is already ${issue.status}`)

        await lockItems(tx, issue.lines.map((l) => l.itemId))
        const batches = await lockedBatches(tx, ORG_ID, issue.lines.map((l) => l.itemId))
        const byBatch = new Map(batches.map((b) => [b.id, b]))
        const balance = new Map()
        for (const b of batches) balance.set(b.itemId, roundQty((balance.get(b.itemId) || 0) + b.quantity))
        const issued = new Map((indent?.lines || []).map((l) => [l.id, l.issuedQty]))

        for (const line of issue.lines) {
          // The goods go back to the batch they left; a batch that is gone
          // (deleted outside Purchase) has nowhere to take them.
          const batch = line.batchId && byBatch.get(line.batchId)
          if (!batch) throw conflict(`${issue.number}: batch ${line.batchNumber || ''} of ${line.itemName} no longer exists, so its goods cannot go back — nothing was changed`)
          const qtyNow = roundQty(batch.quantity + line.stockQty)
          batch.quantity = qtyNow
          await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: qtyNow } })
          const bal = roundQty(balance.get(line.itemId) + line.stockQty)
          balance.set(line.itemId, bal)
          await tx.stockMovement.create({
            data: {
              organizationId: ORG_ID, itemId: line.itemId, batchId: batch.id, type: 'issue_cancel', quantity: line.stockQty, balanceAfter: bal,
              reference: issue.number, referenceId: issue.id, note: `Issue cancelled: ${reason}`, createdById: actor.id, createdByName: actor.name,
            },
          })
          if (indent && line.indentLineId) {
            if (!issued.has(line.indentLineId)) throw conflict(`${issue.number}: its ${line.itemName} line is not on ${indent.number} — the issue and its indent do not agree, so it cannot be undone. Nothing was changed.`)
            const next = issuedAfterUndo(issued.get(line.indentLineId), line.quantity)
            if (next === null) throw conflict(`${issue.number}: ${indent.number} shows less ${line.itemName} issued than this issue gave — the indent and its issues do not agree, so it cannot be undone. Nothing was changed.`)
            issued.set(line.indentLineId, next)
          }
        }
        if (indent) {
          for (const [lineId, qty] of issued) {
            const was = indent.lines.find((l) => l.id === lineId).issuedQty
            if (Math.abs(was - qty) > EPS) await tx.storeIndentLine.update({ where: { id: lineId }, data: { issuedQty: qty } })
          }
          const status = indentStatusAfter(indent.status, indent.lines.map((l) => ({ quantity: l.quantity, issuedQty: issued.get(l.id) })))
          if (status !== indent.status) await tx.storeIndent.update({ where: { id: indent.id }, data: { status } })
        }
        await tx.storeIssue.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.name || 'Administrator', cancelReason: reason } })
        const full = await readIssue(tx, ORG_ID, id)
        await auditIpd(req, ORG_ID, { action: 'cancel', entityType: 'purchase.issue', entityId: id, before, after: full }, tx)
        return { ...full, requestedById: indent?.requestedById }
      }, TX)
      const { requestedById, ...data } = after
      const warning = await safeNotify('cancel', data, () => notify(ORG_ID, [requestedById, data.issuedById], {
        type: 'store.issue.cancelled', title: `Issue ${data.number} was cancelled`,
        message: `${actor.name || 'An administrator'}: ${reason}. Its goods are back in the store${data.indent ? ` and due on ${data.indent.number} again` : ''}.`,
        priority: 'high', entityType: 'store.indent', entityId: data.indentId,
      }, { except: actor.id }))
      return res.json({ success: true, data: hideMoney(req, data, ISSUE_MONEY), ...(warning ? { warning } : {}) })
    }

    throw bad('Unknown action. Use: indent close, issue cancel')
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function indentRemove(req, res) {
  return res.status(400).json({ success: false, error: 'Indents and issues are never deleted — cancel or close them instead' })
}

// ── The department's side (/api/store-indents) ───────────────────────────────

/** The signed-in person's department, read fresh (it can change after login). */
async function myDepartment(ORG_ID, req) {
  const id = getActor(req).id
  if (!id) return null
  const u = await db.user.findFirst({ where: { id, organizationId: ORG_ID }, select: { department: { select: { id: true, name: true, isActive: true } } } })
  return u?.department || null
}

/**
 * Which indents a person sees here: their department's (an administrator:
 * every one). Someone with no department on their record sees the ones they
 * raised — there is no department to share with.
 */
function deptScope(req, dept) {
  if (isAdmin(req)) return {}
  if (dept) return { departmentId: dept.id }
  return { requestedById: getActor(req).id ?? '__none__' }
}

/** May this person see this indent on the department's side? */
const inScope = (req, dept, indent) => isAdmin(req) || (dept ? indent.departmentId === dept.id : indent.requestedById === getActor(req).id)

const indentSchema = z.object({
  departmentId: z.string().optional().nullable(),
  priority: z.enum(PRIORITIES).optional(),
  neededBy: z.preprocess((v) => (blank(v) ? null : v), z.coerce.date({ invalid_type_error: 'Enter a valid date' }).nullable().optional()),
  purpose: optText(500),
  lines: z.array(z.object({
    itemId: z.string().min(1, 'Choose an item on every line'),
    unitId: z.string().optional().nullable(),
    quantity: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
      z.number({ required_error: 'Enter a quantity on every line', invalid_type_error: 'Quantity must be a number' })
        .finite().positive('Quantity must be more than 0').max(1e7, 'Quantity is too large')),
    note: optText(200),
  })).min(1, 'Add at least one item').max(100, 'At most 100 lines on one indent'),
})

export async function deptIndentGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query
    const dept = await myDepartment(ORG_ID, req)

    if (resource === 'form') {
      // Someone with a department raises for it; anyone else (and an
      // administrator) picks one of the hospital's open departments.
      const departments = await db.department.findMany({ where: { organizationId: ORG_ID, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      const fixed = !isAdmin(req) && dept?.isActive ? { id: dept.id, name: dept.name } : null
      return res.json({ success: true, data: { departments, myDepartment: fixed } })
    }

    if (resource === 'items') {
      // The store's goods, without what the vendor was paid: selected field by
      // field, so no price can ride along.
      const where = { organizationId: ORG_ID, isActive: true, purchaseType: { notIn: NOT_STOCKED } }
      itemSearchWhere(where, { search: req.query.search, categoryId: req.query.categoryId })
      const body = await listResponse(db.item, {
        where, req, orderBy: { name: 'asc' },
        select: {
          id: true, code: true, name: true, category: { select: { name: true } },
          stockUnit: { select: { id: true, code: true, allowsFraction: true } },
          conversions: { select: { unitId: true, factor: true, isPurchaseDefault: true, unit: { select: { code: true, allowsFraction: true } } } },
        },
      })
      const shelf = await shelfOf(db, ORG_ID, body.data.map((i) => i.id))
      // Yes or no, not how much: the ward needs to know whether it will come
      // today, not the store's count.
      body.data = body.data.map((i) => ({ ...i, inStock: shelf.get(i.id).issuable > EPS }))
      return res.json(body)
    }

    if (resource === 'indents') {
      return res.json(await indentList(req, { ...indentWhere(ORG_ID, { search: req.query.search }), ...deptScope(req, dept) }))
    }

    if (resource === 'indent') {
      const indent = await readIndent(db, ORG_ID, String(req.query.id || ''))
      // Another department's indent answers as if it did not exist.
      if (!indent || !inScope(req, dept, indent)) throw notFound('Indent not found')
      const [shelf, issues] = await Promise.all([
        shelfOf(db, ORG_ID, indent.lines.map((l) => l.itemId)),
        db.storeIssue.findMany({ where: { organizationId: ORG_ID, indentId: indent.id }, ...ISSUE_FOR_DEPT }),
      ])
      const lines = indent.lines.map((l) => ({ ...l, pending: pendingOf(l), inStock: shelf.get(l.itemId).issuable > EPS }))
      return res.json({ success: true, data: { ...indent, lines, issues } })
    }

    throw bad('Unknown resource. Use: form, items, indents, indent')
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function deptIndentCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const parsed = indentSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { priority = 'normal', neededBy, purpose, lines } = parsed.data
    const actor = getActor(req)

    // The department: one's own; only someone without one (or an
    // administrator) chooses — and only an open department of this hospital.
    const own = await myDepartment(ORG_ID, req)
    let departmentId = parsed.data.departmentId || null
    if (own?.isActive && !isAdmin(req)) {
      if (departmentId && departmentId !== own.id) throw forbidden(`You raise indents for your own department (${own.name})`)
      departmentId = own.id
    }
    if (!departmentId) throw bad('Choose the department that needs the goods')
    const dept = await db.department.findFirst({ where: { id: departmentId, organizationId: ORG_ID }, select: { id: true, name: true, isActive: true } })
    if (!dept) throw bad('Choose the department from the list')
    if (!dept.isActive) throw bad(`The ${dept.name} department is closed`)

    if (neededBy && ymdInZone(neededBy) < ymdInZone()) throw bad('The needed-by date is in the past')
    if (priority !== 'normal' && blank(purpose)) throw bad(`Say why it is ${priority} — the store reads that first`)

    // Item, unit, whole numbers, no twice: the checks every purchase document makes.
    const resolved = await resolveLines(db, ORG_ID, lines, { noun: 'indent' })
    for (const { item } of resolved) {
      if (NOT_STOCKED.includes(item.purchaseType)) throw bad(`${item.name} is a ${item.purchaseType} — it is not kept in the store. Ask the purchase team for it.`)
    }

    const indent = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG_ID, 'STORE_INDENT', 'IND')
      const created = await tx.storeIndent.create({
        data: {
          organizationId: ORG_ID, number, status: 'submitted', departmentId: dept.id,
          requestedById: actor.id, requestedByName: actor.name || 'Staff',
          priority, neededBy: neededBy ?? null, purpose: blank(purpose) ? null : purpose,
          lines: {
            create: resolved.map(({ line, item, unit }, i) => ({
              organizationId: ORG_ID, itemId: item.id, itemCode: item.code, itemName: item.name,
              unitId: unit.id, unitCode: unit.code, unitFactor: unit.factor, quantity: line.quantity,
              note: blank(line.note) ? null : line.note, sortOrder: i,
            })),
          },
        },
      })
      const full = await readIndent(tx, ORG_ID, created.id)
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.indent', entityId: created.id, after: full }, tx)
      return full
    })

    const shelf = await shelfOf(db, ORG_ID, indent.lines.map((l) => l.itemId))
    const missing = indent.lines.filter((l) => !(shelf.get(l.itemId).issuable > EPS))
    const warning = await safeNotify('create', indent, () => notifyRoles(ORG_ID, ['store_keeper'], {
      type: 'store.indent.new', title: `Indent ${indent.number} from ${dept.name}`,
      message: `${names(indent.lines)}. Raised by ${indent.requestedByName}${indent.neededBy ? `, needed by ${ymdInZone(indent.neededBy)}` : ''}.${missing.length ? ` Not in stock: ${names(missing)}.` : ''}`,
      priority: priority === 'normal' ? 'normal' : 'high', entityType: 'purchase.indent', entityId: indent.id,
    }, { except: actor.id }))
    return res.status(201).json({ success: true, data: indent, ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function deptIndentUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const id = String(req.body?.id || '')
    if (req.body?.action !== 'cancel') throw bad('Unknown action. Use: cancel')
    const actor = getActor(req)
    const dept = await myDepartment(ORG_ID, req)
    const reason = reasonOf(req.body)
    let before
    const after = await db.$transaction(async (tx) => {
      const indent = await lockIndent(tx, ORG_ID, id)
      before = indent
      if (!inScope(req, dept, indent)) throw notFound('Indent not found')
      if (!isAdmin(req) && indent.requestedById !== actor.id) throw forbidden(`Only ${indent.requestedByName}, who raised it, or an administrator can cancel ${indent.number}`)
      if (indent.status !== 'submitted' || indent.lines.some((l) => l.issuedQty > EPS)) {
        throw conflict(indent.status === 'cancelled' ? `${indent.number} is already cancelled`
          : `${indent.number} is ${indent.status.replace('_', ' ')} — the store has already acted on it, so it cannot be cancelled`)
      }
      await tx.storeIndent.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || null } })
      const full = await readIndent(tx, ORG_ID, id)
      await auditIpd(req, ORG_ID, { action: 'cancel', entityType: 'purchase.indent', entityId: id, before, after: full }, tx)
      return full
    })
    return res.json({ success: true, data: after })
  } catch (e) {
    sendError(res, e, next)
  }
}
