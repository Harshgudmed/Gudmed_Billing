/**
 * WhatsApp message templates.
 * All templates return a plain-text string (wa.me compatible) and are
 * also suitable for WhatsApp Business API text messages.
 *
 * Keep lines short (~60 chars) for good mobile rendering.
 */

import { formatRupee as rupee } from '../lib/money.js'
import { patientFullName } from '../lib/patientName.js'

function fmtDate(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return String(d) }
}

function fmtDateTime(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return String(d) }
}


function divider() { return '─'.repeat(28) }

// ── 1. Consultation summary ────────────────────────────────────────────────

export function consultationSummary(c, org = {}) {
  const orgName = org.name || 'Hospital'
  const patName = patientFullName(c.patient) || 'Patient'
  const rawName = c.doctor?.fullName || ''
  const doctor  = rawName ? (rawName.toLowerCase().startsWith('dr') ? rawName : `Dr. ${rawName}`) : 'Your Doctor'
  const date    = fmtDate(c.visitDate || c.createdAt)

  let items = []
  try {
    // Try prescriptionItems (direct field) first, then prescriptions relation
    if (c.prescriptionItems) {
      const raw = typeof c.prescriptionItems === 'string' ? JSON.parse(c.prescriptionItems) : c.prescriptionItems
      items = Array.isArray(raw) ? raw : []
    } else if (c.prescriptions?.length > 0) {
      items = c.prescriptions.flatMap(rx => {
        try { const p = typeof rx.items === 'string' ? JSON.parse(rx.items) : rx.items; return Array.isArray(p) ? p : [] }
        catch { return [] }
      })
    }
  } catch { items = [] }

  const lines = [
    `*${orgName}*`,
    `Consultation Summary — ${date}`,
    divider(),
    `*Patient:* ${patName} (UHID: ${c.patient?.mrn || '—'})`,
    `*Doctor:* ${doctor}`,
    '',
    `*Chief Complaint:* ${c.chiefComplaint || '—'}`,
    `*Diagnosis:* ${c.diagnosis || '—'}`,
  ]

  if (c.treatmentPlan) lines.push(`*Treatment Plan:* ${c.treatmentPlan}`)
  if (c.followUpInstructions) lines.push(`*Instructions:* ${c.followUpInstructions}`)
  if (c.followUpDate) lines.push(`*Follow-up:* ${fmtDate(c.followUpDate)}`)

  if (items.length > 0) {
    lines.push('', '*Prescription:*')
    items.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.drugName} ${m.dosage || ''} — ${m.frequency || ''} for ${m.duration || ''}`)
    })
  }

  lines.push('', divider(), `_${orgName}${org.phone ? ' · ' + org.phone : ''}_`)
  return lines.join('\n')
}

// ── 2. Prescription with prices ────────────────────────────────────────────

export function prescriptionWithPrices(patientName, items = [], consultationFee = 0, org = {}) {
  const orgName = org.name || 'Hospital'
  const medTotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.quantity || 1), 0)
  const grandTotal = medTotal + (consultationFee || 0)

  const lines = [
    `*${orgName} — Prescription & Bill*`,
    divider(),
    `*Patient:* ${patientName}`,
    '',
    '*Medicines:*',
  ]

  items.forEach((m, i) => {
    const subtotal = (m.unitPrice || 0) * (m.quantity || 1)
    lines.push(`${i + 1}. ${m.drugName} ${m.strength || ''}\n   Qty: ${m.quantity} × ${rupee(m.unitPrice)} = *${rupee(subtotal)}*`)
  })

  if (consultationFee > 0) {
    lines.push('', `Consultation Fee: ${rupee(consultationFee)}`)
  }

  lines.push(
    '',
    divider(),
    `*Total Amount: ${rupee(grandTotal)}*`,
    '',
    '💊 Reply *YES* to purchase medicines at counter',
    '   or visit our pharmacy.',
    '',
    `_${orgName}${org.phone ? ' · ' + org.phone : ''}_`,
  )
  return lines.join('\n')
}

// ── 3. Payment receipt ────────────────────────────────────────────────────

export function paymentReceipt(invoice, patientName, org = {}) {
  const orgName = org.name || 'Hospital'
  const lines = [
    `*${orgName}*`,
    `Payment Receipt`,
    divider(),
    `*Receipt #:* ${invoice.invoiceNumber || invoice.id}`,
    `*Patient:* ${patientName}`,
    `*Amount Paid:* ${rupee(invoice.amountPaid || invoice.totalAmount)}`,
    `*Payment Mode:* ${invoice.paymentMethod || '—'}`,
    `*Date:* ${fmtDate(invoice.paidAt || invoice.createdAt)}`,
    '',
    `*Status:* ${invoice.paymentStatus === 'paid' ? '✅ Paid' : invoice.paymentStatus}`,
    '',
    divider(),
    `Thank you for visiting ${orgName}!`,
    `_${org.phone ? org.phone : ''}_`,
  ]
  return lines.join('\n')
}

