import { useEffect, useState } from 'react'
import client from '@/api/client'
import { useDebounce } from '@/lib/useDebounce'

/**
 * Is the time just picked still bookable? Answers while the form is being
 * filled in, so the reason can sit in red under the Time field —
 *
 *   Dr. Sharma is already booked at 10:00 AM on 22 Sep. Please choose another time.
 *
 * — instead of the receptionist finding out from a toast after pressing Save.
 *
 * The server runs the SAME rules Save does (slotProblem: not in the past, doctor
 * not on leave, doctor's slot free, patient's slot free), so this line and the
 * result of Save always agree. One hook for every picker: New and Edit
 * appointment, Reschedule, Register Patient and the QR page.
 *
 * A check that fails (offline, server hiccup) shows nothing: it is advice, and
 * Save still asks the server for the final word.
 *
 * @param {object} p
 * @param {string}      p.doctorId
 * @param {Date|string} p.date          a Date (sent as the ISO instant Save sends)
 *                                      or 'YYYY-MM-DD'
 * @param {string}      p.time          'HH:MM'
 * @param {string}      [p.patientId]   also checks the patient is free then
 * @param {string}      [p.appointmentId]  the appointment being edited/moved, so
 *                                      it does not clash with its own slot
 * @param {boolean}     [p.keepCurrent] Edit form: its unchanged slot is fine
 * @param {string}      [p.url]         the public QR endpoint, for the page
 *                                      with no login
 * @returns {{ problem: { code, title, message } | null, checking: boolean }}
 */
export function useSlotCheck({ doctorId, date, time, patientId, appointmentId, keepCurrent, url = '/appointments/check-slot' }) {
  const dateParam = date instanceof Date ? (isNaN(date) ? '' : date.toISOString()) : (date || '')
  // One key for the whole question, debounced, so flicking through the time
  // list asks once for the time finally chosen, not once per option passed.
  const key = useDebounce(
    doctorId && dateParam && time
      ? JSON.stringify({ doctorId, date: dateParam, time, patientId, appointmentId, keepCurrent, url })
      : '',
    250,
  )
  const [problem, setProblem] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!key) { setProblem(null); return }
    const q = JSON.parse(key)
    let live = true
    setChecking(true)
    const params = new URLSearchParams({ doctorId: q.doctorId, date: q.date, time: q.time })
    if (q.patientId) params.set('patientId', q.patientId)
    if (q.appointmentId) params.set('appointmentId', q.appointmentId)
    if (q.keepCurrent) params.set('keepCurrent', '1')
    client.get(`${q.url}?${params}`)
      .then((res) => { if (live) setProblem(res?.data?.ok === false ? res.data : null) })
      .catch(() => { if (live) setProblem(null) })
      .finally(() => { if (live) setChecking(false) })
    return () => { live = false }
  }, [key])

  // A stale answer must not linger while the inputs change under it.
  const settled = key === (doctorId && dateParam && time
    ? JSON.stringify({ doctorId, date: dateParam, time, patientId, appointmentId, keepCurrent, url })
    : '')
  return { problem: settled ? problem : null, checking }
}
