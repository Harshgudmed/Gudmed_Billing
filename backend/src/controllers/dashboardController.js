import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { scopedDoctorId } from '../utils/scope.js'
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'
import { todayRange } from '../lib/dates.js'
import { todayRevenue } from '../lib/revenue.js'
import { roleWorksIn } from '../lib/roleModules.js'

// ---------------------------------------------------------------------------
// Short-lived per-scope cache + single-flight dedup.
//
// The dashboard recomputes the same aggregate numbers on every hit, and two of
// its queries are heavy (patient.count and the recent-patients findMany over a
// 1M+ row table). Each request fans out ~10 parallel queries, so even modest
// concurrency exhausts the Prisma connection pool (limit 13) and requests fail
// with P2024 ("Timed out fetching a new connection from the connection pool").
//
// Two guards fix that without changing the response shape:
//   1. TTL cache — a computed result is reused for CACHE_TTL_MS per scope, so a
//      burst within the window costs a single DB round-trip set.
//   2. Single-flight — concurrent cache-misses for the same scope share ONE
//      in-flight computation instead of each firing its own 10-query fan-out.
//
// Cache keys include the org id, the doctor scope AND the role, so tenants,
// per-doctor views and roles never share data. Every underlying query keeps its organizationId
// filter (org-scoping is preserved end to end).
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 30_000
const dashCache = new Map()     // key -> { expires: number, data: object }
const dashInflight = new Map()  // key -> Promise<object>

