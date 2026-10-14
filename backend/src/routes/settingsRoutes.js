import { Router } from 'express'
import multer from 'multer'
import { authorize } from '../middleware/auth.js'
import {
  getOrganization, updateOrganization,
  getUsers, createUser, updateUser, toggleUserStatus,
  getDepartments, createDepartment, deleteDepartment, getBillingServices,
} from '../controllers/settingsController.js'
import {
  bulkUploadDoctors,
  downloadBulkDoctorTemplate,
} from '../controllers/bulkDoctorUploadController.js'

// Multer instance for bulk-doctor uploads — kept in memory (no temp file) so
// the controller reads req.file.buffer directly and nothing touches the disk.
// Accepts only .xlsx and .csv; caps at 10 MB to prevent DoS via a huge sheet.
const ALLOWED_UPLOAD_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
])
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname?.split('.').pop()?.toLowerCase()
    if (ALLOWED_UPLOAD_MIME.has(file.mimetype) || ext === 'xlsx' || ext === 'csv') {
      return cb(null, true)
    }
    cb(new Error('Only .xlsx or .csv files are accepted'))
  },
})

const router = Router()

// Reading stays open to all staff — the user list fills doctor pickers on eight
// screens. CHANGING settings is the administrator's: without this any logged-in
// account (a receptionist was proven to) could create an admin, reset the
// admin's password and log in as them, or rename the hospital. authorize()
// always passes admin / super_admin, so naming 'admin' admits only them.
const adminOnly = authorize('admin')
router.post('/', adminOnly)
router.patch('/', adminOnly)

router.get('/', (req, res, next) => {
  const { resource } = req.query
  if (resource === 'users') return getUsers(req, res, next)
  if (resource === 'departments') return getDepartments(req, res, next)
  if (resource === 'billingServices') return getBillingServices(req, res, next)
  if (resource === 'bulk-doctor-template') return downloadBulkDoctorTemplate(req, res, next)
  return getOrganization(req, res, next)
})

router.post('/', (req, res, next) => {
  // Bulk doctor upload is multipart — parse the file first, then read resource
  // from req.body (multer populates body fields alongside the file).
  if (
    req.is('multipart/form-data') ||
    req.headers['content-type']?.includes('multipart/form-data')
  ) {
    return uploadExcel.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message || 'File upload failed' })
      const { resource } = req.body
      if (resource === 'bulk-upload-doctors') return bulkUploadDoctors(req, res, next)
      return res.status(400).json({ success: false, error: 'Unknown multipart resource' })
    })
  }
  const { resource } = req.body
  if (resource === 'user') return createUser(req, res, next)
  if (resource === 'department') return createDepartment(req, res, next)
  return res.status(400).json({ success: false, error: 'Unknown resource' })
})

router.patch('/', (req, res, next) => {
  const { resource } = req.body
  if (resource === 'user') return updateUser(req, res, next)
  if (resource === 'user-status') return toggleUserStatus(req, res, next)
  if (resource === 'organization') return updateOrganization(req, res, next)
  return res.status(400).json({ success: false, error: 'Unknown resource' })
})

router.delete('/', adminOnly, (req, res, next) => {
  const { resource } = req.body
  if (resource === 'department') return deleteDepartment(req, res, next)
  return res.status(400).json({ success: false, error: 'Unknown resource' })
})

export default router
