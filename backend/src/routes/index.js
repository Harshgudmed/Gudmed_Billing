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
import { handleWebhook } from '../controllers/paymentController.js'
import importRoutes from './importRoutes.js'
import preTriageRoutes from './preTriageRoutes.js'
import queueRoutes from './queueRoutes.js'
import roomRoutes from './roomRoutes.js'
import displayRoutes from './displayRoutes.js'
import screenRoutes from './screenRoutes.js'
import dayCareRoutes from './dayCareRoutes.js'
import ambulanceRoutes from './ambulanceRoutes.js'
import insuranceRoutes from './insuranceRoutes.js'
import { router as deathCertificateRoutes } from './deathCertificateRoutes.js'
import inpatientRoutes from './inpatientRoutes.js'
import machineIntegrationRoutes from './machineIntegrationRoutes.js'
import preRegistrationRoutes from './preRegistrationRoutes.js'
import partnerRoutes from './partnerRoutes.js'
import otRoutes from './otRoutes.js'
import otClinicalRoutes from './otClinicalRoutes.js'
import { createPreRegistration, getPublicOrg } from '../controllers/preRegistrationController.js'
import { rateLimit } from '../middleware/rateLimit.js'

export const router = Router()

// Public routes (no auth needed)
router.use('/auth',   authRoutes)
router.use('/import', importRoutes)  // data import — protected by x-import-secret header

// Self-service pre-registration from the hospital's QR code — a walk-up patient
// has no login, so these two sit ABOVE authenticate. They create nothing but a
// pending row (no UHID, no Patient); the reception side that turns one into a
// real patient IS behind authenticate (see '/pre-registration' below).
//
// Rate-limited because this is the one route on the whole API where an
// anonymous caller can WRITE. A pending row is cheap and sweeps itself after
// 48h, but nothing stopped a script filling reception's list with thousands of
// them in the meantime.
//
// Counted per HOSPITAL, not per address: behind the load balancer the resolved
// address varies between edge nodes (see partnerRoutes.js — an IP-keyed limiter
// there refused 3 of 150 instead of 90), and per-hospital means a flood aimed at
// one cannot lock walk-ups out of another. 30 a minute is far above a real
// counter's pace and far below a script's.
const preRegLimit = rateLimit({
  limit: Number(process.env.PREREG_RATE_LIMIT) || 30,
  windowMs: 60_000,
  message: 'Too many submissions — please wait a moment and try again',
  keyBy: (req) => req.body?.organizationId || req.ip,
})

router.get('/public/org/:orgId',    getPublicOrg)
router.post('/public/pre-registration', preRegLimit, createPreRegistration)

// Razorpay calls this server-to-server with no cookie or JWT. Mounted here, ahead
// of `authenticate`, or every webhook is rejected with 401 in production and the
// payment is never banked. It authenticates itself via the webhook signature.
router.post('/payments/webhook', handleWebhook)

// The doctor portal's backend reads a doctor's appointment list from here.
// Another system, not a person — no cookie to present — so it sits above
// `authenticate` and carries x-partner-key instead. Read-only, and the endpoint
// refuses everything until DOCTOR_PORTAL_PARTNER_SECRET is set.
router.use('/partner', partnerRoutes)

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
router.use('/queue',                 authorize(), queueRoutes)
router.use('/rooms',                 authorize(), roomRoutes)
router.use('/display',               authorize(), displayRoutes)
router.use('/screens',               authorize(), screenRoutes)
router.use('/day-care',              authorize(), dayCareRoutes)
router.use('/ambulance',             authorize(), ambulanceRoutes)
router.use('/insurance',             authorize(), insuranceRoutes)
router.use('/death-certificates',    authorize(), deathCertificateRoutes)
router.use('/inpatient',             authorize(), inpatientRoutes)
router.use('/machine-integration',   authorize(), machineIntegrationRoutes)
router.use('/pre-registration',      authorize(), preRegistrationRoutes)
// Named roles, unlike the modules above: a lab technician or pharmacist has no
// business in the theatre list at all, so they are refused at the door rather
// than per action. Who may cancel / re-team a case is narrowed again inside the
// controller. admin and super_admin always pass.
// 'billing' and 'billing_clerk' are both accepted: the User.role comment in
// schema.prisma says billing_clerk, the web app's roleConfig key is billing.
router.use('/ot',                    authorize('doctor', 'nurse', 'receptionist', 'billing', 'billing_clerk'), otRoutes)
// The case documents. Same door as /ot; who may WRITE each one is narrowed per
// document inside the controller.
router.use('/ot-clinical',           authorize('doctor', 'nurse', 'receptionist', 'billing', 'billing_clerk'), otClinicalRoutes)
