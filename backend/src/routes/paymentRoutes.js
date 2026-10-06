import { Router } from 'express'
import {
  createRazorpayOrder,
  verifyPayment,
  createLink,
  getPaymentsByInvoice,
} from '../controllers/paymentController.js'

import { billingAllows, BILLING_REFUSED } from '../lib/billingAccess.js'

const router = Router()

// Taking money online is the counter's job, as it is in Billing itself: the
// Finance Controller approves refunds and never collects.
const collects = (req, res, next) => (billingAllows(req, 'raise')
  ? next()
  : res.status(403).json({ success: false, error: BILLING_REFUSED.raise, code: 'FORBIDDEN' }))

// NOTE: /payments/webhook is deliberately NOT here. Razorpay sends no session, so
// it is mounted ahead of `authenticate` in routes/index.js and verifies itself
// with the webhook signature over the raw body.
router.post('/create-order',       collects, createRazorpayOrder)
router.post('/verify',             collects, verifyPayment)
router.post('/create-link',        collects, createLink)
router.get('/invoice/:invoiceId',  getPaymentsByInvoice)

export default router
