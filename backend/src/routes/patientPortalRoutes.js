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
    const ext = path.extname(file.originalname)
    cb(null, file.fieldname + '-' + uniqueSuffix + ext)
  }
})
const upload = multer({ storage })

const router = Router()

// Mounted behind authenticate + requirePatient in routes/index.js.
router.get('/me', getMyDashboard)

// Document Upload Route
router.post('/documents', upload.single('document'), uploadDocument)
router.delete('/documents/:id', deleteDocument)

export default router
