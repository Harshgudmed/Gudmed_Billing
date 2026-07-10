import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { recalcInvoice } from '../lib/invoiceLedger.js'
import {
  createOrder,
  createPaymentLink,
  verifySignature,
  verifyWebhookSignature,
  fetchPayment,
} from '../services/razorpayService.js'

/**
 * Record a captured gateway payment as a real Payment row, then let the ledger
 * recompute the invoice.
 *
 * This used to write `invoice.amountPaid = invoice.totalAmount` directly and never
 * created a Payment row, which broke two things:
 *   - a partial online payment marked the whole invoice paid;
 *   - Invoice.amountPaid is derived from Payment rows (see lib/invoiceLedger.js),
 *     so the next recalc wiped the online payment back to zero.
 *
 * Idempotent on the Razorpay payment id: /verify and the webhook both land here
 * for the same payment, and Razorpay retries webhooks.
 */
async function recordCapturedPayment({ invoiceId, amountPaise, razorpayPaymentId, note }) {
  const idempotencyKey = `rzp_${razorpayPaymentId}`
  const amount = Math.round(amountPaise) / 100

  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, organizationId: true, patientId: true },
    })
    if (!invoice) return { skipped: 'invoice-not-found' }

    const existing = await tx.payment.findFirst({
      where: { organizationId: invoice.organizationId, idempotencyKey },
    })
    if (existing) return { payment: existing, deduped: true }

    const receiptNumber = await nextSeriesNumber(tx, invoice.organizationId, 'OPD_RCP', 'RCP')
    const payment = await tx.payment.create({
      data: {
        organizationId: invoice.organizationId,
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        amount,
        paymentMethod: 'razorpay',
        paymentReference: razorpayPaymentId,
        receiptNumber,
        idempotencyKey,
        notes: note || null,
        paymentDate: new Date(),
        isRefund: false,
      },
    })

    const totals = await recalcInvoice(tx, invoice.id)

    await tx.auditLog.create({
      data: {
        organizationId: invoice.organizationId,
        action: 'PAYMENT_RECORDED',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: JSON.stringify({ source: 'razorpay', razorpayPaymentId, amount, receiptNumber }),
        performedAt: new Date(),
      },
    })

    return { payment, totals }
  })
}

// ── POST /api/payments/create-order ─────────────────────────────────────────
// Frontend calls this → gets orderId → opens Razorpay checkout
export async function createRazorpayOrder(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { invoiceId, amount, patientName } = req.body

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
// Called after a successful checkout to verify the signature and bank the money.
export async function verifyPayment(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, invoiceId } = req.body

    const valid = verifySignature({
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })
    if (!valid)
      return res.status(400).json({ success: false, error: 'Payment verification failed' })

    // Ask Razorpay what was actually captured. The client's `amount` is not trusted.
    const captured = await fetchPayment(razorpay_payment_id)
    if (captured.status !== 'captured')
      return res.status(400).json({ success: false, error: `Payment is ${captured.status}, not captured` })

    if (!invoiceId)
      return res.json({ success: true, paymentId: razorpay_payment_id, message: 'Payment verified (no invoice linked)' })

    // Tenant guard — the invoice must belong to the caller's hospital.
    const owned = await db.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: { id: true } })
    if (!owned) return res.status(404).json({ success: false, error: 'Invoice not found' })

    const result = await recordCapturedPayment({
      invoiceId,
      amountPaise: captured.amount,
      razorpayPaymentId: razorpay_payment_id,
      note: `Razorpay order ${razorpay_order_id}`,
    })

    return res.json({
      success:   true,
      paymentId: razorpay_payment_id,
      deduped:   !!result.deduped,
      data:      result.payment,
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

    if (invoiceId) {
      const owned = await db.invoice.findFirst({ where: { id: invoiceId, organizationId }, select: { id: true } })
      if (!owned) return res.status(404).json({ success: false, error: 'Invoice not found' })
    }

    const link = await createPaymentLink({
      amount,
      description: description || 'Hospital Bill Payment',
      patientName: patientName || 'Patient',
      phone,
      email,
      invoiceId,
    })

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
// Razorpay calls this server-to-server. It carries no session, so the route is
// mounted BEFORE `authenticate` (see routes/index.js) and authenticates itself
// with the webhook signature over the RAW body.
export async function handleWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature']
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(400).json({ error: 'Invalid signature' })
    }

    const event = JSON.parse(req.body.toString('utf8'))
    const entity = event.payload?.payment?.entity

    if ((event.event === 'payment.captured' || event.event === 'payment_link.paid') && entity) {
      const invoiceId =
        entity.notes?.invoiceId || event.payload?.payment_link?.entity?.notes?.invoiceId

      if (invoiceId) {
        // The org is taken from the invoice — a webhook has no caller identity.
        const result = await recordCapturedPayment({
          invoiceId,
          amountPaise: entity.amount,
          razorpayPaymentId: entity.id,
          note: `Razorpay webhook ${event.event}`,
        })
        console.log(`[Razorpay] ${event.event} ${entity.id} → invoice ${invoiceId}`,
          result.deduped ? '(already recorded)' : '(recorded)')
      }
    }

    // Always 200 once the signature checks out, so Razorpay stops retrying.
    return res.json({ received: true })
  } catch (err) {
    console.error('[Razorpay webhook]', err.message)
    return res.json({ received: true })
  }
}

// ── GET /api/payments/invoice/:invoiceId ────────────────────────────────────
// Returns the invoice together with its payment ledger.
export async function getPaymentsByInvoice(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { invoiceId } = req.params
    const invoice = await db.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { payments: { orderBy: { paymentDate: 'asc' } } },
    })
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' })
    return res.json({ success: true, data: invoice, payments: invoice.payments })
  } catch (err) {
    next(err)
  }
}
