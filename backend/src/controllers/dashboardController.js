import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { scopedDoctorId } from '../utils/scope.js'
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'
import { todayRange } from '../lib/dates.js'

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
// Cache keys include the org id AND the doctor scope, so tenants and per-doctor
// views never share data. Every underlying query keeps its organizationId
// filter (org-scoping is preserved end to end).
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 30_000
const dashCache = new Map()     // key -> { expires: number, data: object }
const dashInflight = new Map()  // key -> Promise<object>

async function computeDashboard(ORG_ID, myDoctorId) {
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
    db.patient.count({ where: patientWhere }),

    db.appointment.count({ where: todayApptWhere }),

    db.labOrder.count({
      where: {
        organizationId: ORG_ID,
        status: { in: ['pending', 'sample_collected', 'in_progress'] },
        ...(isDoctor ? { requestedById: myDoctorId } : {}),
      },
    }),

    db.prescription.count({
      where: {
        organizationId: ORG_ID,
        status: 'pending',
        ...(isDoctor ? { doctorId: myDoctorId } : {}),
      },
    }),

    // Revenue is a hospital metric, not a doctor metric — doctors get 0.
    isDoctor
      ? Promise.resolve({ _sum: { amount: 0 } })
      : db.payment.aggregate({
          where: { organizationId: ORG_ID, paymentDate: todayWindow, isRefund: false },
          _sum: { amount: true },
        }),

    // Single groupBy replaces two separate bed.count() round-trips.
    db.bed.groupBy({
      by: ['status'],
      where: { organizationId: ORG_ID },
      _count: { _all: true },
    }),

    // Critical alerts — org-scoped so one tenant never sees another's count.
    // Scoped further to the doctor's own lab orders when a doctor is logged in.
    db.labResult.count({
      where: {
        organizationId: ORG_ID,
        isCritical: true,
        verifiedAt: null,
        ...(isDoctor ? { order: { requestedById: myDoctorId } } : {}),
      },
    }),

    db.appointment.groupBy({
      by: ['status'],
      where: todayApptWhere,
      _count: true,
    }),

    db.patient.findMany({
      where: patientWhere,
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { ...PATIENT_NAME_SELECT, gender: true, dateOfBirth: true, createdAt: true },
    }),

    db.appointment.findMany({
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
    db.queueManagement.count({
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
      totalPatients,
      todayAppointments,
      pendingLabOrders,
      pendingPrescriptions,
      todayRevenue: todayPayments._sum.amount || 0,
      occupiedBeds,
      availableBeds: totalBeds - occupiedBeds,
      queueWaiting,
      criticalAlerts: criticalLabResults,
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

    const key = `${ORG_ID}::${myDoctorId || ''}`
    const nowMs = Date.now()

    // 1. Serve a fresh cached result if we have one.
    const cached = dashCache.get(key)
    if (cached && cached.expires > nowMs) {
      return res.json({ success: true, data: cached.data })
    }

    // 2. Single-flight: concurrent misses for the same scope share one compute.
    let inflight = dashInflight.get(key)
    if (!inflight) {
      inflight = computeDashboard(ORG_ID, myDoctorId)
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
