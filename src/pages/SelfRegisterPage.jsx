import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CalendarCheck, Download, Loader2, UserPlus } from 'lucide-react'
import client from '@/api/client'
import { Button } from '@/components/ui/button'
import PatientDetailsFields, { NotesSection, FieldError } from '@/components/common/PatientDetailsFields'
import PatientLookup from '@/components/common/PatientLookup'
import { Label } from '@/components/ui/label'
import AppointmentFields, { buildAppointmentPayload, format12Hour } from '@/components/common/AppointmentFields'
import { patientDetailsSchema, patientFormSchema, issuesToFieldErrors } from '@/lib/schemas/patientFormSchema'
import { cn, drName } from '@/lib/utils'
import { sanitizeTextInput, sanitizeNameInput } from '@/components/common/textFieldUtils'
import { printAppointmentCard } from '@/components/appointments/appointmentPrint'

// The public, no-login page a patient reaches by scanning the hospital's QR
// code. They fill their OWN details here before the counter, so reception only
// searches and confirms instead of typing all thirty fields.
//
// Deliberately standalone: no app Shell, no sidebar, no auth. It mounts OUTSIDE
// the authenticated tree (see App.jsx) because a walk-up patient has no account.
// Two outcomes, chosen by the patient:
//   - details only: a pending row the counter turns into a registration (no
//     Patient, no UHID until reception confirms), as before;
//   - "Book an appointment now": registered AND booked straight away, through
//     POST /public/org/:orgId/book — which runs the very same patient-create and
//     appointment-create handlers the counter uses. The booking fields are the
//     counter's own AppointmentFields component, with the priority picker hidden
//     (a patient cannot mark their own visit urgent).
//
// The fields and their rules are NOT written here. They are the same
// PatientDetailsFields and patientDetailsSchema reception registers with, so
// what the patient types is exactly what the counter's form expects — same
// labels, same validation, same field names. This page used to carry its own
// copy of both, which is how it came to ask for "Mobile number" where reception
// asked for "Primary Phone", and to skip locality, district, second phone,
// marital status, relationship and insurance altogether — nine fields reception
// then had to type again, which is the work this page exists to remove.
//
// One reception-only field is hidden (showMedicoLegal): the MLC number is the
// hospital's record of the visit, not the patient's to fill in. "Referred By"
// and the notes are asked for — the patient knows who sent them and why.

const EMPTY = {
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: 'male',
  maritalStatus: '', referredBy: '', mlcNumber: '',
  phonePrimary: '', phoneSecondary: '', email: '',
  houseNumber: '', street: '', locality: '', city: '', district: '', state: '', pincode: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
  bloodGroup: '', hasInsurance: false, insuranceProvider: '', insuranceId: '',
  notes: '',
  // Same appointment fields, same defaults as the counter's form.
  bookAppointment: false,
  department: '', doctor: '', consultationFee: '', appointmentType: 'OPD', priority: 'Routine',
  appointmentDate: '', appointmentTime: '',
}

