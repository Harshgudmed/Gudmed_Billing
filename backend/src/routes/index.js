import { Router } from 'express'
import { authenticate, authorize, requireModule, requirePatient } from '../middleware/auth.js'
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
import { INSURANCE_READERS } from '../lib/billingAccess.js'
import { router as deathCertificateRoutes } from './deathCertificateRoutes.js'
import inpatientRoutes from './inpatientRoutes.js'
import machineIntegrationRoutes from './machineIntegrationRoutes.js'
import preRegistrationRoutes from './preRegistrationRoutes.js'
import partnerRoutes from './partnerRoutes.js'
import otRoutes from './otRoutes.js'
import otClinicalRoutes from './otClinicalRoutes.js'
import purchaseRoutes from './purchaseRoutes.js'
import storeIndentRoutes from './storeIndentRoutes.js'
import { createPreRegistration, getPublicOrg } from '../controllers/preRegistrationController.js'
import { publicDepartments, publicDoctors, publicDoctorTimetable, publicCheckSlot, publicFindPatient, publicRegisterAndBook } from '../controllers/publicBookingController.js'
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

// A patient booking their own appointment from the QR page. These call the SAME
// handlers the logged-in counter uses (see publicBookingController) — only the
// hospital comes from the link instead of a session. Rate-limited because they
// are anonymous: reads per hospital, bookings per hospital AND per mobile number,
// so one phone cannot fill a doctor's day.
const publicReadLimit = rateLimit({
  limit: Number(process.env.PUBLIC_READ_RATE_LIMIT) || 120,
  windowMs: 60_000,
  message: 'Too many requests — please wait a moment and try again',
  keyBy: (req) => `read:${req.params?.orgId || req.ip}`,
})
const publicBookHospitalLimit = rateLimit({
  limit: Number(process.env.PUBLIC_BOOK_RATE_LIMIT) || 20,
  windowMs: 60_000,
  message: 'Too many bookings right now — please wait a moment and try again',
  keyBy: (req) => `book:${req.params?.orgId || req.ip}`,
})
const publicBookPhoneLimit = rateLimit({
  limit: Number(process.env.PUBLIC_BOOK_PER_PHONE_LIMIT) || 3,
  windowMs: 60 * 60_000,
  message: 'Too many bookings from this mobile number — please contact the hospital',
  keyBy: (req) => `phone:${req.params?.orgId}:${String(req.body?.patient?.phonePrimary || req.body?.existing?.mobile || req.ip)}`,
})
router.get('/public/org/:orgId/departments',      publicReadLimit, publicDepartments)
router.get('/public/org/:orgId/doctors',          publicReadLimit, publicDoctors)
router.get('/public/org/:orgId/doctor-timetable', publicReadLimit, publicDoctorTimetable)
router.get('/public/org/:orgId/check-slot',       publicReadLimit, publicCheckSlot)
// Finding one's own record needs a complete mobile number; the tighter
// per-address limit keeps anyone from walking through numbers.
const publicFindLimit = rateLimit({
  limit: Number(process.env.PUBLIC_FIND_RATE_LIMIT) || 20,
  windowMs: 10 * 60_000,
  message: 'Too many searches — please wait a few minutes or ask at the reception counter',
  keyBy: (req) => `find:${req.params?.orgId}:${req.ip}`,
})
router.get('/public/org/:orgId/patients',         publicReadLimit, publicFindLimit, publicFindPatient)
router.post('/public/org/:orgId/book',            publicBookHospitalLimit, publicBookPhoneLimit, publicRegisterAndBook)

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

