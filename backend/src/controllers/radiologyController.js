import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'

// GET /api/radiology?resource=exams|orders|reports
// The standalone Radiology page was removed; this endpoint backs the exam
// catalog + order lookups used by the Consultations screen.
export async function get(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const resource = req.query.resource || 'exams'

    if (resource === 'exams') {
      const exams = await db.radiologyExam.findMany({
        where: { organizationId },
        orderBy: { examName: 'asc' },
      })
      return res.json({ success: true, data: exams })
    }

    if (resource === 'orders') {
      const orders = await db.radiologyOrder.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          exam: true,
          report: true,
        },
      })
      return res.json({ success: true, data: orders })
    }

    if (resource === 'reports') {
      const reports = await db.radiologyReport.findMany({
        where: { order: { organizationId } },
        orderBy: { createdAt: 'desc' },
        include: { order: { include: { exam: true } } },
      })
      return res.json({ success: true, data: reports })
    }

    return res.json({ success: true, data: [] })
  } catch (err) {
    next(err)
  }
}
