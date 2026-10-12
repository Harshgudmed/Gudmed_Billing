// Which modules a hospital works with — the server's copy of the screen's rule
// (src/lib/roleConfig.js: MODULES' toggles and isModuleOn). Two switches decide:
//
//   modulesAllowed  what the hospital has BOUGHT — set by the platform owner only.
//                   NULL = no limit yet, so a hospital that existed before this
//                   column keeps every module it had.
//   modulesEnabled  what the hospital's administrator keeps ON — the administrator
//                   may switch a module off and back on, but never on beyond what
//                   is bought.
//
// A module works only when it is bought AND on.

/** Module key (roleModules.js) → its toggle name; null cannot be switched off. */
export const MODULE_TOGGLE = {
  dashboard: null,
  patients: 'patients',
  appointments: null,
  preTriage: 'preTriage',
  queue: 'queue',
  opd: 'opd',
  laboratory: 'laboratory',
  radiology: 'radiology',
  dayCare: 'dayCare',
  ambulance: 'ambulance',
  insurance: 'insurance',
  deathCertificate: 'deathCertificate',
  inpatient: 'inpatient',
  ot: 'ot',
  purchase: 'purchase',
  storeIndent: 'purchase', // the store's stock is Purchase's: on and off with it
  pharmacy: 'pharmacy',
  billing: null,
  doctorAccountability: 'doctorAccountability',
  settings: null,
}

// A module still being built reads "no key" as OFF, so it does not appear in
// every hospital the day it ships (same list as the screen's).
const OFF_UNTIL_ENABLED = new Set(['purchase'])

/** A stored switches column (JSON text, or already an object) as a plain map; unreadable reads as empty. */
export function parseModuleMap(stored) {
  if (!stored) return {}
  try {
    const map = typeof stored === 'string' ? JSON.parse(stored) : stored
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {}
  } catch {
    return {}
  }
}

/** Is the toggle kept on by the administrator? The screen's isModuleOn, rule for rule. */
export function isToggleOn(toggle, modulesEnabled = {}) {
  if (!toggle) return true
  return OFF_UNTIL_ENABLED.has(toggle) ? modulesEnabled[toggle] === true : modulesEnabled[toggle] !== false
}

/** Has the hospital bought it? `modulesAllowed` null/absent = no limit; once set, only what it lists as true. */
export function isToggleBought(toggle, modulesAllowed) {
  if (!toggle || modulesAllowed == null) return true
  return parseModuleMap(modulesAllowed)[toggle] === true
}

/** Does this module work for this hospital row (needs modulesEnabled and modulesAllowed)? Unknown modules do not. */
export function moduleWorks(module, organization) {
  if (!Object.hasOwn(MODULE_TOGGLE, module)) return false
  const toggle = MODULE_TOGGLE[module]
  return isToggleBought(toggle, organization?.modulesAllowed) && isToggleOn(toggle, parseModuleMap(organization?.modulesEnabled))
}

/**
 * The toggles an administrator tries to switch ON that the hospital has not
 * bought — the settings save refuses these. Switching off is always allowed,
 * and so is leaving an already-on, unbought toggle as it is (a hospital whose
 * plan was cut keeps the rest of its map; moduleWorks keeps the module shut).
 */
export function turnedOnBeyondPlan(nextEnabled, currentEnabled, modulesAllowed) {
  const next = parseModuleMap(nextEnabled)
  const current = parseModuleMap(currentEnabled)
  return Object.keys(next).filter((toggle) => next[toggle] === true && current[toggle] !== true && !isToggleBought(toggle, modulesAllowed))
}
