import { db } from '../config/db.js'
import whatsapp from '../services/whatsappService.js'
import { getSession, setSession, clearSession } from '../services/botStateService.js'
import { formatRupee as rupee } from '../lib/money.js'

const ORG_ID = process.env.ORGANIZATION_ID || 'org-demo' // used in non-req helpers (bot callbacks)

function normalisePhone(raw) {
  return String(raw || '').replace(/\D/g, '')
}

// ── Incoming webhook from Twilio ─────────────────────────────────────────────
export async function handleIncoming(req, res) {
  res.sendStatus(200) // always reply 200 to Twilio immediately

  const raw   = req.body?.From || ''
  const body  = (req.body?.Body || '').trim()
  const phone = normalisePhone(raw)

  if (!phone) return

  const session = getSession(phone)
  if (!session) return // no active conversation

  const reply = body.toUpperCase().trim()

  try {
    if (session.state === 'AWAITING_PHARMACY') {
      await handlePharmacyReply(phone, reply, session)
    } else if (session.state === 'AWAITING_PAYMENT') {
      await handlePaymentChoice(phone, reply, session)
    } else if (session.state === 'AWAITING_UPI_REF') {
      await handleUpiRef(phone, body, session)
    } else if (session.state === 'AWAITING_CASH_CONFIRM') {
      await handleCashConfirm(phone, reply, session)
    } else if (session.state === 'AWAITING_CARD_CONFIRM') {
      await handleCardConfirm(phone, reply, session)
    }
  } catch (err) {
    console.error('[WhatsApp Bot] error:', err.message)
  }
}

// ── State handlers ───────────────────────────────────────────────────────────

async function handlePharmacyReply(phone, reply, session) {
  if (['YES', 'Y', '1', 'HAAN', 'HA'].includes(reply)) {
    setSession(phone, { state: 'AWAITING_PAYMENT' })
    await whatsapp.sendMessage(phone, paymentOptionsMsg(session))
  } else if (['NO', 'N', '2', 'NAHI', 'NAI'].includes(reply)) {
    clearSession(phone)
    await whatsapp.sendMessage(phone,
      `No problem! 🙏\nYour prescription is saved with us.\nVisit our pharmacy anytime to collect your medicines.\n\n_Thank you for choosing us!_`)
  } else {
    await whatsapp.sendMessage(phone,
      `Please reply *YES* to purchase medicines or *NO* to skip.`)
  }
}

async function handlePaymentChoice(phone, reply, session) {
  if (reply === '1' || reply.includes('UPI')) {
    setSession(phone, { state: 'AWAITING_UPI_REF', paymentMethod: 'UPI' })
    const org = await getOrg()
    const upiId = org.settings?.upiId || 'hospital@upi'
    await whatsapp.sendMessage(phone,
      `*UPI Payment*\n\nAmount: *${rupee(session.total)}*\n\nPay to UPI ID:\n*${upiId}*\n\nAfter payment, reply with your *UPI reference/transaction number* and we will confirm your order.`)

  } else if (reply === '2' || reply.includes('CASH')) {
    setSession(phone, { state: 'AWAITING_CASH_CONFIRM', paymentMethod: 'Cash' })
    await whatsapp.sendMessage(phone,
      `*Cash Payment*\n\nAmount: *${rupee(session.total)}*\n\nPlease visit our pharmacy counter with this amount.\n\nReply *DONE* once you have paid at the counter.`)

  } else if (reply === '3' || reply.includes('CARD')) {
    setSession(phone, { state: 'AWAITING_CARD_CONFIRM', paymentMethod: 'Card' })
    await whatsapp.sendMessage(phone,
      `*Card Payment*\n\nAmount: *${rupee(session.total)}*\n\nPlease visit our pharmacy counter for card payment.\n\nReply *DONE* once you have paid at the counter.`)

  } else {
    await whatsapp.sendMessage(phone,
      `Please reply:\n*1* for UPI\n*2* for Cash\n*3* for Card`)
  }
}

async function handleUpiRef(phone, ref, session) {
  const invoice = await createSaleAndInvoice(session, 'UPI', ref)
  clearSession(phone)
  await whatsapp.sendMessage(phone, receiptMsg(session, invoice, 'UPI', ref))
}

async function handleCashConfirm(phone, reply, session) {
  if (['DONE', 'YES', 'Y', '1', 'PAID', 'OK'].includes(reply)) {
    const invoice = await createSaleAndInvoice(session, 'Cash', 'Cash at counter')
    clearSession(phone)
    await whatsapp.sendMessage(phone, receiptMsg(session, invoice, 'Cash', 'Paid at counter'))
  } else {
    await whatsapp.sendMessage(phone,
      `Please visit our pharmacy counter and pay *${rupee(session.total)}* in cash.\nReply *DONE* after payment.`)
  }
}

