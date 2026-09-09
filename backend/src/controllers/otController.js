// Operation Theatre — Phase 1 (scheduling).
//
// Follows the house shape: getAll/create/update/remove, dispatched by a
// `resource` query/body field, exactly like inpatientController. Everything
// cross-cutting is reused, nothing re-implemented:
//   getOrgId/getActor/svcErr  → lib/reqContext.js
//   isOwned                   → lib/tenant.js   (cross-tenant guard)
//   nextSeriesNumber          → lib/counters.js (gap-free OT case numbers)
//   auditIpd                  → inpatient/audit.js (NABH trail)
//   assertNoConflict/lockTheatre → ot/schedulingService.js
import { db } from '../config/db.js'
import { getOrgId, getActor, svcErr, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { isOwned } from '../lib/tenant.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { patientSearchWhere } from '../lib/patientSearch.js'
import { dayRange, parseUserDate } from '../lib/dates.js'
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'
import { auditIpd } from '../inpatient/audit.js'
import { ipdAllowed } from '../inpatient/rbac.js'
import { assertNoConflict, lockTheatre, slotAvailability, freeSlots } from '../ot/schedulingService.js'

// PATIENT_NAME_SELECT already carries id + mrn + the three name parts.
const patientSelect = { ...PATIENT_NAME_SELECT, phonePrimary: true }
const staffSelect = { id: true, fullName: true, role: true }

const BOOKING_STATUS = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_THEATRE', 'COMPLETED', 'CANCELLED', 'POSTPONED']

// Where a case may go from where it is. Checking only that a status is spelled
// correctly let a booking jump anywhere: SCHEDULED went straight to COMPLETED,
// and COMPLETED went back to CANCELLED — a surgery that physically happened,
// recorded as cancelled, with the bill following the record.
//
// COMPLETED and CANCELLED are absent on purpose: both are final. A completed
// case that needs correcting is an addendum, not an edit. POSTPONED keeps
// SCHEDULED so a deferred case can be re-booked.
//
// Mirrors OT_NEXT_ACTIONS in src/components/ot/otDisplay.js, which decides which
// buttons a case shows; the two must stay in step, and this one is the authority.
const ALLOWED_NEXT_STATUS = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'POSTPONED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'POSTPONED'],
  CHECKED_IN: ['IN_THEATRE', 'CANCELLED'],
  IN_THEATRE: ['COMPLETED'],
  POSTPONED: ['SCHEDULED', 'CANCELLED'],
}
const PRIORITIES = ['ELECTIVE', 'URGENT', 'EMERGENCY']
// A theatre reads AVAILABLE | OCCUPIED | CLEANING | MAINTENANCE.
// Only these two are anyone's to set. OCCUPIED and CLEANING follow the case —
// the status branch below writes them when a case enters and leaves the room.
// Allowing them by hand let a theatre read AVAILABLE while a case was still
// IN_THEATRE in it, so the board said free and the room was not.
const MANUAL_THEATRE_STATUS = ['AVAILABLE', 'MAINTENANCE']

// Which knee, which eye, which kidney. A typo here is wrong-side surgery.
const LATERALITY = ['NA', 'LEFT', 'RIGHT', 'BILATERAL']
const TEAM_ROLES = [
  'PRIMARY_SURGEON', 'ASSISTANT_SURGEON', 'ANAESTHETIST',
  'SCRUB_NURSE', 'CIRCULATING_NURSE', 'OT_TECHNICIAN', 'PERFUSIONIST', 'OBSERVER',
]



// A theatre with a case still in it cannot be re-labelled or retired. Both would
// leave the board disagreeing with the theatre — the one thing the board exists
// to be right about.
// `tx` is not optional in spirit: the caller must hold this theatre's lock, or a
// case can start between the check and the write.
async function assertNoLiveCase(theatreId, orgId, action, tx = db) {
  const live = await tx.otBooking.findFirst({
    where: { organizationId: orgId, theatreId, status: 'IN_THEATRE' },
    select: { caseNumber: true },
  })
  if (live) {
    throw conflict(
      `${live.caseNumber} is in this theatre right now — complete or cancel it before you ${action}`,
      'OT_THEATRE_IN_USE',
    )
  }
}

