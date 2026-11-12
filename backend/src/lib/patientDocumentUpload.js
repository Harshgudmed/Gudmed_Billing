// Shared by every multer config that accepts a patient document — the
// staff-facing upload (routes/uploadRoutes.js, used by Appointments/OPD/IPD/
// Insurance-TPA) and the patient's own portal upload (routes/
// patientPortalRoutes.js). Both write into the same PatientDocument table, so
// the allowed types and size limit must be the same or an upload accepted on
// one side could 400 if ever re-validated on the other, and the two sides
// used to disagree (portal: images + PDF only; staff side: + WEBP) with no
// Word support anywhere.
export const PATIENT_DOC_MAX_MB = 20
export const PATIENT_DOC_MAX_BYTES = PATIENT_DOC_MAX_MB * 1024 * 1024

// Who may upload, delete or verify/reject a patient's documents — used by
// uploadRoutes.js's authorize() calls, patientController.js's verifyDocument,
// and mirrored on the frontend by PatientDocumentsPanel.jsx's canManage. One
// list here instead of four separate copies, per this repo's own "one
// business constant, several copies" lesson (CLAUDE.md).
export const PATIENT_DOC_ROLES = ['doctor', 'nurse', 'receptionist', 'admin']

export const PATIENT_DOC_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
}
export const PATIENT_DOC_MIME = new Set(Object.keys(PATIENT_DOC_EXT))
export const PATIENT_DOC_TYPES_LABEL = 'JPG, PNG, WEBP, PDF or Word (.doc/.docx)'

// A multer fileFilter rejection surfaces as a plain Error with no code; a
// size rejection is multer's own MulterError with code LIMIT_FILE_SIZE. Map
// both to one clear message instead of multer's bare "File too large".
export function patientDocUploadError(err) {
  if (err?.code === 'LIMIT_FILE_SIZE') return `File is larger than ${PATIENT_DOC_MAX_MB}MB. Please upload a smaller file.`
  return err?.message || 'Upload failed'
}
