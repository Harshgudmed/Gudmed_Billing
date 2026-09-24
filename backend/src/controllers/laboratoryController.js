import { db } from '../config/db.js'
import { getOrgId, getActor, safeMoney } from "../lib/reqContext.js";
import { isOwned } from '../lib/tenant.js'
import { stripIdentity } from '../lib/stripIdentity.js'
import { patientSearchWhere } from '../lib/patientSearch.js'
import { nextSeriesNumber } from "../lib/counters.js";
import { resolveRequestedById } from '../lib/requestedBy.js'
import { todayRange, dayRange, parseScheduleDay } from '../lib/dates.js'
import { listResponse } from '../lib/pagination.js'
import { z } from 'zod'
import { PATIENT_SNAPSHOT_SELECT } from '../utils/patientSnapshot.js'
import { auditIpd } from '../inpatient/audit.js'

// ── Zod schemas ────────────────────────────────────────────────────────────────

const createTestSchema = z.object({
  testName: z.string().min(1),
  testCode: z.string().optional(),
  testCategory: z.string().optional(),
  testType: z.string().optional(),
  specimenType: z.string().optional(),
  specimenVolume: z.string().optional(),
  specimenContainer: z.string().optional(),
  unit: z.string().optional(),
  referenceRanges: z.string().optional(),
  referenceMin: z.number().optional(),
  referenceMax: z.number().optional(),
  criticalLow: z.number().optional(),
  criticalHigh: z.number().optional(),
  price: z.number().optional(),
  turnaroundTime: z.number().int().optional(),
  department: z.string().optional(),
  preparationInstructions: z.string().optional(),
  clinicalSignificance: z.string().optional(),
})

const createOrderSchema = z.object({
  patientId: z.string().min(1),
  consultationId: z.string().optional(),
  tests: z.array(z.any()).min(1),
  clinicalIndication: z.string().optional(),
  provisionalDiagnosis: z.string().optional(),
  priority: z.string().optional(),
  notes: z.string().optional(),
  // 'YYYY-MM-DD' — the day the patient is due. Blank = the day it is billed.
  scheduledDate: z.string().optional(),
})

const createResultSchema = z.object({
  orderId: z.string().min(1),
  testId: z.string().min(1),
  resultValue: z.string().optional(),
  resultUnit: z.string().optional(),
  isAbnormal: z.boolean().optional(),
  isCritical: z.boolean().optional(),
  flag: z.string().optional(),
  comment: z.string().optional(),
})

const updateOrderSchema = z.object({
  id: z.string().min(1),
}).passthrough()

const updateResultSchema = z.object({
  id: z.string().min(1),
}).passthrough()

const updateTestSchema = z.object({
  id: z.string().min(1),
}).passthrough()

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Who signs a result — the acting user, but only once they are proved to be THIS
 * hospital's user.
 *
 * Deliberately NOT resolveRequestedById: that falls back to the org's oldest
 * active user so a system-raised order always has a requester. Doing the same
 * here would print a real pathologist's name under a value they never saw. An
 * unattributable result must stay blank instead.
 */
async function signerId(client, organizationId, req) {
  const id = getActor(req).id
  if (!id) return null
  const user = await client.user.findFirst({ where: { id, organizationId }, select: { id: true } })
  return user?.id ?? null
}

// ── Controllers ────────────────────────────────────────────────────────────────

