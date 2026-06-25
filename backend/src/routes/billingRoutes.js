import { Router } from 'express'
import { getAll, create, update } from '../controllers/billingController.js'

const router = Router()

router.get('/', getAll)
router.post('/', create)
router.patch('/', update)

export default router
