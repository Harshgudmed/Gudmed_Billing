import { Router } from 'express'
import {
  createRazorpayOrder,
  verifyPayment,
  createLink,
  handleWebhook,
  getPaymentsByInvoice,
} from '../controllers/paymentController.js'

const router = Router()

router.post('/create-order',       createRazorpayOrder)
router.post('/verify',             verifyPayment)
router.post('/create-link',        createLink)
router.post('/webhook',            handleWebhook)   // Razorpay calls this
router.get('/invoice/:invoiceId',  getPaymentsByInvoice)

export default router
