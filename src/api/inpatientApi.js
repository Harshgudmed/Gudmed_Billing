import client from './client'

// ─────────────────────────────────────────────────────────────────────────────
// Centralized Inpatient (IPD) API.
// Every "/inpatient" resource string lives HERE — components call named methods
// instead of hand-writing magic strings. Benefits:
//   • typo-safe (IDE autocomplete; a wrong name is a missing-function error)
//   • one place to change if the backend renames a resource
//   • self-documenting (type `inpatientApi.` to see every available call)
// `client` (axios) already unwraps to response.data → each call resolves to the
// backend's `{ success, data, ... }` payload, so call sites are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const get   = (resource, params)      => client.get('/inpatient', { params: { resource, ...params } })
const post  = (resource, body = {})   => client.post('/inpatient', { resource, ...body })
const patch = (resource, body = {})   => client.patch('/inpatient', { resource, ...body })
const del   = (resource, params)      => client.delete('/inpatient', { params: { resource, ...params } })

export const inpatientApi = {
  // ── Reads ──────────────────────────────────────────────────────────────────
  getWards:          ()             => get('wards'),
  getBeds:           (params)       => get('beds', params),                       // { wardId, status }
  getAdmissions:     (params)       => get('admissions', params),                 // { limit, offset, status, mine }
  getStats:          ()             => get('stats'),
  getNotes:          (admissionId)  => get('notes', { admissionId }),
  getVitals:         (admissionId)  => get('vitals', { admissionId }),
  getClinicalNotes:  (admissionId)  => get('clinical-notes-v2', { admissionId }),
  getMedications:    (admissionId)  => get('medication-administration', { admissionId }),
  getOrderTasks:     (admissionId)  => get('order-tasks', { admissionId }),
  getOrderables:     (params)       => get('orderables', params),                 // { q, type }
  getOrders:         (params)       => get('orders', params),                     // { admissionId, type, status }
  getOrder:          (id)           => get('order', { id }),
  getOrderWorklist:  (params)       => get('order-worklist', params),
  getBill:           (admissionId)  => get('bill', { admissionId }),
  getPayments:       (params)       => get('payments', params),                   // { billId, admissionId }
  getCollections:    (params)       => get('collections', params),                // { from, to, cashierId }
  getRunningBill:    (admissionId)  => get('running-bill', { admissionId }),
  getTariffPreview:  (params)       => get('tariff-preview', params),
  getPharmacyPrice:  (params)       => get('pharmacy-price', params),
  getBedCategories:  ()             => get('bed-categories'),
  getTariffPlans:    ()             => get('tariff-plans'),
  getConsultations:  (params)       => get('ipd-consultation', params),           // { admissionId, status, mine }
  getPatientReports: (admissionId)  => get('patient-reports', { admissionId }),

  // ── Wards / Beds / Admissions (writes) ──────────────────────────────────────
  createWard:        (body)         => post('ward', body),
  createBed:         (body)         => post('bed', body),
  createAdmission:   (body)         => post('admission', body),
  createTransfer:    (body)         => post('transfer', body),
  syncBeds:          (wardId)       => post('sync-beds', { wardId }),
  updateWard:        (id, fields)   => patch('ward', { id, ...fields }),
  updateBed:         (id, fields)   => patch('bed', { id, ...fields }),
  updateAdmission:   (id, updates)  => patch('admission', { id, updates }),
  removeWard:        (id)           => del('ward', { id }),
  removeBed:         (id)           => del('bed', { id }),

  // ── Clinical: notes / vitals / meds ─────────────────────────────────────────
  createNote:        (body)         => post('note', body),
  createNoteV2:      (body)         => post('note-v2', body),
  createVitals:      (body)         => post('vitals', body),
  updateVitals:      (id, updates)  => patch('vitals', { id, updates }),
  createMedication:  (body)         => post('medication-administration', body),

  // ── Billing ─────────────────────────────────────────────────────────────────
  generateBill:      (admissionId)  => post('bill-generate', { admissionId }),
  finalizeBill:      (body)         => post('bill-finalize', body),
  cancelBill:        (body)         => post('bill-cancel', body),
  postCharge:        (body)         => post('post-charge', body),
  cancelCharge:      (body)         => post('cancel-charge', body),
  createPayment:     (body)         => post('payment', body),
  voidPayment:       (body)         => post('void-payment', body),
  refund:            (body)         => post('refund', body),

  // ── Discharge ───────────────────────────────────────────────────────────────
  dischargeFinalize: (body)         => post('discharge-finalize', body),
  markExit:          (body)         => post('mark-exit', body),

  // ── Orders (CPOE) ───────────────────────────────────────────────────────────
  createOrder:       (body)         => post('order', body),
  orderTransition:   (action, body) => post(`order-${action}`, body),             // action: ack | start | cancel
  completeOrder:     (body)         => post('order-complete', body),
  updateOrderTask:   (id, fields)   => patch('order-task', { id, ...fields }),

  // ── Consultations ───────────────────────────────────────────────────────────
  createConsultation:(body)         => post('ipd-consultation', body),
  updateConsultation:(id, fields)   => patch('ipd-consultation', { id, ...fields }),
  removeConsultation:(id)           => del('ipd-consultation', { id }),
}

export default inpatientApi
