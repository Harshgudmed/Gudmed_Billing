import { Router } from 'express'
import multer from 'multer'
import { getAll, create, update, remove } from '../controllers/purchaseController.js'
import { downloadVendorTemplate, bulkImportVendors } from '../controllers/bulkVendorImportController.js'
import { requirePurchaseOn } from '../lib/purchaseAccess.js'
import { canManageMasters } from '../lib/purchaseAccess.js'

const router = Router()

// Nothing in Purchase answers while the hospital has it switched off.
router.use(requirePurchaseOn)

// Vendor bulk import — Excel/CSV, memoryStorage (processed in RAM, not written to disk)
const ALLOWED_EXCEL_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
])
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname?.split('.').pop()?.toLowerCase()
    if (ALLOWED_EXCEL_MIME.has(file.mimetype) || ext === 'xlsx' || ext === 'csv') return cb(null, true)
    cb(new Error('Only .xlsx or .csv files are accepted'))
  },
})

router.get('/vendor-import/template', (req, res, next) => {
  if (!canManageMasters(req)) return res.status(403).json({ success: false, error: 'Only the purchase officer or an administrator can download the template' })
  return downloadVendorTemplate(req, res, next)
})

router.post('/vendor-import', (req, res, next) => {
  if (!canManageMasters(req)) return res.status(403).json({ success: false, error: 'Only the purchase officer or an administrator can import vendors' })
  uploadExcel.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' })
    next()
  })
}, bulkImportVendors)

router.get('/', getAll)
router.post('/', create)
router.patch('/', update)
router.delete('/', remove)

export default router
