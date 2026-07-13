import { Router } from 'express'
import { importData, stockRefresh } from '../controllers/importController.js'

const router = Router()
router.post('/', importData)
// Bulk stock top-up, run server-side (the prod DB takes no external connections).
router.post('/stock-refresh', stockRefresh)
export default router
