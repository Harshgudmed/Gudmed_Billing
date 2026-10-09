// What the platform owner can sell, in words a hospital understands: each module
// with one line on what it does, grouped, plus a few ready-made bundles so a
// new hospital is set up in a tap instead of fifteen.
//
// The names come from roleConfig's MODULES (the sidebar's own), so a module is
// never called two things; only the description, group and icon are written here.
// The keys are the toggles the server sells (backend/src/lib/modules.js) — a test
// keeps this list and the server's the same.
import {
  Users, ClipboardList, ListOrdered, Stethoscope, FlaskConical, Scan, BedDouble, Scissors,
  CalendarClock, Ambulance, FileText, ShieldCheck, ShoppingCart, Pill, ClipboardCheck,
} from 'lucide-react'
import { MODULES } from '@/lib/roleConfig'

const labelOf = (toggle) => Object.values(MODULES).find((m) => m.toggle === toggle)?.label || toggle

// Order here is the order on screen, inside each group.
const SOLD = [
  { toggle: 'patients',             group: 'front',    Icon: Users,          description: 'Register patients and keep their records and history.' },
  { toggle: 'preTriage',            group: 'front',    Icon: ClipboardList,  description: 'Nurse checks vitals and complaint before the doctor.' },
  { toggle: 'queue',                group: 'front',    Icon: ListOrdered,    description: 'Waiting-room queue and token display boards.' },
  { toggle: 'opd',                  group: 'clinical', Icon: Stethoscope,    description: 'Doctor consultations, prescriptions and orders.' },
  { toggle: 'inpatient',            group: 'clinical', Icon: BedDouble,      description: 'Admissions, wards and beds, nursing and discharge.' },
  { toggle: 'ot',                   group: 'clinical', Icon: Scissors,       description: 'Operation theatre booking and surgery records.' },
  { toggle: 'dayCare',              group: 'clinical', Icon: CalendarClock,  description: 'Same-day procedures and observation.' },
  { toggle: 'ambulance',            group: 'clinical', Icon: Ambulance,      description: 'Ambulance trips and their charges.' },
  { toggle: 'deathCertificate',     group: 'clinical', Icon: FileText,       description: 'Issue and keep death certificates.' },
  { toggle: 'laboratory',           group: 'diagnostics', Icon: FlaskConical, description: 'Lab orders, samples and results.' },
  { toggle: 'radiology',            group: 'diagnostics', Icon: Scan,         description: 'Scan and X-ray orders and reports.' },
  { toggle: 'pharmacy',             group: 'diagnostics', Icon: Pill,         description: 'Dispense medicines and keep drug stock.' },
  { toggle: 'insurance',            group: 'business', Icon: ShieldCheck,    description: 'Insurance and TPA claims.' },
  { toggle: 'purchase',             group: 'business', Icon: ShoppingCart,   description: 'Requests, orders, stock, vendor bills and store indents.' },
  { toggle: 'doctorAccountability', group: 'business', Icon: ClipboardCheck, description: 'Doctor timing, commission and accountability.' },
]

export const MODULE_CATALOG = SOLD.map((m) => ({ ...m, label: labelOf(m.toggle) }))

export const MODULE_GROUPS = [
  { key: 'front', title: 'Front desk' },
  { key: 'clinical', title: 'Clinical' },
  { key: 'diagnostics', title: 'Diagnostics and pharmacy' },
  { key: 'business', title: 'Business' },
]

// Every hospital has these; they are not sold, so they are only listed.
export const ALWAYS_INCLUDED = Object.values(MODULES).filter((m) => !m.toggle).map((m) => m.label)

// Bundles for a new hospital: a tap picks them, the owner can still change any.
export const MODULE_PRESETS = [
  { key: 'clinic', title: 'OPD clinic', toggles: ['patients', 'preTriage', 'queue', 'opd', 'pharmacy', 'laboratory'] },
  { key: 'hospital', title: 'Hospital (OPD + IPD)', toggles: ['patients', 'preTriage', 'queue', 'opd', 'inpatient', 'pharmacy', 'laboratory', 'radiology', 'insurance'] },
  { key: 'all', title: 'Every module', toggles: SOLD.map((m) => m.toggle) },
]
