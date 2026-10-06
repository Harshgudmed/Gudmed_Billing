// E-mail from the hospital's own mail server — Settings → Integrations →
// E-mail (SMTP). One sender uses it today: a request for quotation e-mailed to
// its vendors (purchaseRfqController.js), when the hospital's Purchase setting
// rfqEmailVendors is on.
//
// The settings live with the other integrations, in the organisation's
// settings JSON under integrations.email:
//   { enabled, host, port, secure, user, fromName, fromAddress, passwordEnc }
// That JSON is read by every staff screen (GET /settings), so the SMTP password
// is never kept there in words: it is sealed (AES-256-GCM, key derived from the
// server's JWT_SECRET) and no response carries it — a screen only learns that
// one is saved (publicEmailSettings).
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import { JWT_SECRET } from '../config/security.js'

const KEY = crypto.createHash('sha256').update(`gudmed:integration-secret:${JWT_SECRET}`).digest()
const SEAL_PREFIX = 'v1:'

/** The secret, sealed for storing in the settings JSON. */
export function sealSecret(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  return SEAL_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

/** The secret back in words; throws, in words, when it cannot be read (the server's secret changed). */
export function openSecret(sealed) {
  try {
    if (!String(sealed).startsWith(SEAL_PREFIX)) throw new Error('not sealed')
    const raw = Buffer.from(String(sealed).slice(SEAL_PREFIX.length), 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('The saved e-mail password can no longer be read — enter it again in Settings → Integrations → E-mail (SMTP)')
  }
}

/** The e-mail block out of an organisation's settings (an object or its JSON text). */
export function emailSettingsOf(settings) {
  let s = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
  return s?.integrations?.email || {}
}

/** What a screen may see: everything but the password, and whether one is saved. */
export function publicEmailSettings(block = {}) {
  const { passwordEnc, ...rest } = block
  return { ...rest, passwordSaved: !!passwordEnc }
}

/** Why e-mail cannot be sent with these settings, in words; null when it can. */
export function emailSetupProblem(block = {}) {
  if (!block.host || !block.fromAddress) return 'E-mail is not set up — an administrator fills in Settings → Integrations → E-mail (SMTP)'
  if (block.enabled === false) return 'E-mail is switched off in Settings → Integrations → E-mail (SMTP)'
  return null
}

/** A mail server's refusal, said so the person can act on it. */
export function smtpErrorInWords(e, block = {}) {
  const where = `${block.host || 'the mail server'}${block.port ? `:${block.port}` : ''}`
  const code = e?.code || ''
  if (code === 'EAUTH') return `The mail server did not accept the user name or password (${where}) — check them in Settings → Integrations → E-mail (SMTP)`
  // nodemailer wraps a refused connection as ESOCKET / ECONNECTION.
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(e?.message || '')) return `Could not reach the mail server at ${where} — it refused the connection. Check the host and port`
  if (code === 'EDNS' || code === 'ENOTFOUND') return `The mail server ${block.host || ''} was not found — check the host name`
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ETLS') return `Could not talk to the mail server at ${where} (${e.message}). Check the host, port and the "secure" switch`
  if (code === 'EENVELOPE') return `The mail server refused the address: ${e.response || e.message}`
  if (e?.responseCode) return `The mail server refused the e-mail: ${e.response || e.message}`
  return `The e-mail could not be sent: ${e?.message || 'unknown error'}`
}

/**
 * Sends one e-mail with the hospital's settings (`block`, as stored). Resolves
 * when the server accepted it; rejects with an Error whose message says, in
 * words, why not. Timeouts are short: the person who pressed Send is waiting.
 */
export async function sendMail(block, { to, subject, html, text, replyTo }) {
  const problem = emailSetupProblem(block)
  if (problem) throw new Error(problem)
  const auth = block.user ? { user: block.user, pass: block.passwordEnc ? openSecret(block.passwordEnc) : '' } : undefined
  const transport = nodemailer.createTransport({
    host: block.host,
    port: Number(block.port) || (block.secure ? 465 : 587),
    secure: !!block.secure,
    auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  try {
    return await transport.sendMail({
      from: block.fromName ? { name: block.fromName, address: block.fromAddress } : block.fromAddress,
      to, subject, html, text, replyTo: replyTo || block.fromAddress,
    })
  } catch (e) {
    throw new Error(smtpErrorInWords(e, block))
  } finally {
    transport.close()
  }
}

/** HTML-safe text for an e-mail body. */
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
