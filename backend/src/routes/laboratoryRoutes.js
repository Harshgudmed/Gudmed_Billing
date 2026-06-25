import { Router } from 'express'
import { get } from '../controllers/laboratoryController.js'

const router = Router()

router.get('/', get)

export default router
