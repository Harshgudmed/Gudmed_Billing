import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { scopedDoctorId } from '../utils/scope.js'
import { assertValidShift, assertNoSelfOverlap } from '../lib/activeDoctor.js'
import { roomIdsInTimetable } from '../lib/doctorTimetable.js'

// Accepts an ISO calendar date (YYYY-MM-DD) or a full ISO datetime whose date
// part is a real calendar date, and returns the canonical YYYY-MM-DD string.
// Returns null for anything else (empty, dd/mm/yyyy, MM/DD/YYYY, overflow like
// 2026-02-31) so callers can reject it. This is what keeps isOnLeave()'s
// slice(0,10) match working — only ISO dates are ever stored.
function normalizeIsoDate(raw) {
  const s = String(raw ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s)
  if (!m) return null
  const ymd = `${m[1]}-${m[2]}-${m[3]}`
  const dt = new Date(`${ymd}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return null
  // Reject calendar overflow (e.g. 2026-02-31 → 2026-03-03).
  if (dt.toISOString().slice(0, 10) !== ymd) return null
  return ymd
}

export async function handleGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource, doctorId, status, period } = req.query

    // A logged-in doctor only ever sees their own accountability data.
    const myDoctorId = scopedDoctorId(req)

    // Pagination is OPT-IN: a caller that passes neither `limit` nor `offset`
    // gets the FULL list. The Doctor-Timetable view and the commission/doctor
    // dropdowns read every doctor (a small, bounded set) and pass no paging —
    // defaulting them to a 10-row page silently hid all but the first 10 doctors
    // (the timetable showed ~10 of 1,100). Explicit limit/offset still pages the
    // big table views.
    const wantsPaging = req.query.limit !== undefined || req.query.offset !== undefined
    let limit = parseInt(req.query.limit) || 10
    let offset = parseInt(req.query.offset) || 0
    limit = Math.max(1, Math.min(limit, 1000))
    offset = Math.max(0, offset)
    const pageArgs = wantsPaging ? { take: limit, skip: offset } : {}

    if (resource === 'doctors') {
      const where = { organizationId: ORG_ID, role: 'doctor', isActive: true, ...(myDoctorId ? { id: myDoctorId } : {}) }
      const [doctors, total] = await Promise.all([
        db.user.findMany({
          where,
          // An explicit select, never `include`. `include` returns every column
          // of User — which sent 1,128 doctors' passwordHash and invitationToken
          // to the browser on every load of this screen. An invitation token is
          // live credential material: it is @unique and redeems into an account.
          // _count.feeSlabs replaces a second request that pulled all 3,384 slab
          // rows (1.1 MB) purely to count them per doctor.
          select: {
            id: true,
            fullName: true,
            specialization: true,
            isActive: true,
            consultationFee: true,
            department: { select: { id: true, name: true } },
            commissionConfig: true,
            _count: { select: { feeSlabs: true } },
          },
          orderBy: { fullName: 'asc' },
          ...pageArgs,
        }),
        db.user.count({ where }),
      ])

      const hasMore = wantsPaging ? (offset + limit) < total : false
      const page = wantsPaging ? Math.floor(offset / limit) + 1 : 1
      const totalPages = wantsPaging ? Math.ceil(total / limit) : 1

      return res.json({
        success: true,
        data: doctors,
        meta: { total, limit: wantsPaging ? limit : total, offset, page, totalPages, hasMore }
      })
    }

    if (resource === 'commissions') {
      // Always scope to the caller's org — never start with an empty where.
      const where = { organizationId: ORG_ID }
      if (doctorId) where.doctorId = doctorId
      if (status) where.status = status
      if (period) where.period = period
      // Force a doctor's own id regardless of any doctorId query param.
      if (myDoctorId) where.doctorId = myDoctorId

      const [commissions, total] = await Promise.all([
        db.doctorCommission.findMany({
          where,
          include: {
            doctor: { select: { id: true, fullName: true } },
            settledBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
          ...pageArgs,
        }),
        db.doctorCommission.count({ where }),
      ])

      const hasMore = wantsPaging ? (offset + limit) < total : false
      const page = wantsPaging ? Math.floor(offset / limit) + 1 : 1
      const totalPages = wantsPaging ? Math.ceil(total / limit) : 1

      return res.json({
        success: true,
        data: commissions,
        meta: { total, limit: wantsPaging ? limit : total, offset, page, totalPages, hasMore }
      })
    }

    if (resource === 'stats') {
      const doctors = await db.user.findMany({
        where: { organizationId: ORG_ID, role: 'doctor', ...(myDoctorId ? { id: myDoctorId } : {}) }, // a doctor sees only their own stats
        include: {
          commissionConfig: true,
          commissions: true,
        },
      })
      const stats = doctors.map(d => {
        const commissions = d.commissions || []
        const pending = commissions.filter(c => c.status === 'pending')
        const settled = commissions.filter(c => c.status === 'settled')
        return {
          doctorId: d.id,
          doctorName: d.fullName,
          commissionRate: d.commissionConfig?.commissionRate || 0,
          commissionType: d.commissionConfig?.commissionType || 'percentage',
          isActive: d.commissionConfig?.isActive || false,
          totalCommissions: commissions.length,
          pendingCount: pending.length,
          settledCount: settled.length,
          pendingAmount: pending.reduce((s, c) => s + (c.commissionAmount || 0), 0),
          settledAmount: settled.reduce((s, c) => s + (c.commissionAmount || 0), 0),
          totalInvoiceAmount: commissions.reduce((s, c) => s + (c.invoiceAmount || 0), 0),
        }
      })
      return res.json({ success: true, data: stats })
    }

    if (resource === 'timetable') {
      const targetDoctorId = myDoctorId || doctorId
      if (!targetDoctorId) {
        return res.status(400).json({ success: false, error: 'Doctor ID is required' })
      }
      const doctor = await db.user.findUnique({
        where: { id: targetDoctorId, organizationId: ORG_ID },
        select: { id: true, fullName: true, preferences: true, updatedAt: true }
      })
      if (!doctor) {
        return res.status(404).json({ success: false, error: 'Doctor not found' })
      }
      let prefs = {}
      try {
        if (doctor.preferences) prefs = JSON.parse(doctor.preferences)
      } catch (e) {}

      const timetable = prefs.timetable || {
        weeklySlots: {
          Monday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Tuesday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Wednesday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Thursday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Friday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Saturday: { active: false, shifts: [] },
          Sunday: { active: false, shifts: [] }
        },
        exceptions: [],
        slotDuration: 15,
        maxPatientsPerDay: 30
      }
      // updatedAt is echoed back on save (as expectedUpdatedAt) so the write
      // can guard against a lost update — see the POST handler below.
      return res.json({ success: true, data: { doctorId: doctor.id, fullName: doctor.fullName, timetable, updatedAt: doctor.updatedAt } })
    }

    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}

export async function handlePost(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query

    // A doctor may only write their OWN accountability data. handleGet already
    // scopes reads to scopedDoctorId; the write paths (config / commission /
    // timetable) all take doctorId straight from the body and never checked it,
    // so any logged-in doctor could rewrite a colleague's timetable or set their
    // commission rate. Admins/coordinators (scopedDoctorId === null) are
    // unrestricted, as before.
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId && req.body?.doctorId && req.body.doctorId !== myDoctorId) {
      return res.status(403).json({ success: false, error: 'You can only modify your own record' })
    }

    if (resource === 'config') {
      const { doctorId, commissionType, commissionRate, isActive, notes, consultationFee, followUpDays } = req.body

      // Validate commission settings before storing them. Previously `parseFloat(x) || 0`
      // silently coerced junk (NaN, negatives, 150%, 1e308, unknown types) into stored
      // values — a percentage of 150 or -10 makes no sense and Infinity/NaN corrupts every
      // downstream commission calculation. Reject bad input up front instead.
      const ALLOWED_COMMISSION_TYPES = ['percentage', 'fixed', 'fixed_per_consultation']
      if (commissionType !== undefined && !ALLOWED_COMMISSION_TYPES.includes(commissionType)) {
        return res.status(400).json({ success: false, error: `Invalid commissionType — must be one of: ${ALLOWED_COMMISSION_TYPES.join(', ')}` })
      }
      const rate = typeof commissionRate === 'string' ? Number(commissionRate.trim()) : Number(commissionRate)
      // A percentage is capped at 100; a fixed ₹ amount is not, but must still be a
      // sane, finite, non-negative number (rejects NaN/Infinity/1e308).
      const isPercentage = commissionType === undefined || commissionType === 'percentage'
      const maxRate = isPercentage ? 100 : 1_000_000
      if (!Number.isFinite(rate) || rate < 0 || rate > maxRate) {
        return res.status(400).json({
          success: false,
          error: isPercentage
            ? 'commissionRate must be a number between 0 and 100'
            : `commissionRate must be a number between 0 and ${maxRate}`,
        })
      }

      // Persist the doctor's appointment fee + free follow-up window on the user record
      const userData = {}
      if (consultationFee !== undefined) {
        userData.consultationFee = consultationFee === '' || consultationFee === null ? null : parseFloat(consultationFee)
      }
      if (followUpDays !== undefined) {
        userData.followUpDays = followUpDays === '' || followUpDays === null ? null : parseInt(followUpDays)
      }
      if (Object.keys(userData).length) {
        // Scope to this org — only update a doctor that belongs to the caller's org
        await db.user.updateMany({ where: { id: doctorId, organizationId: ORG_ID }, data: userData })
      }

      const existing = await db.doctorCommissionConfig.findUnique({ where: { doctorId } })
      let config
      if (existing) {
        config = await db.doctorCommissionConfig.update({
          where: { doctorId },
          data: { commissionType, commissionRate: rate, isActive, notes: notes || null },
        })
      } else {
        config = await db.doctorCommissionConfig.create({
          data: { organizationId: ORG_ID, doctorId, commissionType, commissionRate: rate, isActive, notes: notes || null },
        })
      }
      return res.json({ success: true, data: config })
    }

    if (resource === 'commission') {
      const { doctorId, invoiceId, invoiceAmount, commissionRate, commissionType, commissionAmount } = req.body
      const commission = await db.doctorCommission.create({
        data: {
          organizationId: ORG_ID,
          doctorId,
          invoiceId: invoiceId || null,
          invoiceAmount: parseFloat(invoiceAmount) || 0,
          commissionRate: parseFloat(commissionRate) || 0,
          commissionType,
          commissionAmount: parseFloat(commissionAmount) || 0,
          status: 'pending',
        },
        include: {
          doctor: { select: { id: true, fullName: true } },
        },
      })
      return res.json({ success: true, data: commission })
    }


    if (resource === 'timetable') {
      const { doctorId, timetable, expectedUpdatedAt } = req.body
      const targetDoctorId = doctorId
      if (!targetDoctorId) {
        return res.status(400).json({ success: false, error: 'Doctor ID is required' })
      }
      // The optimistic lock is MANDATORY, not best-effort. Omitting
      // expectedUpdatedAt used to drop the updatedAt guard entirely, so the
      // write landed unconditionally and two concurrent editors silently
      // clobbered each other — the exact lost update the guard below claims to
      // prevent. The real UI always echoes the row's updatedAt back here (see
      // DoctorTiming.jsx), so requiring it doesn't break the app. Reject a
      // missing/empty or unparseable value up front with a clean 400.
      const expected = new Date(expectedUpdatedAt)
      if (!expectedUpdatedAt || Number.isNaN(expected.getTime())) {
        return res.status(400).json({ success: false, error: 'expectedUpdatedAt is required to save the timetable safely' })
      }
      const doctor = await db.user.findUnique({
        where: { id: targetDoctorId, organizationId: ORG_ID }
      })
      if (!doctor) {
        return res.status(404).json({ success: false, error: 'Doctor not found' })
      }
      // Every shift with a room must be internally valid (start < end) and
      // point at a room that actually belongs to this org — otherwise a typo
      // silently breaks the display board's resolution for that room.
      const roomIds = roomIdsInTimetable(timetable)
      if (roomIds.length > 0) {
        const validRooms = await db.room.findMany({ where: { id: { in: roomIds }, organizationId: ORG_ID }, select: { id: true } })
        const validIds = new Set(validRooms.map((r) => r.id))
        const unknown = roomIds.filter((id) => !validIds.has(id))
        if (unknown.length > 0) {
          return res.status(400).json({ success: false, error: `Unknown room(s) in timetable: ${unknown.join(', ')}` })
        }
      }
      for (const [dayName, day] of Object.entries(timetable?.weeklySlots || {})) {
        for (const shift of day?.shifts || []) {
          try {
            assertValidShift(shift)
          } catch (e) {
            return res.status(400).json({ success: false, error: `${dayName}: ${e.message}` })
          }
        }
        // Same doctor, same day, two DIFFERENT rooms with overlapping times —
        // each room resolves independently of the other, so without this the
        // display board would show this doctor "active" in two rooms at once.
        try {
          assertNoSelfOverlap(day?.shifts || [])
        } catch (e) {
          return res.status(400).json({ success: false, error: `${dayName}: ${e.message}` })
        }
      }

      // Leave/exception dates are matched on read by isOnLeave() via
      // String(e.date).slice(0,10), which ONLY works for ISO YYYY-MM-DD. A date
      // stored as dd/mm/yyyy or MM/DD/YYYY would never match and the doctor would
      // silently NOT be marked on leave. Normalize on write: require every
      // exception date to be a real ISO calendar date (accepting a full ISO
      // datetime and keeping its date part); reject anything else with 400 so only
      // ISO dates are ever stored.
      if (timetable?.exceptions !== undefined) {
        if (!Array.isArray(timetable.exceptions)) {
          return res.status(400).json({ success: false, error: 'timetable.exceptions must be a list' })
        }
        for (const ex of timetable.exceptions) {
          const ymd = normalizeIsoDate(ex?.date)
          if (!ymd) {
            return res.status(400).json({ success: false, error: `Invalid exception date "${ex?.date}" — must be ISO format YYYY-MM-DD` })
          }
          ex.date = ymd
        }
      }

      let prefs = {}
      try {
        if (doctor.preferences) prefs = JSON.parse(doctor.preferences)
      } catch (e) {}

      prefs.timetable = timetable

      // Keep the DoctorRoomAssignment index in step with the timetable's own
      // shifts — a fast "which doctors might be active in room X" lookup for
      // the display board, so it never has to scan every doctor's JSON
      // preferences on every poll. The timetable (with its shift times) stays
      // the single source of truth; this index is just a derived cache of it.
      //
      // Optimistic-concurrency guard: two tabs (or admin + doctor) loading
      // then saving this same timetable concurrently would otherwise silently
      // lose whichever save commits first — `preferences` is a single JSON
      // blob overwritten whole, with nothing to detect a stale read. Guarding
      // the update on `updatedAt` (echoed back to the client on GET, sent
      // back as `expectedUpdatedAt` on save) makes a stale-based save affect
      // zero rows instead of clobbering the other save.
      try {
        const result = await db.$transaction(async (tx) => {
          const updateWhere = { id: targetDoctorId, updatedAt: expected }
          const { count } = await tx.user.updateMany({
            where: updateWhere,
            data: { preferences: JSON.stringify(prefs) },
          })
          if (count === 0) {
            const conflictErr = new Error('Timetable was changed by someone else — reload and try again')
            conflictErr.isConflict = true
            throw conflictErr
          }
          await tx.doctorRoomAssignment.deleteMany({ where: { doctorId: targetDoctorId, roomId: { notIn: roomIds } } })
          for (const roomId of roomIds) {
            await tx.doctorRoomAssignment.upsert({
              where: { doctorId_roomId: { doctorId: targetDoctorId, roomId } },
              create: { organizationId: ORG_ID, doctorId: targetDoctorId, roomId },
              update: {},
            })
          }
          return tx.user.findUnique({ where: { id: targetDoctorId }, select: { id: true, fullName: true, preferences: true, updatedAt: true } })
        })
        return res.json({ success: true, message: 'Timetable updated successfully', data: result })
      } catch (e) {
        if (e.isConflict) {
          return res.status(409).json({ success: false, code: 'STALE_TIMETABLE', error: e.message })
        }
        throw e
      }
    }

    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}

export async function handlePatch(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query

    if (resource === 'settle') {
      const { commissionIds, settlementNote, settlementRef } = req.body
      // Tenant guard: restrict the bulk-settle to commissions belonging to
      // this org only — a caller cannot settle another org's commissions.
      await db.doctorCommission.updateMany({
        where: { id: { in: commissionIds }, status: 'pending', organizationId: ORG_ID },
        data: {
          status: 'settled',
          settledAt: new Date(),
          settlementNote: settlementNote || null,
          settlementRef: settlementRef || null,
        },
      })
      return res.json({ success: true, message: `${commissionIds.length} commission(s) settled successfully` })
    }

    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}

export async function handleDelete(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource, id } = req.query
    if (resource === 'commission') {
      // Tenant guard: verify the commission belongs to this org before deleting.
      const existing = await db.doctorCommission.findFirst({
        where: { id, organizationId: ORG_ID },
        select: { id: true },
      })
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Commission not found' })
      }
      await db.doctorCommission.delete({ where: { id } })
      return res.json({ success: true })
    }
    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}
