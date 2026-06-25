import { useState } from 'react'
import { HOSPITAL_LOGO, HOSPITAL_NAME } from '@/lib/brand'

// Renders the hospital logo image. If the image fails to load (e.g. the
// provided data is invalid), it falls back to a clean monogram so the UI
// never shows a broken-image icon.
export default function Logo({ size = 44, rounded = 'rounded-lg', className = '' }) {
  const [failed, setFailed] = useState(!HOSPITAL_LOGO)

  const dim = { width: size, height: size }

  if (failed) {
    const initials = HOSPITAL_NAME.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
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
      src={HOSPITAL_LOGO}
      alt={HOSPITAL_NAME}
      style={dim}
      onError={() => setFailed(true)}
      className={`${rounded} object-contain shrink-0 bg-white p-1 shadow-sm ring-1 ring-black/5 ${className}`}
    />
  )
}
