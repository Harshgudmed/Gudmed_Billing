import { Router } from 'express'
import { getAppointments } from '../controllers/partnerController.js'
import { rateLimit } from '../middleware/rateLimit.js'

// Partner integrations — server-to-server, no user session.
//
// Mounted ABOVE `authenticate` in routes/index.js for the same reason the
// Razorpay webhook is: the caller is another system, not a logged-in person,
// and has no cookie to present. It authenticates itself with x-partner-key,
// checked inside the controller.
//
// GET only. The doctor portal reads this feed; nothing here writes.
const router = Router()

// A ceiling on how fast one address can read.
//
// The expected caller is a single backend answering doctors' screens: one
// request per doctor per view, a handful a second at its busiest. 60 a minute
// leaves several times that headroom while capping what a leaked key can pull
// per hour — the difference between a silent export of every doctor's patient
// list and something slow enough to be noticed.
//
// Env-tunable so the ceiling can be raised for a busy partner without a deploy.
// The limiter sits BEFORE the controller, so a flood is turned away without
// touching the database.
const limit = Number(process.env.PARTNER_RATE_LIMIT) || 60
const windowMs = Number(process.env.PARTNER_RATE_WINDOW_MS) || 60_000

router.get(
  '/appointments',
  rateLimit({ limit, windowMs, message: 'Too many requests — slow down' }),
  getAppointments,
)

export default router