async function handleCardConfirm(phone, reply, session) {
  if (['DONE', 'YES', 'Y', '1', 'PAID', 'OK'].includes(reply)) {
    const invoice = await createSaleAndInvoice(session, 'Card', 'Card at counter')
    clearSession(phone)
    await whatsapp.sendMessage(phone, receiptMsg(session, invoice, 'Card', 'Paid at counter'))
  } else {
    await whatsapp.sendMessage(phone,
      `Please visit our pharmacy counter and pay *${rupee(session.total)}* by card.\nReply *DONE* after payment.`)
  }
}

// ── Message templates ────────────────────────────────────────────────────────

function paymentOptionsMsg(session) {
  const lines = [
    `✅ *Great! Let's process your order.*`,
    ``,
    `*Medicines:*`,
  ]
  session.items.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.drugName} x${m.quantity} — ${rupee((m.unitPrice || 0) * m.quantity)}`)
  })
  lines.push(``, `*Total: ${rupee(session.total)}*`, ``)
  lines.push(`*Choose payment method:*`)
  lines.push(`*1* — UPI (Google Pay, PhonePe, Paytm)`)
  lines.push(`*2* — Cash at counter`)
  lines.push(`*3* — Card at counter`)
  lines.push(``, `Reply with *1*, *2*, or *3*`)
  return lines.join('\n')
}

function receiptMsg(session, invoice, method, ref) {
  const invNo = invoice?.invoiceNumber || invoice?.id?.slice(-8).toUpperCase() || 'N/A'
  const lines = [
    `✅ *Payment Confirmed!*`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `*Receipt #:* ${invNo}`,
    `*Patient:* ${session.patientName}`,
    ``,
    `*Medicines Purchased:*`,
  ]
  session.items.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.drugName} x${m.quantity} — ${rupee((m.unitPrice || 0) * m.quantity)}`)
  })
  lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━━`)
  lines.push(`*Total Paid: ${rupee(session.total)}*`)
  lines.push(`*Payment Mode:* ${method}`)
  if (ref && ref !== 'Cash at counter' && ref !== 'Paid at counter' && ref !== 'Card at counter') {
    lines.push(`*Reference:* ${ref}`)
  }
  lines.push(``, `Thank you for choosing us! 🙏`, `_Your medicines will be ready for pickup._`)
  return lines.join('\n')
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function createSaleAndInvoice(session, paymentMethod, reference) {
  const ts = Date.now()
  try {
    // Create pharmacy sale
    const saleItems = session.items.map(m => ({
      drugId:      m.drugId || null,
      drugName:    m.drugName,
      quantity:    m.quantity,
      unitPrice:   m.unitPrice || 0,
      total:       (m.unitPrice || 0) * m.quantity,
    }))
    const subtotal = saleItems.reduce((s, it) => s + it.total, 0)

    await db.pharmacySale.create({
      data: {
        organizationId: ORG_ID,
        patientId:      session.patientId || null,
        prescriptionId: session.prescriptionId || null,
        servedById:     null,
        saleType:       'prescription',
        items:          JSON.stringify(saleItems),
        subtotal,
        totalAmount:    session.total,
        paymentStatus:  'paid',
        paymentMethod,
        amountPaid:     session.total,
        amountDue:      0,
        receiptNumber:  `RCP-${ts}`,
      },
    })

    // Create invoice (only patients with a real patientId — patientId is required)
    let invoice = { invoiceNumber: `INV-${ts}` }
    if (session.patientId) {
      invoice = await db.invoice.create({
        data: {
          organizationId: ORG_ID,
          patientId:      session.patientId,
          consultationId: session.consultationId || null,
          invoiceNumber:  `INV-${ts}`,
          items:          JSON.stringify(saleItems),
          subtotal,
          totalAmount:    session.total,
          paymentStatus:  'paid',
          amountPaid:     session.total,
          balanceDue:     0,
          status:         'paid',
          notes:          `WhatsApp ${paymentMethod} payment — ref: ${reference}`,
        },
      })
    }

    return invoice
  } catch (err) {
    console.error('[Bot] createSaleAndInvoice error:', err.message)
    return { invoiceNumber: `INV-${ts}` }
  }
}

async function getOrg() {
  try {
    const org = await db.organization.findUnique({ where: { id: ORG_ID } })
    if (!org) return {}
    const settings = typeof org.settings === 'string'
      ? (() => { try { return JSON.parse(org.settings) } catch { return {} } })()
      : (org.settings || {})
    return { ...org, settings }
  } catch { return {} }
}

// ── Start bot session (called after prescription is sent) ────────────────────
export async function startPharmacySession(phone, { prescriptionId, consultationId, patientId, patientName, items, total }) {
  setSession(phone, {
    state: 'AWAITING_PHARMACY',
    prescriptionId,
    consultationId,
    patientId,
    patientName,
    items,
    total,
  })
}
