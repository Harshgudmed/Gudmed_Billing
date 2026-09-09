import { Router } from 'express'
import crypto from 'node:crypto'
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

// Counted against the CREDENTIAL, not the address.
//
// Keying on req.ip was the first attempt and it did almost nothing in
// production: behind Render's load balancer the resolved address varies between
// edge nodes, so 150 requests in five seconds drew three refusals instead of
// ninety — nearly every request opened its own bucket.
//
// The credential is the right key anyway. The risk this exists for is a leaked
// key being used to vacuum patient data, and a partner's every request carries
// the same one, so they share a bucket no matter which edge node or address they
// arrive from. Hashed, so a stray secret is not sitting in a Map key; truncated
// because 16 bytes is far more than enough to tell two callers apart.
//
// Requests with no key fall back to the address. They are refused with 401
// before touching the database, so a scattered bucket costs little there.
const keyBy = (req) => {
  const provided = req.headers['x-partner-key']
  if (!provided) return req.ip
  return 'k:' + crypto.createHash('sha256').update(String(provided)).digest('hex').slice(0, 32)
}

router.get(
  '/appointments',
  rateLimit({ limit, windowMs, message: 'Too many requests — slow down', keyBy }),
  getAppointments,
)

export default router
