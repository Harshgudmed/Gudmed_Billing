import { Router } from 'express'
import {
  createRazorpayOrder,
  verifyPayment,
  createLink,
  getPaymentsByInvoice,
} from '../controllers/paymentController.js'

const router = Router()

// NOTE: /payments/webhook is deliberately NOT here. Razorpay sends no session, so
// it is mounted ahead of `authenticate` in routes/index.js and verifies itself
// with the webhook signature over the raw body.
router.post('/create-order',       createRazorpayOrder)
router.post('/verify',             verifyPayment)
router.post('/create-link',        createLink)
router.get('/invoice/:invoiceId',  getPaymentsByInvoice)

export default router