// Cross-tenant guard: one hospital must not book another hospital's patient.
async function assertOwned(model, id, orgId, label) {
  if (!(await isOwned(model, id, orgId))) throw notFound(`${label} not found`)
}

// Number("") is 0, Number("abc") is NaN, Number("-20") is -20 — all storable.
// A negative cleaningMinutes SHRINKS the theatre's busy window instead of
// widening it, so overlapping cases stop being detected. Absent stays absent.
function optionalMinutes(value, { min, label, max = 24 * 60 }) {
  if (value === undefined || value === null || value === '') return undefined
  const minutes = Number(value)
  if (Number.isInteger(minutes) === false || minutes < min || minutes > max) {
    throw bad(`${label} must be a whole number of minutes between ${min} and ${max}`)
  }
  return minutes
}

// The shared parser in lib/dates.js. It also refuses 30 February and the year
// 99998 — checks the OT case record was written without, so the same screen
// rejected a date in one field and accepted it in another.
const parseDate = parseUserDate

// The columns are Strings, so nothing but this rejects a bad value.
// Blank passes through — the field is optional.
function assertOneOf(value, allowed, label) {
  if (value === undefined || value === null || value === '') return
  if (!allowed.includes(value)) throw bad(`${label} must be one of ${allowed.join(', ')}`)
}

// Per-action permission. The route only says "may this role touch /ot";
// one endpoint serves every verb, so WHICH action is only known here.
function assertMay(req, action) {
  if (!ipdAllowed(req, action)) throw forbidden()
}

// Form rows -> database rows. A bad role is rejected, never dropped: a scrub
// nurse missing from a case record is a medicolegal gap nobody would notice.
async function buildTeamRows(team, orgId, bookingId) {
  const rows = []
  for (const m of team || []) {
    // Read the three fields once, with a plain empty value when they are missing,
    // so every check below is a straight comparison.
    const memberName = m?.memberName?.trim() || ''
    const role = m?.role || ''
    const userId = m?.userId || null

    if (memberName === '' && role === '') continue // blank row from the form
    if (memberName === '') throw bad('Every team member needs a name')
    if (TEAM_ROLES.includes(role) === false) {
      throw bad(`Team role must be one of ${TEAM_ROLES.join(', ')}`)
    }

    rows.push({
      organizationId: orgId, bookingId,
      userId, role, memberName,
      isExternal: userId === null, // no login of their own = visiting staff
      notes: m.notes || null,
    })
  }

  // One query for every staff id, rather than one per member.
  const staffIds = rows.map((r) => r.userId).filter((id) => id !== null)
  const ids = [...new Set(staffIds)]
  if (ids.length > 0) {
    const found = await db.user.count({ where: { id: { in: ids }, organizationId: orgId } })
    if (found !== ids.length) throw notFound('A team member was not found in this hospital')
  }
  return rows
}

// One case, everything about it. For the detail view, which is one row at a time.
const bookingInclude = {
  patient: { select: patientSelect },
  theatre: { select: { id: true, name: true, theatreType: true } },
  surgery: { select: { id: true, name: true, code: true } },
  surgeon: { select: staffSelect },
  anaesthetist: { select: staffSelect },
  team: { include: { user: { select: staffSelect } } },
}

// The list, which returns up to 500 rows, sends only the columns the board and
// the table actually render. Measured over the same rows: 1,886 bytes each with
// the full include against 550 lean, so a 200-case day is 368 KB rather than
// 107 KB — and the difference is team members, anaesthetists and catalogue rows
// that nothing on the list displays.
const bookingListSelect = {
  id: true,
  caseNumber: true,
  procedureName: true,
  laterality: true,
  priority: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  estimatedMinutes: true,
  actualStart: true,
  theatreId: true, // the board groups its columns on this
  patient: { select: PATIENT_NAME_SELECT },
  theatre: { select: { id: true, name: true } },
  surgeon: { select: { id: true, fullName: true } },
}

// ─────────────────────────────────────────────────────────────── READS ──────

