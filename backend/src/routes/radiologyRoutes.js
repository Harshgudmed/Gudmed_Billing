import { Router } from 'express'
import { getAll, create, update } from '../controllers/radiologyController.js'
import { importExams } from '../controllers/radiologyImport.controller.js'

const router = Router()

router.post('/import', importExams) // bulk import radiology exams (xlsx/csv rows)
router.get('/', getAll)
router.post('/', create)
router.patch('/', update)

export default router
