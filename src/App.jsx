// Deployment: 2026-06-05 19:45:00 - Secrets configured
import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, Navigate, useParams, Link } from 'react-router-dom'
import { Toaster } from 'sonner'
import { LogOut, ShieldCheck, Stethoscope, ConciergeBell, HeartPulse, ChevronRight, ClipboardList } from 'lucide-react'
import client from '@/api/client'
import Logo from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleLogin from '@/pages/RoleLogin'
import PatientLogin from '@/pages/PatientLogin'
import PatientDashboard from '@/pages/PatientDashboard'
import PatientKycPage from '@/pages/PatientKycPage'
import {
  AUTH_ENFORCED, MODULES, ROLES, KNOWN_ROLES, isKnownRole, homePathFor,
} from '@/lib/roleConfig'

function isLightColor(hex) {
  const h = (hex || '#ffffff').replace('#', '')
  if (h.length !== 6) return true
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}
// Each page is lazy-loaded so the browser only downloads the chunk for the
// route the user actually visits — not the entire app up front.
const DashboardPage            = lazy(() => import('./pages/DashboardPage.jsx'))
const AppointmentsPage         = lazy(() => import('./pages/AppointmentsPage.jsx'))
const OpdPage                  = lazy(() => import('./pages/OpdPage.jsx'))
const PatientsPage             = lazy(() => import('./pages/PatientsPage.jsx'))
const PharmacyPage             = lazy(() => import('./pages/PharmacyPage.jsx'))
const BillingPage              = lazy(() => import('./pages/BillingPage.jsx'))
const SettingsPage             = lazy(() => import('./pages/SettingsPage.jsx'))
const DoctorAccountabilityPage = lazy(() => import('./pages/DoctorAccountabilityPage.jsx'))
const PreTriagePage            = lazy(() => import('./pages/PreTriagePage.jsx'))
const QueuePage                = lazy(() => import('./pages/QueuePage.jsx'))
const LaboratoryPage           = lazy(() => import('./pages/LaboratoryPage.jsx'))
const RadiologyPage            = lazy(() => import('./pages/RadiologyPage.jsx'))
const DayCarePage              = lazy(() => import('./pages/DayCarePage.jsx'))
const AmbulancePage            = lazy(() => import('./pages/AmbulancePage.jsx'))
const InsurancePage            = lazy(() => import('./pages/InsurancePage.jsx'))
const DeathCertificatePage     = lazy(() => import('./pages/DeathCertificatePage.jsx'))
const InpatientPage            = lazy(() => import('./pages/InpatientPage.jsx'))

// Module key → page component. Shared by both legacy and role-based routing.
const PAGE_BY_MODULE = {
  dashboard:            DashboardPage,
  patients:             PatientsPage,
  appointments:         AppointmentsPage,
  preTriage:            PreTriagePage,
  queue:                QueuePage,
  opd:                  OpdPage,
  laboratory:           LaboratoryPage,
  radiology:            RadiologyPage,
  dayCare:              DayCarePage,
  ambulance:            AmbulancePage,
  insurance:            InsurancePage,
  deathCertificate:     DeathCertificatePage,
  inpatient:            InpatientPage,
  pharmacy:             PharmacyPage,
  billing:              BillingPage,
  doctorAccountability: DoctorAccountabilityPage,
  settings:             SettingsPage,
}

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-gray-400 text-sm">
      Loading…
    </div>
  )
}

// Legacy sidebar order (used when AUTH_ENFORCED is off). Mirrors the historical nav.
// Trimmed for the standalone Billing project — only the required modules:
// Appointments, OPD Consultations, Patients (+ registration), Pharmacy, Billing, Settings.
const LEGACY_NAV = [
  { to: '/',                      label: 'Dashboard' },
  { to: '/appointments',          label: 'Appointments' },
  { to: '/pre-triage',            label: 'Pre-Triage' },
  { to: '/queue',                 label: 'Queue' },
  { to: '/opd',                   label: 'OPD Consultations' },
  { to: '/pharmacy',              label: 'Pharmacy' },
  { to: '/patients',              label: 'Patients' },
  { to: '/laboratory',            label: 'Laboratory' },
  { to: '/radiology',             label: 'Radiology' },
  { to: '/day-care',              label: 'Day Care' },
  { to: '/ambulance',             label: 'Ambulance' },
  { to: '/insurance',             label: 'Insurance / TPA' },
  { to: '/death-certificates',    label: 'Death Certificates' },
  { to: '/inpatient',             label: 'Inpatient (IPD)' },
  { to: '/billing',               label: 'Billing' },
  { to: '/doctor-accountability', label: 'Doctor Accountability' },
  { to: '/settings',              label: 'Settings' },
]

