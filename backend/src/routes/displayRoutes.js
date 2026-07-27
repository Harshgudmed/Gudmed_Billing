import { Router } from 'express'
import { getFloorsOverview, getRoomQueue, getFloorQueue, getScreenQueue } from '../controllers/displayController.js'

const router = Router()

router.get('/floors', getFloorsOverview)
router.get('/queue', getRoomQueue)
router.get('/floor-queue', getFloorQueue)
router.get('/screen-queue', getScreenQueue)

export default router
