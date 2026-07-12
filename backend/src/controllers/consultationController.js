import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { nextSeriesNumber } from "../lib/counters.js";
import { listResponse } from "../lib/pagination.js";
import { scopedDoctorId } from '../utils/scope.js'

export async function getAll(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { patientId, doctorId, date, search = '', startDate = '', endDate = '' } = req.query

    // baseWhere = org + patient/doctor scope + search, but NOT the date filter, so
    // the stat cards (Total / Today / This Week / With Rx) stay stable across tabs.
    const baseWhere = { organizationId }
    if (patientId) baseWhere.patientId = patientId
    if (doctorId) baseWhere.doctorId = doctorId
    // A doctor only sees their own consultations.
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) baseWhere.doctorId = myDoctorId
    if (search) {
      baseWhere.OR = [
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { mrn: { contains: search, mode: 'insensitive' } } },
        { diagnosis: { contains: search, mode: 'insensitive' } },
      ]
    }

    const where = { ...baseWhere }
    // A single `date` (legacy) OR a startDate/endDate range filters the list.
    if (date) {
      const t = new Date(date)
      where.visitDate = { gte: new Date(new Date(t).setHours(0, 0, 0, 0)), lte: new Date(new Date(t).setHours(23, 59, 59, 999)) }
    } else if (startDate || endDate) {
      where.visitDate = {}
      if (startDate) where.visitDate.gte = new Date(new Date(startDate).setHours(0, 0, 0, 0))
      if (endDate) where.visitDate.lte = new Date(new Date(endDate).setHours(23, 59, 59, 999))
    }

    const include = {
      patient: {
        select: { id: true, mrn: true, firstName: true, middleName: true, lastName: true, phonePrimary: true, gender: true, dateOfBirth: true, bloodGroup: true },
      },
      doctor: { select: { id: true, fullName: true, specialization: true } },
      prescriptions: true,
      labOrders: true,
      radiologyOrders: {
        include: { exam: { select: { id: true, examName: true, examCode: true, examCategory: true, bodyPart: true } } },
      },
    }
    // Stat cards count across baseWhere (ignoring the active date tab).
    const body = await listResponse(db.consultation, {
      where, include, orderBy: { visitDate: 'desc' }, req, fullListTake: 50,
      summary: async () => {
        const startOfToday = new Date(new Date().setHours(0, 0, 0, 0))
        const weekAgo = new Date(Date.now() - 7 * 86400000)
        const [total, today, thisWeek, withRx] = await Promise.all([
          db.consultation.count({ where: baseWhere }),
          db.consultation.count({ where: { ...baseWhere, visitDate: { gte: startOfToday } } }),
          db.consultation.count({ where: { ...baseWhere, visitDate: { gte: weekAgo } } }),
          db.consultation.count({ where: { ...baseWhere, prescriptions: { some: {} } } }),
        ])
        return { total, today, thisWeek, withRx }
      },
    })
    res.json(body)
  } catch (err) {
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const validatedData = req.validatedBody
    const { prescriptionItems, labTests, radiologyExams, ...consultationData } = validatedData

    // Use a transaction to ensure consultation, prescriptions, lab orders, radiology orders, and appointment updates all succeed or fail together
    const consultation = await db.$transaction(async (tx) => {
      const newConsultation = await tx.consultation.create({
        data: {
          organizationId,
          patientId: consultationData.patientId,
          doctorId: consultationData.doctorId,
          appointmentId: consultationData.appointmentId,
          visitType: consultationData.visitType || 'outpatient',
          temperature: consultationData.temperature,
          bloodPressureSystolic: consultationData.bloodPressureSystolic,
          bloodPressureDiastolic: consultationData.bloodPressureDiastolic,
          pulseRate: consultationData.pulseRate,
          respiratoryRate: consultationData.respiratoryRate,
          weight: consultationData.weight,
          height: consultationData.height,
          oxygenSaturation: consultationData.oxygenSaturation,
          chiefComplaint: consultationData.chiefComplaint,
          historyOfPresentIllness: consultationData.historyOfPresentIllness,
          physicalExamination: consultationData.physicalExamination,
          diagnosis: consultationData.diagnosis,
          icd10Codes: consultationData.icd10Codes ? JSON.stringify(consultationData.icd10Codes) : null,
          treatmentPlan: consultationData.treatmentPlan,
          followUpInstructions: consultationData.followUpInstructions,
          followUpDate: consultationData.followUpDate ? new Date(consultationData.followUpDate) : null,
          referredTo: consultationData.referredTo,
          referralReason: consultationData.referralReason,
          notes: consultationData.notes,
        },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, middleName: true, lastName: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      })

      let prescriptionId = null
      if (prescriptionItems && prescriptionItems.length > 0) {
        const prescription = await tx.prescription.create({
          data: {
            organizationId,
            patientId: consultationData.patientId,
            doctorId: consultationData.doctorId,
            consultationId: newConsultation.id,
            items: JSON.stringify(prescriptionItems),
            status: 'pending',
          },
        })
        prescriptionId = prescription.id
      }

      // Create Lab Orders
      let labOrderId = null
      if (labTests && labTests.length > 0) {
        const labOrder = await tx.labOrder.create({
          data: {
            organizationId,
            patientId: consultationData.patientId,
            consultationId: newConsultation.id,
            requestedById: consultationData.doctorId,
            orderNumber: await nextSeriesNumber(tx, organizationId, 'LAB_ORDER', 'LAB'),
            tests: JSON.stringify(labTests),
            clinicalIndication: consultationData.diagnosis,
            priority: 'routine',
            status: 'pending',
          },
        })
        labOrderId = labOrder.id
      }

      // Create Radiology Orders
      let radiologyOrderId = null
      if (radiologyExams && radiologyExams.length > 0) {
        const ts = Date.now()
        for (let i = 0; i < radiologyExams.length; i++) {
          await tx.radiologyOrder.create({
            data: {
              organizationId,
              patientId: consultationData.patientId,
              consultationId: newConsultation.id,
              requestedById: consultationData.doctorId,
              examId: radiologyExams[i].examId,
              orderNumber: `RAD${ts}-${i}`,
              clinicalIndication: consultationData.diagnosis,
              urgency: 'routine',
              status: 'pending',
            },
          })
        }
        radiologyOrderId = radiologyExams[0]?.examId
      }

      if (consultationData.appointmentId) {
        await tx.appointment.update({
          where: { id: consultationData.appointmentId },
          data: { status: 'completed', completedAt: new Date() },
        })
      }

      // 5. Fetch and return the fully assembled record with all relations inside transaction
      const fullConsultation = await tx.consultation.findFirst({
        where: { id: newConsultation.id, organizationId },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, middleName: true, lastName: true } },
          doctor: { select: { id: true, fullName: true } },
          prescriptions: true,
          labOrders: {
            include: {
              results: { include: { test: true } }
            }
          },
          radiologyOrders: {
            include: { exam: true, report: true }
          },
        },
      })

      return { consultation: fullConsultation, prescriptionId, labOrderId, radiologyOrderId }
    })

    res.status(201).json({
      success: true,
      data: consultation.consultation,
      prescriptionId: consultation.prescriptionId,
      labOrderId: consultation.labOrderId,
      radiologyOrderId: consultation.radiologyOrderId,
      message: 'Consultation saved with prescriptions, lab orders, and radiology orders'
    })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    const { prescriptionItems, labTests, radiologyExams, ...updateData } = req.validatedBody

    if (!id) {
      return res.status(400).json({ success: false, error: 'Consultation ID is required' })
    }

    // Tenant guard: verify the consultation exists AND belongs to this org.
    // findUnique with bare id would let Org-A update Org-B's consultation.
    const existingConsultation = await db.consultation.findFirst({ where: { id, organizationId } })
    if (!existingConsultation) {
      return res.status(404).json({ success: false, error: 'Consultation not found' })
    }

    if (updateData.icd10Codes && Array.isArray(updateData.icd10Codes)) {
      updateData.icd10Codes = JSON.stringify(updateData.icd10Codes)
    }
    if (updateData.followUpDate) {
      updateData.followUpDate = new Date(updateData.followUpDate)
    }

    // Use a transaction to safely handle consultation, prescriptions, lab orders, and radiology orders
    const consultation = await db.$transaction(async (tx) => {
      // 1. Update the main consultation record (only if there are fields to update)
      if (Object.keys(updateData).length > 0) {
        await tx.consultation.update({
          where: { id },
          data: updateData,
        })
      }

      // Fetch current consultation to get patientId and doctorId
      const currentConsultation = await tx.consultation.findFirst({ where: { id, organizationId } })

      // 2. Handle Prescriptions
      if (prescriptionItems && prescriptionItems.length > 0) {
        // Check if a prescription already exists for this consultation
        const existingPrescription = await tx.prescription.findFirst({
          where: { consultationId: id }
        })

        if (existingPrescription) {
          // Update the existing prescription with the new medicines
          await tx.prescription.update({
            where: { id: existingPrescription.id },
            data: { items: JSON.stringify(prescriptionItems) }
          })
        } else {
          // If no prescription existed, we need to create one
          await tx.prescription.create({
            data: {
              organizationId,
              patientId: currentConsultation.patientId,
              doctorId: currentConsultation.doctorId,
              consultationId: currentConsultation.id,
              items: JSON.stringify(prescriptionItems),
              status: 'pending',
            }
          })
        }
      }

      // 3. Handle Lab Orders
      if (labTests && labTests.length > 0) {
        // Check if a lab order already exists for this consultation
        const existingLabOrder = await tx.labOrder.findFirst({
          where: { consultationId: id }
        })

        if (existingLabOrder) {
          // Update the existing lab order
          await tx.labOrder.update({
            where: { id: existingLabOrder.id },
            data: {
              tests: JSON.stringify(labTests),
              clinicalIndication: updateData.diagnosis || existingLabOrder.clinicalIndication,
            }
          })
        } else {
          // Create new lab order
          await tx.labOrder.create({
            data: {
              organizationId,
              patientId: currentConsultation.patientId,
              consultationId: currentConsultation.id,
              requestedById: currentConsultation.doctorId,
              orderNumber: `LAB${Date.now()}`,
              tests: JSON.stringify(labTests),
              clinicalIndication: updateData.diagnosis,
              priority: 'routine',
              status: 'pending',
            }
          })
        }
      }

      // 4. Handle Radiology Orders
      if (radiologyExams && radiologyExams.length > 0) {
        // Delete existing radiology orders for this consultation
        await tx.radiologyOrder.deleteMany({
          where: { consultationId: id }
        })

        // Create new radiology orders — stamp ts once so exams in the same
        // loop iteration don't share the same ms and collide on @unique.
        const ts = Date.now()
        for (let i = 0; i < radiologyExams.length; i++) {
          await tx.radiologyOrder.create({
            data: {
              organizationId,
              patientId: currentConsultation.patientId,
              consultationId: currentConsultation.id,
              requestedById: currentConsultation.doctorId,
              examId: radiologyExams[i].examId,
              orderNumber: `RAD${ts}-${i}`,
              clinicalIndication: updateData.diagnosis,
              urgency: 'routine',
              status: 'pending',
            }
          })
        }
      }

      // 5. Fetch and return the fully assembled, updated record with all relations
      return await tx.consultation.findFirst({
        where: { id, organizationId },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, middleName: true, lastName: true } },
          doctor: { select: { id: true, fullName: true } },
          prescriptions: true,
          labOrders: {
            include: {
              results: { include: { test: true } }
            }
          },
          radiologyOrders: {
            include: { exam: true, report: true }
          },
        },
      })
    })

    res.json({ success: true, data: consultation })
  } catch (err) {
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params

    if (!id) {
      return res.status(400).json({ success: false, error: 'Consultation ID is required' })
    }

    // Scope to org (and to the doctor's own rows when a doctor is logged in).
    const where = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const existing = await db.consultation.findFirst({ where })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Consultation not found' })
    }

    // Delete dependent records first (no DB cascade), then the consultation itself.
    await db.$transaction(async (tx) => {
      const labOrders = await tx.labOrder.findMany({
        where: { consultationId: id }, select: { id: true },
      })
      if (labOrders.length > 0) {
        const labOrderIds = labOrders.map((o) => o.id)
        await tx.labResult.deleteMany({ where: { orderId: { in: labOrderIds } } })
        await tx.labOrder.deleteMany({ where: { id: { in: labOrderIds } } })
      }

      const radOrders = await tx.radiologyOrder.findMany({
        where: { consultationId: id }, select: { id: true },
      })
      if (radOrders.length > 0) {
        const radOrderIds = radOrders.map((o) => o.id)
        await tx.radiologyReport.deleteMany({ where: { orderId: { in: radOrderIds } } })
        await tx.radiologyOrder.deleteMany({ where: { id: { in: radOrderIds } } })
      }

      await tx.prescription.deleteMany({ where: { consultationId: id } })
      await tx.consultation.delete({ where: { id } })
    })

    res.json({ success: true, message: 'Consultation deleted' })
  } catch (err) {
    next(err)
  }
}
