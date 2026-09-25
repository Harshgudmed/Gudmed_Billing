// Single source of truth for inventory movements.
//
// Every stock change (purchase, sale, dispense, return, adjustment, recall, import)
// must go through `recordStockChange` so that `PharmacyDrug.quantityInStock` and the
// append-only `StockLedger` never drift apart. All functions here MUST be called
// inside a `db.$transaction` (they take the `tx` client) so the stock update and the
// ledger row commit atomically.

import { makeError } from './utils.js'
import { startOfToday } from '../lib/dates.js'

/**
 * Apply a signed delta to a drug's stock and append a ledger row.
 * @param tx Prisma transaction client
 * @returns the drug's new quantityInStock
 */
export async function recordStockChange(
  tx,
  { organizationId, drugId, batchId = null, changeType, quantityDelta, reference = null, note = null, createdById = null }
) {
  // Taking stock out is a claim on a shelf that must never be granted twice.
  // The callers check the count and then write, which two counters selling the
  // last strip at the same moment both pass — proven with two simultaneous
  // sales: both succeeded and quantityInStock went to -1. A batch-tracked
  // medicine was saved by the batch guard below; one entered with opening stock
  // and no batch had nothing holding it.
  //
  // So the guard lives HERE, in the one place every movement passes through:
  // the row is decremented only while it still holds enough, and losing that
  // race is a plain refusal rather than a negative number on the shelf.
  let drug
  if (quantityDelta < 0) {
    const needed = -quantityDelta
    const { count } = await tx.pharmacyDrug.updateMany({
      where: {
        id: drugId,
        ...(organizationId ? { organizationId } : {}),
        quantityInStock: { gte: needed },
      },
      data: { quantityInStock: { decrement: needed } },
    })
    if (count === 0) {
      throw makeError(
        'That quantity is no longer in stock — someone else took it a moment ago. Check the stock and try again.',
        409,
        'STOCK_CHANGED',
      )
    }
    drug = await tx.pharmacyDrug.findUnique({ where: { id: drugId }, select: { quantityInStock: true } })
  } else {
    drug = await tx.pharmacyDrug.update({
      where: { id: drugId },
      data: { quantityInStock: { increment: quantityDelta } },
      select: { quantityInStock: true },
    })
  }

  await tx.stockLedger.create({
    data: {
      organizationId,
      drugId,
      batchId,
      changeType,
      quantityDelta,
      balanceAfter: drug.quantityInStock,
      reference,
      note,
      createdById,
    },
  })

  return drug.quantityInStock
}

/**
 * Decrement a drug's batches FIFO (soonest expiry first) by `quantity`.
 * Marks a batch `depleted` when it hits zero. Batch tracking is best-effort —
 * `quantityInStock` remains the authority for blocking a sale.
 * @returns {{ remaining: number, consumed: Array<{batchId, batchNumber, expiryDate, quantity}> }}
 *   `remaining` is the quantity that could NOT be covered by tracked batches (0 when
 *   fully covered). `consumed` lists which batch(es) were drawn from — the caller
 *   uses this to snapshot batch/expiry onto the sale record for the printed receipt.
 */
