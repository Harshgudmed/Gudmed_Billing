import client from '@/api/client'
import { readOrgSettings } from '@/lib/orgSettingsSchema'

// Module-level cache — one fetch per session, shared across all print functions.
// Call clearOrgCache() from SettingsModule after saving org details.
let _cache = null
let _pending = null
// The untouched /settings response. `_cache` is the print-shaped view of it and
// deliberately drops the branding columns (navbarColor, modulesEnabled,
// primaryColor…), so the app shell used to fetch /settings a SECOND time to get
// them — which is why every one of the 17 modules issued two identical calls on
// every page load. Keeping the raw row here lets both readers share one fetch.
let _raw = null

const FALLBACK = { name: 'Hospital', address: '', city: '', phone: '', email: '', logoUrl: '' }

export async function getOrgSettings() {
  if (_cache) return _cache
  if (_pending) return _pending

  _pending = (async () => {
    try {
      // Use the shared axios client (not raw fetch) so this respects VITE_API_URL
      // in production instead of always hitting a same-origin relative path.
      const res = await client.get('/settings')
      const org = res?.data || {}
      _raw = org
      const settings = typeof org.settings === 'string'
        ? (() => { try { return JSON.parse(org.settings) } catch { return {} } })()
        : (org.settings || {})
      _cache = {
        name:     org.name     || FALLBACK.name,
        address:  org.address  || '',
        city:     org.city     || '',
        region:   org.region   || '',
        phone:    org.phone    || '',
        email:    org.email    || '',
        logoUrl:  settings.logoUrl || org.logoUrl || '',
        tagline:  settings.tagline || '',
        // Hospital-configurable settings, from the one declaration in
        // orgSettingsSchema.js — the reader, the hook and the Settings form all
        // derive from it, so a new setting cannot reach one and miss another.
        ...readOrgSettings(settings),
      }
      return _cache
    } catch (err) {
      console.error('Failed to load organization settings:', err)
      _cache = { ...FALLBACK }
      return _cache
    }
  })()

  return _pending
}

/**
 * The organisation row exactly as /settings returned it — branding columns and
 * all. Shares the single cached fetch with getOrgSettings(), so asking for both
 * costs one request, not two.
 */
export async function getOrgRaw() {
  if (_raw) return _raw
  await getOrgSettings()
  return _raw || {}
}

/** Call after saving organisation settings so next print picks up new values */
export function clearOrgCache() {
  _cache = null
  _pending = null
  _raw = null
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
