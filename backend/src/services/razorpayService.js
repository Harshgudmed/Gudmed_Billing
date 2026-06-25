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

// Verify payment link signature (webhook)
export function verifyWebhookSignature(body, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(JSON.stringify(body))
    .digest('hex')
  return expected === signature
}

export default razorpay
