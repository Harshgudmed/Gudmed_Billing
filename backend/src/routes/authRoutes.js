import { Router } from 'express'
import { login, patientLogin, logout, me } from '../controllers/authController.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

router.post('/login', login)
router.post('/patient-login', patientLogin)
router.post('/logout', logout)
router.get('/me', authenticate, me)

export default router
