import { Stethoscope, Calendar, Clock, IndianRupee } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { cn, drName } from '@/lib/utils'
import { useDoctorTimetable } from './hooks/useDoctorTimetable'
import { FieldError } from './PatientDetailsFields'

// "Book an appointment now" — the checkbox and the booking fields under it.
//
// One component for both ways a patient gets booked: reception's "Register New
// Patient" form, and the patient's own phone from the entrance QR code. The
// department filter, the doctor list, the timetable-driven date and time slots,
// the fee and the payload sent to the booking API are all here, once, so a
// patient who books on their phone is offered exactly what the counter would
// offer them and is booked by exactly the same request.
//
// The caller owns the form values and loads `doctors` and `departments` (the
// counter reads them with its login; the QR page reads the same lists through
// the hospital's public endpoints). `timetableUrl` says where the chosen
// doctor's timetable comes from, for the same reason.

const APPOINTMENT_TYPES = ['OPD', 'Emergency', 'Follow-up', 'Specialist', 'Teleconsultation', 'Procedure']
const PRIORITY_LEVELS = ['Routine', 'Urgent', 'Emergency', 'Critical']

// Departments you do not book a consultation with.
const NON_CONSULTATION = new Set([
  'inpatient', 'ipd', 'radiology', 'laboratory', 'lab', 'pathology',
  'pharmacy', 'billing', 'reception', 'administration', 'admin',
  'store', 'inventory', 'nursing', 'housekeeping',
])

/** 'yyyy-MM-dd' for the browser's local today — used as the date input's `min`. */
function todayYmdLocal() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

export function format12Hour(timeStr) {
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

/**
 * The body of POST /appointments (and of the QR booking) built from the form —
 * without patientId, which the caller adds once the patient exists.
 */
export function buildAppointmentPayload(form) {
  const TYPE_MAP = { 'Follow-up': 'follow_up', Emergency: 'emergency' }
  const PRIORITY_MAP = { Urgent: 'urgent', Emergency: 'urgent', Critical: 'urgent' }
  return {
    doctorId: form.doctor,
    ...(form.department ? { departmentId: form.department } : {}),
    appointmentDate: new Date(form.appointmentDate).toISOString(),
    appointmentTime: form.appointmentTime || '09:00',
    appointmentType: TYPE_MAP[form.appointmentType] || 'new_patient',
    priority: PRIORITY_MAP[form.priority] || 'normal',
    ...(String(form.notes || '').trim() ? { notes: String(form.notes).trim() } : {}),
  }
}

/**
 * @param {object}   patientForm      form values (bookAppointment, department, doctor, …)
 * @param {function} setField         (name, value)
 * @param {function} setPatientForm   state setter, for fields that change together
 * @param {object}   fieldErrors
 * @param {function} setFieldErrors
 * @param {Array}    doctors          lean doctor list ({ id, fullName, specialization, departmentId, consultationFee })
 * @param {Array}    departments
 * @param {function} [timetableUrl]   (doctorId) => URL of that doctor's timetable
 * @param {boolean}  [showPriority]   the priority picker. Defaults to true (the
 *                   counter's form); a patient cannot mark their own visit urgent,
 *                   so the QR page hides it and the booking goes in as Routine.
 * @param {string}   [notBookingNote] shown while the box is clear
 */
export default function AppointmentFields({
  patientForm,
  setField,
  setPatientForm,
  fieldErrors = {},
  setFieldErrors,
  doctors = [],
  departments = [],
  timetableUrl,
  showPriority = true,
  notBookingNote = 'The patient will be registered and given a UHID. Book the appointment later from Appointments.',
}) {
  const todayYmd = todayYmdLocal()
  const { availableTimeSlots, timetableLoading } = useDoctorTimetable(
    patientForm.doctor,
    patientForm.appointmentDate,
    (slots) => {
      setPatientForm(prev => ({ ...prev, appointmentTime: slots.length > 0 ? slots[0] : '' }))
    },
    { url: timetableUrl },
  )

  const doctorDeptIds = new Set(doctors.map(d => d.departmentId).filter(Boolean))
  const departmentOptions = departments.filter(
    d => doctorDeptIds.has(d.id) && !NON_CONSULTATION.has((d.name || '').trim().toLowerCase())
  )

  // Doctors narrowed to the selected department (falls back to all if none chosen)
  const availableDoctors = patientForm.department
    ? doctors.filter(d => d.departmentId === patientForm.department)
    : doctors

  return (
    // Same shape as the insurance section: the checkbox decides whether these
    // fields exist at all, and the schema requires the doctor and the date only
    // while it is ticked.
    <div className="rounded-lg border p-4 space-y-3 bg-blue-50/50 border-blue-200">
      <label htmlFor="bookAppointment" className="flex items-center gap-2 cursor-pointer w-fit">
        <input
          type="checkbox"
          id="bookAppointment"
          checked={!!patientForm.bookAppointment}
          onChange={e => {
            setField('bookAppointment', e.target.checked)
            // Clearing the box also clears any complaint about fields that
            // are no longer on screen.
            if (!e.target.checked) {
              setFieldErrors?.(prev => ({ ...prev, doctor: undefined, appointmentDate: undefined, appointmentTime: undefined }))
            }
          }}
          className="h-4 w-4 accent-blue-600"
        />
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Stethoscope className="h-4 w-4 text-blue-600" />Book an appointment now
        </span>
      </label>

      {!patientForm.bookAppointment && (
        <p className="text-xs text-gray-600">{notBookingNote}</p>
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
              setFieldErrors?.(prev => (prev.doctor ? { ...prev, doctor: undefined } : prev))
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
        {showPriority && (
          <div>
            <Label className="text-xs text-gray-600">Priority</Label>
            <Select value={patientForm.priority} onValueChange={v => setField('priority', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select priority" /></SelectTrigger>
              <SelectContent>
                {PRIORITY_LEVELS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
        <div>
          <Label className="text-xs text-gray-600 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Date <span className="text-red-500">*</span></Label>
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
  )
}
