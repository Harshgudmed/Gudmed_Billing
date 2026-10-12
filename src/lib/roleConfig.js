// ─────────────────────────────────────────────────────────────────────────────
// Role-based access configuration (web).
//
// Single source of truth for: which modules each role can see, where each role
// lands after login, and the master module registry the sidebar/router build from.
//
// Gated by VITE_AUTH_ENFORCED — when 'false' (default) the app keeps its legacy
// behaviour (no login, flat routes) so the live demo is unaffected. Flip to 'true'
// (build/deploy env) to turn on login + per-role URLs.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTH_ENFORCED = import.meta.env.VITE_AUTH_ENFORCED === 'true'

// Master registry of every module. `path` is the suffix mounted under /:role.
// `toggle` is the key in the org's modulesEnabled map (null = always available).
export const MODULES = {
  dashboard:            { path: '',                      label: 'Dashboard',            toggle: null },
  patients:             { path: 'patients',              label: 'Patients',             toggle: 'patients' },
  appointments:         { path: 'appointments',          label: 'Appointments',         toggle: null },
  preTriage:            { path: 'pre-triage',            label: 'Pre-Triage',           toggle: 'preTriage' },
  queue:                { path: 'queue',                 label: 'Queue',                toggle: 'queue' },
  opd:                  { path: 'opd',                   label: 'OPD Consultations',    toggle: 'opd' },
  laboratory:           { path: 'laboratory',            label: 'Laboratory',           toggle: 'laboratory' },
  radiology:            { path: 'radiology',             label: 'Radiology',            toggle: 'radiology' },
  dayCare:              { path: 'day-care',              label: 'Day Care',             toggle: 'dayCare' },
  ambulance:            { path: 'ambulance',             label: 'Ambulance',            toggle: 'ambulance' },
  insurance:            { path: 'insurance',             label: 'Insurance / TPA',      toggle: 'insurance' },
  deathCertificate:     { path: 'death-certificates',    label: 'Death Certificates',   toggle: 'deathCertificate' },
  inpatient:            { path: 'inpatient',             label: 'Inpatient (IPD)',      toggle: 'inpatient' },
  ot:                   { path: 'ot',                    label: 'Operation Theatre',    toggle: 'ot' },
  purchase:             { path: 'purchase',              label: 'Purchase & Supply Chain', toggle: 'purchase' },
  // A department asks the store for goods it holds. The store's stock is
  // Purchase's, so it is there only while Purchase is switched on.
  storeIndent:          { path: 'store-indent',          label: 'Store Indent',         toggle: 'purchase' },
  pharmacy:             { path: 'pharmacy',              label: 'Pharmacy',             toggle: 'pharmacy' },
  billing:              { path: 'billing',               label: 'Billing',              toggle: null },
  doctorAccountability: { path: 'doctor-accountability', label: 'Doctor Accountability', toggle: 'doctorAccountability' },
  settings:             { path: 'settings',              label: 'Settings',             toggle: null },
}

// Roles enabled on the web app for v1. Extend this map to add the remaining roles.
export const ROLES = {
  admin: {
    label: 'Administrator',
    home: 'dashboard',
    modules: [
      'dashboard', 'patients', 'appointments', 'preTriage', 'queue', 'opd', 'pharmacy',
      'laboratory', 'radiology', 'dayCare', 'ambulance', 'insurance', 'deathCertificate', 'inpatient', 'ot', 'purchase',
      'storeIndent', 'billing', 'doctorAccountability', 'settings',
    ],
  },
  doctor: {
    label: 'Doctor',
    home: 'opd',
    // 'queue' shows the doctor their OWN patients' queue only — the backend
    // (queueController.getQueue) scopes it to entries assigned/following-up to
    // this doctor, so they never see another doctor's patients.
    // 'appointments' shows the doctor their OWN list only — appointmentController
    // forces where.doctorId to the logged-in doctor and ignores any doctorId in
    // the query, so this cannot widen what they see. Without it the dashboard's
    // "Today's Appointments → View All" button pointed at a route this role has
    // no entry for, and the catch-all bounced them back to OPD.
    modules: ['dashboard', 'opd', 'appointments', 'queue', 'patients', 'doctorAccountability', 'ot', 'storeIndent'],
  },
  receptionist: {
    label: 'Receptionist',
    home: 'appointments',
    modules: ['dashboard', 'appointments', 'preTriage', 'queue', 'patients', 'billing', 'ot', 'storeIndent'],
  },

  // ── Phase 3.0: clinical-orders roles. Mapped in backend rbac.js already; these
  //    entries activate login + per-role landing/sidebar on the web app. ──
  nurse: {
    label: 'Nurse',
    home: 'dashboard',
    modules: ['dashboard', 'preTriage', 'patients', 'ot', 'storeIndent'],
  },
  pharmacist: {
    label: 'Pharmacist',
    home: 'pharmacy',
    modules: ['dashboard', 'pharmacy', 'storeIndent'],
  },
  billing: {
    label: 'Billing',
    home: 'billing',
    modules: ['dashboard', 'billing', 'storeIndent'],
  },
  finance_controller: {
    label: 'Finance Controller',
    home: 'billing',
    // Purchase: to approve requests above the hospital's limit, and to read.
    modules: ['dashboard', 'billing', 'purchase', 'storeIndent'],
  },

  // ── Purchase & Supply Chain. Purchase only: the backend lets these roles
  //    reach /purchase and nothing clinical. ──
  purchase_officer: {
    label: 'Purchase Officer',
    home: 'purchase',
    modules: ['purchase'],
  },
  store_keeper: {
    label: 'Store Keeper',
    home: 'purchase',
    modules: ['purchase'],
  },
}

