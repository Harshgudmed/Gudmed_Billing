import { Router } from 'express'
import { get } from '../controllers/radiologyController.js'

const router = Router()

router.get('/', get)

export default router