// ── 4. Lab result ready ───────────────────────────────────────────────────

export function labResultReady(order, results = [], org = {}) {
  const orgName  = org.name || 'Hospital'
  const patName  = order.patient
    ? patientFullName(order.patient)
    : 'Patient'
  const hasCritical = results.some(r => r.isCritical)

  const lines = [
    `*${orgName} — Lab Results Ready*`,
    divider(),
    `*Patient:* ${patName} (UHID: ${order.patient?.mrn || '—'})`,
    `*Order #:* ${order.orderNumber || order.id}`,
    `*Date:* ${fmtDate(order.createdAt)}`,
    '',
    '*Results:*',
  ]

  results.forEach(r => {
    const flag = r.isCritical ? ' ⚠️ CRITICAL' : r.isAbnormal ? ' ⚡ Abnormal' : ' ✅'
    lines.push(`• ${r.test?.testName || r.testName || '—'}: *${r.resultValue || '—'}* ${r.unit || ''}${flag}`)
  })

  if (hasCritical) {
    lines.push('', '⚠️ *CRITICAL values detected. Please consult your doctor immediately.*')
  }

  lines.push(
    '',
    `Please collect your detailed report from ${orgName}.`,
    divider(),
    `_${orgName}${org.phone ? ' · ' + org.phone : ''}_`,
  )
  return lines.join('\n')
}

// ── 5. Radiology report ready ─────────────────────────────────────────────

export function radiologyReportReady(order, report, org = {}) {
  const orgName = org.name || 'Hospital'
  const patName = order.patient
    ? patientFullName(order.patient)
    : 'Patient'

  const lines = [
    `*${orgName} — Radiology Report Ready*`,
    divider(),
    `*Patient:* ${patName}`,
    `*Exam:* ${order.exam?.examName || order.examName || '—'}`,
    `*Order #:* ${order.orderNumber || order.id}`,
    `*Date:* ${fmtDate(order.createdAt)}`,
    '',
    `*Status:* ✅ Report Finalised`,
  ]

  if (report?.hasCriticalFindings) {
    lines.push('', '⚠️ *Critical findings present. Please consult your doctor immediately.*')
    if (report.criticalFindingsDetail) {
      lines.push(`_${report.criticalFindingsDetail}_`)
    }
  }

  if (report?.impression) {
    lines.push('', `*Impression:* ${report.impression}`)
  }

  lines.push(
    '',
    `Please collect your report from ${orgName}.`,
    divider(),
    `_${orgName}${org.phone ? ' · ' + org.phone : ''}_`,
  )
  return lines.join('\n')
}

// ── 6. Appointment reminder ───────────────────────────────────────────────

export function appointmentReminder(apt, org = {}) {
  const orgName  = org.name || 'Hospital'
  const patName  = apt.patient
    ? patientFullName(apt.patient)
    : 'Patient'
  const drName   = apt.doctor?.fullName || ''
  const doctor   = drName ? (drName.toLowerCase().startsWith('dr') ? drName : `Dr. ${drName}`) : 'your doctor'
  const dateStr  = fmtDate(apt.appointmentDate)

  const lines = [
    `*${orgName} — Appointment Reminder*`,
    divider(),
    `Dear ${patName},`,
    '',
    `Your appointment with *${doctor}* is confirmed.`,
    '',
    `📅 *Date:* ${dateStr}`,
    `⏰ *Time:* ${apt.appointmentTime || '—'}`,
    '',
    'Please arrive 10 minutes early.',
    'Bring any previous reports or prescriptions.',
    '',
    `To reschedule, contact us at ${org.phone || orgName}.`,
    divider(),
    `_${orgName}_`,
  ]
  return lines.join('\n')
}

// ── 7. Pharmacy team notification ─────────────────────────────────────────

export function pharmacyTeamNotification(prescription, patientName, org = {}) {
  const orgName = org.name || 'Hospital'
  let items = []
  try {
    const raw = typeof prescription.items === 'string'
      ? JSON.parse(prescription.items) : (prescription.items || [])
    items = Array.isArray(raw) ? raw : []
  } catch { items = [] }

  const lines = [
    `*${orgName} — New Prescription*`,
    divider(),
    `*Patient:* ${patientName}`,
    `*Prescription ID:* ${prescription.id?.slice(-8).toUpperCase() || '—'}`,
    `*Time:* ${fmtDateTime(new Date())}`,
    '',
    '*Items to dispense:*',
  ]

  items.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.drugName} ${m.strength || ''} — Qty: ${m.quantity}${m.dosage ? ' (' + m.dosage + ')' : ''}`)
  })

  lines.push('', '📋 Please prepare the above medicines.')
  return lines.join('\n')
}