export const KNOWN_ROLES = Object.keys(ROLES)

// Modules a hospital must switch ON before they appear. Every other module is
// on until switched off — a hospital saved before a module existed has no key
// for it, and reading "no key" as "on" kept their screens as they were. A
// module still being built must not appear in every hospital's sidebar the day
// it ships, so it reads "no key" as OFF instead.
const OFF_UNTIL_ENABLED = new Set(['purchase'])

/**
 * Is this module switched on for the hospital? `toggle` is a MODULES[...].toggle
 * key; null means the module cannot be switched off. The one rule shared by
 * both sidebars and the Settings → Modules switches, so they always agree.
 */
export function isModuleOn(toggle, modulesEnabled = {}) {
  if (!toggle) return true
  return OFF_UNTIL_ENABLED.has(toggle) ? modulesEnabled[toggle] === true : modulesEnabled[toggle] !== false
}

/**
 * May this role open this module (a MODULES key) in this hospital? The
 * sidebar's rule, for any screen that links to another module — a dashboard
 * tile, a quick action — so nothing offers a door the sidebar does not have.
 * With login off (the demo) every role may open everything the hospital has on.
 */
export function roleCanOpen(role, key, modulesEnabled = {}) {
  const m = MODULES[key]
  if (!m) return false
  if (AUTH_ENFORCED && !(ROLES[role]?.modules || []).includes(key)) return false
  return isModuleOn(m.toggle, modulesEnabled)
}

// Hero imagery for each login page — real hospital photos (Unsplash CDN) with a
// role-coloured gradient overlay. If a photo fails to load, the gradient remains,
// so the panel never looks broken.
export const LOGIN_HERO = {
  admin: {
    color: '#2563eb',
    img: '/login/admin.jpg', // place the file at frontend/public/login/admin.jpg
    title: 'Hospital Administration',
    subtitle: 'Oversee every department, staff and setting in one place.',
  },
  doctor: {
    color: '#0891b2',
    img: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=1200&q=70',
    title: 'Doctor Portal',
    subtitle: 'Your patients, consultations, prescriptions and reports.',
  },
  receptionist: {
    color: '#9333ea',
    img: '/login/reception.png', // file at frontend/public/login/reception.png
    title: 'Front Desk',
    subtitle: 'Appointments, check-ins and patient routing.',
  },
  nurse: {
    color: '#0d9488',
    img: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=70',
    title: 'Nursing Station',
    subtitle: 'Vitals, eMAR, clinical notes and bedside orders.',
  },
  pharmacist: {
    color: '#7c3aed',
    img: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=1200&q=70',
    title: 'Pharmacy',
    subtitle: 'Dispense, inventory and medication orders.',
  },
  billing: {
    color: '#d97706',
    img: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=70',
    title: 'Billing & Accounts',
    subtitle: 'Manage invoices, payments, and financial records.',
  },
  finance_controller: {
    color: '#059669',
    img: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=70',
    title: 'Finance Controller',
    subtitle: 'Approve refunds, audit ledgers, and manage hospital finances.',
  },
  purchase_officer: {
    color: '#2563eb',
    img: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=70',
    title: 'Purchase',
    subtitle: 'Requests, approvals, orders and vendors.',
  },
  store_keeper: {
    color: '#0891b2',
    img: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=70',
    title: 'Stores',
    subtitle: 'Raise requests and receive what was ordered.',
  },
  patient: {
    color: '#0d9488',
    img: '/login/patient.png', // file at public/login/patient.png
    title: 'Patient Portal',
    subtitle: 'Your appointments, reports and bills — in real time.',
  },
}

export function isKnownRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role)
}

// Absolute path a user should land on after logging in (their role's home module).
export function homePathFor(role) {
  // Patients live in their own portal, not the staff role layout.
  if (role === 'patient') return '/patient'
  // The platform owner works with hospitals, not inside one: no ROLES entry.
  if (role === 'platform_owner') return '/platform'
  const cfg = ROLES[role]
  if (!cfg) return '/'
  const home = MODULES[cfg.home]?.path || ''
  return home ? `/${role}/${home}` : `/${role}`
}