export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query

    // Retired ones must not reach a booking dropdown. Settings passes this flag.
    const wantsRetiredToo = req.query.includeInactive === 'true'

    if (resource === 'theatres') {
      const where = { organizationId: ORG_ID }
      if (wantsRetiredToo === false) where.isActive = true

      const rows = await db.operatingTheatre.findMany({
        where,
        orderBy: { name: 'asc' },
      })
      return res.json({ success: true, data: rows })
    }

    if (resource === 'surgeries') {
      const where = { organizationId: ORG_ID }
      if (wantsRetiredToo === false) where.isActive = true

      const rows = await db.surgeryCatalog.findMany({
        where,
        include: { chargeItem: { select: { id: true, code: true, name: true, basePrice: true } } },
        orderBy: { name: 'asc' },
      })
      return res.json({ success: true, data: rows })
    }

    if (resource === 'bookings') {
      const { status, theatreId, surgeonId, startDate, endDate, search } = req.query
      const where = { organizationId: ORG_ID }
      if (status && status !== 'all') where.status = status
      if (theatreId) where.theatreId = theatreId
      if (surgeonId) where.primarySurgeonId = surgeonId
      if (startDate || endDate) where.scheduledStart = dayRange(startDate, endDate)

      const searchWhere = patientSearchWhere(search, 'patient', (term) => [
        { procedureName: { contains: term, mode: 'insensitive' } },
        { caseNumber: { contains: term, mode: 'insensitive' } },
      ])
      if (searchWhere) Object.assign(where, searchWhere)

      const rows = await db.otBooking.findMany({
        where,
        select: bookingListSelect,
        orderBy: { scheduledStart: 'asc' },
        take: Math.min(Number(req.query.limit) || 200, 500),
      })
      return res.json({ success: true, data: rows })
    }

    if (resource === 'booking') {
      // Prisma drops an `undefined` from a where clause, so without this guard a
      // request with no id would quietly return the hospital's first booking.
      if (!req.query.id) throw bad('id is required')
      const row = await db.otBooking.findFirst({
        where: { id: req.query.id, organizationId: ORG_ID },
        include: bookingInclude,
      })
      if (!row) throw notFound('Booking not found')
      return res.json({ success: true, data: row })
    }

    // What can take this slot, asked while the user is still choosing rather
    // than after they press Save. Serves both the booking form and rescheduling.
    //
    // The rules are not repeated here — schedulingService answers with the same
    // OCCUPYING statuses and the same cleaning gap that block a real booking, so
    // the preview and the gate cannot drift apart.
    //
    // Same field names as creating a booking (scheduledStart, estimatedMinutes,
    // primarySurgeonId, patientId), because it is the same question about the
    // same slot.
    if (resource === 'availability') {
      // Seeing where a case could go is part of booking one.
      assertMay(req, 'ot-booking')

      const {
        scheduledStart, scheduledEnd, estimatedMinutes,
        primarySurgeonId, patientId, excludeBookingId,
      } = req.query
      if (!scheduledStart) throw bad('scheduledStart is required')

      // parseDate, never new Date(): the service takes the value it is given, so
      // this is the layer that refuses a rollover. Without it "2027-02-30"
      // quietly becomes 2 March and is answered as though it were a real day —
      // the same bug the OT case record already shipped with once.
      const start = parseDate(scheduledStart, 'scheduledStart')
      const mins = optionalMinutes(estimatedMinutes, { min: 1, label: 'estimatedMinutes' }) ?? 60
      const end = scheduledEnd
        ? parseDate(scheduledEnd, 'scheduledEnd')
        : new Date(start.getTime() + mins * 60_000)

      // Both are optional — the form asks about the room before anyone is
      // chosen — but an id that IS given must belong to this hospital, or the
      // answer would describe another hospital's schedule.
      if (primarySurgeonId) await assertOwned('user', primarySurgeonId, ORG_ID, 'Surgeon')
      if (patientId) await assertOwned('patient', patientId, ORG_ID, 'Patient')

      const data = await slotAvailability({
        organizationId: ORG_ID,
        scheduledStart: start,
        scheduledEnd: end,
        primarySurgeonId: primarySurgeonId || null,
        patientId: patientId || null,
        // Rescheduling: a case must not be reported as clashing with itself.
        excludeBookingId: excludeBookingId || null,
      })
      return res.json({ success: true, data })
    }

    // Where a case of this length could go on a given day — the question a
    // coordinator answers today by typing times into the form until one sticks,
    // and the one rescheduling asks on every single move.
    //
    // Suggestions only. The gate is still assertNoConflict, and it is never
    // consulted about working hours: a slot outside them can still be booked
    // directly, which is what an emergency at 2am needs.
    if (resource === 'slots') {
      assertMay(req, 'ot-booking')

      const { date, primarySurgeonId, patientId, theatreId, excludeBookingId, from, to } = req.query
      if (!date) throw bad('date is required')
      // Rejects 30 February before the day is walked, so a suggestion is never
      // offered for a day that does not exist.
      parseDate(`${date}T00:00`, 'date')

      if (primarySurgeonId) await assertOwned('user', primarySurgeonId, ORG_ID, 'Surgeon')
      if (patientId) await assertOwned('patient', patientId, ORG_ID, 'Patient')
      if (theatreId) await assertOwned('operatingTheatre', theatreId, ORG_ID, 'Operating theatre')

      const data = await freeSlots({
        organizationId: ORG_ID,
        date,
        minutes: optionalMinutes(req.query.estimatedMinutes, { min: 1, label: 'estimatedMinutes' }) ?? 60,
        primarySurgeonId: primarySurgeonId || null,
        patientId: patientId || null,
        theatreId: theatreId || null,
        excludeBookingId: excludeBookingId || null,
        from: from || null,
        to: to || null,
        limit: Math.min(Number(req.query.limit) || 10, 40),
      })
      return res.json({ success: true, data })
    }

    throw bad('Unknown resource')
  } catch (e) {
    if (e.status) return svcErr(res, e)
    next(e)
  }
}

