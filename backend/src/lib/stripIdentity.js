// What a client may never change on a row that already exists.
//
// WHY THIS FILE EXISTS
// The update handlers validate with `.passthrough()` schemas — anything the
// caller sends that the schema does not name is kept and spread straight into
// `prisma.update({ data })`. That is deliberate (these resources have many
// optional fields), but it means the ONLY thing standing between a request and
// the row's identity is the list of `delete` lines the handler happens to have.
//
// Six handlers each kept their own list, and they drifted. Laboratory's order
// handler deleted six fields; Radiology's deleted two — so this worked against
// the running app:
//
//     POST  radiology order for patient A       → RAD-2026-27-000002
//     PATCH { patientId: B, orderNumber: "RAD-HACKED-0001" }
//     → the scan now belongs to patient B, under a number of the caller's choosing
//
// One patient's scan on another patient's record is the worst thing a radiology
// system can do, and a rewritten document number breaks the counter series and
// the audit trail with it.
//
// The lists live here so a new resource is a row in the table, not another set
// of `delete` lines that can be forgotten.

// Never settable on ANY resource, whatever it is.
const ALWAYS = ['organizationId', 'id', 'createdAt', 'updatedAt', 'createdById']

// Per-resource: the foreign keys and human-visible numbers that are decided when
// the row is created and must never move afterwards.
const IDENTITY = {
  // Which patient, which doctor, and the number printed on the tube/report.
  labOrder:        ['patientId', 'requestedById', 'orderNumber', 'accessionNumber'],
  radiologyOrder:  ['patientId', 'requestedById', 'orderNumber', 'examId'],

  // A result/report belongs to one order and one test. Re-pointing it would
  // attach a finding to the wrong patient just as surely as moving the order.
  labResult:       ['orderId', 'testId'],
  radiologyReport: ['orderId'],

  // Catalogue rows own nothing beyond ALWAYS.
  labTest:         [],
  radiologyExam:   [],
}

/**
 * Remove every field the caller must not set, in place, and return the object
 * so it can be used inline.
 *
 *   const fields = stripIdentity(rest, 'radiologyOrder')
 *
 * An unknown resource name throws rather than silently protecting nothing —
 * a typo here would be invisible until someone exploited it.
 */
export function stripIdentity(data, resource) {
  const owned = IDENTITY[resource]
  if (!owned) {
    throw new Error(`stripIdentity: unknown resource "${resource}". Add it to IDENTITY in lib/stripIdentity.js.`)
  }
  for (const field of [...ALWAYS, ...owned]) delete data[field]
  return data
}

/** The full list for a resource — used by the tests, so they cannot drift from the code. */
export function protectedFields(resource) {
  const owned = IDENTITY[resource]
  if (!owned) throw new Error(`stripIdentity: unknown resource "${resource}"`)
  return [...ALWAYS, ...owned]
}
