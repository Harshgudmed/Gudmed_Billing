// Phase 3B/3C — Auto-billing for clinical orders.
//
// Reuses the EXISTING tariff engine (resolvePrice) and the EXISTING IpdCharge
// model/flow. Produces a charge byte-for-byte identical to the manual post-charge
// handler (same r2 rounding, frozen tax/lineTotal). Idempotent via the existing
// @@unique([organizationId, sourceModule, sourceRef]).
//
// Two billing entry points:
//   • billAnyOrder      — one charge for the whole order  (sourceRef = <orderId>)
//   • billOrderTask     — one charge PER scheduled occurrence, posted when the
//                         nurse ticks it DONE in the Treatment Chart / MAR
//                         (sourceRef = TASK:<taskId>). This is how recurring
//                         orders (e.g. ABG TDS x2d = 6 collections) bill for what
//                         is ACTUALLY performed instead of a single line.
import { db } from '../config/db.js'
import { resolvePrice } from './tariffService.js'

const r2 = (n) => Math.round((n || 0) * 100) / 100

/**
 * Resolve catalog/tariff pricing for an order and build the IpdCharge data fields
 * for `qty` units. Shared by order-level and per-occurrence billing so both
 * produce identical pricing, rounding and frozen tax. Reads only (safe outside tx).
 */
async function buildOrderChargeData(organizationId, order, qty, actor) {
  let itemCode = order.itemCode
  let nativeBasePrice = null

  // 1. Native base price from the operational catalog.
  if (order.catalogModel === 'LabTest') {
    const lab = await db.labTest.findFirst({ where: { id: order.catalogItemId, organizationId }, select: { price: true } })
    nativeBasePrice = lab?.price
  } else if (order.catalogModel === 'RadiologyExam') {
    const rad = await db.radiologyExam.findFirst({ where: { id: order.catalogItemId, organizationId }, select: { price: true } })
    nativeBasePrice = rad?.price
  } else if (order.catalogModel === 'PharmacyDrug') {
    const rx = await db.pharmacyDrug.findFirst({ where: { id: order.catalogItemId, organizationId }, select: { sellingPrice: true, mrp: true } })
    nativeBasePrice = rx?.sellingPrice ?? rx?.mrp
  }

  // 2. Map to the unified ChargeMaster if present.
  let chargeMasterItem = null
  if (itemCode) {
    chargeMasterItem = await db.chargeMaster.findUnique({ where: { organizationId_code: { organizationId, code: itemCode } } })
  } else if (order.catalogItemId) {
    chargeMasterItem = await db.chargeMaster.findFirst({ where: { id: order.catalogItemId, organizationId } })
  }
  if (chargeMasterItem) itemCode = chargeMasterItem.code
  else itemCode = null // else the tariff engine throws 404 on an unknown code

  // 3. Price via the tariff engine.
  let priced
  try {
    priced = await resolvePrice(organizationId, order.admissionId, {
      itemCode: itemCode || null,
      base: itemCode ? undefined : (nativeBasePrice ?? 0),
      serviceGroup: order.serviceGroup || order.orderType,
      serviceDate: new Date(),
    })
  } catch (e) {
    if (e.status === 404 || e.status === 400) {
      priced = { price: 0, base: 0, serviceGroup: order.serviceGroup || order.orderType, bedCategoryId: null, plan: null, rule: null, chargeItem: null }
    } else {
      throw e
    }
  }

  // Frozen tax from the charge master (mirrors manual post-charge).
  let taxPct = 0
  if (priced.chargeItem?.id) {
    const cm = await db.chargeMaster.findUnique({ where: { id: priced.chargeItem.id }, select: { taxRatePct: true } }).catch(() => null)
    taxPct = cm?.taxRatePct || 0
  }
  const gross = r2(priced.price * qty)
  const discountAmount = 0
  const taxable = r2(gross - discountAmount)
  const taxAmount = r2(taxable * taxPct / 100)

  return {
    organizationId,
    admissionId: order.admissionId,
    chargeItemId: priced.chargeItem?.id || null,
    description: order.itemName || priced.chargeItem?.name || itemCode,
    serviceGroup: priced.serviceGroup || order.serviceGroup || order.orderType,
    unitPrice: priced.price,
    quantity: qty,
    taxPct,
    taxAmount,
    discountPct: 0,
    discountAmount: 0,
    lineTotal: r2(taxable + taxAmount),
    resolvedFrom: { planId: priced.plan?.id, bedCategoryId: priced.bedCategoryId, ruleId: priced.rule?.id, base: priced.base },
    status: 'ACTIVE',
    postedById: actor?.id || null,
    postedByName: actor?.name || null,
    serviceDate: new Date(),
  }
}

/**
 * Post a single ACTIVE IpdCharge for an order (whole order, qty = order.quantity),
 * inside the caller's transaction. Idempotent per order. Returns { charge, deduped }.
 */
export async function billAnyOrder(tx, organizationId, order, actor) {
  const existing = await tx.ipdCharge.findFirst({ where: { organizationId, sourceModule: order.orderType, sourceRef: order.id } })
  if (existing) return { charge: existing, deduped: true }
  const data = await buildOrderChargeData(organizationId, order, Number(order.quantity) || 1, actor)
  data.sourceModule = order.orderType
  data.sourceRef = order.id
  await tx.ipdCharge.createMany({ data: [data], skipDuplicates: true })
  const charge = await tx.ipdCharge.findFirst({ where: { organizationId, sourceModule: order.orderType, sourceRef: order.id } })
  return { charge, deduped: false }
}

/**
 * Per-occurrence billing: ONE unit charged when a scheduled task is completed
 * (nurse ticks DONE). Idempotent per task (sourceRef = TASK:<taskId>). If a prior
 * MISS cancelled the charge, re-activate it. Returns { charge, deduped }.
 */
export async function billOrderTask(tx, organizationId, order, task, actor) {
  const sourceRef = `TASK:${task.id}`
  const existing = await tx.ipdCharge.findFirst({ where: { organizationId, sourceModule: order.orderType, sourceRef } })
  if (existing) {
    if (existing.status !== 'ACTIVE') {
      const re = await tx.ipdCharge.update({ where: { id: existing.id }, data: { status: 'ACTIVE', cancelReason: null, cancelledAt: null } })
      return { charge: re, deduped: false }
    }
    return { charge: existing, deduped: true }
  }
  const data = await buildOrderChargeData(organizationId, order, 1, actor)
  data.sourceModule = order.orderType
  data.sourceRef = sourceRef
  await tx.ipdCharge.createMany({ data: [data], skipDuplicates: true })
  const charge = await tx.ipdCharge.findFirst({ where: { organizationId, sourceModule: order.orderType, sourceRef } })
  return { charge, deduped: false }
}

/**
 * Cancel the per-occurrence charge when a completed task is later un-ticked or
 * marked MISSED/HELD/SKIPPED — so the patient is never billed for a dose/test
 * that did not happen. Best-effort: leaves charges already on a FINAL bill alone.
 */
export async function cancelOrderTaskCharge(tx, organizationId, order, task, reason) {
  const sourceRef = `TASK:${task.id}`
  await tx.ipdCharge.updateMany({
    where: { organizationId, sourceModule: order.orderType, sourceRef, status: 'ACTIVE', billId: null },
    data: { status: 'CANCELLED', cancelReason: reason || 'Task not performed', cancelledAt: new Date() },
  })
}