// ────────────────────────────────────────────────────────────── CREATE ──────

export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const actor = getActor(req)
    const { resource } = req.body

    if (resource === 'theatre') {
      assertMay(req, 'ot-theatre')
      const { name, code, theatreType, cleaningMinutes, floorId, departmentId } = req.body
      if (!name?.trim()) throw bad('Theatre name is required')
      const row = await db.operatingTheatre.create({
        data: {
          organizationId: ORG_ID,
          name: name.trim(), code: code?.trim() || null,
          theatreType: theatreType || null,
          cleaningMinutes: optionalMinutes(cleaningMinutes, { min: 0, label: 'cleaningMinutes' }) ?? 30,
          floorId: floorId || null, departmentId: departmentId || null,
        },
      })
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'ot.theatre', entityId: row.id, after: row })
      return res.status(201).json({ success: true, data: row })
    }

    if (resource === 'surgery') {
      assertMay(req, 'ot-surgery')
      const { name, code, specialty, defaultMinutes, defaultAnaesthesia, chargeItemId } = req.body
      if (!name?.trim()) throw bad('Surgery name is required')
      const row = await db.surgeryCatalog.create({
        data: {
          organizationId: ORG_ID,
          name: name.trim(), code: code?.trim() || null,
          specialty: specialty || null,
          defaultMinutes: optionalMinutes(defaultMinutes, { min: 1, label: 'defaultMinutes' }) ?? 60,
          defaultAnaesthesia: defaultAnaesthesia || null,
          chargeItemId: chargeItemId || null,
        },
      })
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'ot.surgery', entityId: row.id, after: row })
      return res.status(201).json({ success: true, data: row })
    }

    if (resource === 'booking') {
      assertMay(req, 'ot-booking')
      const {
        patientId, admissionId, theatreId, surgeryId, procedureName, laterality,
        siteOfSurgery, patientLocation, equipmentNeeded,
        priority, scheduledStart, estimatedMinutes, scheduledEnd,
        primarySurgeonId, anaesthetistId, notes, team = [],
      } = req.body

      if (!patientId) throw bad('Patient is required')
      if (!theatreId) throw bad('Operating theatre is required')
      if (!primarySurgeonId) throw bad('Surgeon is required')
      if (!scheduledStart) throw bad('Start time is required')

      assertOneOf(priority, PRIORITIES, 'priority')
      assertOneOf(laterality, LATERALITY, 'laterality')

      // The theatre is checked inside assertNoConflict; these are the rest.
      await Promise.all([
        assertOwned('patient', patientId, ORG_ID, 'Patient'),
        assertOwned('user', primarySurgeonId, ORG_ID, 'Surgeon'),
        anaesthetistId ? assertOwned('user', anaesthetistId, ORG_ID, 'Anaesthetist') : null,
        admissionId ? assertOwned('admission', admissionId, ORG_ID, 'Admission') : null,
      ])

      // Fall back to the catalogue's typical duration so the caller may send
      // only a start time.
      const surgery = surgeryId
        ? await db.surgeryCatalog.findFirst({ where: { id: surgeryId, organizationId: ORG_ID } })
        : null
      if (surgeryId && !surgery) throw notFound('Surgery not found')

      const start = parseDate(scheduledStart, 'scheduledStart')
      const mins = optionalMinutes(estimatedMinutes, { min: 1, label: 'estimatedMinutes' })
        ?? surgery?.defaultMinutes ?? 60
      const end = scheduledEnd
        ? parseDate(scheduledEnd, 'scheduledEnd')
        : new Date(start.getTime() + mins * 60_000)
      if (end <= start) throw bad('Surgery end time must be after the start time')

      const name = procedureName?.trim() || surgery?.name
      if (!name) throw bad('Procedure name is required when no surgery is selected')

      // Validated before the transaction opens, so a bad role fails fast rather
      // than holding the theatre lock while it errors.
      const teamRows = await buildTeamRows(team, ORG_ID, null)

      const created = await db.$transaction(async (tx) => {
        // Lock FIRST: two users racing for the same empty slot would otherwise
        // both pass the check and both write.
        await lockTheatre(tx, theatreId)
        await assertNoConflict(
          { organizationId: ORG_ID, theatreId, primarySurgeonId, patientId, scheduledStart: start, scheduledEnd: end },
          tx,
        )

        const caseNumber = await nextSeriesNumber(tx, ORG_ID, 'OT', 'OT')

        const booking = await tx.otBooking.create({
          data: {
            organizationId: ORG_ID,
            patientId, admissionId: admissionId || null,
            theatreId, surgeryId: surgeryId || null,
            caseNumber,
            procedureName: name,          // snapshot — survives a catalogue rename
            laterality: laterality || null,
            siteOfSurgery: siteOfSurgery?.trim() || null,
            patientLocation: patientLocation?.trim() || null,
            equipmentNeeded: equipmentNeeded?.trim() || null,
            priority: priority || 'ELECTIVE',
            scheduledStart: start, scheduledEnd: end, estimatedMinutes: mins,
            primarySurgeonId, anaesthetistId: anaesthetistId || null,
            notes: notes || null,
            bookedById: actor.id, bookedByName: actor.name,
          },
        })

        if (teamRows.length) {
          await tx.otTeamMember.createMany({
            data: teamRows.map((r) => ({ ...r, bookingId: booking.id })),
            skipDuplicates: true,
          })
        }

        return booking
      })

      const full = await db.otBooking.findUnique({ where: { id: created.id }, include: bookingInclude })
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'ot.booking', entityId: created.id, after: created })
      return res.status(201).json({ success: true, data: full })
    }

    throw bad('Unknown resource')
  } catch (e) {
    if (e.status) return svcErr(res, e)
    next(e)
  }
}

