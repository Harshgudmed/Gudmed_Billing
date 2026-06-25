import { Router } from 'express'
import { getAll, getOne, getStats, create, update, remove, reschedule, bulkUpdateStatus } from '../controllers/appointmentController.js'
import { validate } from '../middleware/validate.js'
import { createAppointmentSchema } from '../validations/appointment.validation.js'

const router = Router()

router.get('/', getAll)
router.get('/stats', getStats)   // must be before '/:id' so "stats" isn't read as an id
router.get('/:id', getOne)
router.post('/', validate(createAppointmentSchema), create)
router.post('/:id/reschedule', reschedule)
router.patch('/bulk/status', bulkUpdateStatus)   // before '/:id' so "bulk" isn't an id
router.patch('/:id', update)
router.delete('/:id', remove)

export default router
