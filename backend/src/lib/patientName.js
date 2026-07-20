// ── The ONE place that knows how to name a patient ───────────────────────────
//
// A patient's name lives in three columns (firstName / middleName / lastName).
// Turning those into text was hand-written at ~110 call sites, and almost all
// of them joined only the first and last — so a patient registered as
// "Harsh Mohan Bansal" printed as "Harsh Bansal" on their own bills.
//
// Two things have to be right for a name to come out whole, and they live in
// different layers. Both are here so they cannot drift apart:
//
//   1. PATIENT_NAME_SELECT — the query must ASK the database for the columns.
//      Miss `middleName` in the select and the row simply has no such field:
//      the formatter then reads `undefined` and silently drops it. This is what
//      actually caused the bug — several screens already called a
//      middleName-aware formatter, but the API had never sent the column, so
//      they printed "Harsh  Bansal" (with a double space) regardless.
//
//   2. patientFullName() — the formatter itself.
//
// Rule of thumb: if a query feeds a screen that shows a patient's name, spread
// PATIENT_NAME_SELECT into its `select`. Never re-type the field list.

/**
 * Prisma `select` fragment for anything that displays a patient's name.
 * Spread it, then add whatever else that screen needs:
 *
 *   patient: { select: { ...PATIENT_NAME_SELECT, phonePrimary: true } }
 *
 * `id` and `mrn` ride along because a name is almost always rendered next to
 * the UHID, and a row keyed by id — leaving them out just moves the same
 * "field is missing" problem one column over.
 */
export const PATIENT_NAME_SELECT = {
  id: true,
  mrn: true,
  firstName: true,
  middleName: true,
  lastName: true,
}

/**
 * "Harsh Mohan Bansal" — every part that exists, in order, single-spaced.
 *
 * Blank parts are dropped rather than interpolated, so a patient with no middle
 * name reads "Priya Sharma" and not "Priya  Sharma" (the double space that the
 * old `${first} ${middle || ''} ${last}` pattern left behind).
 *
 * Returns '' for a missing patient so callers can `|| 'Unknown'` as they see
 * fit — a walk-in with no record is not an error, and the right wording for it
 * differs per screen ("Walk-in" on a pharmacy receipt, "Unknown Patient" on an
 * appointment card).
 *
 * @param p a patient row selected with PATIENT_NAME_SELECT (or any superset)
 */
export function patientFullName(p) {
  if (!p) return ''
  return [p.firstName, p.middleName, p.lastName]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ')
}
