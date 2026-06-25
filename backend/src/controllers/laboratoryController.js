import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'

// GET /api/laboratory?resource=tests|orders|results
// The standalone Laboratory page was removed; this endpoint backs the lab-test
// catalog + order lookups used by the Consultations screen.
export async function get(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const resource = req.query.resource || 'tests'

    if (resource === 'tests') {
      const tests = await db.labTest.findMany({
        where: { organizationId },
        orderBy: { testName: 'asc' },
      })
      return res.json({ success: true, data: tests })
    }

    if (resource === 'orders') {
      const orders = await db.labOrder.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          results: { include: { test: true } },
        },
      })
      return res.json({ success: true, data: orders })
    }

    if (resource === 'results') {
      const results = await db.labResult.findMany({
        where: { order: { organizationId } },
        orderBy: { createdAt: 'desc' },
        include: { test: true },
      })
      return res.json({ success: true, data: results })
    }

    return res.json({ success: true, data: [] })
  } catch (err) {
    next(err)
  }
}
