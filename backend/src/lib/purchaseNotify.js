// Who hears about what in Purchase — the bell (lib/notify.js). Each function
// takes the document as it is AFTER the change, so it is called once the write
// has committed, and never fails it: it answers null when everyone was told
// (or nobody needed to be), or NOTIFY_WARNING when the bell could not be
// written — the controller sends that back as `warning` and the screen shows it.
//
//   request sent / a level approved → the people who approve the next level
//   request approved                → its requester, and the purchase officers (ready to order)
//   request rejected                → its requester, with the reason
//   order sent / a level approved   → the next level's approvers
//   order approved                  → whoever made it (send it to the vendor)
//   order rejected                  → whoever made it, with the reason
//   order sent to the vendor        → the store (goods are coming)
//   order cancelled or closed       → the store (stop waiting)
//   goods received                  → whoever made the order, and whoever asked for the items
//   a receipt cancelled             → whoever received it, and whoever made the order
//   a bill put on hold (no match)   → Finance
//   a bill approved / rejected      → whoever entered it (approved by the match itself → nobody)
//   a bill cancelled                → whoever entered it
//   (a decision with nobody else in the deciding role → the administrators)
//
// The store's messages carry no money, as nothing else it gets does.
import { db } from '../config/db.js'
import { notify, notifyRoles } from './notify.js'
import { formatRupee } from './money.js'

const STORE = ['store_keeper']
const BUYERS = ['purchase_officer']
const link = (kind, id) => ({ entityType: `purchase.${kind}`, entityId: id })
export const NOTIFY_WARNING = 'Saved — but the people who act next could not be notified on the bell. Tell them directly.'
// Never let a notification fail the write it follows; never let its failure
// pass unseen either — logged with the document, and answered as a warning.
const safe = (fn) => async (orgId, action, doc, ...rest) => {
  try {
    await fn(orgId, action, doc, ...rest)
    return null
  } catch (e) {
    console.error(`[notify] ${fn.name} "${action}" on ${doc?.number || doc?.id || 'a document'} (hospital ${orgId}): its bell notifications were not (all) sent — ${e.message}`)
    return NOTIFY_WARNING
  }
}
const levelOf = (doc) => doc.currentStep && doc.steps?.length > 1 ? ` (level ${doc.currentStep.level} of ${doc.steps.length})` : ''
// The people who decide. When nobody else holds the role — the hospital has no
// Finance Controller, or its only one raised the document or approved the level
// before — the administrators, who may decide any level, hear instead.
// Otherwise the document waited with nobody told.
const toDeciders = async (orgId, role, payload, who) =>
  (await notifyRoles(orgId, [role], payload, who)) || notifyRoles(orgId, ['admin'], payload, who)

/** After a request's submit / approve / reject. */
export const requestChanged = safe(async function requestChanged(orgId, action, pr, actor, { remark } = {}) {
  const who = { except: actor.id }
  const what = `${pr.number} — ${pr.department?.name || 'a department'}, ${formatRupee(pr.estimatedTotal)}`
  if (pr.status === 'submitted' && pr.currentStep && (action === 'submit' || action === 'approve')) {
    return toDeciders(orgId, pr.currentStep.approverRole, {
      type: 'purchase.request.to_approve', title: `Request ${pr.number} needs your approval`,
      message: `${what}${levelOf(pr)}. Raised by ${pr.requestedByName}.`,
      priority: pr.priority === 'normal' ? 'normal' : 'high', ...link('request', pr.id),
    }, who)
  }
  if (pr.status === 'approved' && (action === 'submit' || action === 'approve')) {
    await notify(orgId, [pr.requestedById], {
      type: 'purchase.request.approved', title: `Your request ${pr.number} is approved`,
      message: 'The purchase team will now order it.', ...link('request', pr.id),
    }, who)
    return notifyRoles(orgId, BUYERS, {
      type: 'purchase.request.ready', title: `${pr.number} is ready to order`,
      message: `${what}. Make a purchase order from it.`, ...link('request', pr.id),
    }, who)
  }
  if (pr.status === 'rejected' && action === 'reject') {
    return notify(orgId, [pr.requestedById], {
      type: 'purchase.request.rejected', title: `Your request ${pr.number} was rejected`,
      message: `${actor.name || 'The approver'}: ${remark || 'no reason given'}. Reopen it to correct and send again.`,
      priority: 'high', ...link('request', pr.id),
    }, who)
  }
  return 0
})

