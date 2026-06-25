/**
 * WhatsApp service — abstraction layer over wa.me links (current) and
 * a real WhatsApp Business API provider (future).
 *
 * Behaviour:
 *   - WHATSAPP_API_KEY not set → returns { type:'wa_link', url } for the
 *     frontend to open in a new tab (zero cost, works today).
 *   - WHATSAPP_API_KEY set     → calls the configured provider API to send
 *     the message directly without any staff action required.
 *
 * Supported providers (future): wati, twilio, 360dialog, meta
 */

const PROVIDER      = process.env.WHATSAPP_PROVIDER  || 'wame'
const API_KEY       = process.env.WHATSAPP_API_KEY   || ''
const API_URL       = process.env.WHATSAPP_API_URL   || ''
const COUNTRY_CODE  = process.env.WHATSAPP_COUNTRY_CODE || '91'

// Twilio uses its own credentials — treat as API mode if SID is set
const TWILIO_SID    = process.env.TWILIO_ACCOUNT_SID  || ''
const isApiMode     = !!API_KEY || (PROVIDER === 'twilio' && !!TWILIO_SID)

function normalisePhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  // If already has country code length, use as-is; otherwise prepend
  return digits.length >= 11 ? digits : `${COUNTRY_CODE}${digits}`
}

function buildWaLink(phone, message) {
  const number = normalisePhone(phone)
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

/**
 * Send a text message to a patient/staff WhatsApp number.
 *
 * Returns:
 *   { sent: true }                          — when API call succeeded
 *   { type: 'wa_link', url: '...' }         — when wa.me mode (no API key)
 *   { error: 'reason' }                     — on failure
 */
async function sendMessage(phone, message) {
  if (!phone) return { error: 'No phone number provided' }

  // ── wa.me mode (default) ─────────────────────────────────────────────────
  if (!isApiMode) {
    const url = buildWaLink(phone, message)
    if (!url) return { error: 'Could not build WhatsApp link' }
    return { type: 'wa_link', url }
  }

  // ── Real API mode ────────────────────────────────────────────────────────
  try {
    const number = normalisePhone(phone)
    if (PROVIDER === 'wati') return await _sendWati(number, message)
    if (PROVIDER === 'twilio') return await _sendTwilio(number, message)
    if (PROVIDER === 'meta') return await _sendMeta(number, message)
    return { error: `Unknown provider: ${PROVIDER}` }
  } catch (err) {
    console.error('[WhatsApp] send error:', err.message)
    return { error: err.message }
  }
}

// ── Provider implementations (add credentials via env vars) ──────────────────

async function _sendWati(phone, message) {
  // WATI API: POST {API_URL}/api/v1/sendSessionMessage/{phone}
  const { default: axios } = await import('axios')
  const res = await axios.post(
    `${API_URL}/api/v1/sendSessionMessage/${phone}`,
    { messageText: message },
    { headers: { Authorization: `Bearer ${API_KEY}` } },
  )
  return res.data?.result ? { sent: true } : { error: 'WATI send failed' }
}

async function _sendTwilio(phone, message) {
  // Twilio WhatsApp: POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN    || ''
  const TWILIO_FROM  = process.env.TWILIO_WHATSAPP_FROM || ''
  const { default: axios } = await import('axios')
  const fromClean = TWILIO_FROM.replace(/^whatsapp:/, '').replace(/^\+/, '')
  const params = new URLSearchParams({
    From: `whatsapp:+${fromClean}`,
    To:   `whatsapp:+${phone}`,
    Body: message,
  })
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    params.toString(),
    { auth: { username: TWILIO_SID, password: TWILIO_TOKEN },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  )
  return { sent: true }
}

async function _sendMeta(phone, message) {
  // Meta Cloud API: POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
  const PHONE_ID = process.env.META_PHONE_NUMBER_ID || ''
  const { default: axios } = await import('axios')
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message },
    },
    { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' } },
  )
  return { sent: true }
}

export default { sendMessage, buildWaLink, normalisePhone }
