// Integration secrets in a hospital's settings — the SMS and eAPTS API keys,
// the sealed e-mail password — stay on the server.
//
// GET /settings answers every staff role (the screens read the hospital's name,
// switches and branding from it), and it used to send the whole settings JSON,
// so a store keeper could read the SMS gateway's API key. Now a secret is never
// sent: the screen gets `<field>Saved: true` instead and shows "saved". The
// Settings screens save the whole JSON back, so a secret that comes back blank
// or missing keeps the stored one — otherwise the next save of any other
// setting would wipe it.

export const SECRET_FIELDS = ['apiKey', 'apiSecret', 'authToken', 'password', 'passwordEnc', 'secret', 'token']

const blocksOf = (settings) => (settings && typeof settings.integrations === 'object' && settings.integrations) || {}

/** A copy of `settings` with every integration secret replaced by `<field>Saved: true`. */
export function withoutSecrets(settings) {
  if (!settings || typeof settings !== 'object') return settings
  const integrations = {}
  for (const [key, block] of Object.entries(blocksOf(settings))) {
    if (!block || typeof block !== 'object') { integrations[key] = block; continue }
    const safe = { ...block }
    for (const field of SECRET_FIELDS) {
      if (field in safe) {
        if (safe[field]) safe[`${field}Saved`] = true
        delete safe[field]
      }
    }
    integrations[key] = safe
  }
  return settings.integrations ? { ...settings, integrations } : settings
}

/**
 * `incoming` (what the screen saves) with each stored secret it left blank or
 * out put back, and the `<field>Saved` markers dropped. A secret typed anew
 * replaces the stored one.
 */
export function keepSecrets(incoming, stored) {
  if (!incoming || typeof incoming !== 'object') return incoming
  const storedBlocks = blocksOf(stored)
  const integrations = {}
  for (const [key, block] of Object.entries(blocksOf(incoming))) {
    if (!block || typeof block !== 'object') { integrations[key] = block; continue }
    const next = { ...block }
    for (const field of SECRET_FIELDS) {
      delete next[`${field}Saved`]
      const typed = next[field]
      const kept = storedBlocks[key]?.[field]
      if ((typed === undefined || typed === null || typed === '') && kept) next[field] = kept
    }
    integrations[key] = next
  }
  // A block the screen did not send at all keeps everything it had.
  for (const [key, block] of Object.entries(storedBlocks)) {
    if (!(key in integrations)) integrations[key] = block
  }
  return (incoming.integrations || stored?.integrations) ? { ...incoming, integrations } : incoming
}