const MODULE_BY_PATH = {
  '/patients':              'patients',
  '/pre-triage':            'preTriage',
  '/queue':                 'queue',
  '/opd':                   'opd',
  '/laboratory':            'laboratory',
  '/radiology':             'radiology',
  '/day-care':              'dayCare',
  '/ambulance':             'ambulance',
  '/insurance':             'insurance',
  '/death-certificates':    'deathCertificate',
  '/inpatient':             'inpatient',
  '/pharmacy':              'pharmacy',
  '/doctor-accountability': 'doctorAccountability',
}

function applyBranding(settings) {
  if (!settings) return
  const root = document.documentElement
  if (settings.primaryColor)   root.style.setProperty('--color-primary', settings.primaryColor)
  if (settings.secondaryColor) root.style.setProperty('--color-secondary', settings.secondaryColor)
  if (settings.navbarColor)    root.style.setProperty('--color-navbar', settings.navbarColor)
  if (settings.headerColor)    root.style.setProperty('--color-header', settings.headerColor)
  if (settings.hospitalName) {
    document.title = settings.hospitalName
  }
}

// Shared branding/modules state for both routing modes.
function useBranding() {
  const [navbarColor, setNavbarColor] = useState('#2E4168')
  const [hospitalName, setHospitalName] = useState('Hospital HMS')
  const [modulesEnabled, setModulesEnabled] = useState({})

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await client.get('/settings')
        const s = res.data?.settings || {}
        const orgName = res.data?.name || s.hospitalName
        if (s.navbarColor)   setNavbarColor(s.navbarColor)
        if (orgName)         setHospitalName(orgName)
        if (res.data?.modulesEnabled) setModulesEnabled(res.data.modulesEnabled)
        applyBranding({ ...s, hospitalName: orgName })
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    }

    loadSettings()

    const onColorChange = (e) => { setNavbarColor(e.detail.navbarColor || e.detail); applyBranding(e.detail) }
    const onNameChange  = (e) => setHospitalName(e.detail)
    const onModulesChange = (e) => setModulesEnabled(e.detail || {})

    window.addEventListener('navbarColorChange', onColorChange)
    window.addEventListener('hospitalNameChange', onNameChange)
    window.addEventListener('brandingChange', onColorChange)
    window.addEventListener('modulesChange', onModulesChange)
    return () => {
      window.removeEventListener('navbarColorChange', onColorChange)
      window.removeEventListener('hospitalNameChange', onNameChange)
      window.removeEventListener('brandingChange', onColorChange)
      window.removeEventListener('modulesChange', onModulesChange)
    }
  }, [])

  return { navbarColor, hospitalName, modulesEnabled }
}

// Sidebar shell shared by both modes. `navItems` is a list of { to, label, end }.
function Shell({ navItems, navbarColor, hospitalName, homeTo = '/', footer, children }) {
  const light = isLightColor(navbarColor)
  const colored = navbarColor !== '#ffffff' && navbarColor !== '#fff'

  return (
    <div className="min-h-screen bg-gray-50">
      <aside
        className="fixed top-0 left-0 h-full w-56 border-r shadow-sm z-20 flex flex-col overflow-y-auto transition-colors duration-300"
        style={{ backgroundColor: navbarColor }}
      >
        <NavLink
          to={homeTo}
          end
          title={hospitalName}
          className={`flex items-center gap-3 px-4 py-4 border-b transition-colors hover:opacity-90 ${colored && !light ? 'border-white/20' : 'border-gray-200'}`}
        >
          <Logo size={44} />
          <span className={`text-sm font-bold leading-tight ${colored && !light ? 'text-white' : 'text-blue-700'}`}>
            {hospitalName}
          </span>
        </NavLink>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => {
                if (colored && !light) {
                  return `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-white/20 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
                  }`
                }
                return `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`
              }}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        {footer}
      </aside>

      <main className="ml-56 p-6">{children}</main>
    </div>
  )
}