// ────────────────────────────────────────────────────────────── UPDATE ──────

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const actor = getActor(req)
    const { resource, id } = req.body
    if (!id) throw bad('id is required')

    if (resource === 'theatre') {
      assertMay(req, 'ot-theatre')
      if (!(await isOwned('operatingTheatre', id, ORG_ID))) throw notFound('Theatre not found')
      const { name, code, theatreType, status, cleaningMinutes, isActive, floorId, departmentId } = req.body
      // An empty string is not a value. assertOneOf lets blanks through, because
      // these fields are optional — so `status: ''` passed validation and was
      // then written, leaving a theatre with no status at all.
      const nextStatus = status === '' ? undefined : status
      assertOneOf(nextStatus, MANUAL_THEATRE_STATUS, 'status')

      // 0 is legitimate here — a theatre with no turnaround gap.
      const cleaning = optionalMinutes(cleaningMinutes, { min: 0, label: 'cleaningMinutes' })
      const before = await db.operatingTheatre.findUnique({ where: { id } })

      const data = {
        ...(name !== undefined && { name: name?.trim() || undefined }),
        ...(code !== undefined && { code: code?.trim() || null }),
        ...(theatreType !== undefined && { theatreType }),
        ...(nextStatus !== undefined && { status: nextStatus }),
        ...(cleaning !== undefined && { cleaningMinutes: cleaning }),
        ...(isActive !== undefined && { isActive: !!isActive }),
        ...(floorId !== undefined && { floorId: floorId || null }),
        ...(departmentId !== undefined && { departmentId: departmentId || null }),
      }

      // Re-labelling or retiring a room with a case in it makes the board lie.
      // The check and the write share one transaction behind the SAME theatre
      // lock the scheduler takes, so a case cannot start in the gap between them.
      const changesAvailability = nextStatus !== undefined || isActive === false
      const row = await db.$transaction(async (tx) => {
        if (changesAvailability) {
          await lockTheatre(tx, id)
          await assertNoLiveCase(id, ORG_ID, nextStatus !== undefined ? 'change its status' : 'retire it', tx)
        }
        return tx.operatingTheatre.update({ where: { id }, data })
      })
      await auditIpd(req, ORG_ID, { action: 'update', entityType: 'ot.theatre', entityId: id, before, after: row })
      return res.json({ success: true, data: row })
    }

    if (resource === 'surgery') {
      assertMay(req, 'ot-surgery')
      if (!(await isOwned('surgeryCatalog', id, ORG_ID))) throw notFound('Surgery not found')
      const { name, code, specialty, defaultMinutes, defaultAnaesthesia, chargeItemId, isActive } = req.body
      // A surgery that takes zero minutes is not a surgery, so min is 1.
      const minutes = optionalMinutes(defaultMinutes, { min: 1, label: 'defaultMinutes' })
      const before = await db.surgeryCatalog.findUnique({ where: { id } })
      const row = await db.surgeryCatalog.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name?.trim() || undefined }),
          ...(code !== undefined && { code: code?.trim() || null }),
          ...(specialty !== undefined && { specialty }),
          ...(minutes !== undefined && { defaultMinutes: minutes }),
          ...(defaultAnaesthesia !== undefined && { defaultAnaesthesia }),
          ...(chargeItemId !== undefined && { chargeItemId: chargeItemId || null }),
          ...(isActive !== undefined && { isActive: !!isActive }),
        },
      })
      await auditIpd(req, ORG_ID, { action: 'update', entityType: 'ot.surgery', entityId: id, before, after: row })
      return res.json({ success: true, data: row })
    }

    // Reschedule — re-runs the clash check, excluding this booking so it cannot
    // clash with itself.
    if (resource === 'reschedule') {
      assertMay(req, 'ot-reschedule')
      if (!(await isOwned('otBooking', id, ORG_ID))) throw notFound('Booking not found')
      const before = await db.otBooking.findUnique({ where: { id } })
      if (['COMPLETED', 'CANCELLED'].includes(before.status)) {
        throw Object.assign(new Error(`A ${before.status.toLowerCase()} case cannot be rescheduled`), { status: 409 })
      }

      if (req.body.primarySurgeonId) await assertOwned('user', req.body.primarySurgeonId, ORG_ID, 'Surgeon')
      if (req.body.anaesthetistId) await assertOwned('user', req.body.anaesthetistId, ORG_ID, 'Anaesthetist')

      assertOneOf(req.body.priority, PRIORITIES, 'priority')
      assertOneOf(req.body.laterality, LATERALITY, 'laterality')

      const theatreId = req.body.theatreId || before.theatreId
      const start = parseDate(req.body.scheduledStart || before.scheduledStart, 'scheduledStart')
      const mins = optionalMinutes(req.body.estimatedMinutes, { min: 1, label: 'estimatedMinutes' })
        ?? before.estimatedMinutes ?? 60
      const end = req.body.scheduledEnd
        ? parseDate(req.body.scheduledEnd, 'scheduledEnd')
        : new Date(start.getTime() + mins * 60_000)
      if (end <= start) throw bad('Surgery end time must be after the start time')

      const row = await db.$transaction(async (tx) => {
        await lockTheatre(tx, theatreId)
        await assertNoConflict(
          {
            organizationId: ORG_ID, theatreId,
            primarySurgeonId: req.body.primarySurgeonId || before.primarySurgeonId,
            patientId: before.patientId,
            scheduledStart: start, scheduledEnd: end,
            excludeBookingId: id,
          },
          tx,
        )
        return tx.otBooking.update({
          where: { id },
          data: {
            theatreId, scheduledStart: start, scheduledEnd: end, estimatedMinutes: mins,
            // Re-booking a postponed case IS giving it a new time, so the case
            // stops being postponed. Without this it kept the POSTPONED badge
            // while holding a fresh slot, and the board — which the theatre
            // reads as the truth about today — showed a booked case as shelved.
            // Every other status is left alone: a confirmed case that moves an
            // hour is still confirmed.
            ...(before.status === 'POSTPONED' && { status: 'SCHEDULED' }),
            ...(req.body.primarySurgeonId && { primarySurgeonId: req.body.primarySurgeonId }),
            ...(req.body.anaesthetistId !== undefined && { anaesthetistId: req.body.anaesthetistId || null }),
            statusChangeNote: req.body.reason || null,
          },
        })
      })
      await auditIpd(req, ORG_ID, { action: 'reschedule', entityType: 'ot.booking', entityId: id, before, after: row })
      return res.json({ success: true, data: row })
    }

    // Status move. CANCELLED/POSTPONED require a reason (medicolegal); IN_THEATRE
    // requires an admission, because vitals, notes and charges all key on it.
    if (resource === 'status') {
      const { status, reason } = req.body
      if (!BOOKING_STATUS.includes(status)) throw bad(`status must be one of ${BOOKING_STATUS.join(', ')}`)

      // Calling a case OFF is a clinical decision, so it is gated separately from
      // moving one along the day. Checked BEFORE the record is looked up: a role
      // that may not cancel should not learn whether the case exists either.
      assertMay(req, status === 'CANCELLED' ? 'ot-cancel' : 'ot-status')

      if (!(await isOwned('otBooking', id, ORG_ID))) throw notFound('Booking not found')

      const before = await db.otBooking.findUnique({ where: { id } })

      const allowed = ALLOWED_NEXT_STATUS[before.status] ?? []
      if (allowed.includes(status) === false) {
        throw Object.assign(
          new Error(
            allowed.length === 0
              ? `This case is ${before.status.toLowerCase()} and cannot be changed`
              : `A ${before.status.toLowerCase()} case can only move to ${allowed.join(', ')}`,
          ),
          { status: 409, code: 'OT_BAD_TRANSITION' },
        )
      }

      // The status is a past participle ("CANCELLED"), so lowercasing it reads
      // "required to cancelled a case". Name the verb instead.
      const REASON_VERB = { CANCELLED: 'cancel', POSTPONED: 'postpone' }
      if (REASON_VERB[status] && !reason?.trim()) {
        throw bad(`A reason is required to ${REASON_VERB[status]} a case`)
      }
      if (['CHECKED_IN', 'IN_THEATRE'].includes(status) && !before.admissionId) {
        throw Object.assign(
          new Error('Admit the patient first — vitals, nursing notes and OT charges all attach to the admission'),
          { status: 409, code: 'OT_NO_ADMISSION' },
        )
      }

      const data = { status, statusChangeNote: reason?.trim() || null }
      if (status === 'CANCELLED') data.cancelReason = reason.trim()
      if (status === 'POSTPONED') data.postponeReason = reason.trim()
      if (status === 'IN_THEATRE' && !before.actualStart) data.actualStart = new Date()
      if (status === 'COMPLETED' && !before.actualEnd) data.actualEnd = new Date()

      const row = await db.$transaction(async (tx) => {
        // The theatre lock FIRST, before anything is read or written. A status
        // move can occupy or free a room, and retiring that room checks whether a
        // case is in it — two transactions that must not interleave. Taking the
        // same lock the scheduler takes is what orders them: without it, "start
        // this case" and "retire this theatre" both succeeded and left a case
        // running in a retired room.
        await lockTheatre(tx, before.theatreId)

        // Re-read the theatre INSIDE the lock. The lock orders this against a
        // retire, but ordering alone is not enough: if the retire went first,
        // nothing here would have noticed, and the case would start in a room
        // that is no longer in service.
        if (['CHECKED_IN', 'IN_THEATRE'].includes(status)) {
          const theatre = await tx.operatingTheatre.findUnique({
            where: { id: before.theatreId },
            select: { name: true, isActive: true },
          })
          if (theatre?.isActive === false) {
            throw conflict(`${theatre.name} is no longer in service — move this case to another theatre`, 'OT_THEATRE_RETIRED')
          }
        }

        // Compare-and-swap on the status that was read above. Two people looking
        // at the same CONFIRMED case both pass the transition check — one presses
        // Check in, the other Cancel — and without this both writes land, the
        // second overwriting the first with no sign anything happened. Naming the
        // old status in the WHERE means the loser updates nothing and is told so.
        const { count } = await tx.otBooking.updateMany({
          where: { id, organizationId: ORG_ID, status: before.status },
          data,
        })
        if (count !== 1) {
          throw conflict(
            'Someone else changed this case a moment ago — reload it and try again',
            'OT_STALE_STATUS',
          )
        }
        const b = await tx.otBooking.findUnique({ where: { id } })

        // Keep the theatre board honest: occupied while a case is in, free again
        // the moment it leaves — including via cancel, which is the bug GNU
        // Health still has (its cancel() never releases the room).
        if (status === 'IN_THEATRE') {
          await tx.operatingTheatre.update({ where: { id: b.theatreId }, data: { status: 'OCCUPIED' } })
        } else if (['COMPLETED', 'CANCELLED', 'POSTPONED'].includes(status) && before.status === 'IN_THEATRE') {
          await tx.operatingTheatre.update({ where: { id: b.theatreId }, data: { status: 'CLEANING' } })
        }
        return b
      })
      await auditIpd(req, ORG_ID, { action: `status:${status}`, entityType: 'ot.booking', entityId: id, before, after: row })
      return res.json({ success: true, data: row })
    }

    // Replace the whole team for a booking — simplest correct semantics for the
    // UI, which edits the list as a unit.
    if (resource === 'team') {
      assertMay(req, 'ot-team')
      if (!(await isOwned('otBooking', id, ORG_ID))) throw notFound('Booking not found')
      const { team = [] } = req.body
      const rows = await buildTeamRows(team, ORG_ID, id)

      const before = await db.otTeamMember.findMany({ where: { bookingId: id } })
      await db.$transaction(async (tx) => {
        await tx.otTeamMember.deleteMany({ where: { bookingId: id, organizationId: ORG_ID } })
        if (rows.length) await tx.otTeamMember.createMany({ data: rows, skipDuplicates: true })
      })
      const after = await db.otTeamMember.findMany({ where: { bookingId: id }, include: { user: { select: staffSelect } } })
      await auditIpd(req, ORG_ID, { action: 'update', entityType: 'ot.team', entityId: id, before, after })
      return res.json({ success: true, data: after })
    }

    throw bad('Unknown resource')
  } catch (e) {
    if (e.status) return svcErr(res, e)
    next(e)
  }
}

