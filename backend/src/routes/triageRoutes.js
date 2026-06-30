import { Router } from 'express'
import { getQueue, addToQueue, updateQueue } from '../controllers/triageController.js'

const router = Router()

router.get('/', getQueue)
router.post('/', addToQueue)
router.patch('/:id', updateQueue)

export default router
