// Per-doctor data isolation helpers.
//
// When the caller is a doctor, their view of doctor-owned records
// (appointments, consultations, ...) is limited to their own. Returns the
// doctor's userId to force into a `where.doctorId`, or null for every other
// role (admins, receptionists, etc. see everything).
//
// NOTE: data scoping is intentionally INDEPENDENT of AUTH_ENFORCED. The login
// flag only controls whether a token is *required* and the demo master
// password — it must not weaken per-doctor isolation. As long as a doctor is
// logged in (their JWT carries role=doctor), they are scoped, even in demo mode.

export function scopedDoctorId(req) {
  if (req.user?.role === 'doctor') return req.user.userId
  return null
}
