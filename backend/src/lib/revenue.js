// Today's Revenue — the one figure Billing's tile and the main Dashboard both show.
//
// Owner's rule (Oct 2026): money taken at every counter today (the hospital's
// calendar day, lib/dates.js), minus refunds paid out today.
//
//   in : Billing payments (OPD, lab, radiology, and Day Care / Ambulance, whose
//        money is taken on Billing invoices — so they are not added again)
//        + pharmacy counter sales + IPD collections (payments and advances)
//   out: OPD refunds approved today + IPD refunds paid today
//
// A pharmacy sale that carries a Billing receipt or invoice number (a WhatsApp
// order records both; old billing-raised sales used the invoice number) is
// already a Billing payment and is not counted twice. A cancelled sale is out.
//
// Every sum runs in the database; nothing is loaded row by row.
import { todayRange } from './dates.js'
import { round2 } from './money.js'

export async function todayRevenue(client, organizationId, range = todayRange()) {
  const { gte, lte } = range
  const [billing, refunds, ipdIn, ipdOut, pharmacy] = await Promise.all([
    client.payment.aggregate({ where: { organizationId, isRefund: false, paymentDate: { gte, lte } }, _sum: { amount: true } }),
    client.payment.aggregate({ where: { organizationId, isRefund: true, status: 'APPROVED', approvalDate: { gte, lte } }, _sum: { amount: true } }),
    client.billPayment.aggregate({ where: { organizationId, status: 'SUCCESS', type: { in: ['PAYMENT', 'ADVANCE'] }, paidAt: { gte, lte } }, _sum: { amount: true } }),
    client.billPayment.aggregate({ where: { organizationId, status: 'SUCCESS', type: 'REFUND', paidAt: { gte, lte } }, _sum: { amount: true } }),
    client.$queryRaw`
      SELECT COALESCE(SUM(s."amountPaid"), 0)::float AS total
      FROM "PharmacySale" s
      WHERE s."organizationId" = ${organizationId}
        AND s."saleDate" BETWEEN ${gte} AND ${lte}
        AND s."paymentStatus" <> 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."organizationId" = s."organizationId" AND p."receiptNumber" = s."receiptNumber")
        AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."organizationId" = s."organizationId" AND i."invoiceNumber" = s."receiptNumber")`,
  ])
  const parts = {
    billing: round2(billing._sum.amount || 0),
    pharmacy: round2(pharmacy[0]?.total || 0),
    ipd: round2(ipdIn._sum.amount || 0),
    // IPD refunds are stored negative; OPD refunds positive.
    refunds: round2((refunds._sum.amount || 0) - (ipdOut._sum.amount || 0)),
  }
  return { total: round2(parts.billing + parts.pharmacy + parts.ipd - parts.refunds), ...parts }
}
