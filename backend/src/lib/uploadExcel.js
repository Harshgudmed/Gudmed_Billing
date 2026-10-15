import multer from 'multer'

// Shared multer instance for spreadsheet bulk uploads — kept in memory (no
// temp file) so controllers read req.file.buffer directly and nothing touches
// the disk. Accepts only .xlsx and .csv; caps at 10 MB to prevent DoS via a
// huge sheet.
const ALLOWED_UPLOAD_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
])

export const uploadExcel = multer({
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

// Express middleware: parse a single `file` field and turn multer errors
// (wrong type, too large) into a 400 instead of a 500.
export function uploadSingleExcel(req, res, next) {
  uploadExcel.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'File upload failed' })
    next()
  })
}
