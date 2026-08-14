import { formatTime12h } from '@/lib/format'
import { shortToken } from '@/lib/queueToken'
import { MASK_PATIENT_IDENTITY, DEPARTMENT_COLORS, COLUMN_SIZE_TIERS, BASE_COLUMN_SIZE } from './constants'

export { shortToken }

export function maskPatientName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!MASK_PATIENT_IDENTITY || parts.length <= 1) return name || '—'
  const [given, ...rest] = parts
  return `${given} ${rest.map((p) => p[0].toUpperCase() + '.').join(' ')}`
}

/**
 * How this hospital wants a patient named on its boards.
 *
 * One function, used by every board, because the alternative — each screen
 * deciding for itself — is how the room grid ends up showing names while the
 * room detail shows tokens, on the same floor, for the same patient.
 *
 * A token is a number nobody in the hall can attach to a person; a name is
 * readable from across the room. Which one is right depends on the hospital, so
 * neither is hardcoded. When the chosen field is missing, the other one is used
 * rather than printing a dash — a board with nothing on it helps nobody.
 */
export function patientLabel(entry, cfg = {}) {
  const name = entry?.name && entry.name !== '—' ? maskPatientName(entry.name) : ''
  const token = shortToken(entry?.token)
  const mode = cfg.displayPatientAs || 'name'
  if (mode === 'token') return token || name || '—'
  if (mode === 'both') return [name, token].filter(Boolean).join(' · ') || '—'
  return name || token || '—'
}

/** Whether to print the doctor's name. Some hospitals treat who is sitting where
 *  as internal, and a shared room's doctor changes through the day anyway. */
export const showDoctorName = (cfg = {}) => cfg.displayShowDoctorName !== false

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
