import { Router } from 'express'
import {
  getAll,
  getOne,
  create,
  update,
  convertToPatient,
} from '../controllers/preTriageController.js'
import { validate } from '../middleware/validate.js'
import { createPreTriageSchema } from '../validations/preTriage.validation.js'

const router = Router()

router.get('/', getAll)
router.get('/:id', getOne)
router.post('/', validate(createPreTriageSchema), create)
router.patch('/:id', update)
router.post('/:id/convert', convertToPatient)

export default router
