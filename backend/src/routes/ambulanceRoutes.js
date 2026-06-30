import { Router } from 'express'
import { getAll, create, update, remove } from '../controllers/ambulanceController.js'

const router = Router()

router.get('/', getAll)
router.post('/', create)
router.patch('/', update)
router.delete('/', remove)

export default router