// ── Legacy mode (AUTH_ENFORCED off): original behaviour, no login ───────────────
function LegacyApp() {
  const { navbarColor, hospitalName, modulesEnabled } = useBranding()
  const navItems = LEGACY_NAV.filter(({ to }) => {
    const mod = MODULE_BY_PATH[to]
    return !mod || modulesEnabled[mod] !== false
  }).map(item => ({ ...item, end: item.to === '/' }))

  return (
    <Shell navItems={navItems} navbarColor={navbarColor} hospitalName={hospitalName} homeTo="/">
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/appointments"          element={<AppointmentsPage />} />
          <Route path="/pre-triage"            element={<PreTriagePage />} />
          <Route path="/queue"                 element={<QueuePage />} />
          <Route path="/opd"                   element={<OpdPage />} />
          <Route path="/patients"              element={<PatientsPage />} />
          <Route path="/laboratory"            element={<LaboratoryPage />} />
          <Route path="/radiology"             element={<RadiologyPage />} />
          <Route path="/day-care"              element={<DayCarePage />} />
          <Route path="/ambulance"             element={<AmbulancePage />} />
          <Route path="/insurance"             element={<InsurancePage />} />
          <Route path="/death-certificates"    element={<DeathCertificatePage />} />
          <Route path="/inpatient"             element={<InpatientPage />} />
          <Route path="/pharmacy"              element={<PharmacyPage />} />
          <Route path="/billing"               element={<BillingPage />} />
          <Route path="/doctor-accountability" element={<DoctorAccountabilityPage />} />
          <Route path="/settings"              element={<SettingsPage />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}

// ── Role mode (AUTH_ENFORCED on): per-role login + scoped layout ────────────────
function RoleLayout() {
  const { role } = useParams()
  const { user, logout } = useAuth()
  const { navbarColor, hospitalName, modulesEnabled } = useBranding()

  const cfg = ROLES[role]
  if (!cfg) return <Navigate to={user ? homePathFor(user.role) : '/'} replace />

  // Modules this role may see, minus any disabled via Settings → Modules.
  const allowed = cfg.modules.filter((key) => {
    const toggle = MODULES[key]?.toggle
    return !toggle || modulesEnabled[toggle] !== false
  })

  const navItems = allowed.map((key) => {
    const m = MODULES[key]
    const to = m.path ? `/${role}/${m.path}` : `/${role}`
    return { to, label: m.label, end: !m.path }
  })

  const footer = (
    <div className="border-t border-white/15 p-3">
      <button
        onClick={logout}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  )

  return (
    <Shell navItems={navItems} navbarColor={navbarColor} hospitalName={hospitalName} homeTo={homePathFor(role)} footer={footer}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {allowed.map((key) => {
            const m = MODULES[key]
            const Page = PAGE_BY_MODULE[key]
            if (!Page) return null
            return m.path
              ? <Route key={key} path={m.path} element={<Page />} />
              : <Route key={key} index element={<Page />} />
          })}
          {/* Any path not allowed for this role → role home */}
          <Route path="*" element={<Navigate to={homePathFor(role)} replace />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}

// Patient portal wrapper: requires a patient session, otherwise back to patient login.
function PatientPortal() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/patient/login" replace />
  if (user.role !== 'patient') return <Navigate to={homePathFor(user.role)} replace />
  
  return (
    <Routes>
      <Route path="/" element={<PatientDashboard />} />
      <Route path="/kyc" element={<PatientKycPage />} />
    </Routes>
  )
}

// Root: send a logged-in user to their workspace, otherwise show a role picker.
function RootRoute() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to={homePathFor(user.role)} replace />
  return <RolePicker />
}

// Visual identity for each sign-in option (icon + accent colour + helper text)
// so the picker is understandable at a glance, without reading.
const PICKER_TILES = [
  { to: '/admin/login',        label: 'Administrator', desc: 'Manage the whole hospital',     Icon: ShieldCheck,    color: '#2563eb' },
  { to: '/doctor/login',       label: 'Doctor',        desc: 'Consultations & my patients',   Icon: Stethoscope,    color: '#0891b2' },
  { to: '/receptionist/login', label: 'Receptionist',  desc: 'Appointments & front desk',     Icon: ConciergeBell,  color: '#9333ea' },
  { to: '/patient/login',      label: 'Patient',       desc: 'View my reports & visits',      Icon: HeartPulse,     color: '#0d9488' },
]

function RolePicker() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="flex justify-center"><Logo size={56} /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Hospital Management</h1>
          <p className="text-sm text-gray-500">Select your role to sign in</p>
        </div>
        <div className="space-y-2.5">
          {PICKER_TILES.map(({ to, label, desc, Icon, color }) => (
            <Link
              key={to}
              to={to}
              className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ '--tile': color }}
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${color}15`, color }}
              >
                <Icon className="h-6 w-6" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-gray-900">{label}</span>
                <span className="block text-xs text-gray-500">{desc}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-gray-300 transition-colors group-hover:text-gray-500" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  if (!AUTH_ENFORCED) {
    return (
      <>
        <LegacyApp />
        <Toaster richColors position="top-right" />
      </>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        {/* Patient portal — separate from the staff role layout */}
        <Route path="/patient/login" element={<PatientLogin />} />
        <Route path="/patient/*" element={<PatientPortal />} />
        {/* Staff roles */}
        <Route path="/:role/login" element={<RoleLogin />} />
        <Route path="/:role/*" element={<ProtectedRoute><RoleLayout /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  )
}
