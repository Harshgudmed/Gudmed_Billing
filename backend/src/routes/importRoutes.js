import { Router } from 'express'
import { importData } from '../controllers/importController.js'

const router = Router()
router.post('/', importData)
export default router
