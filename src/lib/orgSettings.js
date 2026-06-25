// Module-level cache — one fetch per session, shared across all print functions.
// Call clearOrgCache() from SettingsModule after saving org details.
let _cache = null
let _pending = null

const FALLBACK = { name: 'Hospital', address: '', city: '', phone: '', email: '', logoUrl: '' }

export async function getOrgSettings() {
  if (_cache) return _cache
  if (_pending) return _pending
  _pending = fetch('/api/settings')
    .then(r => r.json())
    .then(res => {
      const org = res?.data || {}
      const settings = typeof org.settings === 'string'
        ? (() => { try { return JSON.parse(org.settings) } catch { return {} } })()
        : (org.settings || {})
      _cache = {
        name:     org.name     || FALLBACK.name,
        address:  org.address  || '',
        city:     org.city     || '',
        phone:    org.phone    || '',
        email:    org.email    || '',
        logoUrl:  settings.logoUrl || org.logoUrl || '',
        tagline:  settings.tagline || '',
      }
      return _cache
    })
    .catch(() => { _cache = { ...FALLBACK }; return _cache })
  return _pending
}

/** Call after saving organisation settings so next print picks up new values */
export function clearOrgCache() {
  _cache = null
  _pending = null
}

/** Sync helper — returns cache if loaded, otherwise the fallback. Use only when async is impossible. */
export function getOrgSettingsSync() {
  return _cache || { ...FALLBACK }
}

/** Build the standard header lines used in HTML prints */
export function orgHeader(org) {
  const name    = org.name    || 'Hospital'
  const address = [org.address, org.city].filter(Boolean).join(', ')
  const contact = [org.phone, org.email].filter(Boolean).join(' · ')
  return { name, address, contact }
}
