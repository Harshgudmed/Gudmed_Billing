import { Router } from 'express'
import { authenticate, authorize, requirePatient } from '../middleware/auth.js'
import authRoutes from './authRoutes.js'
import patientPortalRoutes from './patientPortalRoutes.js'
import dashboardRoutes from './dashboardRoutes.js'
import appointmentRoutes from './appointmentRoutes.js'
import patientRoutes from './patientRoutes.js'
import consultationRoutes from './consultationRoutes.js'
import clinicalKbRoutes from './clinicalKbRoutes.js'
import settingsRoutes from './settingsRoutes.js'
import pharmacyRoutes from './pharmacyRoutes.js'
import laboratoryRoutes from './laboratoryRoutes.js'
import radiologyRoutes from './radiologyRoutes.js'
import billingRoutes from './billingRoutes.js'
import { router as doctorAccountabilityRoutes } from './doctorAccountabilityRoutes.js'
import { router as feeSlabRoutes } from './feeSlabRoutes.js'
import notificationRoutes from './notificationRoutes.js'
import paymentRoutes from './paymentRoutes.js'
import importRoutes from './importRoutes.js'
import preTriageRoutes from './preTriageRoutes.js'
import triageRoutes from './triageRoutes.js'
import dayCareRoutes from './dayCareRoutes.js'
import ambulanceRoutes from './ambulanceRoutes.js'
import insuranceRoutes from './insuranceRoutes.js'
import { router as deathCertificateRoutes } from './deathCertificateRoutes.js'
import inpatientRoutes from './inpatientRoutes.js'

export const router = Router()

// Public routes (no auth needed)
router.use('/auth',   authRoutes)
router.use('/import', importRoutes)  // data import — protected by x-import-secret header

// Apply authenticate middleware to all routes below
router.use(authenticate)

router.get('/', (_req, res) => res.json({ message: 'Hospital Management API', version: '1.0.0' }))

// Access model (v1):
//  - `authenticate` above already requires a valid login on every route (401 otherwise).
//  - What each role can *navigate to* is controlled by the frontend sidebar (roleConfig).
//  - Real per-doctor isolation is enforced by DATA SCOPING in the controllers: a doctor
//    only ever sees their own patients / appointments / consultations.
// We deliberately do NOT hard-block these endpoints by role, because the clinical screens
// are interconnected — e.g. a doctor's Consultation reads /pharmacy/drugs to prescribe,
// and Doctor Accountability reads /fee-slabs. Per-endpoint role hardening is a later
// refinement.
// Patient portal — patient-session only, scoped to their own record.
router.use('/patient-portal',        requirePatient, patientPortalRoutes)

router.use('/dashboard',             authorize(), dashboardRoutes)
router.use('/appointments',          authorize(), appointmentRoutes)
router.use('/patients',              authorize(), patientRoutes)
router.use('/consultations',         authorize(), consultationRoutes)
router.use('/clinical-kb',           authorize(), clinicalKbRoutes)
router.use('/settings',              authorize(), settingsRoutes)
router.use('/pharmacy',              authorize(), pharmacyRoutes)
router.use('/laboratory',            authorize(), laboratoryRoutes)
router.use('/radiology',             authorize(), radiologyRoutes)
router.use('/billing',               authorize(), billingRoutes)
router.use('/doctor-accountability', authorize(), doctorAccountabilityRoutes)
router.use('/fee-slabs',             authorize(), feeSlabRoutes)
router.use('/notifications',         authorize(), notificationRoutes)
router.use('/payments',              authorize(), paymentRoutes)
router.use('/pre-triage',            authorize(), preTriageRoutes)
router.use('/triage',                authorize(), triageRoutes)
router.use('/day-care',              authorize(), dayCareRoutes)
router.use('/ambulance',             authorize(), ambulanceRoutes)
router.use('/insurance',             authorize(), insuranceRoutes)
router.use('/death-certificates',    authorize(), deathCertificateRoutes)
router.use('/inpatient',             authorize(), inpatientRoutes)
