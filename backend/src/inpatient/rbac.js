// Per-action RBAC for IPD mutations (C6). Demo-safe: when AUTH_ENFORCED is off
// (no login), nothing is blocked — matching the existing authorize() behaviour.
// admin / super_admin always pass. Unlisted resources default to allow (reads are
// not gated here). Future roles (nurse/billing/pharmacist/housekeeping) are mapped
// now so permissions are correct the moment those roles are enabled.
const AUTH_ENFORCED = process.env.AUTH_ENFORCED === 'true'

const PERMS = {
  // Ward / bed configuration
  ward: ['receptionist'],
  bed: ['receptionist'],
  'sync-beds': ['receptionist'],

  // Admission lifecycle
  admission: ['receptionist', 'doctor'],
  transfer: ['doctor', 'nurse'],
  'discharge-finalize': ['doctor'],
  discharge: ['doctor'],
  'mark-exit': ['doctor'],

  // Clinical documentation
  // Vitals are a NURSING responsibility — only nurses (and admins) record/correct
  // them. Doctors review vitals (read), but do not create/update them.
  vitals: ['nurse'],
  'note-v2': ['doctor', 'nurse'],
  note: ['doctor', 'nurse'],
  'medication-administration': ['doctor', 'nurse'],

  // Billing
  'post-charge': ['receptionist', 'billing'],
  billing: ['receptionist', 'billing'],
  charge: ['receptionist', 'billing'],
  'bill-generate': ['receptionist', 'billing'],
  'bill-finalize': ['receptionist', 'billing'],
  'bill-cancel': ['receptionist', 'billing'],
  'cancel-charge': ['receptionist', 'billing'],
  // Payment ledger (Phase 2): cashier collects; void/refund are supervisor-level
  payment: ['receptionist', 'billing'],
  'void-payment': ['billing'],
  refund: ['billing'],

  // ── Phase 3A: Clinical Orders (CPOE) spine ──
  // Doctors (and nurses, for verbal/protocol orders) place orders. Departments
  // acknowledge/start/complete their own type. `order-complete` passes this broad
  // gate first, then orderAllowed() narrows completion to the responsible discipline.
  order: ['doctor', 'nurse'],
  'order-ack': ['lab_technician', 'radiology_technician', 'pharmacist', 'nurse'],
  'order-start': ['lab_technician', 'radiology_technician', 'pharmacist', 'nurse'],
  'order-complete': ['lab_technician', 'radiology_technician', 'pharmacist', 'doctor', 'nurse'],
  'order-cancel': ['doctor'],
  // Treatment Chart: nurses tick scheduled lab/imaging/procedure occurrences.
  'order-task': ['nurse', 'lab_technician', 'radiology_technician'],

  // ── IPD Specialist Consultations ──
  // Any clinical role can request; only the consulting doctor updates notes/completes.
  'ipd-consultation': ['receptionist', 'doctor', 'nurse'],

  // ── Operation Theatre ──
  // Booking a list is desk work; deciding a case is not. The route guard already
  // keeps lab/pharmacy/radiology out of OT entirely — these narrow what the roles
  // that ARE in OT may do, which the route cannot express because one endpoint
  // serves every verb.
  //
  // Rooms and the surgery catalogue are configuration: receptionists maintain them.
  'ot-theatre': ['receptionist'],
  'ot-surgery': ['receptionist'],

  // A receptionist books and re-times the list — that is the job.
  'ot-booking': ['receptionist', 'doctor'],
  'ot-reschedule': ['receptionist', 'doctor'],

  // Moving a case ALONG the day (confirm, check in, start, complete) is theatre
  // floor work, so nurses do it too.
  'ot-status': ['receptionist', 'doctor', 'nurse'],

  // But calling a case OFF is a clinical decision with a medicolegal reason
  // attached, so it stays with the surgeon. A receptionist who needs a case
  // cancelled asks the surgeon — which is what happens on a real theatre list.
  'ot-cancel': ['doctor'],

  // Who scrubbed in is a nursing record. Billing has no business editing it.
  'ot-team': ['doctor', 'nurse'],

  // ── The four case documents ──
  // Each belongs to the discipline that signs it. A receptionist books the list;
  // none of these are theirs to write.
  'ot-preop': ['doctor'], // the anaesthetist assesses and declares fitness
  'ot-checklist': ['nurse', 'doctor'], // the nurse runs it; either may sign a phase
  'ot-anaesthesia': ['doctor'],
  'ot-opnote': ['doctor'], // the surgeon dictates
}

// An order may only be COMPLETED by the discipline that fulfils that order type.
// (Phase 3A: completion = status flip only; auto-billing is wired per type in 3B+.)
const ORDER_COMPLETE_ROLE = {
  LAB: ['lab_technician'],
  RADIOLOGY: ['radiology_technician'],
  PHARMACY: ['pharmacist'],
  PROCEDURE: ['doctor', 'nurse'],
}

export function ipdAllowed(req, resource) {
  if (!AUTH_ENFORCED) return true
  const role = req.user?.role
  if (!role) return false
  if (role === 'admin' || role === 'super_admin') return true
  const allowed = PERMS[resource]
  if (!allowed) return true
  return allowed.includes(role)
}

// Discipline-scoped gate for COMPLETING an order of a given type.
// Used in addition to ipdAllowed('order-complete').
export function orderAllowed(req, orderType) {
  if (!AUTH_ENFORCED) return true
  const role = req.user?.role
  if (!role) return false
  if (role === 'admin' || role === 'super_admin') return true
  return (ORDER_COMPLETE_ROLE[orderType] || []).includes(role)
}
