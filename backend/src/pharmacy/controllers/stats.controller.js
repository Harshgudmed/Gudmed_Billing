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

    // The dashboard's low-stock and expiring PREVIEW lists carry a search box.
    // They were filtered in the browser over the top-20 preview, so a drug that
    // sorted past the 20 shown could never be found by searching. The search is
    // applied in the DB here instead — the preview stays capped at 20, but at 20
    // rows that MATCH, drawn from the whole table. The KPI counts below stay
    // whole-pharmacy totals and ignore the search.
    const search = (req.query.search || '').trim()
    const like = `%${search}%`

    const [
      totalDrugs,
      lowStockRaw,
      inStockRaw,
      outOfStockCount,
      expiringCount,
      stockValueRaw,
      pendingPrescriptions,
      todaySalesAgg,
      lowStockDrugs,
      expiringBatches,
    ] = await Promise.all([
      db.pharmacyDrug.count({ where: { organizationId: ORGANIZATION_ID, isActive: true } }),
      // Raw query required: Prisma ORM count cannot compare two columns.
      // "Low stock" means some left but at/under reorder — a drug at ZERO is Out
      // of Stock, a separate card. Counting `<= reorderLevel` put every empty
      // drug in BOTH cards, so Low + Out double-counted the empties.
      db.$queryRaw`
        SELECT COUNT(*)::int AS count FROM "PharmacyDrug"
        WHERE "organizationId" = ${ORGANIZATION_ID}
          AND "isActive" = true
          AND "quantityInStock" > 0
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
      // The real count of batches expiring within 90 days — the KPI card used the
      // 20-row preview's length, so it never read past 20 (and now would shrink
      // when the preview is searched).
      db.pharmacyBatch.count({
        where: {
          status: 'active',
          quantityRemaining: { gt: 0 },
          expiryDate: { lte: in90Days },
          drug: { organizationId: ORGANIZATION_ID },
        },
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
      // A cancelled sale (invoice cancel/reversal voids the PharmacySale rather
      // than deleting it, so stock returns can be traced) must not still count
      // as revenue — otherwise "today's sales" overstates cash actually taken.
      db.pharmacySale.aggregate({
        where: {
          organizationId: ORGANIZATION_ID,
          createdAt: { gte: today, lt: tomorrow },
          paymentStatus: { not: 'cancelled' },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Top low-stock drugs (preview list) — DB filtered + limited. Excludes
      // empties (those are Out of Stock), and honours the dashboard search so a
      // match past the first 20 is still found. `${search} = ''` makes the
      // search clause a no-op when the box is empty.
      db.$queryRaw`
        SELECT "id", "drugName", "drugCategory", "quantityInStock", "reorderLevel"
        FROM "PharmacyDrug"
        WHERE "organizationId" = ${ORGANIZATION_ID}
          AND "isActive" = true
          AND "quantityInStock" > 0
          AND "quantityInStock" <= "reorderLevel"
          AND (${search} = '' OR "drugName" ILIKE ${like} OR "drugCategory" ILIKE ${like})
        ORDER BY "quantityInStock" ASC
        LIMIT 20
      `,
      // Batches expiring within 90 days (preview list), honouring the search.
      db.pharmacyBatch.findMany({
        where: {
          status: 'active',
          quantityRemaining: { gt: 0 },
          expiryDate: { lte: in90Days },
          drug: { organizationId: ORGANIZATION_ID },
          ...(search
            ? {
                OR: [
                  { batchNumber: { contains: search, mode: 'insensitive' } },
                  { drug: { drugName: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {}),
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
        expiringCount,
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
