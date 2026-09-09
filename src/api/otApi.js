import client from './client'

// ─────────────────────────────────────────────────────────────────────────────
// Centralized Operation Theatre (OT) API.
// Every "/ot" resource string lives HERE — components call named methods
// instead of hand-writing magic strings. Same shape as inpatientApi.js:
//   • typo-safe (IDE autocomplete; a wrong name is a missing-function error)
//   • one place to change if the backend renames a resource
//   • self-documenting (type `otApi.` to see every available call)
// `client` (axios) already unwraps to response.data → each call resolves to the
// backend's `{ success, data }` payload.
// ─────────────────────────────────────────────────────────────────────────────

const get   = (resource, params)    => client.get('/ot', { params: { resource, ...params } })
const post  = (resource, body = {}) => client.post('/ot', { resource, ...body })
const patch = (resource, body = {}) => client.patch('/ot', { resource, ...body })
const del   = (resource, params)    => client.delete('/ot', { params: { resource, ...params } })

export const otApi = {
  // ── Reads ──────────────────────────────────────────────────────────────────
  getTheatres:  (params)  => get('theatres', params),   // { includeInactive }
  getSurgeries: (params)  => get('surgeries', params),  // { includeInactive }
  getBookings:  (params)  => get('bookings', params),   // { status, theatreId, surgeonId, startDate, endDate, search, limit }
  getBooking:   (id)      => get('booking', { id }),

  // Which theatres are free for a slot, asked while the user is still choosing.
  // Answered by the same rules that block a real booking, so what this shows and
  // what createBooking() allows cannot drift apart.
  // { scheduledStart, estimatedMinutes, excludeBookingId }
  getAvailability: (params) => get('availability', params),

  // Where a case of this length could go on a day — the question rescheduling
  // asks on every move. Suggestions only; the booking check is still the gate.
  // { date, estimatedMinutes, primarySurgeonId, patientId, theatreId,
  //   excludeBookingId, from, to, limit }
  getSlots: (params) => get('slots', params),

  // ── Masters ────────────────────────────────────────────────────────────────
  createTheatre:  (body)        => post('theatre', body),
  createSurgery:  (body)        => post('surgery', body),
  updateTheatre:  (id, fields)  => patch('theatre', { id, ...fields }),
  updateSurgery:  (id, fields)  => patch('surgery', { id, ...fields }),
  // Retire, not delete — a past case must still resolve its theatre and procedure.
  retireTheatre:  (id)          => del('theatre', { id }),
  retireSurgery:  (id)          => del('surgery', { id }),

  // ── Bookings ───────────────────────────────────────────────────────────────
  createBooking:  (body)        => post('booking', body),
  reschedule:     (id, fields)  => patch('reschedule', { id, ...fields }),
  updateTeam:     (id, team)    => patch('team', { id, team }),

  // Status moves. `reason` is REQUIRED by the backend for cancel and postpone,
  // so the named helpers below take it as a plain argument rather than leaving
  // the caller to remember.
  setStatus:      (id, status, reason)  => patch('status', { id, status, reason }),
  confirm:        (id)          => patch('status', { id, status: 'CONFIRMED' }),
  checkIn:        (id)          => patch('status', { id, status: 'CHECKED_IN' }),
  startSurgery:   (id)          => patch('status', { id, status: 'IN_THEATRE' }),
  completeCase:   (id)          => patch('status', { id, status: 'COMPLETED' }),
  cancelCase:     (id, reason)  => patch('status', { id, status: 'CANCELLED', reason }),
  postponeCase:   (id, reason)  => patch('status', { id, status: 'POSTPONED', reason }),
}

// The values the backend accepts. Kept here so dropdowns and badges read from
// one list instead of each screen hard-coding its own — a mismatch here is a
// 400 the user cannot act on.
export const OT_STATUSES = [
  'SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_THEATRE', 'COMPLETED', 'CANCELLED', 'POSTPONED',
]

export const OT_TEAM_ROLES = [
  'PRIMARY_SURGEON', 'ASSISTANT_SURGEON', 'ANAESTHETIST',
  'SCRUB_NURSE', 'CIRCULATING_NURSE', 'OT_TECHNICIAN', 'PERFUSIONIST', 'OBSERVER',
]

export const OT_PRIORITIES = ['ELECTIVE', 'URGENT', 'EMERGENCY']
export const OT_LATERALITY = ['NA', 'LEFT', 'RIGHT', 'BILATERAL']