export default function SelfRegisterPage() {
  // The hospital id rides in on the QR URL: /self-register?org=<id>.
  const orgId = useMemo(() => new URLSearchParams(window.location.search).get('org') || '', [])

  const [org, setOrg] = useState(null)
  const [orgError, setOrgError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [booked, setBooked] = useState(null) // { mrn, doctorName, date, time, alreadyRegistered }
  // 'new' fills the registration form; 'existing' finds the patient's record
  // (the counter's own PatientLookup) and goes straight to booking — someone
  // already registered should never have to type their whole form again.
  const [mode, setMode] = useState('new')
  const [existingPatient, setExistingPatient] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])

  // Confirm the QR points at a real hospital, and show its name — so a patient
  // sees where they are registering before typing anything.
  useEffect(() => {
    if (!orgId) { setOrgError('This link is missing its hospital code. Please scan the QR code again.'); return }
    let live = true
    client.get(`/public/org/${orgId}`)
      .then((res) => { if (live) setOrg(res.data) })
      .catch(() => { if (live) setOrgError('We could not find this hospital. Please scan the QR code again.') })
    return () => { live = false }
  }, [orgId])

  // The lists the booking fields offer — the same lean doctor list and departments
  // the counter books from, read through the hospital's public endpoints.
  useEffect(() => {
    if (!org?.id) return
    let live = true
    client.get(`/public/org/${org.id}/doctors`)
      .then((res) => { if (live) setDoctors((res.data ?? []).filter((u) => (u.role ?? 'doctor') === 'doctor' && u.isActive !== false)) })
      .catch(() => {})
    client.get(`/public/org/${org.id}/departments`)
      .then((res) => { if (live) setDepartments(res.data ?? []) })
      .catch(() => {})
    return () => { live = false }
  }, [org?.id])

  // The same three setters the reception form passes down, so every field
  // behaves identically on a phone and at the counter.
  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }
  const setTextField = (field, raw) => setField(field, sanitizeTextInput(raw))
  const setNameField = (field, raw) => setField(field, sanitizeNameInput(raw))

  async function submit(e) {
    e.preventDefault()
    setFormError('')

    if (mode === 'existing') {
      const errors = {}
      if (!existingPatient) errors.existingPatient = 'Find your record first'
      if (!form.doctor) errors.doctor = 'Please select a doctor'
      if (!form.appointmentDate) errors.appointmentDate = 'Appointment date is required'
      if (Object.keys(errors).length) { setFieldErrors(errors); return }

      setSubmitting(true)
      try {
        // The server checks again that the chosen patient is registered on this
        // mobile number — an id from the page alone is never trusted.
        const res = await client.post(`/public/org/${orgId}/book`, {
          existing: { mobile: existingPatient.phonePrimary, patientId: existingPatient.id },
          appointment: buildAppointmentPayload(form),
        })
        const doc = doctors.find((d) => d.id === form.doctor)
        setBooked({
          name: [existingPatient.firstName, existingPatient.lastName].filter(Boolean).join(' '),
          mrn: res.data?.patient?.mrn,
          alreadyRegistered: false,
          doctorName: doc ? drName(doc.fullName) : '',
          date: form.appointmentDate,
          time: form.appointmentTime,
          appointment: res.data?.appointment || null,
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (err) {
        setFormError(err?.message || 'Could not book. Please try again.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    // Booking adds the counter's own rule: doctor and date required.
    const parsed = (form.bookAppointment ? patientFormSchema : patientDetailsSchema).safeParse(form)
    if (!parsed.success) {
      setFieldErrors(issuesToFieldErrors(parsed.error.issues))
      // Jump to the first thing that needs fixing — on a long phone form the
      // error can be well above the button they just pressed.
      setTimeout(() => {
        document.querySelector('.border-red-500, .text-red-600')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
      return
    }

    setSubmitting(true)
    try {
      if (form.bookAppointment) {
        // Exactly the two requests the counter makes, in one call: the patient
        // body reception sends to POST /patients, and the appointment body it
        // sends to POST /appointments.
        const patient = patientDetailsSchema.parse(form)
        const res = await client.post(`/public/org/${orgId}/book`, {
          patient: { ...patient, hasInsurance: form.hasInsurance === true },
          appointment: buildAppointmentPayload(form),
        })
        const doc = doctors.find((d) => d.id === form.doctor)
        setBooked({
          mrn: res.data?.patient?.mrn,
          alreadyRegistered: res.data?.alreadyRegistered,
          doctorName: doc ? drName(doc.fullName) : '',
          date: form.appointmentDate,
          time: form.appointmentTime,
          // The booked appointment as the server recorded it — fee, type and
          // status included — for the appointment card.
          appointment: res.data?.appointment || null,
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      // Send only what was filled — blanks stay out of the stored form, which
      // is handed back to the reception form untouched on confirm.
      const payload = { organizationId: orgId }
      for (const [k, v] of Object.entries(parsed.data)) {
        if (v !== undefined && v !== '' && v !== false) payload[k] = v
      }
      await client.post('/public/pre-registration', payload)
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      if ((err.status === 400 || err.status === 422) && Array.isArray(err.details)) {
        setFieldErrors(issuesToFieldErrors(err.details))
      }
      setFormError(err?.message || 'Could not submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Hospital not found / bad link ────────────────────────────────────────
  if (orgError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-slate-700">{orgError}</p>
        </div>
      </div>
    )
  }

  // ── Booked ───────────────────────────────────────────────────────────────
  if (booked) {
    const when = booked.date
      ? new Date(`${booked.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : ''
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CalendarCheck className="mx-auto h-16 w-16 text-green-500" />
          <h1 className="mt-4 text-xl font-bold text-slate-800">Appointment Confirmed</h1>
          <p className="mt-2 text-slate-600">
            Thank you, <span className="font-semibold">{booked.name || form.firstName}</span>. Your appointment has been booked.
          </p>
          <dl className="mt-5 space-y-2 rounded-lg bg-slate-50 p-4 text-left text-sm text-slate-700">
            {booked.mrn && <div className="flex justify-between gap-3"><dt className="text-slate-500">UHID</dt><dd className="font-mono font-semibold">{booked.mrn}</dd></div>}
            {booked.doctorName && <div className="flex justify-between gap-3"><dt className="text-slate-500">Doctor</dt><dd className="text-right font-semibold">{booked.doctorName}</dd></div>}
            {when && <div className="flex justify-between gap-3"><dt className="text-slate-500">Date</dt><dd className="text-right font-semibold">{when}</dd></div>}
            {booked.time && <div className="flex justify-between gap-3"><dt className="text-slate-500">Time</dt><dd className="font-semibold">{format12Hour(booked.time)}</dd></div>}
          </dl>
          <div className="mt-4 rounded-lg bg-blue-50 p-4 text-left text-sm text-blue-800">
            Please arrive <span className="font-semibold">15 minutes before</span> your appointment time and share your{' '}
            <span className="font-semibold">UHID</span> or <span className="font-semibold">registered mobile number</span> at the reception counter.
            {booked.alreadyRegistered && <> Your existing registration has been used.</>}
          </div>
          {booked.appointment && (
            <>
              {/* The same appointment card reception prints (printAppointmentCard):
                  the hospital's template, not a second design for the phone. It
                  opens the print dialog, where "Save as PDF" downloads it. */}
              <Button
                type="button"
                className="mt-5 h-11 w-full"
                onClick={() => printAppointmentCard(booked.appointment, { name: org?.name || 'Hospital' })}
              >
                <Download className="mr-2 h-4 w-4" /> Download Appointment Card (PDF)
              </Button>
              <p className="mt-2 text-xs text-slate-400">When the print window opens, select &ldquo;Save as PDF&rdquo;.</p>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" />
          <h1 className="mt-4 text-xl font-bold text-slate-800">Details Received</h1>
          <p className="mt-2 text-slate-600">
            Thank you, <span className="font-semibold">{form.firstName}</span>. Your registration details have been submitted.
          </p>
          <div className="mt-5 rounded-lg bg-blue-50 p-4 text-left text-sm text-blue-800">
            Please visit the <span className="font-semibold">reception counter</span> and share your{' '}
            <span className="font-semibold">name</span> or <span className="font-semibold">mobile number</span> to complete
            your registration. You will not need to fill in your details again.
          </div>
        </div>
      </div>
    )
  }

  // ── The form ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        {/* Header */}
        {/* The hospital's own logo and name first — the patient just scanned a
            poster on a wall and should see at once whose form this is (the same
            logo and name the poster carries). The generic icon is only the
            fallback for a hospital with no logo. */}
        {/* On a phone the header is tightened up — a patient standing in the
            corridor should reach the first field without scrolling past a
            half-screen of heading. The words are the same on both. */}
        <div className="mb-6 text-center max-sm:mb-5">
          {org?.logoUrl ? (
            <img
              src={org.logoUrl}
              alt={`${org.name} logo`}
              className="mx-auto mb-3 h-20 w-20 rounded-2xl border border-slate-200 bg-white object-contain p-2 shadow-sm max-sm:mb-2 max-sm:h-16 max-sm:w-16"
            />
          ) : (
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 max-sm:mb-2 max-sm:h-14 max-sm:w-14">
              <UserPlus className="h-8 w-8 text-blue-600" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-slate-800 [text-wrap:balance] max-sm:text-xl">
            {org?.name || 'Patient Registration'}
          </h1>
          {org?.city && <p className="text-sm text-slate-500">{org.city}</p>}
          <p className="mt-4 text-lg font-semibold text-slate-700 max-sm:mt-3 max-sm:text-base">Patient Registration &amp; Appointment Booking</p>
          <p className="mt-1 text-sm text-slate-500 max-sm:text-[13px]">
            Complete your registration or book an appointment online and save time at the reception counter.
          </p>
        </div>

        {/* Phone styling for the SHARED fields, applied from here so the same
            components keep reception's look untouched — none of these rules
            exist above sm:. A phone gets: white cards instead of grey panels,
            taller fields, and 16px text in every field, which is the size below
            which iOS zooms the page in the moment a field is tapped, leaving
            the patient scrolled sideways on a form they cannot read. */}
        <form
          onSubmit={submit}
          className={cn(
            'space-y-4',
            // One size for every field on this page. The inputs are set taller
            // than the shared default here, so the dropdowns (Gender, Blood
            // Group, Marital Status, State) have to be set with them or they
            // sit 8px shorter than the box beside them, which is what a patient
            // notices first.
            '[&_input:not([type=checkbox])]:h-11 [&_input:not([type=checkbox])]:text-[15px]',
            '[&_button[role=combobox]]:h-11 [&_button[role=combobox]]:text-[15px]',
            '[&_textarea]:text-[15px]',
            'max-sm:space-y-3',
            'max-sm:[&_section]:rounded-2xl max-sm:[&_section]:border-slate-200 max-sm:[&_section]:bg-white max-sm:[&_section]:p-4 max-sm:[&_section]:shadow-sm',
            // the icon + title row that opens every section
            'max-sm:[&_section>div:first-of-type]:mb-1 max-sm:[&_section>div:first-of-type]:text-[15px] max-sm:[&_section>div:first-of-type]:text-slate-800',
            'max-sm:[&_label]:text-[13px] max-sm:[&_label]:text-slate-600',
            'max-sm:[&_input:not([type=checkbox])]:h-12 max-sm:[&_input:not([type=checkbox])]:rounded-xl max-sm:[&_input:not([type=checkbox])]:bg-white max-sm:[&_input:not([type=checkbox])]:text-base',
            'max-sm:[&_textarea]:rounded-xl max-sm:[&_textarea]:bg-white max-sm:[&_textarea]:text-base',
            'max-sm:[&_button[role=combobox]]:h-12 max-sm:[&_button[role=combobox]]:rounded-xl max-sm:[&_button[role=combobox]]:bg-white max-sm:[&_button[role=combobox]]:text-base',
            'max-sm:[&_button[role=checkbox]]:h-5 max-sm:[&_button[role=checkbox]]:w-5',
            // The browser's own calendar button inside the date field. Left
            // alone it floats right beside the digits, mid-field, which reads as
            // a stray icon; it belongs at the edge of the box like the arrow on
            // the dropdowns beside it. On a phone it is also enlarged, because a
            // 1rem target is a hard thing to hit with a thumb.
            '[&_input[type=date]]:relative',
            '[&_input[type=date]::-webkit-calendar-picker-indicator]:absolute [&_input[type=date]::-webkit-calendar-picker-indicator]:right-3 [&_input[type=date]::-webkit-calendar-picker-indicator]:cursor-pointer [&_input[type=date]::-webkit-calendar-picker-indicator]:opacity-60',
            'max-sm:[&_input[type=date]::-webkit-calendar-picker-indicator]:h-6 max-sm:[&_input[type=date]::-webkit-calendar-picker-indicator]:w-6',
          )}
          noValidate
        >
          {/* New or already registered — chosen first, so a returning patient
              never faces the registration form at all. */}
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">Have you visited this hospital before?</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Patient type">
              {[
                ['new', 'New Patient', 'First visit — register now'],
                ['existing', 'Returning Patient', 'Already registered with us'],
              ].map(([key, label, sub]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={mode === key}
                  onClick={() => {
                    setMode(key)
                    setFieldErrors({})
                    setFormError('')
                    // A returning patient is here to book.
                    if (key === 'existing') setField('bookAppointment', true)
                  }}
                  className={`rounded-lg border p-3 text-left transition-colors max-sm:rounded-2xl max-sm:p-4 ${mode === key
                    ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                    : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <span className={`block text-sm font-semibold ${mode === key ? 'text-blue-700' : 'text-slate-800'}`}>{label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{sub}</span>
                </button>
              ))}
            </div>
          </div>

          {mode === 'existing' ? (
            <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Find your registration</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Enter the mobile number you registered with. Select your name from the list to continue.
                </p>
              </div>
              <div>
                <Label className="text-xs text-gray-600">Registered Mobile Number <span className="text-red-500">*</span></Label>
                {/* The counter's own patient search, pointed at the hospital's
                    public endpoint: it answers only a complete 10-digit mobile
                    number, with names and UHIDs masked. */}
                <PatientLookup
                  className="mt-1"
                  selectedPatient={existingPatient}
                  onSelect={(p) => { setExistingPatient(p); setFieldErrors((prev) => ({ ...prev, existingPatient: undefined })) }}
                  onClear={() => setExistingPatient(null)}
                  placeholder="10-digit mobile number"
                  showHint={false}
                  allowAddNew={false}
                  searchUrl={`/public/org/${orgId}/patients`}
                  minSearchLength={10}
                  minLengthHint="Enter all 10 digits of your mobile number."
                  emptyText="No registration found for this mobile number."
                />
                <FieldError message={fieldErrors.existingPatient} />
              </div>
              {!existingPatient && (
                <p className="text-xs text-slate-500">
                  Not registered yet?{' '}
                  <button type="button" className="font-semibold text-blue-600 underline" onClick={() => setMode('new')}>
                    Register as a new patient
                  </button>
                </p>
              )}
            </section>
          ) : (
            <PatientDetailsFields
              patientForm={form}
              setField={setField}
              setNameField={setNameField}
              setTextField={setTextField}
              fieldErrors={fieldErrors}
              showMedicoLegal={false}
              patientFilling
            />
          )}
          {(mode === 'new' || existingPatient) && (
          <AppointmentFields
            patientForm={form}
            setField={setField}
            setPatientForm={setForm}
            fieldErrors={fieldErrors}
            setFieldErrors={setFieldErrors}
            doctors={doctors}
            departments={departments}
            timetableUrl={(doctorId) => `/public/org/${orgId}/doctor-timetable?doctorId=${encodeURIComponent(doctorId)}`}
            slotCheckUrl={`/public/org/${orgId}/check-slot`}
            showPriority={false}
            notBookingNote={mode === 'existing'
              ? 'Select this option to book your appointment.'
              : 'Leave this unselected to submit your details only. The reception counter will complete your registration when you arrive.'}
          />
          )}
          {mode === 'new' && <NotesSection value={form.notes} setField={setField} />}

          {formError && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">{formError}</p>
          )}

          {/* On a phone: a full-width bar that follows the patient down the
              form, so the button is always under their thumb. On a wider screen
              that bar covers the fields and reads as a banner rather than a
              button, so there it is an ordinary button at the end of the form,
              with the required-fields note beside it. */}
          <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:flex sm:flex-row-reverse sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
            <Button
              type="submit"
              disabled={submitting || !org || (mode === 'existing' && (!existingPatient || !form.bookAppointment))}
              className="h-12 w-full text-base sm:h-11 sm:w-auto sm:px-10"
            >
              {submitting
                ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {form.bookAppointment ? 'Booking…' : 'Submitting…'}</>
                : form.bookAppointment || mode === 'existing' ? 'Book appointment' : 'Submit'}
            </Button>
            <p className="mt-2 text-center text-xs text-slate-400 sm:mt-0">
              Fields marked <span className="text-red-500">*</span> are required.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