/** After an order's submit / approve / reject / send / cancel / close. */
export const orderChanged = safe(async function orderChanged(orgId, action, po, actor, { remark, reason, wasStatus } = {}) {
  const who = { except: actor.id }
  if (po.status === 'submitted' && po.currentStep && (action === 'submit' || action === 'approve')) {
    return toDeciders(orgId, po.currentStep.approverRole, {
      type: 'purchase.order.to_approve', title: `Order ${po.number} needs your approval`,
      message: `${po.vendorName}, ${formatRupee(po.total)}${levelOf(po)}. Made by ${po.createdByName}.`, ...link('order', po.id),
    }, who)
  }
  if (po.status === 'approved' && action === 'approve') {
    return notify(orgId, [po.createdById], {
      type: 'purchase.order.approved', title: `Order ${po.number} is approved`,
      message: `Print it and send it to ${po.vendorName}, then mark it sent.`, ...link('order', po.id),
    }, who)
  }
  if (po.status === 'rejected' && action === 'reject') {
    return notify(orgId, [po.createdById], {
      type: 'purchase.order.rejected', title: `Order ${po.number} was rejected`,
      message: `${actor.name || 'The approver'}: ${remark || 'no reason given'}.`, priority: 'high', ...link('order', po.id),
    }, who)
  }
  if (po.status === 'sent' && action === 'send') {
    const by = po.expectedDate ? ` by ${new Date(po.expectedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''
    return notifyRoles(orgId, STORE, {
      type: 'purchase.order.sent', title: `Goods coming from ${po.vendorName}`,
      message: `${po.number}: ${po.lines.length} item${po.lines.length === 1 ? '' : 's'} expected${by}. Receive them against this order.`,
      ...link('order', po.id),
    }, who)
  }
  // The store was told goods are coming; tell it they are not.
  if ((po.status === 'cancelled' && ['approved', 'sent'].includes(wasStatus)) || po.status === 'closed') {
    return notifyRoles(orgId, STORE, {
      type: `purchase.order.${po.status}`, title: `${po.number} ${po.status === 'closed' ? 'closed' : 'cancelled'} — stop waiting`,
      message: `Nothing more is coming from ${po.vendorName} on this order. ${reason || ''}`.trim(), ...link('order', po.id),
    }, who)
  }
  return 0
})

/** After goods are received (action 'create') or a receipt is cancelled. */
export const receiptChanged = safe(async function receiptChanged(orgId, action, grn, actor, { reason } = {}) {
  const who = { except: actor.id }
  const po = await db.purchaseOrder.findFirst({
    where: { id: grn.orderId, organizationId: orgId },
    select: { number: true, status: true, createdById: true, lines: { select: { requestLine: { select: { request: { select: { requestedById: true } } } } } } },
  })
  if (!po) return 0
  if (action === 'create') {
    const taken = grn.lines.filter((l) => l.acceptedQty > 0)
    const names = taken.slice(0, 3).map((l) => l.itemName).join(', ') + (taken.length > 3 ? ` and ${taken.length - 3} more` : '')
    const rejected = grn.lines.some((l) => l.rejectedQty > 0)
    const message = `${grn.number} against ${po.number}: ${taken.length ? names : 'nothing accepted'}.${rejected ? ' Some goods were turned back.' : ''}${po.status === 'received' ? ' The order is now fully received.' : ''}`
    await notify(orgId, [po.createdById], {
      type: 'purchase.receipt.created', title: `Goods received from ${grn.vendorName}`, message, ...link('receipt', grn.id),
    }, who)
    const requesters = po.lines.map((l) => l.requestLine?.request?.requestedById).filter((id) => id && id !== po.createdById)
    if (!taken.length || !requesters.length) return 0
    return notify(orgId, requesters, {
      type: 'purchase.receipt.arrived', title: 'Items you asked for have arrived',
      message: `${names} — received in store on ${grn.number}.`, ...link('receipt', grn.id),
    }, who)
  }
  if (action === 'cancel') {
    return notify(orgId, [grn.receivedById, po.createdById], {
      type: 'purchase.receipt.cancelled', title: `Receipt ${grn.number} was cancelled`,
      message: `${actor.name || 'An administrator'}: ${reason || ''}. Its goods are out of stock and due on ${po.number} again.`,
      priority: 'high', ...link('receipt', grn.id),
    }, who)
  }
  return 0
})

// The title carries the start of the difference; the message has all of it.
const shortText = (s, max = 90) => (s && s.length > max ? `${s.slice(0, max - 1)}…` : s || 'it does not match')

/** After a bill's submit / approve / reject / cancel. `bill` with its order. */
export const billChanged = safe(async function billChanged(orgId, action, bill, actor, { remark, reason } = {}) {
  const who = { except: actor.id }
  const what = `${bill.vendorName}, ${formatRupee(bill.payable)} on ${bill.order?.number || 'its order'}`
  if (bill.status === 'on_hold' && action === 'submit') {
    const held = {
      type: 'purchase.bill.on_hold', title: `Bill ${bill.number} on hold — ${shortText(bill.mismatch)}`,
      message: `${what}. ${bill.mismatch || ''}. Entered by ${bill.createdByName}. Approve or reject it.`,
      priority: 'high', ...link('bill', bill.id),
    }
    return toDeciders(orgId, 'finance_controller', held, who)
  }
  if (bill.status === 'approved' && action === 'approve') {
    return notify(orgId, [bill.createdById], {
      type: 'purchase.bill.approved', title: `Bill ${bill.number} is approved`,
      message: `${what}. ${actor.name || 'Finance'} passed it for payment${remark ? `: ${remark}` : ''}.`, ...link('bill', bill.id),
    }, who)
  }
  if (bill.status === 'rejected' && action === 'reject') {
    return notify(orgId, [bill.createdById], {
      type: 'purchase.bill.rejected', title: `Bill ${bill.number} was rejected`,
      message: `${actor.name || 'Finance'}: ${remark || 'no reason given'}. Reopen it to correct and send again.`,
      priority: 'high', ...link('bill', bill.id),
    }, who)
  }
  if (bill.status === 'cancelled' && action === 'cancel') {
    return notify(orgId, [bill.createdById], {
      type: 'purchase.bill.cancelled', title: `Bill ${bill.number} was cancelled`,
      message: `${actor.name || 'Finance'}: ${reason || ''}. Its quantities on ${bill.order?.number || 'the order'} can be billed again.`,
      priority: 'high', ...link('bill', bill.id),
    }, who)
  }
  return 0
})
