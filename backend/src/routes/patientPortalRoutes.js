import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { getMyDashboard, uploadDocument, deleteDocument } from '../controllers/patientPortalController.js'

// Configure multer for local file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/patient-documents/')
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    // Force the stored extension from an allowlist of known-safe types — never trust
    // the client's extension (prevents a .html/.svg/.exe being written to disk).
    const ALLOWED_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' }
    const ext = ALLOWED_EXT[file.mimetype] || ''
    cb(null, file.fieldname + '-' + uniqueSuffix + ext)
  }
})
// Only allow patient documents to be images or PDFs, and cap the size so a single
// upload can't exhaust disk / act as a DoS. Rejected types return a clear error.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB, one file
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true)
    cb(new Error('Only JPG, PNG, or PDF files are allowed'))
  },
})

const router = Router()

// Mounted behind authenticate + requirePatient in routes/index.js.
router.get('/me', getMyDashboard)

// Document Upload Route. Wrap multer so a rejected type / oversized file returns a
// clean 400 instead of bubbling up as an unhandled error.
router.post('/documents', (req, res, next) => {
  upload.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' })
    next()
  })
}, uploadDocument)
router.delete('/documents/:id', deleteDocument)

export default router
