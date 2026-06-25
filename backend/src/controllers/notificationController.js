import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import whatsapp from '../services/whatsappService.js'
import * as tpl from '../services/messageTemplates.js'
import { startPharmacySession } from './whatsappBotController.js'

async function getOrg(orgId) {
  const ORG_ID = orgId || process.env.ORGANIZATION_ID || 'org-demo'
  try {
    const org = await db.organization.findUnique({ where: { id: ORG_ID } })
    if (!org) return { name: 'Hospital', phone: '', email: '' }
    const settings = typeof org.settings === 'string'
      ? (() => { try { return JSON.parse(org.settings) } catch { return {} } })()
      : (org.settings || {})
    return { ...org, settings }
  } catch { return { name: 'Hospital', phone: '', email: '' } }
}

// ── POST /api/notifications/consultation ────────────────────────────────────
// Body: { consultationId }
export async function sendConsultationNotification(req, res) {
  try {
    const { consultationId } = req.body
    if (!consultationId) return res.status(400).json({ success: false, error: 'consultationId required' })

    const [consultation, org] = await Promise.all([
      db.consultation.findUnique({
        where: { id: consultationId },
        include: {
          patient:       { select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true } },
          doctor:        { select: { id: true, fullName: true } },
          prescriptions: { select: { id: true, items: true } },
        },
      }),
      getOrg(req.organizationId),
    ])

    if (!consultation) return res.status(404).json({ success: false, error: 'Consultation not found' })

    const message = tpl.consultationSummary(consultation, org)
    const phone   = consultation.patient?.phonePrimary
    const result  = await whatsapp.sendMessage(phone, message)

    return res.json({ success: true, ...result, message })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /api/notifications/prescription ────────────────────────────────────
// Body: { prescriptionId, consultationFee?, includeReceipt?, invoiceId? }
export async function sendPrescriptionNotification(req, res) {
  try {
    const { prescriptionId, consultationFee = 0, invoiceId } = req.body
    if (!prescriptionId) return res.status(400).json({ success: false, error: 'prescriptionId required' })

    const reqOrgId = getOrgId(req)
    const [prescription, org] = await Promise.all([
      db.prescription.findUnique({
        where: { id: prescriptionId },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true } },
        },
      }),
      getOrg(reqOrgId),
    ])

    if (!prescription) return res.status(404).json({ success: false, error: 'Prescription not found' })

    let items = []
    try {
      const raw = typeof prescription.items === 'string' ? JSON.parse(prescription.items) : (prescription.items || [])
      items = Array.isArray(raw) ? raw : []
    } catch { items = [] }

    // Enrich items with drug prices from pharmacy catalog
    const enriched = await Promise.all(items.map(async (item) => {
      if (item.unitPrice) return item
      const drug = await db.pharmacyDrug.findFirst({
        where: { organizationId: reqOrgId, drugName: { contains: item.drugName, mode: 'insensitive' } },
        select: { sellingPrice: true },
      })
      return { ...item, unitPrice: drug?.sellingPrice || 0 }
    }))

    // If an invoice was provided, send receipt instead
    if (invoiceId) {
      const invoice = await db.invoice.findUnique({ where: { id: invoiceId } })
      const patName = [prescription.patient?.firstName, prescription.patient?.lastName].filter(Boolean).join(' ')
      const message = tpl.paymentReceipt(invoice || {}, patName, org)
      const result  = await whatsapp.sendMessage(prescription.patient?.phonePrimary, message)
      return res.json({ success: true, ...result, message })
    }

    const patName = [prescription.patient?.firstName, prescription.patient?.lastName].filter(Boolean).join(' ')
    const message = tpl.prescriptionWithPrices(patName, enriched, consultationFee, org)
    const phone   = prescription.patient?.phonePrimary
    const result  = await whatsapp.sendMessage(phone, message)

    // Send pharmacy purchase prompt and start bot session
    const total = enriched.reduce((s, m) => s + (m.unitPrice || 0) * (m.quantity || 1), 0) + (consultationFee || 0)
    setTimeout(async () => {
      await whatsapp.sendMessage(phone,
        `💊 *Would you like to purchase these medicines from our pharmacy?*\n\nReply *YES* to order now\nReply *NO* to skip`)
      await startPharmacySession(phone, {
        prescriptionId:  prescription.id,
        consultationId:  prescription.consultationId,
        patientId:       prescription.patient?.id,
        patientName:     patName,
        items:           enriched,
        total,
      })
    }, 2000)

    return res.json({ success: true, ...result, message, enrichedItems: enriched })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /api/notifications/lab-result ──────────────────────────────────────
