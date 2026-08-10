import { useState, useEffect, useMemo, useCallback } from 'react'
import client from '@/api/client'

/**
 * Everything needed to book an appointment: departments, the doctors in one of
 * them, that doctor's fee slabs, and what THIS patient will actually be charged.
 *
 * WHY THIS EXISTS
 * Appointments already resolves all of it (useAppointments.js), and Billing needs
 * the same thing to book from the counter — two real callers, which is what makes
 * this a shared lib rather than speculation (CLAUDE.md rule 9). Billing's create
 * screen currently uses a hardcoded `OPD Consultation ₹500`, so a bill raised there
 * is not the bill the doctor's slab says.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not create an invoice. `POST /appointments` writes appointment, queue
 * entry, invoice and doctor commission in ONE transaction — a caller that also
 * writes its own invoice produces two bills, no queue token and no commission.
 * Book through the endpoint that owns the behaviour; the bill comes back with it.
 */

// Departments are ten rows, 2.2 KB, and identical for every screen in a session.
// Fetching them per mount is the "same URL twice in one action" finding that this
// audit raised against five modules — so they are cached at module level, the way
// src/lib/orgSettings.js caches /settings.
let _departments = null
let _inflight = null

async function loadDepartments() {
  if (_departments) return _departments
  if (_inflight) return _inflight
  _inflight = client.get('/settings?resource=departments')
    .then((res) => { _departments = res?.data ?? res ?? []; return _departments })
    .finally(() => { _inflight = null })
  return _inflight
}

export function useBookingSource({ departmentId, doctorId, patientId, date } = {}) {
  const [departments, setDepartments] = useState(_departments ?? [])
  const [doctors, setDoctors] = useState([])
  const [slabs, setSlabs] = useState([])
  const [fee, setFee] = useState(null)
  const [loading, setLoading] = useState({ doctors: false, slabs: false, fee: false })

  const set = useCallback((k, v) => setLoading((p) => (p[k] === v ? p : { ...p, [k]: v })), [])

  useEffect(() => { let live = true; loadDepartments().then((d) => live && setDepartments(d)); return () => { live = false } }, [])

  // Doctors, scoped to the chosen department and to the five fields the form
  // reads. Measured: all doctors is 336 KB over 1,128 rows; one department is
  // 18 KB over 116. A `limit=` here would be a cap, not pagination — the doctors
  // past it would vanish with nothing to say so (rule 5).
  useEffect(() => {
    if (!departmentId) { setDoctors([]); return }
    let live = true
    set('doctors', true)
    client.get('/settings', { params: { resource: 'users', role: 'doctor', departmentId, lean: 1 } })
      .then((res) => { if (live) setDoctors(res?.data ?? res ?? []) })
      .catch(() => { if (live) setDoctors([]) })
      .finally(() => { if (live) set('doctors', false) })
    return () => { live = false }
  }, [departmentId, set])

  // One doctor's slabs — 1 KB. Asking for the whole table is 1,162 KB over 3,384
  // rows, and the booking form only ever has one doctor selected.
  useEffect(() => {
    if (!doctorId) { setSlabs([]); return }
    let live = true
    set('slabs', true)
    client.get('/fee-slabs', { params: { doctorId } })
      .then((res) => { if (live) setSlabs(res?.data ?? res ?? []) })
      .catch(() => { if (live) setSlabs([]) })
      .finally(() => { if (live) set('slabs', false) })
    return () => { live = false }
  }, [doctorId, set])

  // What this patient is actually charged. The server resolves the slab itself and
  // refuses a client-supplied fee (appointmentController.js:401), so this is for
  // SHOWING the number before booking — never for sending it.
  useEffect(() => {
    if (!doctorId || !patientId || !date) { setFee(null); return }
    const ctl = new AbortController()
    set('fee', true)
    client.get('/fee-slabs/calculate', { params: { doctorId, patientId, date }, signal: ctl.signal })
      .then((res) => { if (res?.success !== false) setFee(res?.data ?? res ?? null) })
      .catch(() => {})
      .finally(() => set('fee', false))
    // Exactly the three values the request is built from — nothing wider. A
    // dependency array broader than the query is what produced "refetched with
    // nothing changed" in five modules.
    return () => ctl.abort()
  }, [doctorId, patientId, date, set])

  const doctorsById = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors])

  // `??`, never `||`. A free follow-up is fee 0, and 0 is falsy — `||` would
  // silently charge the doctor's base fee instead of nothing. That substitution is
  // in CLAUDE.md's list of bugs this repo has already paid for.
  const effectiveFee = fee?.fee ?? doctorsById.get(doctorId)?.consultationFee ?? null
  const isFreeFollowUp = fee?.fee === 0

  // Memoised, because a fresh object every render defeats memo() on whatever
  // consumes it — the app-shell repaint this audit found in all 17 modules.
  return useMemo(() => ({
    departments, doctors, doctorsById, slabs,
    fee, effectiveFee, isFreeFollowUp, loading,
  }), [departments, doctors, doctorsById, slabs, fee, effectiveFee, isFreeFollowUp, loading])
}

/** Forget the cached departments — for tests, and after Settings edits one. */
export function resetBookingSourceCache() { _departments = null; _inflight = null }
