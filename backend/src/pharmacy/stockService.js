// Single source of truth for inventory movements.
//
// Every stock change (purchase, sale, dispense, return, adjustment, recall, import)
// must go through `recordStockChange` so that `PharmacyDrug.quantityInStock` and the
// append-only `StockLedger` never drift apart. All functions here MUST be called
// inside a `db.$transaction` (they take the `tx` client) so the stock update and the
// ledger row commit atomically.

import { makeError } from './utils.js'

/**
 * Apply a signed delta to a drug's stock and append a ledger row.
 * @param tx Prisma transaction client
 * @returns the drug's new quantityInStock
 */
export async function recordStockChange(
  tx,
  { organizationId, drugId, batchId = null, changeType, quantityDelta, reference = null, note = null, createdById = null }
) {
  const drug = await tx.pharmacyDrug.update({
    where: { id: drugId },
    data: { quantityInStock: { increment: quantityDelta } },
    select: { quantityInStock: true },
  })

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
 * Marks a batch `depleted` when it hits zero. Returns the quantity that could
 * NOT be covered by tracked batches (0 when fully covered). Batch tracking is
 * best-effort — `quantityInStock` remains the authority for blocking a sale.
 */
export async function consumeFromBatches(tx, { drugId, quantity }) {
  let remaining = quantity
  const batches = await tx.pharmacyBatch.findMany({
    where: { drugId, status: 'active', quantityRemaining: { gt: 0 } },
    orderBy: { expiryDate: 'asc' },
  })

  for (const b of batches) {
    if (remaining <= 0) break
    const take = Math.min(b.quantityRemaining, remaining)
    await tx.pharmacyBatch.update({
      where: { id: b.id },
      data: {
        quantityRemaining: { decrement: take },
        ...(b.quantityRemaining - take === 0 ? { status: 'depleted' } : {}),
      },
    })
    remaining -= take
  }

  return remaining
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

  const shortages = []
  for (const it of stockItems) {
    const d = byId.get(it.drugId)
    if (!d) {
      shortages.push({ drugId: it.drugId, drugName: it.drugName || 'Unknown', requested: it.quantity, available: 0, shortage: it.quantity })
    } else if (d.quantityInStock < it.quantity) {
      shortages.push({ drugId: d.id, drugName: d.drugName, requested: it.quantity, available: d.quantityInStock, shortage: it.quantity - d.quantityInStock })
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
