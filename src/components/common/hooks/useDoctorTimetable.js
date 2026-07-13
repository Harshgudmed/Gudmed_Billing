import { useState, useEffect } from 'react'
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

/**
 * Custom hook to manage fetching and calculating a doctor's available time slots.
 * This abstracts away the heavy math and API calls from the UI components.
 */
export function useDoctorTimetable(doctorId, appointmentDate, onSlotsGenerated) {
  const [doctorTimetable, setDoctorTimetable] = useState(null)
  const [availableTimeSlots, setAvailableTimeSlots] = useState([])
  const [timetableLoading, setTimetableLoading] = useState(false)

  // 1. Fetch the doctor's timetable when the selected doctor changes
  useEffect(() => {
    const fetchTimetable = async () => {
      try {
        setDoctorTimetable(null)
        setAvailableTimeSlots([])

        if (!doctorId) return

        setTimetableLoading(true)
        const res = await client.get(`/doctor-accountability?resource=timetable&doctorId=${doctorId}`)
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

  // 2. Compute available time slots based on selected date & doctor timetable
  useEffect(() => {
    const slots = slotsForDate(doctorTimetable, appointmentDate)
    setAvailableTimeSlots(slots)
    if (onSlotsGenerated) onSlotsGenerated(slots)

    // A date the doctor has explicitly blocked out is worth saying out loud —
    // "no slots" alone reads like a loading state.
    if (slots.length === 0 && doctorTimetable && appointmentDate) {
      const d = new Date(appointmentDate)
      if (!isNaN(d.getTime()) && doctorTimetable.exceptions?.some((ex) => ex.date === toYmd(d))) {
        toast.error('Doctor is on leave/vacation on this date')
      }
    }
  }, [appointmentDate, doctorTimetable])

  return { availableTimeSlots, timetableLoading, doctorTimetable }
}
