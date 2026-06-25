import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";

export async function getStats(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [
      totalDrugs,
      lowStockRaw,
      outOfStockCount,
      pendingPrescriptions,
      todaySalesAgg,
    ] = await Promise.all([
      db.pharmacyDrug.count({ where: { organizationId: ORGANIZATION_ID, isActive: true } }),
      // Raw query required: Prisma ORM count does not support comparing two columns
      db.$queryRaw`
        SELECT COUNT(*)::int AS count FROM "PharmacyDrug"
        WHERE "organizationId" = ${ORGANIZATION_ID}
          AND "isActive" = true
          AND "quantityInStock" <= "reorderLevel"
      `,
      db.pharmacyDrug.count({
        where: { organizationId: ORGANIZATION_ID, isActive: true, quantityInStock: 0 },
      }),
      db.prescription.count({
        where: { organizationId: ORGANIZATION_ID, status: 'pending' },
      }),
      db.pharmacySale.aggregate({
        where: { organizationId: ORGANIZATION_ID, createdAt: { gte: today, lt: tomorrow } },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ])

    res.json({
      success: true,
      data: {
        totalDrugs,
        lowStock: lowStockRaw[0]?.count ?? 0,
        outOfStock: outOfStockCount,
        pendingPrescriptions,
        todaySalesCount: todaySalesAgg._count.id,
        todaySalesTotal: todaySalesAgg._sum.totalAmount ?? 0,
      },
    })
  } catch (err) {
    next(err)
  }
}
