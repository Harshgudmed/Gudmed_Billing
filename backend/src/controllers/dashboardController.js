import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { scopedDoctorId } from '../utils/scope.js'
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'

export async function getDashboard(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)

    // Use UTC boundaries so the server timezone never skews "today".
    const now = new Date()
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
    const todayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))

    // When a doctor is logged in, the dashboard shows ONLY their own data:
    // their patients, their appointments, their prescriptions/lab orders, their queue.
    const myDoctorId = scopedDoctorId(req)
    const isDoctor   = Boolean(myDoctorId)

    // A doctor's "own patients" = those they have an appointment or consultation with.
    const patientOwnFilter = isDoctor
      ? { OR: [{ appointments: { some: { doctorId: myDoctorId } } }, { consultations: { some: { doctorId: myDoctorId } } }] }
      : {}
    const patientWhere = { organizationId: ORG_ID, isActive: true, ...patientOwnFilter }
    const apptDoctor   = isDoctor ? { doctorId: myDoctorId } : {}

    const todayApptWhere = {
      organizationId: ORG_ID,
      appointmentDate: { gte: todayStart, lte: todayEnd },
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
            where: { organizationId: ORG_ID, paymentDate: { gte: todayStart, lte: todayEnd }, isRefund: false },
            _sum: { amount: true },
          }),

      // Single groupBy replaces two separate bed.count() round-trips.
      db.bed.groupBy({
        by: ['status'],
        where: { organizationId: ORG_ID },
        _count: { _all: true },
      }),

      // Critical alerts scoped to the doctor's own lab orders; org-wide otherwise.
      db.labResult.count({
        where: {
          isCritical: true,
          verifiedAt: null,
          ...(isDoctor ? { order: { requestedById: myDoctorId } } : {}),
        },
      }),

      // Moved into Promise.all — was previously a sequential await.
      db.appointment.groupBy({
        by: ['status'],
        where: todayApptWhere,
        _count: true,
      }),

      // Moved into Promise.all — was previously a sequential await.
      db.patient.findMany({
        where: patientWhere,
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { ...PATIENT_NAME_SELECT, gender: true, dateOfBirth: true, createdAt: true },
      }),

      // Moved into Promise.all — was previously a sequential await.
      db.appointment.findMany({
        where: {
          organizationId: ORG_ID,
          status: { in: ['scheduled', 'confirmed'] },
          appointmentDate: { gte: todayStart },
          ...apptDoctor,
        },
        take: 10,
        orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
        include: {
          patient: { select: { ...PATIENT_NAME_SELECT, } },
        },
      }),
    ])

    // Derive occupied & total from the single groupBy result.
    const occupiedBeds = bedStatusGroups.find(g => g.status === 'occupied')?._count._all ?? 0
    const totalBeds    = bedStatusGroups.reduce((sum, g) => sum + g._count._all, 0)

    res.json({
      success: true,
      data: {
        stats: {
          totalPatients,
          todayAppointments,
          pendingLabOrders,
          pendingPrescriptions,
          todayRevenue: todayPayments._sum.amount || 0,
          occupiedBeds,
          availableBeds: totalBeds - occupiedBeds,
          queueWaiting: 0,
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
      },
    })
  } catch (err) {
    next(err)
  }
}
