import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import { startOfToday } from '../../lib/dates.js'

export async function getStats(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    // "Today" = the hospital's day, not the server's (see lib/dates.js).
    const today = startOfToday()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const in90Days = new Date()
    in90Days.setDate(in90Days.getDate() + 90)

    const [
      totalDrugs,
      lowStockRaw,
      inStockRaw,
      outOfStockCount,
      stockValueRaw,
      pendingPrescriptions,
      todaySalesAgg,
      lowStockDrugs,
      expiringBatches,
    ] = await Promise.all([
      db.pharmacyDrug.count({ where: { organizationId: ORGANIZATION_ID, isActive: true } }),
      // Raw query required: Prisma ORM count cannot compare two columns
      db.$queryRaw`
        SELECT COUNT(*)::int AS count FROM "PharmacyDrug"
        WHERE "organizationId" = ${ORGANIZATION_ID}
          AND "isActive" = true
          AND "quantityInStock" <= "reorderLevel"
      `,
      db.$queryRaw`
        SELECT COUNT(*)::int AS count FROM "PharmacyDrug"
        WHERE "organizationId" = ${ORGANIZATION_ID}
          AND "isActive" = true
          AND "quantityInStock" > "reorderLevel"
      `,
      db.pharmacyDrug.count({
        where: { organizationId: ORGANIZATION_ID, isActive: true, quantityInStock: 0 },
      }),
      // Total stock value computed in the DB (scale-safe; never loads the rows).
      db.$queryRaw`
        SELECT COALESCE(SUM("quantityInStock" * COALESCE("sellingPrice", 0)), 0)::float AS value
        FROM "PharmacyDrug"
        WHERE "organizationId" = ${ORGANIZATION_ID} AND "isActive" = true
      `,
      db.prescription.count({
        where: { organizationId: ORGANIZATION_ID, status: 'pending' },
      }),
      db.pharmacySale.aggregate({
        where: { organizationId: ORGANIZATION_ID, createdAt: { gte: today, lt: tomorrow } },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Top low-stock drugs (preview list) — DB filtered + limited.
      db.$queryRaw`
        SELECT "id", "drugName", "drugCategory", "quantityInStock", "reorderLevel"
        FROM "PharmacyDrug"
        WHERE "organizationId" = ${ORGANIZATION_ID}
          AND "isActive" = true
          AND "quantityInStock" <= "reorderLevel"
        ORDER BY "quantityInStock" ASC
        LIMIT 20
      `,
      // Batches expiring within 90 days (preview list).
      db.pharmacyBatch.findMany({
        where: {
          status: 'active',
          quantityRemaining: { gt: 0 },
          expiryDate: { lte: in90Days },
          drug: { organizationId: ORGANIZATION_ID },
        },
        orderBy: { expiryDate: 'asc' },
        take: 20,
        select: {
          id: true,
          batchNumber: true,
          expiryDate: true,
          quantityRemaining: true,
          drug: { select: { drugName: true } },
        },
      }),
    ])

    res.json({
      success: true,
      data: {
        totalDrugs,
        lowStock: lowStockRaw[0]?.count ?? 0,
        inStock: inStockRaw[0]?.count ?? 0,
        outOfStock: outOfStockCount,
        stockValue: stockValueRaw[0]?.value ?? 0,
        pendingPrescriptions,
        todaySalesCount: todaySalesAgg._count.id,
        todaySalesTotal: todaySalesAgg._sum.totalAmount ?? 0,
        lowStockDrugs,
        expiringBatches,
      },
    })
  } catch (err) {
    next(err)
  }
}
