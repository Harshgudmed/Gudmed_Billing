import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  UserPlus, Stethoscope,
  Calendar, Clock, IndianRupee, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import client from '@/api/client'
import { cn, drName } from '@/lib/utils'
import { useDoctorTimetable } from './hooks/useDoctorTimetable'
import { useCreatePatient } from '@/lib/useCreatePatient'
import { patientFormSchema, issuesToFieldErrors } from '@/lib/schemas/patientFormSchema'
import PatientDetailsFields, { FieldError } from './PatientDetailsFields'
import { sanitizeTextInput, sanitizeMultilineInput, sanitizeNameInput } from './textFieldUtils'

const APPOINTMENT_TYPES = ['OPD', 'Emergency', 'Follow-up', 'Specialist', 'Teleconsultation', 'Procedure']
const PRIORITY_LEVELS = ['Routine', 'Urgent', 'Emergency', 'Critical']

/** 'yyyy-MM-dd' for the browser's local today — used as the date input's `min`. */
function todayYmdLocal() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

function format12Hour(timeStr) {
  if (!timeStr) return ''
  const [hStr, mStr] = timeStr.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (isNaN(h) || isNaN(m)) return timeStr
  const ampm = h >= 12 ? 'PM' : 'AM'
  const displayH = h % 12 === 0 ? 12 : h % 12
  const displayM = String(m).padStart(2, '0')
  return `${String(displayH).padStart(2, '0')}:${displayM} ${ampm}`
}

const emptyPatientForm = {
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: 'male',
  maritalStatus: '', referredBy: '', mlcNumber: '',
  phonePrimary: '', phoneSecondary: '', email: '',
  houseNumber: '', street: '', locality: '', city: '', district: '', state: '', pincode: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
  bloodGroup: '', hasInsurance: false, insuranceProvider: '', insuranceId: '',
  // Appointment — booked only when the box is ticked. Registering and booking
  // are two different acts: a patient may be registered for a lab test, or from
  // their own QR submission, with the doctor decided later. Requiring a doctor
  // and a date to register blocked those outright, so registration now stands
  // on its own and the booking fields appear on request.
  bookAppointment: false,
  department: '', doctor: '', consultationFee: '', appointmentType: 'OPD', priority: 'Routine',
  appointmentDate: '', appointmentTime: '', notes: '',
}

/**
 * Shared "Register New Patient" form (registers the patient AND books the first
 * appointment). Render it inside a <DialogContent>. Used by both the Dashboard
 * and the Patients module so there is a single source of truth.
 *
 * Props:
 *  - onSuccess(patient): called after a successful registration
 *  - onCancel(): called when the Cancel button is clicked
 *  - initialData: pre-fills the form (used by the reception "Confirm a
 *    self-registration" flow, where the patient already typed their own
 *    details on their phone — reception only checks them and adds the doctor
 *    + appointment). Omitted everywhere else, so those callers still open a
 *    blank form exactly as before.
 */
