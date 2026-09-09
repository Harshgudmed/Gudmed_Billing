import { Router } from 'express'
import { listPreRegistrations, deletePreRegistration } from '../controllers/preRegistrationController.js'

// Reception-facing (authenticated) half of self-service pre-registration. The
// PUBLIC half — the patient's own submission and the hospital-branding lookup —
// is mounted separately in routes/index.js, ABOVE the authenticate middleware,
// because a walk-up patient scanning the QR has no login.
const router = Router()

router.get('/', listPreRegistrations)
router.delete('/:id', deletePreRegistration)

export default router
