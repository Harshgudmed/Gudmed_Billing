import { useState, useEffect } from 'react'
import { HOSPITAL_LOGO, HOSPITAL_NAME } from '@/lib/brand'
import { useOrgSettings } from '@/lib/useOrgSettings'

// Renders the hospital logo. It is now DYNAMIC: the logo + name come from the
// organisation Settings (logoUrl the user pastes in Settings → shows everywhere).
// Fallback order:  Settings logoUrl  →  bundled brand logo  →  initials monogram.
// The logo auto-refreshes when Settings are saved (useOrgSettings listens for
// the brandingChange / organizationSettingsChange events).
export default function Logo({ size = 44, rounded = 'rounded-lg', className = '' }) {
  const { orgInfo } = useOrgSettings()
  const logoSrc = orgInfo?.logoUrl || HOSPITAL_LOGO
  const name = orgInfo?.name || HOSPITAL_NAME

  const [failed, setFailed] = useState(false)
  // Reset the error state whenever the source changes (e.g. user saves a new URL).
  useEffect(() => { setFailed(!logoSrc) }, [logoSrc])

  const dim = { width: size, height: size }

  if (failed || !logoSrc) {
    const initials = (name || 'H').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    return (
      <div
        style={dim}
        className={`${rounded} shrink-0 flex items-center justify-center font-bold text-white bg-gradient-to-br from-[#2E4168] to-[#3b5a8a] shadow-sm ring-1 ring-black/5 ${className}`}
      >
        <span style={{ fontSize: size * 0.4 }}>{initials}</span>
      </div>
    )
  }

  return (
    <img
      src={logoSrc}
      alt={name}
      style={dim}
      onError={() => setFailed(true)}
      className={`${rounded} object-contain shrink-0 bg-white p-1 shadow-sm ring-1 ring-black/5 ${className}`}
    />
  )
}