export default function RegisterPatientForm({ onSuccess, onCancel, initialData }) {
  const [patientForm, setPatientForm] = useState(() => ({ ...emptyPatientForm, ...(initialData || {}) }))
  // Keyed by field name — { firstName: "message", ... } — populated by either
  // the pre-submit Zod check or a validation error the backend returns.
  const [fieldErrors, setFieldErrors] = useState({})
  const [bookingAppointment, setBookingAppointment] = useState(false)
  const { createPatient, creating: creatingPatient } = useCreatePatient()
  // savingPatient covers the whole flow (patient create + appointment book),
  // so the submit button stays disabled across both steps.
  const savingPatient = creatingPatient || bookingAppointment
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])
  const todayYmd = todayYmdLocal()
  const { availableTimeSlots, timetableLoading } = useDoctorTimetable(
    patientForm.doctor,
    patientForm.appointmentDate,
    (slots) => {
      setPatientForm(prev => ({ ...prev, appointmentTime: slots.length > 0 ? slots[0] : '' }))
    }
  )

  useEffect(() => {
    const loadSettings = async () => {
      try {
        // lean=1 is what carries consultationFee — the default select does not
        // have it, so the fee box sat empty and the dropdown showed no (₹…).
        const doctorsRes = await client.get('/settings?resource=users&role=doctor&lean=1')
        if (doctorsRes.success) {
          // See useAppointments: role may be absent mid-deploy, and comparing it
          // then would empty the dropdown rather than narrow it.
          setDoctors((doctorsRes.data ?? []).filter(u => (u.role ?? 'doctor') === 'doctor'))
        }

        const deptsRes = await client.get('/settings?resource=departments')
        if (deptsRes.success) {
          setDepartments(deptsRes.data ?? [])
        }
      } catch (err) {
        console.error('Failed to load doctors and departments:', err)
      }
    }

    loadSettings()
  }, [])

  const setField = (field, value) => {
    setPatientForm(prev => ({ ...prev, [field]: value }))
    // Clear a field's error the moment the user edits it, rather than leaving
    // a stale message on screen after they've already fixed the value.
    setFieldErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  // Free-text fields go through sanitizeTextInput live (strips HTML tags and
  // invisible/zero-width characters) — trimming stays the Zod schema's job at
  // submit time so a trailing space doesn't get eaten mid-typing.
  const setTextField = (field, raw) => setField(field, sanitizeTextInput(raw))

  // Name-type fields (person/place names) are further restricted to letters,
  // spaces, and name punctuation — no digits or symbols can land in them at all.
  const setNameField = (field, raw) => setField(field, sanitizeNameInput(raw))

  // Departments for booking = real consultation departments only.
  // Exclude operational / service departments (you don't book a consult with them).
  const NON_CONSULTATION = new Set([
    'inpatient', 'ipd', 'radiology', 'laboratory', 'lab', 'pathology',
    'pharmacy', 'billing', 'reception', 'administration', 'admin',
    'store', 'inventory', 'nursing', 'housekeeping',
  ])
  const doctorDeptIds = new Set(doctors.map(d => d.departmentId).filter(Boolean))
  const departmentOptions = departments.filter(
    d => doctorDeptIds.has(d.id) && !NON_CONSULTATION.has((d.name || '').trim().toLowerCase())
  )

  // Doctors narrowed to the selected department (falls back to all if none chosen)
  const availableDoctors = patientForm.department
    ? doctors.filter(d => d.departmentId === patientForm.department)
    : doctors

  const handleRegisterPatient = async (e) => {
    e.preventDefault()
    setFieldErrors({})

    // Catch obviously-bad input before it makes a round trip. The backend
    // (patientController.js `patientSchema`) still re-validates and remains
    // the source of truth — this is only a faster first pass.
    const parsed = patientFormSchema.safeParse(patientForm)
    if (!parsed.success) {
      setFieldErrors(issuesToFieldErrors(parsed.error.issues))
      toast.error('Please fix the highlighted fields')
      return
    }

    try {
      const patient = await createPatient({
        ...patientForm,
        hasInsurance: patientForm.hasInsurance === true || patientForm.hasInsurance === 'true',
      })
      const patientId = patient?.id

      // Registration done. Booking is a separate act, and the box may say not
      // to book at all.
      if (!patientForm.bookAppointment) {
        toast.success(`Patient ${patient.mrn} registered`)
        setPatientForm(emptyPatientForm)
        setFieldErrors({})
        onSuccess?.(patient)
        return
      }

      setBookingAppointment(true)
      try {
        const TYPE_MAP = { 'Follow-up': 'follow_up', Emergency: 'emergency' }
        const PRIORITY_MAP = { Urgent: 'urgent', Emergency: 'urgent', Critical: 'urgent' }
        await client.post('/appointments', {
          patientId,
          doctorId: patientForm.doctor,
          ...(patientForm.department ? { departmentId: patientForm.department } : {}),
          appointmentDate: new Date(patientForm.appointmentDate).toISOString(),
          appointmentTime: patientForm.appointmentTime || '09:00',
          appointmentType: TYPE_MAP[patientForm.appointmentType] || 'new_patient',
          priority: PRIORITY_MAP[patientForm.priority] || 'normal',
          ...(patientForm.notes.trim() ? { notes: patientForm.notes.trim() } : {}),
        })

        toast.success(`Patient ${patient.mrn} registered & appointment booked`)
        setPatientForm(emptyPatientForm)
        setFieldErrors({})
        onSuccess?.(patient)
      } catch (err) {
        // The patient IS registered — the UHID exists and is theirs. Deleting
        // them here (which only flips isActive, with no way back in the UI) lost
        // the number, hid the record from every screen, and still matched the
        // duplicate guard on phone + date of birth: re-registering that person
        // then failed with "already registered with UHID …" for a patient
        // nobody could see. So keep them, say plainly what did and did not
        // happen, and let reception book from Appointments.
        toast.warning(
          `Patient ${patient.mrn} registered, but the appointment could not be booked (${err.message || 'unknown error'}). Book it from Appointments.`,
          { duration: 10000 },
        )
        setPatientForm(emptyPatientForm)
        setFieldErrors({})
        onSuccess?.(patient)
      } finally {
        setBookingAppointment(false)
      }
    } catch (err) {
      // Backend validation error (see errorHandler.js: ZodError -> 400 with
      // `details`). The backend is the source of truth, so any rule the
      // pre-submit check missed still surfaces here, next to the field.
      if ((err.status === 400 || err.status === 422) && Array.isArray(err.details)) {
        setFieldErrors(issuesToFieldErrors(err.details))
      }
      toast.error(err.message || 'Failed to register patient')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-blue-600" />
          Register New Patient
        </DialogTitle>
        <DialogDescription>Enter the patient's details. Book the first appointment now, or clear the box and book it later.</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={handleRegisterPatient}
        className="min-w-0 space-y-5 [&_input:not([type=checkbox])]:h-11 [&_input:not([type=checkbox])]:text-[15px] [&_button]:h-11"
      >
        <PatientDetailsFields
          patientForm={patientForm}
          setField={setField}
          setNameField={setNameField}
          setTextField={setTextField}
          fieldErrors={fieldErrors}
        />

        {/* Appointment Details — booked together with registration when asked
            for. Same shape as the insurance section above: the checkbox decides
            whether these fields exist at all, and the schema requires the doctor
            and the date only while it is ticked. */}
        <div className="rounded-lg border p-4 space-y-3 bg-blue-50/50 border-blue-200">
          <label htmlFor="bookAppointment" className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              id="bookAppointment"
              checked={patientForm.bookAppointment}
              onChange={e => {
                setField('bookAppointment', e.target.checked)
                // Clearing the box also clears any complaint about fields that
                // are no longer on screen.
                if (!e.target.checked) {
                  setFieldErrors(prev => ({ ...prev, doctor: undefined, appointmentDate: undefined, appointmentTime: undefined }))
                }
              }}
              className="h-4 w-4 accent-blue-600"
            />
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Stethoscope className="h-4 w-4 text-blue-600" />Book an appointment now
            </span>
          </label>

          {!patientForm.bookAppointment && (
            <p className="text-xs text-gray-600">
              The patient will be registered and given a UHID. Book the appointment later from Appointments.
            </p>
          )}

          {patientForm.bookAppointment && (
          <>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">Department</Label>
              <SearchableSelect
                className="w-full"
                options={departmentOptions.map(d => ({ value: d.id, label: d.name }))}
                value={patientForm.department}
                onChange={v => setPatientForm(prev => ({ ...prev, department: v, doctor: '', consultationFee: '' }))}
                placeholder={departmentOptions.length ? 'Select department' : 'No doctor departments'}
                searchPlaceholder="Search departments..."
              />
            </div>
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">Doctor <span className="text-red-500">*</span></Label>
              <SearchableSelect
                className="w-full"
                options={availableDoctors.map(d => ({
                  value: d.id,
                  label: `${drName(d.fullName)}${d.consultationFee != null ? ` (₹${d.consultationFee})` : ''}`,
                  sublabel: d.specialization || undefined,
                }))}
                value={patientForm.doctor}
                onChange={v => {
                  const doc = availableDoctors.find(d => d.id === v)
                  setPatientForm(prev => ({
                    ...prev,
                    doctor: v,
                    consultationFee: doc?.consultationFee != null ? String(doc.consultationFee) : '',
                    appointmentDate: '',
                    appointmentTime: ''
                  }))
                  setFieldErrors(prev => (prev.doctor ? { ...prev, doctor: undefined } : prev))
                }}
                placeholder={availableDoctors.length ? 'Select doctor' : (patientForm.department ? 'No doctors in department' : 'Select doctor')}
                searchPlaceholder="Search doctors..."
                emptyText="No doctors found"
                disabled={availableDoctors.length === 0}
              />
              <FieldError message={fieldErrors.doctor} />
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
            <div>
              <Label className="text-xs text-gray-600">Appointment Type</Label>
              <Select value={patientForm.appointmentType} onValueChange={v => setField('appointmentType', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-600">Priority</Label>
              <Select value={patientForm.priority} onValueChange={v => setField('priority', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select priority" /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_LEVELS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
            <div>
              <Label className="text-xs text-gray-600 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Date <span className="text-red-500">*</span></Label>
              {/* <Input className="mt-1" type="date" value={patientForm.appointmentDate} onChange={e => setField('appointmentDate', e.target.value)} /> */}
              <Input
                className={cn('mt-1', fieldErrors.appointmentDate && 'border-red-500')}
                type="date"
                min={todayYmd}
                value={patientForm.appointmentDate}
                onChange={e => setField('appointmentDate', e.target.value)}
                disabled={!patientForm.doctor || timetableLoading}
              />
              <FieldError message={fieldErrors.appointmentDate} />
            </div>
            <div>
              <Label className="text-xs text-gray-600 flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Time</Label>
              {/* <Input className="mt-1" type="time" value={patientForm.appointmentTime} onChange={e => setField('appointmentTime', e.target.value)} /> */}
              <Select
                value={patientForm.appointmentTime}
                onValueChange={v => setField('appointmentTime', v)}
                disabled={!patientForm.appointmentDate || availableTimeSlots.length === 0}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={
                    !patientForm.doctor
                      ? "Select doctor first"
                      : !patientForm.appointmentDate
                      ? "Select date first"
                      : availableTimeSlots.length === 0
                      ? "Sorry! Doctor not available on this date"
                      : "Select appointment time"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {availableTimeSlots.map(slot => (
                    <SelectItem key={slot} value={slot}>{format12Hour(slot)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.appointmentTime} />
            </div>
          </div>

          <div>
            <Label className="text-xs text-gray-600 flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" />Consultation Fee (₹)</Label>
            <Input className="mt-1 bg-gray-100 cursor-not-allowed text-gray-700" type="number" readOnly tabIndex={-1} value={patientForm.consultationFee} placeholder="Set by selected doctor" />
          </div>
          </>
          )}
        </div>

        {/* Notes */}
        <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <FileText className="h-4 w-4 text-blue-600" />Notes
          </div>
          <Textarea
            rows={3}
            value={patientForm.notes}
            onChange={e => setField('notes', sanitizeMultilineInput(e.target.value))}
            placeholder="Any additional notes (reason for visit, special instructions, referral details...)"
          />
        </section>

        <div className="flex flex-col-reverse gap-3 border-t pt-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onCancel}>Cancel</Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={savingPatient}>
            {savingPatient
              ? 'Registering...'
              : patientForm.bookAppointment ? 'Register & Book' : 'Register Patient'}
          </Button>
        </div>
      </form>
    </>
  )
}
