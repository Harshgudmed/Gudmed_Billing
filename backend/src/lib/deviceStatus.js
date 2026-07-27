// Single source of truth for a display device's live status, shared by the
// backend (admin list) and the frontend (status badge) so both agree.
//
// Thresholds are on the last heartbeat:
//   online       heartbeat within 45s
//   reconnecting missed a beat or two (45–90s) — likely to recover
//   offline      silent > 90s (or never, when paired)
//   unpaired     not yet linked to a screen — the actionable "assign me" state
export const ONLINE_MS = 45_000
export const RECONNECTING_MS = 90_000

export function getDeviceStatus(device) {
  if (!device || !device.screenId || device.status === 'unpaired') return 'unpaired'
  const last = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0
  const gap = Date.now() - last
  if (gap <= ONLINE_MS) return 'online'
  if (gap <= RECONNECTING_MS) return 'reconnecting'
  return 'offline'
}