// How these values are LABELLED and COLOURED on screen is a display concern and
// lives in components/ot/otDisplay.js — this file stays the backend contract.

export default otApi

// ─────────────────────────────────────────────────────────────────────────────
// The four case documents (Phase 2). Each is one per case and edited in place,
// so there is a read and a save — no create/delete.
// ─────────────────────────────────────────────────────────────────────────────

const clinicalGet = (resource, bookingId) =>
  client.get('/ot-clinical', { params: { resource, bookingId } })

const clinicalSave = (resource, bookingId, fields) =>
  client.patch('/ot-clinical', { resource, bookingId, ...fields })

export const otClinicalApi = {
  // One request for the whole case record — the detail screen shows all four.
  getCaseRecord: (bookingId) => clinicalGet('all', bookingId),

  getPreOp: (bookingId) => clinicalGet('preop', bookingId),
  getChecklist: (bookingId) => clinicalGet('checklist', bookingId),
  getAnaesthesia: (bookingId) => clinicalGet('anaesthesia', bookingId),
  getOpNote: (bookingId) => clinicalGet('opnote', bookingId),

  savePreOp: (bookingId, fields) => clinicalSave('preop', bookingId, fields),
  saveAnaesthesia: (bookingId, fields) => clinicalSave('anaesthesia', bookingId, fields),
  saveOpNote: (bookingId, fields) => clinicalSave('opnote', bookingId, fields),

  // The checklist saves a phase at a time. `phase` is what stamps the time and
  // the signer, so a phase saved without it records the ticks but not who ran it.
  saveChecklistPhase: (bookingId, phase, fields) => clinicalSave('checklist', bookingId, { phase, ...fields }),
  saveCounts: (bookingId, fields) => clinicalSave('checklist', bookingId, fields),
}

// Values the backend accepts, so a dropdown and the server can never disagree.
export const ASA_GRADES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'IE', 'IIE', 'IIIE', 'IVE', 'VE']
export const OT_FITNESS = ['FIT', 'UNFIT', 'FIT_WITH_CONDITIONS']
export const ANAESTHESIA_TYPES = ['GENERAL', 'SPINAL', 'EPIDURAL', 'REGIONAL', 'LOCAL', 'SEDATION', 'COMBINED']
export const AIRWAY_DEVICES = ['ETT', 'LMA', 'FACE_MASK', 'NASAL', 'TRACHEOSTOMY']
export const VENTILATION_MODES = ['SPONTANEOUS', 'CONTROLLED', 'ASSISTED', 'SIMV', 'PSV']

// How the case ended, and where the patient went from the table.
// Both mirror otClinicalController.js — a value not on its list is a 400 the
// user cannot act on.
export const PROCEDURE_STATUS = ['COMPLETED', 'MODIFIED', 'ABANDONED']
export const PROCEDURE_STATUS_LABEL = {
  COMPLETED: 'Completed as planned',
  MODIFIED: 'Completed, but changed',
  ABANDONED: 'Abandoned',
}

// What kind of complication occurred.
//
// A clinical taxonomy, the same for every hospital on the system on purpose:
// left to each to name, one would write "Bleeding", another "Haemorrhage" and a
// third "Blood loss", and counting them across the group would go back to being
// a text search — the thing structuring this was meant to end.
//
// Mirrors COMPLICATION_TYPES in backend/src/controllers/otClinicalController.js,
// which is the authority. These two files are the only places the codes appear.
export const COMPLICATION_TYPES = [
  'BLEEDING',
  'INFECTION',
  'ORGAN_INJURY',
  'ANAESTHESIA',
  'CARDIOVASCULAR',
  'RESPIRATORY',
  'EQUIPMENT',
  'OTHER',
]
export const COMPLICATION_TYPE_LABEL = {
  BLEEDING: 'Bleeding',
  INFECTION: 'Infection',
  ORGAN_INJURY: 'Organ or tissue injury',
  ANAESTHESIA: 'Anaesthesia-related',
  CARDIOVASCULAR: 'Cardiovascular',
  RESPIRATORY: 'Respiratory',
  EQUIPMENT: 'Equipment-related',
  OTHER: 'Other',
}

export const PATIENT_DESTINATIONS = ['RECOVERY', 'ICU', 'HDU', 'WARD', 'HOME']
export const PATIENT_DESTINATION_LABEL = {
  RECOVERY: 'Recovery (PACU)',
  ICU: 'ICU',
  HDU: 'HDU',
  WARD: 'Ward',
  HOME: 'Home (day case)',
}