//
// Expired batches are never handed to a patient. FIFO by expiry used to pick
// the EXPIRED batch first (it expires soonest), so a sale, a dispense, a billed
// medicine and a WhatsApp order all gave out medicine past its date. Stock that
// is out of date still counts in quantityInStock until it is written off, so the
// sellable quantity is checked here too: asking for more than is in date is a
// refusal that says how much is expired, not a quiet fall-back onto it.
// `includeExpired` is for taking stock OUT of the shelf without selling it
// (Adjust Stock → Remove, a write-off), which must be able to reach them.
export async function consumeFromBatches(tx, { drugId, quantity, includeExpired = false }) {
  let remaining = quantity
  const consumed = []
  const today = startOfToday()
  const all = await tx.pharmacyBatch.findMany({
    where: { drugId, status: 'active', quantityRemaining: { gt: 0 } },
    orderBy: { expiryDate: 'asc' },
  })
  const isExpired = (b) => b.expiryDate && b.expiryDate < today
  const batches = includeExpired ? all : all.filter((b) => !isExpired(b))

  if (!includeExpired) {
    const expiredQty = all.filter(isExpired).reduce((s, b) => s + b.quantityRemaining, 0)
    if (expiredQty > 0) {
      const drug = await tx.pharmacyDrug.findUnique({ where: { id: drugId }, select: { drugName: true, quantityInStock: true } })
      const sellable = Math.max(0, (drug?.quantityInStock ?? 0) - expiredQty)
      if (quantity > sellable) {
        throw makeError(
          `${drug?.drugName || 'This medicine'}: only ${sellable} in date — ${expiredQty} unit(s) are past their expiry and cannot be given out. Remove them with Adjust Stock.`,
          422,
          'EXPIRED_STOCK',
          { drugName: drug?.drugName, requested: quantity, available: sellable, expired: expiredQty },
        )
      }
    }
  }

  for (const b of batches) {
    if (remaining <= 0) break
    const take = Math.min(b.quantityRemaining, remaining)
    
    // Atomic update to prevent negative stock race conditions
    const updated = await tx.pharmacyBatch.updateMany({
      where: { id: b.id, quantityRemaining: { gte: take } },
      data: { quantityRemaining: { decrement: take } },
    })
    
    if (updated.count === 0) {
      throw Object.assign(new Error('Batch stock changed concurrently. Please try again.'), { status: 409, code: 'CONCURRENCY_ERROR' })
    }
    
    // Mark as depleted if it reached 0
    const current = await tx.pharmacyBatch.findUnique({ where: { id: b.id }, select: { quantityRemaining: true } })
    if (current && current.quantityRemaining <= 0) {
       await tx.pharmacyBatch.update({ where: { id: b.id }, data: { status: 'depleted' } })
    }
    
    consumed.push({ batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: take })
    remaining -= take
  }

  return { remaining, consumed }
}

/**
 * Validate a list of {drugId, quantity, drugName?} against current stock.
 * Returns an array of shortage objects (empty when everything is available).
 */
export async function findShortages(tx, { organizationId, items }) {
  const stockItems = items.filter((i) => i.drugId && Number(i.quantity) > 0)
  if (!stockItems.length) return []

  const drugs = await tx.pharmacyDrug.findMany({
    where: { id: { in: stockItems.map((i) => i.drugId) }, organizationId },
    select: { id: true, drugName: true, quantityInStock: true },
  })
  const byId = new Map(drugs.map((d) => [d.id, d]))

  // Only IN-DATE stock can be promised: Billing takes the money here and the
  // medicine is handed over later at dispense, which refuses expired batches
  // (consumeFromBatches). Counting them here charged for a medicine the
  // pharmacy then could not give.
  const expired = await tx.pharmacyBatch.groupBy({
    by: ['drugId'],
    where: { drugId: { in: drugs.map((d) => d.id) }, status: 'active', quantityRemaining: { gt: 0 }, expiryDate: { lt: startOfToday() } },
    _sum: { quantityRemaining: true },
  })
  const expiredById = new Map(expired.map((e) => [e.drugId, e._sum.quantityRemaining || 0]))

  const shortages = []
  for (const it of stockItems) {
    const d = byId.get(it.drugId)
    const available = d ? Math.max(0, d.quantityInStock - (expiredById.get(d.id) || 0)) : 0
    if (!d) {
      shortages.push({ drugId: it.drugId, drugName: it.drugName || 'Unknown', requested: it.quantity, available: 0, shortage: it.quantity })
    } else if (available < it.quantity) {
      shortages.push({ drugId: d.id, drugName: d.drugName, requested: it.quantity, available, shortage: it.quantity - available })
    }
  }
  return shortages
}

/** Build the standard 422 INSUFFICIENT_STOCK error from shortage rows. */
export function insufficientStockError(shortages) {
  const summary = shortages
    .map((s) => `${s.drugName}: requested ${s.requested}, available ${s.available} (short ${s.shortage})`)
    .join('; ')
  return makeError(`Insufficient stock — ${summary}`, 422, 'INSUFFICIENT_STOCK', { shortages })
}
