import { Router } from 'express'
import { getAll, create, update, remove } from '../controllers/consultationController.js'
import { validate } from '../middleware/validate.js'
import { createConsultationSchema, updateConsultationSchema } from '../validations/consultation.validation.js'

const router = Router()

router.get('/', getAll)
router.post('/', validate(createConsultationSchema), create)
router.patch('/:id', validate(updateConsultationSchema), update)
router.delete('/:id', remove)

export default router
