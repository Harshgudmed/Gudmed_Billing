import { Router } from 'express'
import { getSpecialties, getConditions, getCondition } from '../controllers/clinicalKbController.js'

const router = Router()

router.get('/specialties', getSpecialties)
router.get('/condition', getCondition)
router.get('/', getConditions)

export default router
