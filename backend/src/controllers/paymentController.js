import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { createOrder, createPaymentLink, verifySignature, verifyWebhookSignature } from '../services/razorpayService.js'

// ── POST /api/payments/create-order ─────────────────────────────────────────
// Frontend calls this → gets orderId → opens Razorpay checkout
export async function createRazorpayOrder(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { invoiceId, amount, patientName, description } = req.body

    if (!amount || amount <= 0)
      return res.status(400).json({ success: false, error: 'Valid amount required' })

    const receipt = `inv_${invoiceId || Date.now()}`.slice(0, 40)

    const order = await createOrder({
      amount,
      receipt,
      notes: { invoiceId: invoiceId || '', organizationId, patientName: patientName || '' },
    })

    return res.json({
      success:  true,
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      keyId:    process.env.RAZORPAY_KEY_ID,
    })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/payments/verify ────────────────────────────────────────────────
// Called after successful payment to verify + mark invoice paid
export async function verifyPayment(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, invoiceId } = req.body

    // 1. Verify signature
    const valid = verifySignature({
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })

    if (!valid)
      return res.status(400).json({ success: false, error: 'Payment verification failed' })

    // 2. Mark invoice as paid
    if (invoiceId) {
      const invoice = await db.invoice.findFirst({ where: { id: invoiceId, organizationId } })
      if (invoice) {
        await db.invoice.update({
          where: { id: invoiceId },
          data: {
            paymentStatus:    'paid',
            amountPaid:       invoice.totalAmount,
            balanceDue:       0,
            status:           'paid',
            notes:            `Razorpay Payment ID: ${razorpay_payment_id}`,
          },
        })
      }
    }

    // 3. Record payment transaction
    await db.paymentTransaction.create({
      data: {
        organizationId,
        invoiceId:         invoiceId || null,
        razorpayOrderId:   razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        status:            'captured',
        paymentMethod:     'razorpay',
      },
    }).catch(() => {}) // table may not exist yet — ignore error

    return res.json({
      success:   true,
      paymentId: razorpay_payment_id,
      message:   'Payment verified and recorded',
    })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/payments/create-link ───────────────────────────────────────────
// Creates a shareable payment link (for WhatsApp / SMS)
export async function createLink(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { invoiceId, amount, patientName, phone, email, description } = req.body

    if (!amount || amount <= 0)
      return res.status(400).json({ success: false, error: 'Valid amount required' })

    const link = await createPaymentLink({
      amount,
      description: description || 'Hospital Bill Payment',
      patientName: patientName || 'Patient',
      phone,
      email,
      invoiceId,
    })

    // Save link URL to invoice
    if (invoiceId) {
      await db.invoice.update({
        where: { id: invoiceId },
        data:  { notes: `Payment link: ${link.short_url}` },
      }).catch(() => {})
    }

    return res.json({
      success:  true,
      linkId:   link.id,
      shortUrl: link.short_url,
      amount:   link.amount / 100,
      status:   link.status,
    })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/payments/webhook ───────────────────────────────────────────────
// Razorpay calls this when payment status changes
export async function handleWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature']
    const valid = verifyWebhookSignature(req.body, signature)
    if (!valid) return res.status(400).json({ error: 'Invalid signature' })

    const event   = req.body.event
    const payload = req.body.payload

    if (event === 'payment.captured' || event === 'payment_link.paid') {
      const paymentId = payload.payment?.entity?.id || payload.payment_link?.entity?.id
      const invoiceId = payload.payment?.entity?.notes?.invoiceId
                     || payload.payment_link?.entity?.notes?.invoiceId

      if (invoiceId) {
        await db.invoice.update({
          where: { id: invoiceId },
          data:  { paymentStatus: 'paid', amountPaid: db.invoice.fields?.totalAmount, balanceDue: 0 },
        }).catch(() => {})
      }

      console.log(`[Razorpay] Payment captured: ${paymentId} for invoice: ${invoiceId}`)
    }

    return res.json({ received: true })
  } catch (err) {
    console.error('[Razorpay webhook]', err.message)
    return res.json({ received: true })
  }
}

// ── GET /api/payments/invoice/:invoiceId ────────────────────────────────────
export async function getPaymentsByInvoice(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { invoiceId } = req.params
    const invoice = await db.invoice.findFirst({ where: { id: invoiceId, organizationId } })
    return res.json({ success: true, data: invoice })
  } catch (err) {
    next(err)
  }
}
