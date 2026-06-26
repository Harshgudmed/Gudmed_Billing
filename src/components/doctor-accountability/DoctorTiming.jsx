import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from 'sonner'
import { Clock, Plus, Trash2, Calendar, ShieldCheck, HelpCircle, Save, Loader2, Sparkles, CheckCircle } from 'lucide-react'
import client from '@/api/client'

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function DoctorTiming() {
  const [doctors, setDoctors] = useState([])
  const [selectedDoctorId, setSelectedDoctorId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [timetable, setTimetable] = useState(null)
  
  // New vacation exception state
  const [exceptionDate, setExceptionDate] = useState('')
  const [exceptionReason, setExceptionReason] = useState('')

  // Load all active doctors
  const loadDoctors = useCallback(async () => {
    setLoading(true)
    const res = await client.get('/doctor-accountability?resource=doctors')
    if (res.success) {
      setDoctors(res.data)
      // Auto-select first doctor if available
      if (res.data.length > 0) {
        setSelectedDoctorId(res.data[0].id)
      }
    } else {
      toast.error(res.error || 'Failed to load doctors')
    }
    setLoading(false)
  }, [])

  // Load timetable for selected doctor
  const loadTimetable = useCallback(async (docId) => {
    if (!docId) return
    setLoading(true)
    const res = await client.get(`/doctor-accountability?resource=timetable&doctorId=${docId}`)
    if (res.success) {
      setTimetable(res.data.timetable)
    } else {
      toast.error(res.error || 'Failed to load timetable')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadDoctors()
  }, [loadDoctors])

  useEffect(() => {
    if (selectedDoctorId) {
      loadTimetable(selectedDoctorId)
    }
  }, [selectedDoctorId, loadTimetable])

  const handleToggleDay = (day) => {
    if (!timetable) return
    const updatedWeeklySlots = { ...timetable.weeklySlots }
    const dayData = updatedWeeklySlots[day] || { active: false, shifts: [] }
    
    const newActive = !dayData.active
    let newShifts = [...(dayData.shifts || [])]
    
    // Add default shift if activating and none exist
    if (newActive && newShifts.length === 0) {
      newShifts = [{ start: '09:00', end: '17:00' }]
    }
    
    updatedWeeklySlots[day] = {
      ...dayData,
      active: newActive,
      shifts: newShifts
    }
    
    setTimetable({
      ...timetable,
      weeklySlots: updatedWeeklySlots
    })
  }

  const handleAddShift = (day) => {
    if (!timetable) return
    const updatedWeeklySlots = { ...timetable.weeklySlots }
    const dayData = updatedWeeklySlots[day] || { active: true, shifts: [] }
    
    const lastShift = dayData.shifts[dayData.shifts.length - 1]
    let nextStart = '09:00'
    let nextEnd = '17:00'
    
    if (lastShift) {
      // Intelligently calculate next default shift after the previous one
      const [endH, endM] = lastShift.end.split(':').map(Number)
      const nextH = Math.min(23, endH + 1)
      const formatH = String(nextH).padStart(2, '0')
      nextStart = `${formatH}:00`
      nextEnd = `${String(Math.min(23, nextH + 3)).padStart(2, '0')}:00`
    }

    updatedWeeklySlots[day] = {
      ...dayData,
      active: true,
      shifts: [...dayData.shifts, { start: nextStart, end: nextEnd }]
    }

    setTimetable({
      ...timetable,
      weeklySlots: updatedWeeklySlots
    })
  }

  const handleRemoveShift = (day, index) => {
    if (!timetable) return
    const updatedWeeklySlots = { ...timetable.weeklySlots }
    const dayData = updatedWeeklySlots[day]
    if (!dayData) return

    const newShifts = dayData.shifts.filter((_, idx) => idx !== index)
    updatedWeeklySlots[day] = {
      ...dayData,
      active: newShifts.length > 0 ? dayData.active : false,
      shifts: newShifts
    }

    setTimetable({
      ...timetable,
      weeklySlots: updatedWeeklySlots
    })
  }

  const handleUpdateShift = (day, index, field, value) => {
    if (!timetable) return
    const updatedWeeklySlots = { ...timetable.weeklySlots }
    const dayData = updatedWeeklySlots[day]
    if (!dayData) return

    const newShifts = dayData.shifts.map((s, idx) => {
      if (idx === index) {
        return { ...s, [field]: value }
      }
      return s
    })

    updatedWeeklySlots[day] = {
      ...dayData,
      shifts: newShifts
    }

    setTimetable({
      ...timetable,
      weeklySlots: updatedWeeklySlots
    })
  }

  const handleAddException = (e) => {
    e.preventDefault()
    if (!exceptionDate) {
      toast.error('Please select a date for the leave/exception')
      return
    }
    if (!timetable) return

    // Prevent duplicates
    const exists = timetable.exceptions.some(ex => ex.date === exceptionDate)
    if (exists) {
      toast.error('Leave/Exception already set for this date')
      return
    }

    const newException = {
      date: exceptionDate,
      reason: exceptionReason.trim() || 'Vacation/Leave'
    }

    setTimetable({
      ...timetable,
      exceptions: [...timetable.exceptions, newException].sort((a, b) => a.date.localeCompare(b.date))
    })

    setExceptionDate('')
    setExceptionReason('')
    toast.success('Vacation/Leave date added to list')
  }

  const handleRemoveException = (date) => {
    if (!timetable) return
    setTimetable({
      ...timetable,
      exceptions: timetable.exceptions.filter(ex => ex.date !== date)
    })
    toast.success('Exception removed')
  }

  const validateTimetable = () => {
    if (!timetable) return false

    for (const day of DAYS_OF_WEEK) {
      const dayData = timetable.weeklySlots[day]
      if (dayData && dayData.active) {
        if (!dayData.shifts || dayData.shifts.length === 0) {
          toast.error(`Please add at least one shift range for ${day} or disable the day.`)
          return false
        }
        for (let i = 0; i < dayData.shifts.length; i++) {
          const shift = dayData.shifts[i]
          if (!shift.start || !shift.end) {
            toast.error(`Shifts must have both Start and End times on ${day}.`)
            return false
          }
          if (shift.start >= shift.end) {
            toast.error(`Invalid shift range on ${day}: Start time (${shift.start}) must be before End time (${shift.end}).`)
            return false
          }
          
          // Check for overlaps with other shifts on the same day
          for (let j = i + 1; j < dayData.shifts.length; j++) {
            const other = dayData.shifts[j]
            const overlap = (shift.start < other.end && other.start < shift.end)
            if (overlap) {
              toast.error(`Overlapping shift ranges found on ${day}: ${shift.start}-${shift.end} overlaps with ${other.start}-${other.end}.`)
              return false
            }
          }
        }
      }
    }

    const duration = parseInt(timetable.slotDuration)
    if (isNaN(duration) || duration <= 0) {
      toast.error('Slot duration must be a positive number of minutes.')
      return false
    }

    const maxPatients = parseInt(timetable.maxPatientsPerDay)
    if (isNaN(maxPatients) || maxPatients <= 0) {
      toast.error('Max patients per day must be a positive number.')
      return false
    }

    return true
  }

  const handleSave = async () => {
    if (!validateTimetable()) return
    setSaving(true)
    const res = await client.post(`/doctor-accountability?resource=timetable`, {
      doctorId: selectedDoctorId,
      timetable
    })
    if (res.success) {
      toast.success('Doctor timetable saved successfully')
    } else {
      toast.error(res.error || 'Failed to save timetable')
    }
    setSaving(false)
  }

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/30 p-4 rounded-xl border border-blue-100/50 shadow-sm">
        <div className="flex-1 min-w-[280px] max-w-md">
          <Label className="text-xs font-semibold uppercase tracking-wider text-blue-800">Select Doctor to Manage Timetable</Label>
          <SearchableSelect
            className="mt-1.5 w-full bg-white shadow-sm transition-all duration-200 border-gray-200 focus:border-blue-500"
            value={selectedDoctorId || ''}
            onChange={setSelectedDoctorId}
            options={doctors.map(doc => ({
              value: doc.id,
              label: doc.fullName,
              sublabel: doc.specialization || undefined,
            }))}
            placeholder="Choose a doctor..."
            searchPlaceholder="Search doctor by name..."
            emptyText="No doctors found"
          />
        </div>
        
        {timetable && (
          <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md shadow-indigo-100 px-6 py-2 transition-all duration-200 flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving changes...' : 'Save Doctor Timetable'}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-10 w-10 text-indigo-600 animate-spin" />
          <span className="text-sm font-medium text-gray-500">Loading schedule settings...</span>
        </div>
      ) : !timetable ? (
        <Card className="border-dashed border-2 py-16">
          <CardContent className="flex flex-col items-center justify-center text-center space-y-3">
            <div className="p-4 bg-gray-50 rounded-full text-gray-400">
              <Clock className="h-8 w-8" />
            </div>
            <h3 className="font-semibold text-gray-700 text-lg">No Timetable Available</h3>
            <p className="text-sm text-gray-400 max-w-sm">Please select a doctor to begin setting up their custom weekly shifts and leaves.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left/Middle Column: Weekly Slots Timing Grid */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-gray-200/80 shadow-sm overflow-hidden">
              <div className="bg-indigo-50/50 border-b border-gray-100 p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                    <Clock className="h-5 w-5 text-indigo-600" />
                    Weekly Shift Configuration
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">Toggle working days and define start/end shifts.</p>
                </div>
                <Badge className="bg-emerald-100 hover:bg-emerald-100 text-emerald-700 border-0 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> Enabled
                </Badge>
              </div>
              <CardContent className="p-0 divide-y divide-gray-100">
                {DAYS_OF_WEEK.map(day => {
                  const dayData = timetable.weeklySlots[day] || { active: false, shifts: [] }
                  return (
                    <div key={day} className={`p-4 transition-colors duration-150 flex flex-col md:flex-row md:items-start justify-between gap-4 ${dayData.active ? 'bg-white' : 'bg-gray-50/40 opacity-70'}`}>
                      {/* Day Label & Active Toggle */}
                      <div className="flex items-center justify-between md:justify-start gap-4 md:w-44 pt-1.5">
                        <span className="font-semibold text-gray-700 w-24">{day}</span>
                        <button
                          type="button"
                          onClick={() => handleToggleDay(day)}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${dayData.active ? 'bg-indigo-600' : 'bg-gray-200'}`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${dayData.active ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      {/* Shift List for this day */}
                      <div className="flex-1 space-y-3">
                        {dayData.active ? (
                          <>
                            {dayData.shifts.map((shift, sIdx) => (
                              <div key={sIdx} className="flex items-center gap-3 flex-wrap md:flex-nowrap bg-indigo-50/20 p-2.5 rounded-lg border border-indigo-100/30">
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs text-indigo-700 font-medium whitespace-nowrap">Shift {sIdx + 1}</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">Start</span>
                                  <Input
                                    type="time"
                                    value={shift.start}
                                    onChange={(e) => handleUpdateShift(day, sIdx, 'start', e.target.value)}
                                    className="h-8 py-0.5 px-2 text-sm w-28 bg-white border-gray-200 rounded"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">End</span>
                                  <Input
                                    type="time"
                                    value={shift.end}
                                    onChange={(e) => handleUpdateShift(day, sIdx, 'end', e.target.value)}
                                    className="h-8 py-0.5 px-2 text-sm w-28 bg-white border-gray-200 rounded"
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => handleRemoveShift(day, sIdx)}
                                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50/50 rounded-full ml-auto md:ml-2"
                                  title="Remove Shift"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleAddShift(day)}
                              className="h-8 border-dashed border-indigo-200 text-indigo-600 hover:bg-indigo-50/50 font-medium text-xs px-3 py-1 flex items-center gap-1"
                            >
                              <Plus className="h-3 w-3" /> Add Time Shift
                            </Button>
                          </>
                        ) : (
                          <div className="text-xs text-gray-400 italic py-2">Doctor unavailable / closed</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Slot Details & Leave Date Configuration */}
          <div className="space-y-6">
            
            {/* Slot & Patient Limits Config */}
            {/* <Card className="border-gray-200/80 shadow-sm">
              <div className="bg-indigo-50/50 border-b border-gray-100 p-4">
                <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-indigo-600" />
                  Appointment Setup
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Control appointment duration and max limit.</p>
              </div>
              <CardContent className="p-4 space-y-4">
                <div>
                  <Label className="text-xs text-gray-600 font-semibold uppercase">Consultation Slot Duration (mins)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={timetable.slotDuration}
                    onChange={(e) => setTimetable({ ...timetable, slotDuration: parseInt(e.target.value) || 15 })}
                    className="mt-1.5 border-gray-200 focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Default is 15 minutes per session slot.</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-600 font-semibold uppercase">Max Patients Per Day</Label>
                  <Input
                    type="number"
                    min={1}
                    value={timetable.maxPatientsPerDay}
                    onChange={(e) => setTimetable({ ...timetable, maxPatientsPerDay: parseInt(e.target.value) || 30 })}
                    className="mt-1.5 border-gray-200 focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Stops bookings once this patient limit is reached.</p>
                </div>
              </CardContent>
            </Card> */}

            {/* Leave / Vacation Mode Exceptions */}
            <Card className="border-gray-200/80 shadow-sm">
              <div className="bg-indigo-50/50 border-b border-gray-100 p-4">
                <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-indigo-600" />
                  Vacation / Leave Outages
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Set specific dates doctor is out of office.</p>
              </div>
              <CardContent className="p-4 space-y-4">
                <form onSubmit={handleAddException} className="space-y-3">
                  <div>
                    <Label className="text-xs text-gray-600 font-semibold uppercase">Date *</Label>
                    <Input
                      type="date"
                      value={exceptionDate}
                      onChange={(e) => setExceptionDate(e.target.value)}
                      className="mt-1 border-gray-200 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600 font-semibold uppercase">Reason / Note</Label>
                    <Input
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      placeholder="e.g. Medical Leave, Travel"
                      className="mt-1 border-gray-200 focus:border-indigo-500"
                    />
                  </div>
                  <Button type="submit" variant="secondary" className="w-full text-xs font-semibold py-1.5 flex items-center justify-center gap-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100/60">
                    <Plus className="h-3.5 w-3.5" /> Add Exclusion Date
                  </Button>
                </form>

                {timetable.exceptions && timetable.exceptions.length > 0 ? (
                  <div className="pt-2 border-t border-gray-100">
                    <Label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block mb-2">Exclusion Dates List</Label>
                    <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                      {timetable.exceptions.map((ex) => (
                        <div key={ex.date} className="flex items-center justify-between p-2 bg-red-50/30 rounded border border-red-100/30 text-xs">
                          <div>
                            <span className="font-semibold text-gray-700">{ex.date}</span>
                            <span className="text-gray-400 block text-[10px] italic">{ex.reason}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveException(ex.date)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded-full transition-colors"
                            title="Delete exception"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 italic text-center py-4 border-t border-dashed">No leave outages configured.</div>
                )}
              </CardContent>
            </Card>

          </div>

        </div>
      )}
    </div>
  )
}
