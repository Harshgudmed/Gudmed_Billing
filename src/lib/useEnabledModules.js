import { useState, useEffect, useCallback } from 'react'
import { getOrgRaw, clearOrgCache } from '@/lib/orgSettings'

/**
 * Which modules this hospital has switched on, for any screen that offers a
 * choice belonging to another module.
 *
 * WHY THIS EXISTS
 * Settings → Modules already hides a disabled module from the sidebar (App.jsx
 * builds its routes from the same map). But a module's work also appears INSIDE
 * other screens — Billing offers "Laboratory", "Pharmacy" and "Radiology" as
 * billing departments, and those options went on being offered after the module
 * behind them was switched off. A biller could raise a lab bill for a hospital
 * that has no laboratory.
 *
 * The rule is App.jsx's, repeated here rather than reinvented: a key that is
 * ABSENT means enabled; only an explicit `false` switches something off. A
 * hospital that has never opened this screen has an empty map and must keep
 * everything it had.
 *
 * Settings dispatches `modulesChange` with the whole new map, which is how the
 * sidebar already updates without a reload — this listens to the same event, so
 * a toggle reaches every screen at once. It also clears the org cache, which
 * the toggle handler does not: without that, the next reader of getOrgRaw()
 * would be handed the map from before the change.
 */
export function useEnabledModules() {
  // null while the first read is in flight — distinguishable from "loaded, and
  // the hospital has disabled nothing", which is an empty object.
  const [modules, setModules] = useState(null)

  useEffect(() => {
    let live = true
    getOrgRaw()
      .then((org) => { if (live) setModules(org?.modulesEnabled || {}) })
      .catch(() => { if (live) setModules({}) })

    // The event carries the full map, so nothing needs re-fetching to apply it.
    const onModulesChange = (event) => {
      clearOrgCache()
      setModules(event.detail || {})
    }
    window.addEventListener('modulesChange', onModulesChange)
    return () => {
      live = false
      window.removeEventListener('modulesChange', onModulesChange)
    }
  }, [])

  // `key` is the toggle name from roleConfig's MODULES — 'laboratory',
  // 'pharmacy', 'radiology'. A falsy key means "not gated by any module", which
  // is how a plain consultation line passes through.
  //
  // Nothing is hidden until the map has actually loaded: showing a real option
  // a moment late is a flicker, hiding one that is switched ON is a bill the
  // biller cannot raise.
  const isEnabled = useCallback(
    (key) => !key || modules === null || modules[key] !== false,
    [modules],
  )

  return { modules, isEnabled, loading: modules === null }
}
