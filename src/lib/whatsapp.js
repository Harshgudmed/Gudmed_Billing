/**
 * Frontend WhatsApp helper.
 *
 * All notification calls go through the backend `/api/notifications/*`
 * endpoints. The backend returns either:
 *   { type: 'wa_link', url }   — wa.me mode → we open the URL in a new tab
 *   { sent: true }             — API mode → message was sent automatically
 *   { error: '...' }           — something went wrong
 */

import client from '@/api/client'

/**
 * Open a wa.me link in a new tab.
 * @param {string} url
 */
export function openWhatsApp(url) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Build a raw wa.me URL from a phone + message.
 * (Useful for ad-hoc messages without going through the backend.)
 * @param {string} phone   — 10-digit or with country code
 * @param {string} message
 * @param {string} countryCode — default '91'
 */
export function buildWaLink(phone, message, countryCode = '91') {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const number = digits.length >= 11 ? digits : `${countryCode}${digits}`
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

/**
 * Call a backend notification endpoint and handle the response.
 *
 * @param {string} endpoint  — e.g. '/notifications/consultation'
 * @param {object} payload   — body sent to backend
 * @param {object} [options]
 * @param {boolean} [options.autoOpen=true] — auto-open wa.me link if returned
 * @returns {{ sent: boolean, waLink: string|null, message: string|null }}
 */
export async function triggerNotification(endpoint, payload, options = {}) {
  const { autoOpen = true } = options
  try {
    const res = await client.post(endpoint, payload)

    if (res.error) {
      return { sent: false, waLink: null, message: null, error: res.error }
    }

    // API mode — message was sent automatically
    if (res.sent) {
      return { sent: true, waLink: null, message: res.message || null }
    }

    // wa.me mode — open the link
    if (res.type === 'wa_link' && res.url) {
      if (autoOpen) openWhatsApp(res.url)
      return { sent: false, waLink: res.url, message: res.message || null }
    }

    // no_team_phone — pharmacy team not configured
    if (res.type === 'no_team_phone') {
      return { sent: false, waLink: null, message: res.message || null, note: res.note }
    }

    return { sent: false, waLink: null, message: null }
  } catch (err) {
    console.error('[WhatsApp] trigger error:', err.message)
    return { sent: false, waLink: null, message: null, error: err.message }
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export const sendConsultationNotification = (consultationId) =>
  triggerNotification('/notifications/consultation', { consultationId })

export const sendPrescriptionNotification = (prescriptionId, opts = {}) =>
  triggerNotification('/notifications/prescription', { prescriptionId, ...opts })

export const sendLabResultNotification = (orderId) =>
  triggerNotification('/notifications/lab-result', { orderId })

export const sendRadiologyNotification = (orderId) =>
  triggerNotification('/notifications/radiology-report', { orderId })

export const notifyPharmacyTeam = (prescriptionId) =>
  triggerNotification('/notifications/pharmacy-team', { prescriptionId })
