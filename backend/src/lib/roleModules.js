// Which modules each role works in — the server's copy of the web app's
// sidebar (src/lib/roleConfig.js ROLES). The screens use that one to decide
// what to show; the server uses this one to decide what to SEND, so a role is
// never handed data from a module it cannot open (a billing desk does not get
// the ward's bed count or the patient list on its dashboard).
//
// The two lists must stay the same: __tests__/roleModules.test.js reads the
// web app's file and fails the build of the moment they differ.
//
// An administrator works everywhere. With login switched off (the demo) there
// is no role and every module is open, as on every other route.

export const ROLE_MODULES = {
  doctor: ['dashboard', 'opd', 'appointments', 'queue', 'patients', 'doctorAccountability', 'ot', 'storeIndent', 'purchase'],
  receptionist: ['dashboard', 'appointments', 'preTriage', 'queue', 'patients', 'billing', 'ot', 'storeIndent'],
  nurse: ['dashboard', 'preTriage', 'patients', 'ot', 'storeIndent', 'purchase'],
  pharmacist: ['dashboard', 'pharmacy', 'storeIndent'],
  billing: ['dashboard', 'billing', 'storeIndent'],
  finance_controller: ['dashboard', 'billing', 'purchase', 'storeIndent'],
  purchase_officer: ['purchase'],
  store_keeper: ['purchase'],
}

const EVERYWHERE = new Set(['admin', 'super_admin'])

/** May this role work in this module? No role (login off) may. */
export function roleWorksIn(role, module) {
  if (!role || EVERYWHERE.has(role)) return true
  return (ROLE_MODULES[role] || []).includes(module)
}
