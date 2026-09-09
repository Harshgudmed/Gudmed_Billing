import { Router } from 'express'
import { getAppointments } from '../controllers/partnerController.js'

// Partner integrations — server-to-server, no user session.
//
// Mounted ABOVE `authenticate` in routes/index.js for the same reason the
// Razorpay webhook is: the caller is another system, not a logged-in person,
// and has no cookie to present. It authenticates itself with x-partner-key,
// checked inside the controller.
//
// GET only. The doctor portal reads this feed; nothing here writes.
const router = Router()
router.get('/appointments', getAppointments)
export default router
