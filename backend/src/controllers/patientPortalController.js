import { db } from '../config/db.js'
import { patientFullName } from '../lib/patientName.js'

// All endpoints here serve the logged-in patient ONLY, using the patientId baked
// into their JWT. A patient can never see another patient's data.

function jsonArray(value) {
  if (!value) return []
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : [] } catch { return [] }
}

/**
 * GET /api/patient-portal/me
 * The patient's own profile + dashboard: appointments, prescriptions, lab/radiology
 * reports, invoices, and a billing summary.
 */
export async function getMyDashboard(req, res, next) {
  try {
    const patientId = req.user?.patientId
    if (!patientId) return res.status(401).json({ success: false, error: 'Not authenticated' })

    const patient = await db.patient.findUnique({ where: { id: patientId } })
    if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' })

    // Hospital branding so the patient portal matches the main site's colours/logo.
    const org = await db.organization.findUnique({ where: { id: patient.organizationId } })
    let orgSettings = {}
    try { orgSettings = JSON.parse(org?.settings || '{}') } catch { orgSettings = {} }
    const branding = {
      hospitalName:   org?.name || 'Hospital',
      primaryColor:   org?.primaryColor || '#2563eb',
      secondaryColor: org?.secondaryColor || '#7c3aed',
      navbarColor:    orgSettings.navbarColor || org?.primaryColor || '#2E4168',
      headerColor:    orgSettings.headerColor || null,
      logoUrl:        org?.logoUrl || null,
    }

    const [appointments, prescriptions, labOrders, radiologyOrders, invoices, patientDocuments] = await Promise.all([
      db.appointment.findMany({
        where: { patientId },
        orderBy: { appointmentDate: 'desc' },
        take: 25,
        include: { doctor: { select: { id: true, fullName: true, specialization: true } } },
      }),
      db.prescription.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { doctor: { select: { id: true, fullName: true } } },
      }),
      db.labOrder.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { results: { include: { test: true } } },
      }),
      db.radiologyOrder.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { exam: true, report: true },
      }),
      db.invoice.findMany({ where: { patientId }, orderBy: { invoiceDate: 'desc' }, take: 25 }),
      db.patientDocument.findMany({ where: { patientId }, orderBy: { uploadedAt: 'desc' } }),
    ])

    const billable = invoices.filter(i => i.status !== 'cancelled' && i.paymentStatus !== 'cancelled')
    const totalBilled = billable.reduce((s, i) => s + (i.totalAmount || 0), 0)
    const totalPaid = billable.reduce((s, i) => s + (i.amountPaid || 0), 0)
    const balanceDue = billable.reduce((s, i) => s + (i.balanceDue != null ? i.balanceDue : (i.totalAmount || 0) - (i.amountPaid || 0)), 0)

    const now = new Date()
    const upcomingAppointments = appointments.filter(
      a => ['scheduled', 'confirmed'].includes(a.status) && new Date(a.appointmentDate) >= new Date(now.toDateString())
    )

    res.json({
      success: true,
      data: {
        branding,
        serverTime: new Date().toISOString(),
        profile: {
          id: patient.id,
          mrn: patient.mrn,
          fullName: patientFullName(patient),
          gender: patient.gender,
          dateOfBirth: patient.dateOfBirth,
          bloodGroup: patient.bloodGroup,
          phonePrimary: patient.phonePrimary,
          email: patient.email,
          allergies: jsonArray(patient.allergies),
          chronicConditions: jsonArray(patient.chronicConditions),
          currentMedications: jsonArray(patient.currentMedications),
        },
        stats: {
          upcomingAppointments: upcomingAppointments.length,
          totalAppointments: appointments.length,
          prescriptions: prescriptions.length,
          labReports: labOrders.length,
          radiologyReports: radiologyOrders.length,
          balanceDue,
        },
        upcomingAppointments,
        appointments,
        prescriptions,
        labOrders,
        radiologyOrders,
        invoices,
        patientDocuments,
        billing: { totalBilled, totalPaid, balanceDue, invoiceCount: billable.length },
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * POST /api/patient-portal/documents
 * Upload a document (KYC, lab report, etc.) for the logged-in patient.
 */
export async function uploadDocument(req, res, next) {
  try {
    const patientId = req.user?.patientId
    if (!patientId) return res.status(401).json({ success: false, error: 'Not authenticated' })

    const { documentType, title } = req.body
    if (!documentType) return res.status(400).json({ success: false, error: 'Missing documentType' })
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' })

    const patient = await db.patient.findUnique({ where: { id: patientId } })
    if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' })

    // Generate a URL that the frontend can use to view the file
    // Assumes server is configured to serve static files from /uploads
    // (e.g. app.use('/uploads', express.static(path.join(__dirname, 'uploads'))))
    const fileUrl = `/uploads/patient-documents/${req.file.filename}`

    const newDoc = await db.patientDocument.create({
      data: {
        organizationId: patient.organizationId,
        patientId,
        documentType,
        title: title || documentType,
        fileUrl,
        fileType: req.file.mimetype,
      }
    })

    res.status(201).json({ success: true, data: newDoc })
  } catch (err) {
    next(err)
  }
}

/**
 * DELETE /api/patient-portal/documents/:id
 * Delete a previously uploaded document.
 */
export async function deleteDocument(req, res, next) {
  try {
    const patientId = req.user?.patientId
    if (!patientId) return res.status(401).json({ success: false, error: 'Not authenticated' })

    const documentId = req.params.id

    // Check if it belongs to the patient
    const doc = await db.patientDocument.findUnique({ where: { id: documentId } })
    if (!doc || doc.patientId !== patientId) {
      return res.status(404).json({ success: false, error: 'Document not found' })
    }

    // Delete from DB (optionally from disk too, but keeping it simple for now)
    await db.patientDocument.delete({ where: { id: documentId } })

    res.json({ success: true, message: 'Document deleted successfully' })
  } catch (err) {
    next(err)
  }
}
