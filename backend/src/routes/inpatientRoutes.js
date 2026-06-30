import { Router } from 'express'
import { getAll, create, update, remove, getPatientTimeline } from '../controllers/inpatientController.js'

const router = Router()

router.get('/', getAll)
router.get('/timeline/:patientId', getPatientTimeline)
router.post('/', create)
router.patch('/', update)
router.delete('/', remove)

export default router
