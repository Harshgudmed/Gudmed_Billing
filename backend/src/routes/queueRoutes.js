import { Router } from 'express'
import { getQueue, addToQueue, updateQueue, callNextPatient, markPrescriptionUploaded, clearPrescriptionUploaded } from '../controllers/queueController.js'

const router = Router()

router.get('/', getQueue)
router.post('/', addToQueue)
router.patch('/:id', updateQueue)
// Before '/:id/...' routes so 'call-next' is never read as an :id.
router.post('/call-next', callNextPatient)
router.post('/:id/prescription-uploaded', markPrescriptionUploaded)
router.delete('/:id/prescription-uploaded', clearPrescriptionUploaded)

export default router
