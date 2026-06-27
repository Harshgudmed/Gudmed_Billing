import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import client from '@/api/client'

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
    setDoctorTimetable(null)
    setAvailableTimeSlots([])
    
    if (!doctorId) return

    setTimetableLoading(true)
    client.get(`/doctor-accountability?resource=timetable&doctorId=${doctorId}`)
      .then(res => {
        if (res.success) {
          setDoctorTimetable(res.data.timetable)
        }
      })
      .catch(() => {})
      .finally(() => {
        setTimetableLoading(false)
      })
  }, [doctorId])

  // 2. Compute available time slots based on selected date & doctor timetable
  useEffect(() => {
    if (!appointmentDate || !doctorTimetable) {
      setAvailableTimeSlots([])
      if (onSlotsGenerated) onSlotsGenerated([])
      return
    }

    const dateObj = new Date(appointmentDate)
    if (isNaN(dateObj.getTime())) {
      setAvailableTimeSlots([])
      if (onSlotsGenerated) onSlotsGenerated([])
      return
    }

    const yyyy = dateObj.getFullYear()
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0')
    const dd = String(dateObj.getDate()).padStart(2, '0')
    const dateStr = `${yyyy}-${mm}-${dd}`

    const isException = doctorTimetable.exceptions?.some(ex => ex.date === dateStr)
    if (isException) {
      setAvailableTimeSlots([])
      if (onSlotsGenerated) onSlotsGenerated([])
      toast.error("Doctor is on leave/vacation on this date")
      return
    }

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayName = days[dateObj.getDay()]

    const dayConfig = doctorTimetable.weeklySlots?.[dayName]
    if (!dayConfig || !dayConfig.active || !dayConfig.shifts || dayConfig.shifts.length === 0) {
      setAvailableTimeSlots([])
      if (onSlotsGenerated) onSlotsGenerated([])
      return
    }

    const duration = doctorTimetable.slotDuration || 15
    const slots = []

    // Mathematical loop to generate discrete time slots from continuous shifts
    dayConfig.shifts.forEach(shift => {
      const [startH, startM] = shift.start.split(':').map(Number)
      const [endH, endM] = shift.end.split(':').map(Number)

      let currentMinutes = startH * 60 + startM
      const endMinutes = endH * 60 + endM

      while (currentMinutes + duration <= endMinutes) {
        const h = Math.floor(currentMinutes / 60)
        const m = currentMinutes % 60
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        slots.push(timeStr)
        currentMinutes += duration
      }
    })

    setAvailableTimeSlots(slots)
    if (onSlotsGenerated) onSlotsGenerated(slots)

  }, [appointmentDate, doctorTimetable])

  return { availableTimeSlots, timetableLoading }
}