// Access model:
//  - `authenticate` above already requires a valid login on every route (401 otherwise).
//  - A module's API answers the roles whose sidebar has that module
//    (requireModule, lib/roleModules.js — the server's copy of roleConfig), plus
//    the screens of other modules that use it, named on each line below. The
//    sidebar alone kept no one out: Finance could sell at the pharmacy counter
//    and a doctor could read every invoice through Queue › Billing.
//  - Per-doctor isolation is DATA SCOPING in the controllers: a doctor only
//    ever sees their own patients / appointments / consultations.
//  - Left open to every staff role on purpose: the patient lookup (nearly every
//    screen finds a patient; the owner also kept it open for the store), the
//    dashboard and settings (shaped per role inside), notifications, rooms and
//    display boards, the clinical knowledge base, pre-registration, and
//    /doctor-accountability and /fee-slabs (booking reads the timetable and the
//    fees; the controllers refuse the rest).
// Patient portal — patient-session only, scoped to their own record.
router.use('/patient-portal',        requirePatient, patientPortalRoutes)

router.use('/dashboard',             authorize(), dashboardRoutes)
// The billing counter books appointments from Billing (and checks free slots).
router.use('/appointments',          authorize(), requireModule('appointments', { write: ['billing'] }), appointmentRoutes)
router.use('/patients',              authorize(), patientRoutes)
router.use('/consultations',         authorize(), requireModule('opd'), consultationRoutes)
router.use('/clinical-kb',           authorize(), clinicalKbRoutes)
router.use('/settings',              authorize(), settingsRoutes)
// Bills and OPD prescriptions pick from the drug list, lab tests and scans.
router.use('/pharmacy',              authorize(), requireModule('pharmacy', { read: ['billing', 'opd'] }), pharmacyRoutes)
router.use('/laboratory',            authorize(), requireModule('laboratory', { read: ['billing', 'opd'] }), laboratoryRoutes)
router.use('/radiology',             authorize(), requireModule('radiology', { read: ['billing', 'opd'] }), radiologyRoutes)
// The pharmacy, lab, radiology, day care and ambulance bill their own work
// through this API (which write each may do is lib/billingAccess.js). Purchase
// roles may read: the owner chose (Oct 2026) to keep the store's view of
// billing figures.
router.use('/billing',               authorize(), requireModule('billing', { read: ['purchase'], write: ['pharmacy', 'laboratory', 'radiology', 'dayCare', 'ambulance'] }), billingRoutes)
router.use('/doctor-accountability', authorize(), doctorAccountabilityRoutes)
router.use('/fee-slabs',             authorize(), feeSlabRoutes)
router.use('/notifications',         authorize(), notificationRoutes)
router.use('/payments',              authorize(), requireModule('billing'), paymentRoutes)
router.use('/pre-triage',            authorize(), requireModule('preTriage'), preTriageRoutes)
router.use('/queue',                 authorize(), requireModule('queue'), queueRoutes)
router.use('/rooms',                 authorize(), roomRoutes)
router.use('/display',               authorize(), displayRoutes)
router.use('/screens',               authorize(), screenRoutes)
router.use('/day-care',              authorize(), requireModule('dayCare'), dayCareRoutes)
router.use('/ambulance',             authorize(), requireModule('ambulance'), ambulanceRoutes)
// Insurance cases carry patients' policies and claims: the billing desk and
// Finance only (lib/billingAccess.js), administrators always.
router.use('/insurance',             authorize(...INSURANCE_READERS), insuranceRoutes)
router.use('/death-certificates',    authorize(), requireModule('deathCertificate'), deathCertificateRoutes)
// IPD keeps its own per-action permissions (inpatient/rbac.js): the counters
// admit and collect, the ward nurse charts, without the IPD sidebar module.
router.use('/inpatient',             authorize(), inpatientRoutes)
// Lab machine connections are set up in Settings.
router.use('/machine-integration',   authorize(), requireModule('settings'), machineIntegrationRoutes)
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
// Purchase holds the hospital's spending — vendors, prices, payments — so it
// is refused at the door to everyone but the people who run it (admin and
// super_admin always pass). The two roles are added to Settings with the
// approval rules; until then only an administrator gets in. When staff raise
// purchase requests, that one screen is opened to them explicitly.
router.use('/purchase',              authorize('purchase_officer', 'store_keeper', 'finance_controller'), purchaseRoutes)
// A department asking the store for goods it holds: every department that
// uses store goods (the storeIndent module). The store issues in /purchase.
router.use('/store-indents',         authorize(), requireModule('storeIndent'), storeIndentRoutes)
