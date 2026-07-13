import { Router } from 'express'
import { getQueue, addToQueue, updateQueue } from '../controllers/queueController.js'

const router = Router()

router.get('/', getQueue)
router.post('/', addToQueue)
router.patch('/:id', updateQueue)

export default router
