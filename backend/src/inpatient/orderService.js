// Phase 3A — Clinical Orders (CPOE) spine service.
//
// SPINE ONLY: create + lifecycle transitions + reads. NO tariff/bill calls, NO
// executor dispatch, NO IpdCharge. Each write also appends a ClinicalOrderEvent
// (the UI timeline). Auto-billing is wired per order type in 3B+.
import { db } from '../config/db.js'

const DRUG_FORMS = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Ointment",
  "Drops",
  "Inhaler",
  "Suppository",
  "Solution",
  "Suspension",
];

// Canonical state machine. `stamp` selects the <stamp>ById/<stamp>ByName/<stamp>At
// columns to set on transition.
const TRANSITIONS = {
  ack:      { from: ['ORDERED'],                              to: 'ACKNOWLEDGED', stamp: 'acknowledged' },
  start:    { from: ['ORDERED', 'ACKNOWLEDGED'],              to: 'IN_PROGRESS',  stamp: 'started' },
  complete: { from: ['IN_PROGRESS'],                          to: 'COMPLETED',    stamp: 'completed' },
  cancel:   { from: ['ORDERED', 'ACKNOWLEDGED', 'IN_PROGRESS'], to: 'CANCELLED',  stamp: 'cancelled' },
}

const err = (status, code, message) => Object.assign(new Error(message), { status, code })

function actorFields(stamp, actor) {
  return {
    [`${stamp}ById`]: actor?.id || null,
    [`${stamp}ByName`]: actor?.name || null,
    [`${stamp}At`]: new Date(),
  }
}

/** Create a new order (status ORDERED) + its first timeline event. */
export async function createOrder(organizationId, input, actor) {
  const { admissionId, patientId, orderType, catalogModel, catalogItemId, itemName, itemCode, serviceGroup } = input
  if (!admissionId || !orderType || !itemName || !serviceGroup) {
    throw err(400, 'IPD_ORDER_INVALID', 'admissionId, orderType, itemName and serviceGroup are required')
  }

  if (input.route && !DRUG_FORMS.includes(input.route)) {
    throw err(400, 'IPD_ORDER_INVALID', `Invalid route. Allowed values: ${DRUG_FORMS.join(', ')}`)
  }

  const order = await db.clinicalOrder.create({
    data: {
      organizationId,
      admissionId,
      patientId: patientId || null,
      orderType,
      catalogModel: catalogModel || null,
      catalogItemId: catalogItemId || null,
      itemName,
      itemCode: itemCode || null,
      serviceGroup,
      priority: input.priority || 'ROUTINE',
      quantity: input.quantity != null ? Number(input.quantity) : 1,
      frequency: input.frequency || null,
      dosage: input.dosage || null,
      route: input.route || null,
      duration: input.duration || null,
      clinicalIndication: input.clinicalIndication || null,
      notes: input.notes || null,
      status: 'ORDERED',
      orderedById: actor?.id || null,
      orderedByName: actor?.name || null,
    },
  })
  await db.clinicalOrderEvent.create({
    data: { organizationId, orderId: order.id, fromStatus: null, toStatus: 'ORDERED', actorId: actor?.id || null, actorName: actor?.name || null, actorRole: actor?.role || null },
  })
  return order
}

/**
 * Apply a lifecycle transition. Validates the state machine, stamps who/when,
 * and appends a timeline event. Returns { order, before }.
 * NOTE: discipline-scoped completion (orderAllowed) is enforced in the controller.
 */
export async function transition(organizationId, orderId, action, actor, { reason } = {}) {
  const cfg = TRANSITIONS[action]
  if (!cfg) throw err(400, 'IPD_ORDER_BAD_ACTION', `Unknown order action: ${action}`)

  const order = await db.clinicalOrder.findFirst({ where: { id: orderId, organizationId } })
  if (!order) throw err(404, 'IPD_ORDER_NOT_FOUND', 'Order not found')

  if (!cfg.from.includes(order.status)) {
    throw err(400, 'IPD_ORDER_BAD_TRANSITION', `Cannot ${action} an order that is ${order.status}`)
  }

  const data = { status: cfg.to, ...actorFields(cfg.stamp, actor) }
  if (action === 'cancel') data.cancelReason = reason || null

  const updated = await db.clinicalOrder.update({ where: { id: order.id }, data })
  await db.clinicalOrderEvent.create({
    data: { organizationId, orderId: order.id, fromStatus: order.status, toStatus: cfg.to, actorId: actor?.id || null, actorName: actor?.name || null, actorRole: actor?.role || null, remark: reason || null },
  })
  return { order: updated, before: order.status }
}

/**
 * Complete an order atomically. If `biller` is supplied (PROCEDURE in 3B), it runs
 * inside the SAME transaction as the status flip + event, so a pricing/charge
 * failure rolls everything back (order stays IN_PROGRESS, no orphan charge).
 * Non-billing order types pass biller=null → status flip only (spine-only).
 * Returns { order, before, charge, deduped }.
 */
export async function completeOrder(organizationId, orderId, actor, { biller } = {}) {
  return db.$transaction(async (tx) => {
    const order = await tx.clinicalOrder.findFirst({ where: { id: orderId, organizationId } })
    if (!order) throw err(404, 'IPD_ORDER_NOT_FOUND', 'Order not found')
    if (!TRANSITIONS.complete.from.includes(order.status)) {
      throw err(400, 'IPD_ORDER_BAD_TRANSITION', `Cannot complete an order that is ${order.status}`)
    }

    let charge = null
    let deduped = false
    if (biller) {
      const r = await biller(tx, order)
      charge = r?.charge || null
      deduped = !!r?.deduped
    }

    const data = { status: 'COMPLETED', ...actorFields('completed', actor) }
    if (charge) { data.billed = true; data.ipdChargeId = charge.id; data.executorModel = 'ClinicalOrder'; data.executorId = order.id }

    const updated = await tx.clinicalOrder.update({ where: { id: order.id }, data })
    await tx.clinicalOrderEvent.create({
      data: { organizationId, orderId: order.id, fromStatus: order.status, toStatus: 'COMPLETED', actorId: actor?.id || null, actorName: actor?.name || null, actorRole: actor?.role || null },
    })
    return { order: updated, before: order.status, charge, deduped }
  })
}

/** List orders for an admission, or a department worklist by type. */
export async function listOrders(organizationId, { admissionId, type, status, withContext } = {}) {
  const where = { organizationId }
  if (admissionId) where.admissionId = admissionId
  if (type) where.orderType = type
  if (status) where.status = status
  const orders = await db.clinicalOrder.findMany({
    where,
    orderBy: [{ priority: 'desc' }, { orderedAt: 'desc' }],
    take: 200,
    ...(withContext
      ? { include: { admission: { select: { id: true, bedId: true, patient: { select: { firstName: true, lastName: true, mrn: true } }, bed: { select: { bedNumber: true } } } } } }
      : {}),
  })
  if (!withContext) return orders
  return orders.map((o) => ({
    ...o,
    patientName: o.admission?.patient ? [o.admission.patient.firstName, o.admission.patient.lastName].filter(Boolean).join(' ') : null,
    mrn: o.admission?.patient?.mrn || null,
    bedNumber: o.admission?.bed?.bedNumber || null,
    admission: undefined,
  }))
}

/** One order with its full append-only timeline. */
export async function getOrder(organizationId, id) {
  const order = await db.clinicalOrder.findFirst({
    where: { id, organizationId },
    include: { events: { orderBy: { at: 'asc' } } },
  })
  if (!order) throw err(404, 'IPD_ORDER_NOT_FOUND', 'Order not found')
  return order
}
