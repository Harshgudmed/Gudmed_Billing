import { Router } from 'express'
import { getFloorsOverview, getRoomQueue } from '../controllers/displayController.js'

const router = Router()

router.get('/floors', getFloorsOverview)
router.get('/queue', getRoomQueue)

export default router
