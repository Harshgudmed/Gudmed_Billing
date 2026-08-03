import { formatTime12h } from '@/lib/format'
import { MASK_PATIENT_IDENTITY, DEPARTMENT_COLORS, COLUMN_SIZE_TIERS, BASE_COLUMN_SIZE } from './constants'

export function maskPatientName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!MASK_PATIENT_IDENTITY || parts.length <= 1) return name || '—'
  const [given, ...rest] = parts
  return `${given} ${rest.map((p) => p[0].toUpperCase() + '.').join(' ')}`
}

export function maskUhid(uhid) {
  const s = String(uhid || '')
  if (!MASK_PATIENT_IDENTITY || s.length <= 4) return s || '—'
  return `••••${s.slice(-4)}`
}

export function departmentColorClass(departmentId) {
  let hash = 0
  for (let i = 0; i < departmentId.length; i++) hash = (hash * 31 + departmentId.charCodeAt(i)) | 0
  return DEPARTMENT_COLORS[Math.abs(hash) % DEPARTMENT_COLORS.length]
}

/**
 * What to put on a room where nobody is sitting right now.
 *
 * This used to be the single word "On break", which reads as "back in a minute"
 * and was shown for every reason a room can be empty: the session has not
 * started, it ended hours ago, it is a lunch gap, the clinic is shut for the
 * day, or the doctor is on leave. At 11pm every room said "On break". A patient
 * in the waiting area is asking one question — how long — so answer it from the
 * next scheduled session, and say "closed" plainly when there isn't one.
 *
 * `nextSession` comes from the API ({ dayName, start, today }); null means
 * nobody is scheduled here in the next week.
 */
export function emptyRoomLabel(nextSession) {
  if (!nextSession) return 'Consultations closed'
  if (nextSession.today) return `Next session ${formatTime12h(nextSession.start)}`
  return `Closed today · Next ${nextSession.dayName.slice(0, 3)} ${formatTime12h(nextSession.start)}`
}

export const columnSize = (colCount) => COLUMN_SIZE_TIERS[colCount] || BASE_COLUMN_SIZE
