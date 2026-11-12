import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { getMyDashboard, uploadDocument, deleteDocument } from '../controllers/patientPortalController.js'
import { PATIENT_DOC_MIME, PATIENT_DOC_EXT, PATIENT_DOC_MAX_BYTES, PATIENT_DOC_TYPES_LABEL, patientDocUploadError } from '../lib/patientDocumentUpload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads')

// Configure multer for local file uploads. Types/size limit are shared with
// the staff-side upload in routes/uploadRoutes.js (lib/patientDocumentUpload.js)
// — both write into the same PatientDocument table.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(UPLOAD_ROOT, 'patient-documents')
    fs.mkdirSync(uploadPath, { recursive: true })
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    // Force the stored extension from an allowlist of known-safe types — never trust
    // the client's extension (prevents a .html/.svg/.exe being written to disk).
    const ext = PATIENT_DOC_EXT[file.mimetype] || ''
    cb(null, file.fieldname + '-' + uniqueSuffix + ext)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: PATIENT_DOC_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (PATIENT_DOC_MIME.has(file.mimetype)) return cb(null, true)
    cb(new Error(`Only ${PATIENT_DOC_TYPES_LABEL} files are allowed`))
  },
})

const router = Router()

// Mounted behind authenticate + requirePatient in routes/index.js.
router.get('/me', getMyDashboard)

// Document Upload Route. Wrap multer so a rejected type / oversized file returns a
// clean 400 instead of bubbling up as an unhandled error.
router.post('/documents', (req, res, next) => {
  upload.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: patientDocUploadError(err) })
    next()
  })
}, uploadDocument)
router.delete('/documents/:id', deleteDocument)

export default router
