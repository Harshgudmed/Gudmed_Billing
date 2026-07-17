import { db } from '../config/db.js'

// Pricing policy constants (previously hard-coded as magic numbers in two places).
export const DEFAULT_CONSULTATION_FEE = 500
export const FOLLOW_UP_RESET_DAYS = 30

/**
 * Compute the consultation fee for a (doctor, patient, date).
 *
 * Pricing is anchored to the patient's most recent NEW-PATIENT visit with this
 * doctor. Within the reset window the doctor's fee slabs apply; beyond it the
 * visit is treated as a new patient again.
 *
 * This is the SINGLE source of truth used by both the booking endpoint
 * (appointmentController.create) and the fee-preview endpoint
 * (feeSlabController.calculateFee), so the preview can never disagree with the
 * charge.
 *
 * @returns {{ fee:number, daysSinceLastVisit:number|null, isNewPatient:boolean,
 *             slab:object|null, reason:'new_patient'|'reset'|'slab'|'default',
 *             doctorMissing?:boolean }}
 */
export async function computeConsultationFee({ organizationId, doctorId, patientId, date }) {
  const targetDate = date ? new Date(date) : new Date()

  const doctor = await db.user.findFirst({
    where: { id: doctorId, organizationId, role: 'doctor' },
    select: { consultationFee: true, id: true },
  })
  if (!doctor) return { doctorMissing: true }

  // `??` not `||`: a doctor whose fee is deliberately set to 0 (a free clinic /
  // charity / govt-scheme doctor) must bill 0, not silently fall back to 500.
  // Only a null/unset fee falls back to the default.
  const baseFee = doctor.consultationFee ?? DEFAULT_CONSULTATION_FEE

  const lastNewVisit = await db.appointment.findFirst({
    where: {
      organizationId,
      patientId,
      doctorId,
      appointmentType: 'new_patient',
      status: { notIn: ['cancelled', 'rescheduled'] },
      appointmentDate: { lt: targetDate },
    },
    orderBy: { appointmentDate: 'desc' },
    select: { appointmentDate: true },
  })

  // First-ever visit with this doctor → new patient.
  if (!lastNewVisit) {
    return { fee: baseFee, daysSinceLastVisit: null, isNewPatient: true, slab: null, reason: 'new_patient' }
  }

  const daysSinceLastVisit = Math.floor(
    (targetDate - new Date(lastNewVisit.appointmentDate)) / (1000 * 60 * 60 * 24),
  )

  // Beyond the reset window → treat as a new patient again.
  if (daysSinceLastVisit > FOLLOW_UP_RESET_DAYS) {
    return { fee: baseFee, daysSinceLastVisit, isNewPatient: true, slab: null, reason: 'reset' }
  }

  // Within the window → apply a matching fee slab if one exists.
  const slab = await db.doctorFeeSlab.findFirst({
    where: {
      doctorId,
      organizationId,
      isActive: true,
      fromDays: { lte: daysSinceLastVisit },
      toDays: { gt: daysSinceLastVisit },
    },
  })
  if (slab) {
    // Clamp at 0 in case a bad slab predates the createSlab guard — a negative
    // fee must never become a negative invoice/commission.
    return { fee: Math.max(0, slab.feeAmount), daysSinceLastVisit, isNewPatient: false, slab, reason: 'slab' }
  }

  return { fee: baseFee, daysSinceLastVisit, isNewPatient: false, slab: null, reason: 'default' }
}