// ────────────────────────────────────────────────────────────── DELETE ──────
// Masters are retired, never deleted — a past case must still resolve its
// theatre and procedure. Bookings are cancelled through `status`, not removed.

export async function remove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource, id } = req.query
    if (!id) throw bad('id is required')

    if (resource === 'theatre') {
      assertMay(req, 'ot-theatre')
      if (!(await isOwned('operatingTheatre', id, ORG_ID))) throw notFound('Theatre not found')
      // Same lock the scheduler takes, so a case cannot start between the check
      // and the write.
      const row = await db.$transaction(async (tx) => {
        await lockTheatre(tx, id)
        await assertNoLiveCase(id, ORG_ID, 'retire it', tx)
        return tx.operatingTheatre.update({ where: { id }, data: { isActive: false } })
      })
      await auditIpd(req, ORG_ID, { action: 'retire', entityType: 'ot.theatre', entityId: id, after: row })
      return res.json({ success: true, data: row })
    }

    if (resource === 'surgery') {
      assertMay(req, 'ot-surgery')
      if (!(await isOwned('surgeryCatalog', id, ORG_ID))) throw notFound('Surgery not found')
      const row = await db.surgeryCatalog.update({ where: { id }, data: { isActive: false } })
      await auditIpd(req, ORG_ID, { action: 'retire', entityType: 'ot.surgery', entityId: id, after: row })
      return res.json({ success: true, data: row })
    }

    throw bad('Unknown resource')
  } catch (e) {
    if (e.status) return svcErr(res, e)
    next(e)
  }
}
