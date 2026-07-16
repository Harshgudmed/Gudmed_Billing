import { Router } from 'express'
import { getQueue, addToQueue, updateQueue, markPrescriptionUploaded, clearPrescriptionUploaded } from '../controllers/queueController.js'

const router = Router()

router.get('/', getQueue)
router.post('/', addToQueue)
router.patch('/:id', updateQueue)
router.post('/:id/prescription-uploaded', markPrescriptionUploaded)
router.delete('/:id/prescription-uploaded', clearPrescriptionUploaded)

export default router
