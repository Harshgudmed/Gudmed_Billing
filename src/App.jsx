// Deployment: 2026-06-05 19:45:00 - Secrets configured
import { useState, useEffect, lazy, Suspense, memo, useMemo, useCallback } from 'react'
import { Routes, Route, NavLink, Navigate, useParams, Link } from 'react-router-dom'
import { Toaster, toast } from 'sonner'
import { LogOut, ShieldCheck, Stethoscope, ConciergeBell, HeartPulse, ChevronRight, ClipboardList, Pill, Receipt, Landmark, ShoppingCart, Warehouse, UserRoundCog, Menu, X, Lock, Activity, Building2 } from 'lucide-react'
import client from '@/api/client'
import { getOrgRaw } from '@/lib/orgSettings'
import { HOSPITAL_NAME } from '@/lib/brand'
import Logo from '@/components/Logo'
// The app's one spinner — see components/ui/spinner.jsx for the
// button-vs-standalone colour rule.
import { PageLoader } from '@/components/ui/spinner'
import { InboxProvider, NotificationBell } from '@/components/common/NotificationBell'
import { useAuth } from '@/lib/auth'
import ProtectedRoute from '@/components/ProtectedRoute'
import RoleLogin from '@/pages/RoleLogin'
import PatientLogin from '@/pages/PatientLogin'
import PatientDashboard from '@/pages/PatientDashboard'
import PatientKycPage from '@/pages/PatientKycPage'
import {
  AUTH_ENFORCED, MODULES, ROLES, KNOWN_ROLES, isKnownRole, homePathFor, isModuleOn,
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
const OtPage                   = lazy(() => import('./pages/OtPage.jsx'))
const PurchasePage             = lazy(() => import('./pages/PurchasePage.jsx'))
const StoreIndentPage          = lazy(() => import('./pages/StoreIndentPage.jsx'))
const NotFoundPage             = lazy(() => import('./pages/NotFoundPage.jsx'))
// No Shell (no sidebar/header) — this runs full-screen on a lobby TV/second
// monitor, so it's mounted outside both the legacy and role-based Shell trees.
const DisplayBoardPage         = lazy(() => import('./pages/DisplayBoardPage.jsx'))
const DisplayAutoPage          = lazy(() => import('./pages/DisplayAutoPage.jsx'))
const SelfRegisterPage         = lazy(() => import('./pages/SelfRegisterPage.jsx'))

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
  ot:                   OtPage,
  purchase:             PurchasePage,
  storeIndent:          StoreIndentPage,
  pharmacy:             PharmacyPage,
  billing:              BillingPage,
  doctorAccountability: DoctorAccountabilityPage,
  settings:             SettingsPage,
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
  { to: '/ot',                    label: 'Operation Theatre' },
  { to: '/purchase',              label: 'Purchase & Supply Chain' },
  { to: '/store-indent',          label: 'Store Indent' },
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
  '/ot':                    'ot',
  '/purchase':              'purchase',
  '/store-indent':          'storeIndent',
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
  // False until the hospital's module switches have arrived. Before then a
  // module that is off-until-enabled (roleConfig.isModuleOn) has no route yet,
  // so the router must wait rather than send a refreshed /purchase page home.
  const [modulesLoaded, setModulesLoaded] = useState(false)

  useEffect(() => {
    let live = true
    let retry = null
    // A failed read is tried again (1, 2, 4, 8 s) with the loader up: without
    // the hospital's switches, a module that must be switched on — Purchase,
    // the store keeper's only one — has no route, and the screen stayed blank.
    const loadSettings = async (attempt = 0) => {
      try {
        // Shares the cached /settings fetch with getOrgSettings() rather than
        // issuing its own — this was the second of the two identical calls every
        // module made on every page load.
        const org = await getOrgRaw()
        if (!live) return
        const res = { data: org }
        const s = org?.settings || {}
        const orgName = org?.name || s.hospitalName
        if (s.navbarColor)   setNavbarColor(s.navbarColor)
        if (orgName)         setHospitalName(orgName)
        if (org?.modulesEnabled) setModulesEnabled(org.modulesEnabled)
        // primaryColor/secondaryColor are their own columns on Organization
        // (Settings → Organization → colour picker) — NOT inside the nested
        // `settings` JSON blob (`s`, which only holds currency/timezone/etc).
        // This was reading them off `s`, where they never existed, so
        // --color-primary/--color-secondary were never actually set — any
        // CSS relying on them (this screen's brand colour) silently failed.
        applyBranding({ ...s, primaryColor: res.data?.primaryColor, secondaryColor: res.data?.secondaryColor, hospitalName: orgName })
        setModulesLoaded(true)
      } catch (err) {
        if (!live) return
        if (attempt < 4) {
          retry = setTimeout(() => loadSettings(attempt + 1), 1000 * 2 ** attempt)
          return
        }
        console.error('Failed to load settings:', err)
        toast.error('Could not load the hospital settings. Reload the page to try again.')
        setModulesLoaded(true)
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
      live = false
      clearTimeout(retry)
      window.removeEventListener('navbarColorChange', onColorChange)
      window.removeEventListener('hospitalNameChange', onNameChange)
      window.removeEventListener('brandingChange', onColorChange)
      window.removeEventListener('modulesChange', onModulesChange)
    }
  }, [])

  // A fresh object here would be a new reference on every render of the caller,
  // so any consumer that passes the whole thing down as a prop would defeat
  // memoisation below it. Both callers destructure today; keep the contract
  // stable so the next one cannot reintroduce that.
  return useMemo(
    () => ({ navbarColor, hospitalName, modulesEnabled, modulesLoaded }),
    [navbarColor, hospitalName, modulesEnabled, modulesLoaded],
  )
}

// Sidebar shell shared by both modes. `navItems` is a list of { to, label, end }.
// `inboxBase` (role mode: "/store_keeper") turns on the top bar's notification
// bell, beside the signed-in person (`account`: { name, role }) — the place
// every ERP keeps them. Phones keep their one bar: menu, hospital, bell.
// memo'd because it renders one NavLink per module: without it, any state change
// anywhere above it (a dialog tab, a dropdown, a keystroke in a module's search
// box) re-rendered all 17 sidebar links. Every prop passed in must be a stable
// reference or this bail-out never fires — see the useMemo calls in both callers.
const Shell = memo(function Shell({ navItems, navbarColor, hospitalName, homeTo = '/', footer, inboxBase, account, children }) {
  const light = isLightColor(navbarColor)
  const colored = navbarColor !== '#ffffff' && navbarColor !== '#fff'
  // Phones: the sidebar is a drawer behind a ☰ in a top bar, so the page gets
  // the whole width. From md (768px) up nothing changes — the sidebar is fixed
  // beside the page as it always was.
  const [drawer, setDrawer] = useState(false)
  const close = useCallback(() => setDrawer(false), [])

  const page = (
    <div className="min-h-screen bg-gray-50">
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 border-b shadow-sm" style={{ backgroundColor: navbarColor }}>
        <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu"
          className={`rounded-md p-1.5 ${colored && !light ? 'text-white hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'}`}>
          <Menu className="h-6 w-6" />
        </button>
        <span className={`truncate text-sm font-bold ${colored && !light ? 'text-white' : 'text-blue-700'}`}>{hospitalName}</span>
        {inboxBase && <NotificationBell dark={colored && !light} className="ml-auto" />}
      </header>
      {drawer && <div className="md:hidden fixed inset-0 z-30 bg-black/40" onClick={close} aria-hidden="true" />}
      <aside
        className={`fixed top-0 left-0 h-full w-64 md:w-56 border-r shadow-sm z-40 md:z-20 flex flex-col overflow-y-auto transition-[transform,background-color] duration-300 md:translate-x-0 ${drawer ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ backgroundColor: navbarColor }}
      >
        <button type="button" onClick={close} aria-label="Close menu"
          className={`md:hidden absolute right-2 top-2 rounded-md p-1.5 ${colored && !light ? 'text-white/80 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}>
          <X className="h-5 w-5" />
        </button>
        <NavLink
          to={homeTo}
          end
          onClick={close}
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
              onClick={close}
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

      {inboxBase && (
        <header className="hidden md:flex sticky top-0 z-20 md:ml-56 h-14 items-center justify-end gap-3 border-b bg-white/95 px-6 backdrop-blur">
          <NotificationBell className="h-9 w-9 justify-center rounded-full" />
          {account && (
            <div className="flex items-center gap-2.5 border-l pl-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700" aria-hidden="true">
                {(account.name || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-medium text-gray-900">{account.name}</span>
                <span className="block text-xs text-gray-500">{account.role}</span>
              </span>
            </div>
          )}
        </header>
      )}
      <main className="md:ml-56 p-4 md:p-6 min-w-0">{children}</main>
    </div>
  )
  return inboxBase ? <InboxProvider base={inboxBase}>{page}</InboxProvider> : page
})

// ── Legacy mode (AUTH_ENFORCED off): original behaviour, no login ───────────────
function LegacyApp() {
  const { navbarColor, hospitalName, modulesEnabled } = useBranding()
  const navItems = useMemo(
    () => LEGACY_NAV.filter(({ to }) => isModuleOn(MODULE_BY_PATH[to] || null, modulesEnabled))
      .map(item => ({ ...item, end: item.to === '/' })),
    [modulesEnabled],
  )

  // Shell's `children` is a prop like any other: a fresh element here on every
  // render would fail memo's comparison and re-render the whole sidebar anyway.
  // The route table is static, so it never needs rebuilding.
  const pages = useMemo(() => (
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
        <Route path="/ot"                    element={<OtPage />} />
        <Route path="/purchase"              element={<PurchasePage />} />
        <Route path="/store-indent"          element={<StoreIndentPage />} />
        <Route path="/pharmacy"              element={<PharmacyPage />} />
        <Route path="/billing"               element={<BillingPage />} />
        <Route path="/doctor-accountability" element={<DoctorAccountabilityPage />} />
        <Route path="/settings"              element={<SettingsPage />} />
        <Route path="*"                      element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  ), [])

  return (
    <Shell navItems={navItems} navbarColor={navbarColor} hospitalName={hospitalName} homeTo="/">
      {pages}
    </Shell>
  )
}

// ── Role mode (AUTH_ENFORCED on): per-role login + scoped layout ────────────────
function RoleLayout() {
  const { role } = useParams()
  const { user, logout } = useAuth()
  const { navbarColor, hospitalName, modulesEnabled, modulesLoaded } = useBranding()

  const cfg = ROLES[role]

  // Every hook below must stay ABOVE the `!cfg` early return — React counts
  // hooks per render, and an unknown role would otherwise run fewer of them and
  // crash the whole app rather than redirecting.

  // Modules this role may see, minus any disabled via Settings → Modules.
  // ROLES is a module-level table, so `cfg` is a stable reference per role.
  const allowed = useMemo(
    () => (cfg?.modules || []).filter((key) => isModuleOn(MODULES[key]?.toggle, modulesEnabled)),
    [cfg, modulesEnabled],
  )

  const navItems = useMemo(
    () => allowed.map((key) => {
      const m = MODULES[key]
      const to = m.path ? `/${role}/${m.path}` : `/${role}`
      return { to, label: m.label, end: !m.path }
    }),
    [allowed, role],
  )

  // `logout` is already stable (useCallback in AuthProvider), so this element is
  // built once — a fresh one each render would break Shell's memo comparison.
  // Who is signed in, for the top bar. Strings, so Shell's memo still holds.
  const account = useMemo(() => (user ? { name: user.fullName || user.email, role: cfg?.label || role } : undefined), [user, cfg, role])

  const footer = useMemo(() => (
    <div className="border-t border-white/15 p-3">
      <button
        onClick={logout}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  ), [logout])

  // Same reason as `footer`: `children` is a prop, and a new element every
  // render would re-render the sidebar even with everything else memoised.
  const pages = useMemo(() => (
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
        {/* Any path not allowed for this role → role home. Not before the
            hospital's module switches arrive, though: until then a module that
            is off-until-enabled has no route, and a refresh on it would be
            thrown to the dashboard. */}
        <Route path="*" element={modulesLoaded ? <Navigate to={homePathFor(role)} replace /> : <PageLoader />} />
      </Routes>
    </Suspense>
  ), [allowed, role, modulesLoaded])

  if (!cfg) return <Navigate to={user ? homePathFor(user.role) : '/'} replace />

  return (
    <Shell navItems={navItems} navbarColor={navbarColor} hospitalName={hospitalName} homeTo={homePathFor(role)} footer={footer} inboxBase={user ? `/${role}` : undefined} account={account}>
      {pages}
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
// so the picker is understandable at a glance, without reading. Every staff
// role with its own portal (ROLES in roleConfig) is offered here, grouped by
// the part of the hospital it works in — a role missing from this list had a
// portal nobody could find.
const PICKER_GROUPS = [
  { title: 'Management', tiles: [
    { to: '/admin/login',              label: 'Administrator',      desc: 'Manage the whole hospital',          Icon: ShieldCheck,   color: '#2563eb' },
  ] },
  { title: 'Clinical', tiles: [
    { to: '/doctor/login',             label: 'Doctor',             desc: 'Consultations & my patients',        Icon: Stethoscope,   color: '#0891b2' },
    { to: '/nurse/login',              label: 'Nurse',              desc: 'Pre-triage, patients & OT',          Icon: UserRoundCog,  color: '#0d9488' },
  ] },
  { title: 'Front desk & billing', tiles: [
    { to: '/receptionist/login',       label: 'Receptionist',       desc: 'Appointments & front desk',          Icon: ConciergeBell, color: '#9333ea' },
    { to: '/billing/login',            label: 'Billing',            desc: 'Invoices & payments',                Icon: Receipt,       color: '#d97706' },
    { to: '/pharmacist/login',         label: 'Pharmacist',         desc: 'Dispensing & drug stock',            Icon: Pill,          color: '#7c3aed' },
  ] },
  { title: 'Purchase & finance', tiles: [
    { to: '/store_keeper/login',       label: 'Store Keeper',       desc: 'Receive goods, issue indents, returns', Icon: Warehouse,     color: '#0891b2' },
    { to: '/purchase_officer/login',   label: 'Purchase Officer',   desc: 'Quotations, orders, vendors & bills', Icon: ShoppingCart,  color: '#2563eb' },
    { to: '/finance_controller/login', label: 'Finance Controller', desc: 'Approvals, refunds & vendor payments', Icon: Landmark,      color: '#059669' },
  ] },
]

// What staff can rely on, said plainly — each line is how the system works.
const PICKER_PROMISES = [
  { Icon: Lock,      text: 'Each role sees only its own work' },
  { Icon: Activity,  text: 'Departments stay in step, live' },
  { Icon: Building2, text: "Every hospital's records kept apart" },
]

function RolePicker() {
  // Before sign-in no hospital is known (the server answers settings only to a
  // session), so the bundled brand name is shown, not the "Hospital" fallback.
  const hospital = HOSPITAL_NAME
  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Identity panel: the hospital, and what this sign-in is for. */}
      <aside className="relative overflow-hidden bg-gradient-to-br from-[#1f2f4f] via-[#2E4168] to-[#1d5f74] px-6 py-8 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[40%] lg:flex-col lg:justify-between lg:px-12 lg:py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <Logo size={48} rounded="rounded-xl" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{hospital}</p>
            <p className="text-xs text-white/70">Hospital Information System</p>
          </div>
        </div>
        <div className="relative mt-8 lg:mt-0">
          <h1 className="text-2xl font-semibold leading-tight [text-wrap:balance] lg:text-4xl">
            One sign-in for every department
          </h1>
          <p className="mt-3 max-w-md text-sm text-white/75 lg:text-base">
            OPD, front desk, pharmacy, laboratory, billing and stores — each team works in its own space on the same patient record.
          </p>
          <ul className="mt-6 hidden space-y-3 lg:block">
            {PICKER_PROMISES.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/85">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><Icon className="h-4 w-4" /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-8 hidden text-xs text-white/60 lg:block">
          Need an account? Your hospital administrator creates it in Settings → Users.
        </p>
      </aside>

      {/* Role choice */}
      <main className="flex-1 px-4 py-8 sm:px-8 lg:overflow-y-auto lg:px-14 lg:py-12">
        <div className="mx-auto w-full max-w-3xl">
          <h2 className="text-xl font-semibold text-slate-900">Sign in to your workspace</h2>
          <p className="mt-1 text-sm text-slate-500">Choose the role you work in today.</p>

          <div className="mt-8 space-y-7">
            {PICKER_GROUPS.map((group) => (
              <section key={group.title} aria-labelledby={`picker-${group.title}`}>
                <h3 id={`picker-${group.title}`} className="mb-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.title}
                  <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.tiles.map(({ to, label, desc, Icon, color }) => (
                    <Link
                      key={to}
                      to={to}
                      className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[var(--tile)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tile)] focus-visible:ring-offset-2"
                      style={{ '--tile': color }}
                    >
                      <span
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${color}14`, color }}
                      >
                        <Icon className="h-6 w-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-slate-900">{label}</span>
                        <span className="block text-xs text-slate-500">{desc}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--tile)]" />
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Patients are not staff: their portal is offered apart, not as one more role. */}
          <Link
            to="/patient/login"
            className="group mt-8 flex flex-col gap-3 rounded-xl border border-teal-200 bg-teal-50/70 p-5 transition hover:border-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 sm:flex-row sm:items-center"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-teal-600 shadow-sm">
              <HeartPulse className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-slate-900">Are you a patient?</span>
              <span className="block text-sm text-slate-600">See your reports, bills and visits in the patient portal.</span>
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700">
              Patient portal <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </span>
          </Link>

          <p className="mt-6 text-center text-xs text-slate-400 lg:hidden">
            Need an account? Your hospital administrator creates it in Settings → Users.
          </p>
        </div>
      </main>
    </div>
  )
}

// Everything that goes through the staff/patient Shell — unchanged from
// before, just extracted so /display/* can be matched ahead of it.
function AuthedApp() {
  return (
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
  )
}

export default function App() {
  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Self-pairing display — the ONE URL every TV opens; shows a pairing
              code until an admin links it, then the assigned screen's board. */}
          <Route path="/display/auto" element={<DisplayAutoPage />} />
          {/* Queue display board — no Shell, full-screen, second-monitor use */}
          <Route path="/display/*" element={<DisplayBoardPage />} />
          {/* Public self-registration — a walk-up patient fills their own
              details from the hospital's QR code. No Shell, no login: mounted
              here, outside the authenticated tree. */}
          <Route path="/self-register" element={<SelfRegisterPage />} />
          <Route path="*" element={AUTH_ENFORCED ? <AuthedApp /> : <LegacyApp />} />
        </Routes>
      </Suspense>
      <Toaster richColors position="top-right" />
    </>
  )
}
