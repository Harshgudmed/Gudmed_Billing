import Razorpay from 'razorpay'
import crypto from 'crypto'

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

// Create a Razorpay order
export async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  const order = await razorpay.orders.create({
    amount:   Math.round(amount * 100), // Razorpay needs paise
    currency,
    receipt,
    notes,
  })
  return order
}

// Create a payment link (for WhatsApp / SMS sharing)
export async function createPaymentLink({ amount, description, patientName, phone, email, invoiceId }) {
  const link = await razorpay.paymentLink.create({
    amount:      Math.round(amount * 100),
    currency:    'INR',
    description,
    customer: {
      name:    patientName,
      contact: phone   ? phone.replace(/\D/g, '').slice(-10) : undefined,
      email:   email   || undefined,
    },
    notify: { sms: !!phone, email: !!email },
    reminder_enable: true,
    notes: { invoiceId: invoiceId || '' },
    callback_url:    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-success`,
    callback_method: 'get',
  })
  return link
}

// Verify payment signature (called after frontend payment)
export function verifySignature({ orderId, paymentId, signature }) {
  const body      = `${orderId}|${paymentId}`
  const expected  = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex')
  return expected === signature
}

// Authoritative amount/status for a payment — never trust the client's claim.
export async function fetchPayment(paymentId) {
  return razorpay.payments.fetch(paymentId)
}

/**
 * Verify a Razorpay webhook.
 *
 * Two things this used to get wrong:
 *  1. It signed with RAZORPAY_KEY_SECRET. Webhooks are signed with the separate
 *     webhook secret configured in the Razorpay dashboard.
 *  2. It hashed `JSON.stringify(req.body)`. The signature covers the RAW request
 *     bytes; re-serialising a parsed object does not reproduce them.
 *
 * Fails closed: no secret configured → no webhook is ever accepted.
 *
 * @param rawBody   Buffer of the untouched request body
 * @param signature value of the x-razorpay-signature header
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(signature))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export default razorpay