// Body: { orderId }
export async function sendLabResultNotification(req, res) {
  try {
    const { orderId } = req.body
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' })

    const [order, org] = await Promise.all([
      db.labOrder.findUnique({
        where: { id: orderId },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true } },
          results: { include: { test: { select: { testName: true, unit: true, normalRange: true } } } },
        },
      }),
      getOrg(req.organizationId),
    ])

    if (!order) return res.status(404).json({ success: false, error: 'Lab order not found' })

    const message = tpl.labResultReady(order, order.results || [], org)
    const result  = await whatsapp.sendMessage(order.patient?.phonePrimary, message)

    return res.json({ success: true, ...result, message })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /api/notifications/radiology-report ────────────────────────────────
// Body: { orderId }
export async function sendRadiologyNotification(req, res) {
  try {
    const { orderId } = req.body
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' })

    const [order, org] = await Promise.all([
      db.radiologyOrder.findUnique({
        where: { id: orderId },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true } },
          exam:   { select: { examName: true, examCategory: true } },
          report: true,
        },
      }),
      getOrg(req.organizationId),
    ])

    if (!order) return res.status(404).json({ success: false, error: 'Radiology order not found' })

    const message = tpl.radiologyReportReady(order, order.report, org)
    const result  = await whatsapp.sendMessage(order.patient?.phonePrimary, message)

    return res.json({ success: true, ...result, message })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /api/notifications/pharmacy-team ───────────────────────────────────
// Body: { prescriptionId }
// Sends notification to the configured pharmacy team WhatsApp number
export async function notifyPharmacyTeam(req, res) {
  try {
    const { prescriptionId } = req.body
    const teamPhone = process.env.WHATSAPP_PHARMACY_TEAM_PHONE

    if (!prescriptionId) return res.status(400).json({ success: false, error: 'prescriptionId required' })

    const [prescription, org] = await Promise.all([
      db.prescription.findUnique({
        where: { id: prescriptionId },
        include: {
          patient: { select: { firstName: true, lastName: true, mrn: true } },
        },
      }),
      getOrg(req.organizationId),
    ])

    if (!prescription) return res.status(404).json({ success: false, error: 'Prescription not found' })

    const patName = [prescription.patient?.firstName, prescription.patient?.lastName].filter(Boolean).join(' ')
    const message = tpl.pharmacyTeamNotification(prescription, patName, org)

    // If no team phone configured, return the message text so frontend can open wa.me manually
    if (!teamPhone) {
      return res.json({ success: true, type: 'no_team_phone', message, note: 'Set WHATSAPP_PHARMACY_TEAM_PHONE in .env to auto-send' })
    }

    const result = await whatsapp.sendMessage(teamPhone, message)
    return res.json({ success: true, ...result, message })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

// ── POST /api/whatsapp/webhook ───────────────────────────────────────────────
// Placeholder for future two-way WhatsApp bot
export async function whatsappWebhook(req, res) {
  // Verify webhook (Meta/WATI signature check goes here in production)
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN || 'gudmed_verify')) {
    return res.status(200).send(challenge)
  }

  // Log incoming messages for future bot implementation
  if (req.body?.entry) {
    console.log('[WhatsApp Webhook]', JSON.stringify(req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || {}))
  }

  return res.sendStatus(200)
}
