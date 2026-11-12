// One canonical list of PatientDocument.documentType codes and their labels,
// shared by every screen that uploads/shows a patient's documents: the
// patient's own KYC page (KycSection.jsx), and the staff-facing panel used in
// Appointments, OPD, IPD and Insurance/TPA (PatientDocumentsPanel.jsx). Both
// read and write the same PatientDocument table — a code defined in only one
// place used to mean a document (e.g. Aadhaar/PAN uploaded by the patient)
// had nowhere to show up on the staff side, and the two screens disagreed on
// the label for the same code (e.g. "Insurance Policy" vs "Insurance
// Details"). Add a new type here once, for both screens.
//
// Renaming a `label` is always safe: PatientDocument.documentType stores the
// `value` code, never the label text, so an existing upload is never
// orphaned or unlinked by a wording change here.
//
// `group` places the type under one of five sections a staff panel renders
// as collapsible groups (GROUPS below), in the patient's actual journey
// order: identity/insurance → admission/clinical → treatment/procedure →
// pre-auth/billing → claim submission/settlement.
export const GROUPS = [
  { id: 'identity', label: '01. Identity & Insurance Documents' },
  { id: 'admission_clinical', label: '02. Admission & Clinical Documents' },
  { id: 'treatment_procedure', label: '03. Treatment & Procedure Documents' },
  { id: 'preauth_billing', label: '04. Pre-Authorisation & Billing Documents' },
  { id: 'claim_settlement', label: '05. Claim Submission & Settlement Documents' },
]

