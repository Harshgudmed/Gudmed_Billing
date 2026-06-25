/**
 * In-memory conversation state store.
 * Keyed by phone number (digits only, no + or whatsapp: prefix).
 *
 * Session shape:
 * {
 *   state: 'AWAITING_PHARMACY' | 'AWAITING_PAYMENT' | 'AWAITING_UPI_REF' | 'AWAITING_CASH_CONFIRM' | 'AWAITING_CARD_CONFIRM'
 *   prescriptionId, consultationId, patientId, patientName,
 *   items: [{ drugName, quantity, unitPrice }],
 *   total: number,
 *   paymentMethod: 'UPI' | 'Cash' | 'Card'
 * }
 */

const sessions = new Map()

export function getSession(phone) {
  return sessions.get(normalise(phone)) || null
}

export function setSession(phone, data) {
  const key = normalise(phone)
  sessions.set(key, { ...(sessions.get(key) || {}), ...data })
}

export function clearSession(phone) {
  sessions.delete(normalise(phone))
}

function normalise(phone) {
  return String(phone).replace(/\D/g, '')
}