export const getAll = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource, testCategory, status, priority, orderId, search, startDate, endDate, dateOn } = req.query

    // Pagination. NOTE: a second `Math.min(limit, 1000)` used to sit below this and
    // silently overrode the 2000 cap, so `?limit=2000` returned only 1000 rows and
    // the rest of the catalogue was unreachable (1607 tests → 607 invisible).
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 2000)
    const offset = Math.max(0, parseInt(req.query.offset) || 0)

    if (resource === 'tests') {
      const where = { organizationId: ORGANIZATION_ID, isActive: true }
      if (testCategory) where.testCategory = testCategory
      // Server-side search, so a picker never has to download the whole catalogue
      // (mirrors pharmacy/controllers/drug.controller.js).
      if (search) {
        where.OR = [
          { testName: { contains: search, mode: 'insensitive' } },
          { testCode: { contains: search, mode: 'insensitive' } },
          { testCategory: { contains: search, mode: 'insensitive' } },
        ]
      }

      const body = await listResponse(db.labTest, {
        where,
        orderBy: [{ testCategory: 'asc' }, { testName: 'asc' }],
        req,
        fullListTake: 2000,
      })
      return res.json(body)
    }

    if (resource === 'orders') {
      const where = { organizationId: ORGANIZATION_ID }
      // `status` accepts one value or a comma-separated list. The lab screens ask
      // for GROUPS of statuses ("open" = pending + sample_collected + in_progress);
      // with single-value matching only, they had to pull the whole table and
      // split it in the browser, which silently dropped rows past the cap.
      if (status) {
        const wanted = String(status).split(',').map((s) => s.trim()).filter(Boolean)
        if (wanted.length > 1) where.status = { in: wanted }
        else if (wanted.length === 1) where.status = wanted[0]
      }
      if (priority) where.priority = priority
      const searchWhere = patientSearchWhere(search, 'patient', (term) => [
        { orderNumber: { contains: term, mode: 'insensitive' } },
      ])
      if (searchWhere) Object.assign(where, searchWhere)
      // Whole days in the hospital's timezone (the shared dayRange), on the date
      // the screen is actually about: Orders asks when it was ordered, the
      // Reports tab (completed orders) asks when the result went out.
      if ((startDate || endDate) && dateOn === 'scheduled') {
        // "Who is due on these days" — every order stores its day (see schema).
        where.scheduledDate = dayRange(startDate, endDate)
      } else if (startDate || endDate) {
        where[dateOn === 'completed' ? 'resultsReportedAt' : 'orderDate'] = dayRange(startDate, endDate)
      }
      const body = await listResponse(db.labOrder, {
        where,
        include: {
          patient: { select: PATIENT_SNAPSHOT_SELECT },
          results: { include: { test: true } },
          // The referring doctor is stored but was never sent, so every printed
          // lab report said "Ref Doctor: self" no matter who raised the order.
          requestedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        req,
        fullListTake: 2000,
      })
      return res.json(body)
    }

    if (resource === 'results') {
      const where = { organizationId: ORGANIZATION_ID }
      if (orderId) where.orderId = orderId
      const body = await listResponse(db.labResult, {
        where,
        include: {
          test: true,
          order: { include: { patient: { select: PATIENT_SNAPSHOT_SELECT } } },
          // Who ran the test and who signed it off. Both ids were stored and
          // neither was sent, so the report footer printed a placeholder and a
          // dash — a signed-off pathology report with no pathologist on it.
          enteredBy: { select: { fullName: true } },
          verifiedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        req,
        fullListTake: 2000,
      })
      return res.json(body)
    }

    if (resource === 'stats') {
      const baseWhere = { organizationId: ORGANIZATION_ID }

      const [pending, sampleCollected, inProgress, completedToday, criticalResults, totalTests] =
        await Promise.all([
          db.labOrder.count({ where: { ...baseWhere, status: 'pending' } }),
          db.labOrder.count({ where: { ...baseWhere, status: 'sample_collected' } }),
          db.labOrder.count({ where: { ...baseWhere, status: 'in_progress' } }),
          db.labOrder.count({
            where: { ...baseWhere, status: 'completed', resultsReportedAt: todayRange() },
          }),
          // Scoped through the parent order: LabResult.organizationId is nullable,
          // so the org filter has to come from the LabOrder it belongs to. Without
          // it this tile counted EVERY hospital's unverified criticals — one
          // tenant's alarm number driven by another tenant's patients.
          db.labResult.count({
            where: { isCritical: true, verifiedAt: null, order: { organizationId: ORGANIZATION_ID } },
          }),
          db.labTest.count({ where: { organizationId: ORGANIZATION_ID, isActive: true } }),
        ])

      return res.json({
        success: true,
        data: { pending, sampleCollected, inProgress, completedToday, criticalResults, totalTests },
      })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource parameter' })
  } catch (err) {
    next(err)
  }
}

export const create = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'test') {
      const parsed = createTestSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      // Reject a negative/non-numeric price before it flows into billing.
      if (parsed.data.price !== undefined && safeMoney(parsed.data.price) === null) {
        return res.status(400).json({ success: false, error: 'price must be a non-negative number' })
      }

      const data = await db.labTest.create({
        data: {
          ...parsed.data,
          organizationId: ORGANIZATION_ID,
          isActive: true,
        },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'order') {
      const parsed = createOrderSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { patientId, consultationId, tests, clinicalIndication, provisionalDiagnosis, priority, notes } =
        parsed.data
      // Blank → undefined, so the column's database default (now) applies.
      const scheduledDate = parsed.data.scheduledDate ? parseScheduleDay(parsed.data.scheduledDate) : undefined

      const actorId = getActor(req).id
      // The order number is drawn from the atomic per-org counter inside the same
      // transaction as the insert, so two orders raised in the same millisecond
      // cannot collide on the @unique orderNumber (which `LAB${Date.now()}` did).
      // patientId is caller-supplied: without this an order (and the patient
      // demographics echoed back in the response) could be attached to another
      // hospital's patient. Shared isOwned tenant guard.
      if (!(await isOwned('patient', patientId, ORGANIZATION_ID))) {
        return res.status(404).json({ success: false, error: 'Patient not found' })
      }

      const data = await db.$transaction(async (tx) => {
        const orderNumber = await nextSeriesNumber(tx, ORGANIZATION_ID, 'LAB_ORDER', 'LAB')
        const requestedById = await resolveRequestedById(tx, ORGANIZATION_ID, actorId)

        return tx.labOrder.create({
          data: {
            orderNumber,
            organizationId: ORGANIZATION_ID,
            patientId,
            consultationId: consultationId || null,
            requestedById,
            tests: JSON.stringify(tests),
            clinicalIndication,
            provisionalDiagnosis,
            priority,
            notes,
            scheduledDate,
            status: 'pending',
          },
          // Return the patient too, so the freshly-created order shows the real
          // name in the UI immediately (not "Unknown" until the next refresh).
          include: {
            patient: {
              select: PATIENT_SNAPSHOT_SELECT,
            },
          },
        })
      })
      return res.json({ success: true, data })
    }

    if (resource === 'result') {
      const parsed = createResultSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { orderId, testId, resultValue, resultUnit, isAbnormal, isCritical, flag, comment } =
        parsed.data

      // Tenant guard: only attach a result to an order/test that belong to this
      // org, otherwise a caller could bind a result onto another org's records.
      const ownedOrder = await db.labOrder.findFirst({
        where: { id: orderId, organizationId: getOrgId(req) },
        select: { id: true },
      })
      if (!ownedOrder) return res.status(404).json({ success: false, error: 'Lab order not found' })

      const ownedTest = await db.labTest.findFirst({
        where: { id: testId, organizationId: getOrgId(req) },
        select: { id: true },
      })
      if (!ownedTest) return res.status(404).json({ success: false, error: 'Lab test not found' })

      // One value per test per order. Saving a draft and coming back to finish
      // it posted a SECOND row for the same test: the report then carried two
      // haemoglobins, and which one printed depended on which the query found
      // first. There is no unique index to lean on yet (existing data would have
      // to be de-duplicated before one could be added), so the rule is enforced
      // here — the second save updates the first row instead of adding to it.
      const fields = {
        resultValue,
        resultUnit,
        isAbnormal,
        isCritical,
        flag,
        comment,
        // Taken from the session, never from the body: a lab report is a signed
        // clinical document, and until now nobody's name was recorded against
        // the value at all, so the printout said "Lab Technologist".
        enteredById: await signerId(db, getOrgId(req), req),
      }
      const existingResult = await db.labResult.findFirst({
        where: { organizationId: getOrgId(req), orderId, testId },
        select: { id: true, verifiedAt: true },
      })
      if (existingResult?.verifiedAt) {
        return res.status(409).json({
          success: false,
          error: 'This test has already been verified. Amend the verified result instead of entering it again.',
          code: 'RESULT_ALREADY_VERIFIED',
        })
      }
      const data = existingResult
        ? await db.labResult.update({ where: { id: existingResult.id }, data: fields })
        : await db.labResult.create({
            data: { organizationId: getOrgId(req), orderId, testId, ...fields },
          })
      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource value' })
  } catch (err) {
    next(err)
  }
}

export const update = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'order') {
      const parsed = updateOrderSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      // `rescheduleReason` is why the day moved — it goes to the audit trail,
      // not a column, so it must not reach Prisma through `...updates`.
      const { id, resource: _r, rescheduleReason, ...updates } = parsed.data

      // Strip identity/tenant fields so a passthrough body can't relocate this
      // order to another org or corrupt its identity via the `...updates` spread.
      stripIdentity(updates, 'labOrder')
      // The accession number labels the physical tube, so it is minted HERE and
      // never accepted from the client. The UI used to build it as
      // `ACC-${Math.floor(Math.random() * 10000)}` — 10,000 possible values
      // against a @@unique column, which by the birthday bound is more likely
      // than not to repeat within ~118 samples and then 500s in front of a
      // technician holding the tube. Worse, it called that twice per collection,
      // once for this request and once for the on-screen copy, so the number
      // printed on the tube was never the number stored against the order.

      // Tenant guard: only touch an order that belongs to this org.
      const owned = await db.labOrder.findFirst({
        where: { id, organizationId: ORGANIZATION_ID },
        select: { id: true, status: true, orderNumber: true, scheduledDate: true },
      })
      if (!owned) return res.status(404).json({ success: false, error: 'Lab order not found' })

      // Moving the day the patient is due (they could not come, or were told to
      // come later). Only while the sample is still to be drawn — after that the
      // visit has happened. A reason is required and kept in the audit trail.
      if (updates.scheduledDate !== undefined) {
        if (owned.status !== 'pending') {
          return res.status(409).json({
            success: false,
            title: "Can't reschedule",
            error: 'The sample has already been collected for this order, so its date can no longer be changed.',
          })
        }
        if (!String(rescheduleReason || '').trim()) {
          return res.status(400).json({ success: false, title: 'Reason needed', error: 'Please give a reason for rescheduling.' })
        }
        const scheduledDate = parseScheduleDay(updates.scheduledDate)
        // Compare-and-set, as with cancel: a sample collected in the same instant wins.
        const { count } = await db.labOrder.updateMany({
          where: { id, organizationId: ORGANIZATION_ID, status: 'pending' },
          data: { scheduledDate },
        })
        if (count === 0) {
          return res.status(409).json({ success: false, title: "Can't reschedule", error: 'The sample has just been collected for this order.' })
        }
        await auditIpd(req, ORGANIZATION_ID, {
          action: 'reschedule',
          entityType: 'lab.order',
          entityId: id,
          before: { scheduledDate: owned.scheduledDate },
          after: { scheduledDate, rescheduleReason: String(rescheduleReason).trim() },
        })
        const data = await db.labOrder.findFirst({ where: { id, organizationId: ORGANIZATION_ID } })
        return res.json({ success: true, data })
      }

      // Closing an order the patient never came for (they went elsewhere, or did
      // not return). Three rules, checked here and not only on the screen:
      //  - only while nothing has been done: once the sample is drawn the work
      //    exists, and cancelling would drop a real result off the worklist;
      //  - never an order paid at Billing (billing names it LAB-<invoice number>,
      //    see lib/invoiceFulfillment.js): cancelling it here would leave the
      //    patient's money taken for nothing — that is Billing's cancel, which
      //    refunds;
      //  - with a reason, kept on the order (rejectionReason), so the record says
      //    why it was closed. Nothing is deleted.
      if (updates.status === 'cancelled') {
        if (owned.status !== 'pending') {
          return res.status(409).json({
            success: false,
            title: "Can't cancel this order",
            error: 'The sample has already been collected for this order, so it can no longer be cancelled.',
          })
        }
        const paidOn = owned.orderNumber?.startsWith('LAB-')
          ? await db.invoice.findFirst({
            where: { organizationId: ORGANIZATION_ID, invoiceNumber: owned.orderNumber.slice(4) },
            select: { invoiceNumber: true },
          })
          : null
        if (paidOn) {
          return res.status(409).json({
            success: false,
            title: 'Paid at Billing',
            error: `This order was paid on invoice ${paidOn.invoiceNumber}. Cancel it from Billing so the patient is refunded.`,
          })
        }
        if (!String(updates.rejectionReason || '').trim()) {
          return res.status(400).json({ success: false, title: 'Reason needed', error: 'Please give a reason for cancelling this order.' })
        }
      }

      const data = await db.$transaction(async (tx) => {
        // Cancel only if the order is STILL pending at the moment of writing — a
        // technician collecting the sample in the same instant must win, not be
        // silently overwritten by a cancel read a moment earlier.
        if (updates.status === 'cancelled') {
          const { count } = await tx.labOrder.updateMany({
            where: { id, organizationId: ORGANIZATION_ID, status: 'pending' },
            data: { status: 'cancelled', rejectionReason: String(updates.rejectionReason).trim() },
          })
          if (count === 0) {
            throw Object.assign(new Error('The sample has already been collected for this order, so it can no longer be cancelled.'), { status: 409 })
          }
          return tx.labOrder.findFirst({ where: { id, organizationId: ORGANIZATION_ID } })
        }
        // First collection only. Re-collecting, or any later status change, must
        // not renumber a tube that is already on a rack in the lab.
        if (updates.status === 'sample_collected') {
          const accessionNumber = await nextSeriesNumber(tx, ORGANIZATION_ID, 'LAB_ACCESSION', 'ACC')
          // Compare-and-set: only claim the number if the order still has none.
          // A double-clicked Collect button would otherwise relabel the tube with
          // a second number after the first one was already written and printed.
          // A losing click leaves a gap in the series, which is harmless.
          await tx.labOrder.updateMany({
            where: { id, organizationId: ORGANIZATION_ID, accessionNumber: null },
            data: { accessionNumber },
          })
        }
        return tx.labOrder.update({ where: { id }, data: { ...updates } })
      })
      return res.json({ success: true, data })
    }

    if (resource === 'result') {
      const parsed = updateResultSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      // `amendmentReason` is WHY the change is being made, not a column on the
      // result — it belongs in the audit trail. The schema is .passthrough(), so
      // left in it would reach Prisma as an unknown field and fail the write.
      const { id, resource: _r, amendmentReason: _reason, ...updates } = parsed.data

      // Strip identity/tenant fields so a passthrough body can't reattach this
      // result to another org's order or corrupt its identity via `...updates`.
      stripIdentity(updates, 'labResult')

      // Tenant guard via the parent order's org (LabResult.organizationId is nullable,
      // so verify ownership through the order it belongs to). Blocks cross-tenant
      // tampering with clinical result values.
      const owned = await db.labResult.findFirst({
        where: { id, order: { organizationId: ORGANIZATION_ID } },
        select: {
          id: true, verifiedAt: true, resultValue: true, resultUnit: true,
          isAbnormal: true, isCritical: true, flag: true, comment: true,
        },
      })
      if (!owned) return res.status(404).json({ success: false, error: 'Lab result not found' })

      // Whoever signs it off is the logged-in user, not whatever the body claims.
      if (updates.verifiedAt) updates.verifiedById = await signerId(db, ORGANIZATION_ID, req)

      // A verified result is a signed clinical document. Changing one was a
      // plain update: a critical value could be turned normal and nothing on the
      // record said it had ever been anything else. An amendment is allowed —
      // results are corrected in real labs — but it must be asked for, and it
      // must say why.
      const CLINICAL = ['resultValue', 'resultUnit', 'isAbnormal', 'isCritical', 'flag', 'comment']
      const changed = CLINICAL.filter((f) => updates[f] !== undefined && updates[f] !== owned[f])
      const reason = String(req.body?.amendmentReason || '').trim()
      if (owned.verifiedAt && changed.length && !reason) {
        return res.status(409).json({
          success: false,
          error: 'This result is already verified. To change it, give the reason for the amendment.',
          code: 'AMENDMENT_REASON_REQUIRED',
        })
      }

      const data = await db.labResult.update({
        where: { id },
        data: { ...updates },
      })

      // Every change to a verified result leaves a trace — who, when, from what
      // to what, and why. Uses the shared audit writer (inpatient/audit.js),
      // which OT already borrows; this is not an IPD-only concern.
      if (owned.verifiedAt && changed.length) {
        await auditIpd(req, ORGANIZATION_ID, {
          action: 'amend',
          entityType: 'lab.result',
          entityId: id,
          before: Object.fromEntries(changed.map((f) => [f, owned[f]])),
          after: { ...Object.fromEntries(changed.map((f) => [f, data[f]])), amendmentReason: reason },
        })
      }
      return res.json({ success: true, data })
    }

    if (resource === 'test') {
      const parsed = updateTestSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { id, resource: _r, ...updates } = parsed.data

      // Strip identity/tenant fields so a passthrough body can't relocate this
      // test catalog entry to another org via the `...updates` spread.
      stripIdentity(updates, 'labTest')

      // Reject a negative/non-numeric price on update too (passthrough schema
      // doesn't type-check it), so it can't slip back in via edit.
      if (updates.price !== undefined && safeMoney(updates.price) === null) {
        return res.status(400).json({ success: false, error: 'price must be a non-negative number' })
      }

      // Tenant guard: only touch a test catalog entry that belongs to this org.
      const owned = await db.labTest.findFirst({ where: { id, organizationId: ORGANIZATION_ID }, select: { id: true } })
      if (!owned) return res.status(404).json({ success: false, error: 'Lab test not found' })

      const data = await db.labTest.update({
        where: { id },
        data: { ...updates },
      })
      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource value' })
  } catch (err) {
    next(err)
  }
}