// Each figure belongs to a module (lib/roleModules.js); a role is sent only the
// figures of the modules it works in, and the others are not even counted — a
// billing desk gets the day's takings, not the patient list or the bed count.
async function computeDashboard(ORG_ID, myDoctorId, role) {
  const can = (module) => roleWorksIn(role, module)
  const skip = (fallback) => Promise.resolve(fallback)
  // "Today" is the HOSPITAL's day (todayRange, Asia/Kolkata), not the UTC day.
  // These were hand-rolled UTC midnight boundaries, which is a different 24h
  // window entirely: an appointment booked for today is stored at the start of
  // the IST day (18:30Z the previous date), so it fell BEFORE 00:00Z and the
  // "Today's Appointments" tile never counted a single appointment booked
  // through the app — while the queue tile, which already used todayRange,
  // counted the same patient correctly. One screen, two different "todays".
  const todayWindow = todayRange()

  const isDoctor = Boolean(myDoctorId)

  // A doctor's "own patients" = those they have an appointment or consultation with.
  const patientOwnFilter = isDoctor
    ? { OR: [{ appointments: { some: { doctorId: myDoctorId } } }, { consultations: { some: { doctorId: myDoctorId } } }] }
    : {}
  const patientWhere = { organizationId: ORG_ID, isActive: true, ...patientOwnFilter }
  const apptDoctor   = isDoctor ? { doctorId: myDoctorId } : {}

  const todayApptWhere = {
    organizationId: ORG_ID,
    appointmentDate: todayWindow,
    ...apptDoctor,
  }

  // All queries fire in parallel — no sequential waterfalls.
  const [
    totalPatients,
    todayAppointments,
    pendingLabOrders,
    pendingPrescriptions,
    todayPayments,
    bedStatusGroups,      // replaces two separate bed.count calls
    criticalLabResults,
    appointmentStatusGroups,
    recentPatients,
    upcomingAppointments,
    queueWaiting,
  ] = await Promise.all([
    can('patients') ? db.patient.count({ where: patientWhere }) : skip(0),

    can('appointments') ? db.appointment.count({ where: todayApptWhere }) : skip(0),

    !can('laboratory') ? skip(0) : db.labOrder.count({
      where: {
        organizationId: ORG_ID,
        status: { in: ['pending', 'sample_collected', 'in_progress'] },
        ...(isDoctor ? { requestedById: myDoctorId } : {}),
      },
    }),

    !can('pharmacy') ? skip(0) : db.prescription.count({
      where: {
        organizationId: ORG_ID,
        status: 'pending',
        ...(isDoctor ? { doctorId: myDoctorId } : {}),
      },
    }),

    // Revenue is a hospital metric, not a doctor metric — doctors get 0.
    // Every counter, net of refunds paid out today: the same figure as
    // Billing's tile (lib/revenue.js), so the two never disagree.
    isDoctor || !can('billing')
      ? Promise.resolve({ total: 0 })
      : todayRevenue(db, ORG_ID, todayWindow),

    // Single groupBy replaces two separate bed.count() round-trips.
    //
    // Skipped for a doctor, like the payments aggregate above: ward occupancy is
    // the hospital's business, not one doctor's, and their dashboard does not
    // render it. Not asking is a round-trip saved, not just a field hidden.
    isDoctor || !can('inpatient')
      ? Promise.resolve([])
      : db.bed.groupBy({
          by: ['status'],
          where: { organizationId: ORG_ID },
          _count: { _all: true },
        }),

    // Critical alerts — org-scoped so one tenant never sees another's count.
    // Scoped further to the doctor's own lab orders when a doctor is logged in.
    !can('opd') ? skip(0) : db.labResult.count({
      where: {
        organizationId: ORG_ID,
        isCritical: true,
        verifiedAt: null,
        ...(isDoctor ? { order: { requestedById: myDoctorId } } : {}),
      },
    }),

    !can('appointments') ? skip([]) : db.appointment.groupBy({
      by: ['status'],
      where: todayApptWhere,
      _count: true,
    }),

    !can('patients') ? skip([]) : db.patient.findMany({
      where: patientWhere,
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { ...PATIENT_NAME_SELECT, gender: true, dateOfBirth: true, createdAt: true },
    }),

    !can('appointments') ? skip([]) : db.appointment.findMany({
      where: {
        organizationId: ORG_ID,
        status: { in: ['scheduled', 'confirmed'] },
        appointmentDate: { gte: todayWindow.gte },
        ...apptDoctor,
      },
      take: 10,
      orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
      include: {
        patient: { select: { ...PATIENT_NAME_SELECT, } },
      },
    }),

    // Today's queue waiting count. A doctor sees only patients waiting for
    // them (assignedToId) or returning to them (followUpDoctorId) — same
    // "mine" scoping queueController.js uses for the queue list.
    !can('queue') ? skip(0) : db.queueManagement.count({
      where: {
        organizationId: ORG_ID,
        status: 'waiting',
        joinedQueueAt: todayRange(),
        ...(isDoctor ? { OR: [{ assignedToId: myDoctorId }, { followUpDoctorId: myDoctorId }] } : {}),
      },
    }),
  ])

  // Derive occupied & total from the single groupBy result.
  const occupiedBeds = bedStatusGroups.find(g => g.status === 'occupied')?._count._all ?? 0
  const totalBeds    = bedStatusGroups.reduce((sum, g) => sum + g._count._all, 0)

  return {
    stats: {
      ...(can('patients') ? { totalPatients } : {}),
      ...(can('appointments') ? { todayAppointments } : {}),
      ...(can('laboratory') ? { pendingLabOrders } : {}),
      ...(can('pharmacy') ? { pendingPrescriptions } : {}),
      // OMITTED for a doctor rather than sent as zero. The payments aggregate
      // above already refuses them the figure, but a tile reading "Today's
      // Revenue ₹0" states something false — the hospital did collect money,
      // this doctor is simply not the audience for it. Absent, the tile is not
      // drawn at all, which is the honest version of "not yours to see".
      ...(isDoctor || !can('billing') ? {} : { todayRevenue: todayPayments.total }),
      ...(isDoctor || !can('inpatient') ? {} : { occupiedBeds, availableBeds: totalBeds - occupiedBeds }),
      ...(can('queue') ? { queueWaiting } : {}),
      ...(can('opd') ? { criticalAlerts: criticalLabResults } : {}),
    },
    appointmentStatuses: appointmentStatusGroups.reduce((acc, item) => {
      acc[item.status] = item._count
      return acc
    }, {}),
    queueByService: {},
    recentPatients,
    upcomingAppointments,
    queue: [],
  }
}

export async function getDashboard(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)

    // When a doctor is logged in, the dashboard shows ONLY their own data:
    // their patients, their appointments, their prescriptions/lab orders, their queue.
    const myDoctorId = scopedDoctorId(req)

    const role = req.user?.role || ''
    const key = `${ORG_ID}::${myDoctorId || ''}::${role}`
    const nowMs = Date.now()

    // 1. Serve a fresh cached result if we have one.
    const cached = dashCache.get(key)
    if (cached && cached.expires > nowMs) {
      return res.json({ success: true, data: cached.data })
    }

    // 2. Single-flight: concurrent misses for the same scope share one compute.
    let inflight = dashInflight.get(key)
    if (!inflight) {
      inflight = computeDashboard(ORG_ID, myDoctorId, role)
        .then((data) => {
          dashCache.set(key, { expires: Date.now() + CACHE_TTL_MS, data })
          return data
        })
        .finally(() => { dashInflight.delete(key) })
      dashInflight.set(key, inflight)
    }

    const data = await inflight
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