export const PATIENT_DOC_TYPES = [
  // 01. Identity & Insurance
  { value: 'registration_form', label: 'Patient Registration Form', group: 'identity' },
  { value: 'privacy_consent', label: 'Privacy & DPDPA Consent Form (Data Protection)', group: 'identity' },
  { value: 'aadhaar', label: 'Patient ID Proof (Aadhaar / Other Govt. ID)', group: 'identity' },
  { value: 'pan', label: 'PAN Card', group: 'identity', optional: true },
  { value: 'employee_id', label: 'Corporate Employee ID (If Applicable)', group: 'identity', optional: true },
  { value: 'photograph', label: 'Patient Photograph', group: 'identity' },
  { value: 'insurance', label: 'Health Insurance E-card / Policy Copy', group: 'identity' },
  // 02. Admission & Clinical
  { value: 'referral', label: 'Referral Letter', group: 'admission_clinical' },
  { value: 'admission_note', label: 'Admission Note / Initial Assessment', group: 'admission_clinical' },
  { value: 'patient_rights', label: 'Patient Rights & Responsibilities (Signed)', group: 'admission_clinical' },
  { value: 'patient_education', label: 'Patient & Family Education Record', group: 'admission_clinical', optional: true },
  { value: 'prescription', label: "Doctor's Prescription", group: 'admission_clinical' },
  { value: 'history', label: 'Medical History / Previous Records', group: 'admission_clinical' },
  { value: 'opd_card', label: 'Previous OPD Card', group: 'admission_clinical' },
  { value: 'progress_notes', label: 'Daily Progress Notes / Indoor Case Papers', group: 'admission_clinical' },
  { value: 'lab_report', label: 'Laboratory Reports', group: 'admission_clinical' },
  { value: 'radiology', label: 'Radiology / Imaging Reports', group: 'admission_clinical' },
  { value: 'ecg_echo', label: 'ECG / ECHO Reports', group: 'admission_clinical' },
  // Registered at casualty/admission — before treatment starts — for an
  // accident, assault or poisoning case, not during the procedure itself.
  { value: 'mlc_fir', label: 'MLC / FIR (Accident Case)', group: 'admission_clinical', optional: true },
  // 03. Treatment & Procedure
  { value: 'operative_notes', label: 'Operative / Surgery Notes', group: 'treatment_procedure' },
  { value: 'consent', label: 'Consent Forms', group: 'treatment_procedure' },
  { value: 'anaesthesia_records', label: 'Anaesthesia Records', group: 'treatment_procedure', optional: true },
  { value: 'implant_invoice', label: 'Implant / Device Invoice', group: 'treatment_procedure', optional: true },
  { value: 'clinical_photo', label: 'Clinical Photo', group: 'treatment_procedure' },
  { value: 'lama_form', label: 'LAMA Form (Left Against Medical Advice)', group: 'treatment_procedure', optional: true },
  { value: 'dama_form', label: 'DAMA Form (Discharge Against Medical Advice)', group: 'treatment_procedure', optional: true },
  { value: 'dnr_form', label: 'DNR Form (Do Not Resuscitate)', group: 'treatment_procedure', optional: true },
  // 04. Pre-Authorisation & Billing
  { value: 'cost_estimate', label: 'Estimated Hospitalisation Cost / Package Estimate', group: 'preauth_billing' },
  { value: 'pre_auth_form', label: 'Cashless Pre-Authorization Request Form', group: 'preauth_billing' },
  { value: 'pre_auth_approval', label: 'Pre-Authorization Approval Letter', group: 'preauth_billing' },
  { value: 'enhancement_request', label: 'Enhancement Request & Approval', group: 'preauth_billing', optional: true },
  { value: 'discharge_summary', label: 'Discharge Summary', group: 'preauth_billing' },
  // Death Summary replaces the Discharge Summary only when the patient dies
  // in hospital — a case has one or the other, never both.
  { value: 'death_summary', label: 'Death Summary', group: 'preauth_billing', optional: true },
  { value: 'discharge_medications', label: 'Discharge Medications', group: 'preauth_billing', optional: true },
  { value: 'discharge_instructions', label: 'Discharge Instructions', group: 'preauth_billing', optional: true },
  { value: 'followup_instructions', label: 'Follow-up Instructions', group: 'preauth_billing', optional: true },
  { value: 'investigation_bills', label: 'Investigation Bills / Receipts', group: 'preauth_billing' },
  { value: 'pharmacy_bill', label: 'Pharmacy Bills / Invoices', group: 'preauth_billing' },
  { value: 'final_bill', label: 'Final Hospital Bill (Consolidated)', group: 'preauth_billing' },
  { value: 'final_bill_breakup', label: 'Detailed Final Bill Breakup', group: 'preauth_billing' },
  { value: 'payment_receipt', label: 'Advance / Deposit / Payment Receipts', group: 'preauth_billing' },
  // 05. Claim Submission & Settlement
  { value: 'claim_form', label: 'Insurance Claim Form', group: 'claim_settlement' },
  { value: 'cghs_claim_form', label: 'CGHS Claim / Reimbursement Form', group: 'claim_settlement', optional: true },
  { value: 'pmjay_claim_form', label: 'PMJAY / Ayushman Bharat Claim Form', group: 'claim_settlement', optional: true },
  { value: 'bank_details', label: 'Bank Details / Cancelled Cheque', group: 'claim_settlement' },
  { value: 'tpa_query', label: 'TPA Query / Deficiency Letter', group: 'claim_settlement', optional: true },
  { value: 'tpa_query_response', label: 'TPA Query Response Documents', group: 'claim_settlement', optional: true },
  { value: 'claim_settlement', label: 'Claim Submission Acknowledgement / Final Settlement Advice', group: 'claim_settlement' },
  { value: 'other', label: 'Other Supporting Documents', group: 'claim_settlement' },
]

export const PATIENT_DOC_TYPE_LABEL = Object.fromEntries(PATIENT_DOC_TYPES.map((t) => [t.value, t.label]))

// Shown in the Insurance/TPA module's Documents tab — everything except the
// two types that belong to other visit screens only (Previous OPD Card,
// Clinical Photo). They still show correctly wherever a document of that
// type was uploaded, just without their own upload card here.
const TPA_EXCLUDED = new Set(['opd_card', 'clinical_photo'])
export const TPA_DOC_TYPES = PATIENT_DOC_TYPES.filter((t) => !TPA_EXCLUDED.has(t.value))

// Buckets a list of types (e.g. TPA_DOC_TYPES) into GROUPS order, skipping an
// empty group — so a caller can render one collapsible section per entry.
export function groupDocTypes(types) {
  return GROUPS
    .map((g) => ({ ...g, types: types.filter((t) => t.group === g.id) }))
    .filter((g) => g.types.length > 0)
}
