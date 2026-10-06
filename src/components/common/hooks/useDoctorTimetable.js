import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import client from '@/api/client'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** 'yyyy-MM-dd' for a Date, in the browser's local calendar. */
function toYmd(dateObj) {
  const yyyy = dateObj.getFullYear()
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0')
  const dd = String(dateObj.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * The discrete slots a doctor sits on one date, from their saved timetable —
 * PURE, so callers that need many days at once (e.g. the weekly slot grid) can
 * reuse the same rule instead of re-deriving it.
 *
 * Returns [] when the doctor is off that day or the date is an exception.
 */
export function slotsForDate(timetable, date) {
  if (!timetable || !date) return []
  const dateObj = new Date(date)
  if (isNaN(dateObj.getTime())) return []

  if (timetable.exceptions?.some((ex) => ex.date === toYmd(dateObj))) return []

  const dayConfig = timetable.weeklySlots?.[DAY_NAMES[dateObj.getDay()]]
  if (!dayConfig?.active || !dayConfig.shifts?.length) return []

  const duration = timetable.slotDuration || 15
  const slots = []
  for (const shift of dayConfig.shifts) {
    const [startH, startM] = String(shift.start).split(':').map(Number)
    const [endH, endM] = String(shift.end).split(':').map(Number)
    let minutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM
    while (minutes + duration <= endMinutes) {
      const h = Math.floor(minutes / 60)
      const m = minutes % 60
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      minutes += duration
    }
  }
  return slots
}

// Bookings that no longer hold their slot (the server's slotProblem says the same).
const VOIDED = new Set(['cancelled', 'no_show', 'rescheduled'])

/**
 * The slots a picker may OFFER: the timetable's slots for the day, minus those
 * already past (today) and those another booking holds. The tester counted 54
 * past slots offered and slots offered although booked — each one Save then
 * refused. The server still decides (slotProblem); this only stops offering
 * what it will refuse.
 */
export function bookableSlots(slots, date, bookedTimes = [], now = new Date()) {
  const d = new Date(date)
  const isToday = !isNaN(d.getTime()) && toYmd(d) === toYmd(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const taken = new Set(bookedTimes)
  return slots.filter((slot) => {
    if (taken.has(slot)) return false
    if (!isToday) return true
    const [h, m] = slot.split(':').map(Number)
    return h * 60 + m >= nowMinutes
  })
}

/**
 * Custom hook to manage fetching and calculating a doctor's available time slots.
 * This abstracts away the heavy math and API calls from the UI components.
 *
 * `availableTimeSlots` are the bookable ones (bookableSlots above). The booked
 * times are read from the appointments list; the QR page (`url`, no login)
 * cannot read it, so there only past slots are left out.
 */
export function useDoctorTimetable(doctorId, appointmentDate, onSlotsGenerated, { url } = {}) {
  const [doctorTimetable, setDoctorTimetable] = useState(null)
  const [availableTimeSlots, setAvailableTimeSlots] = useState([])
  const [timetableLoading, setTimetableLoading] = useState(false)
  const [bookedTimes, setBookedTimes] = useState([])
  const day = appointmentDate && !isNaN(new Date(appointmentDate).getTime()) ? toYmd(new Date(appointmentDate)) : ''
  // The parent's callback picks a default time; it runs only when the offered
  // list really changes, so a late answer does not overwrite a time already picked.
  const lastOffered = useRef('')

  // 1. Fetch the doctor's timetable when the selected doctor changes
  useEffect(() => {
    const fetchTimetable = async () => {
      try {
        setDoctorTimetable(null)
        setAvailableTimeSlots([])

        if (!doctorId) return

        setTimetableLoading(true)
        // `url` lets a caller without a login (the QR booking page) read the
        // same timetable through the hospital's public endpoint.
        const res = await client.get(url ? url(doctorId) : `/doctor-accountability?resource=timetable&doctorId=${doctorId}`)
        if (res.success) {
          setDoctorTimetable(res.data.timetable)
        }
      } catch (err) {
        console.error('Failed to load doctor timetable:', err)
      } finally {
        setTimetableLoading(false)
      }
    }

    fetchTimetable()
  }, [doctorId])

  // 2. The times other bookings already hold that day (staff screens only).
  useEffect(() => {
    setBookedTimes([])
    if (!doctorId || !day || url) return
    let live = true
    client.get(`/appointments?doctorId=${encodeURIComponent(doctorId)}&date=${day}&limit=1000`)
      .then((res) => {
        if (!live) return
        setBookedTimes((res.data || []).filter((a) => !VOIDED.has(a.status)).map((a) => a.appointmentTime))
      })
      // Advice only: if the list cannot be read, every slot stays on offer and
      // the time check under the field (useSlotCheck) and Save still refuse a taken one.
      .catch((err) => console.warn('Could not read booked slots:', err?.message))
    return () => { live = false }
  }, [doctorId, day, url])

  // 3. Compute available time slots based on selected date & doctor timetable
  useEffect(() => {
    const allSlots = slotsForDate(doctorTimetable, appointmentDate)
    const slots = bookableSlots(allSlots, appointmentDate, bookedTimes)
    setAvailableTimeSlots(slots)
    const offeredKey = `${doctorId}|${day}|${slots.join(',')}`
    if (onSlotsGenerated && offeredKey !== lastOffered.current) onSlotsGenerated(slots)
    lastOffered.current = offeredKey

    // A date the doctor has explicitly blocked out is worth saying out loud —
    // "no slots" alone reads like a loading state.
    if (allSlots.length === 0 && doctorTimetable && appointmentDate) {
      const d = new Date(appointmentDate)
      if (!isNaN(d.getTime()) && doctorTimetable.exceptions?.some((ex) => ex.date === toYmd(d))) {
        toast.error('Doctor is on leave/vacation on this date')
      }
    }
  }, [appointmentDate, doctorTimetable, bookedTimes])

  return { availableTimeSlots, timetableLoading, doctorTimetable }
}
