import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import client from '@/api/client'
import { useCreatePatient } from '@/lib/useCreatePatient'
import { patientFormSchema, issuesToFieldErrors } from '@/lib/schemas/patientFormSchema'
import PatientDetailsFields, { NotesSection } from './PatientDetailsFields'
import AppointmentFields, { buildAppointmentPayload } from './AppointmentFields'
import { sanitizeTextInput, sanitizeNameInput } from './textFieldUtils'

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
        // The same payload the QR booking page sends (buildAppointmentPayload).
        await client.post('/appointments', { patientId, ...buildAppointmentPayload(patientForm) })

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
      {/* noValidate: the fields carry `required`, and without this the browser
          stopped the submit with its own grey bubbles before handleRegisterPatient
          ran — so the app's own messages under each box never appeared. The zod
          schema below (and the server) do the checking. */}
      <form
        noValidate
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

        <AppointmentFields
          patientForm={patientForm}
          setField={setField}
          setPatientForm={setPatientForm}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          doctors={doctors}
          departments={departments}
        />

        {/* Notes */}
        <NotesSection value={patientForm.notes} setField={setField} />

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
