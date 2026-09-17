import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CalendarCheck, Download, Loader2, UserPlus } from 'lucide-react'
import client from '@/api/client'
import { Button } from '@/components/ui/button'
import PatientDetailsFields, { NotesSection } from '@/components/common/PatientDetailsFields'
import AppointmentFields, { buildAppointmentPayload, format12Hour } from '@/components/common/AppointmentFields'
import { patientDetailsSchema, patientFormSchema, issuesToFieldErrors } from '@/lib/schemas/patientFormSchema'
import { drName } from '@/lib/utils'
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
          <h1 className="mt-4 text-xl font-bold text-slate-800">Appointment booked!</h1>
          <p className="mt-2 text-slate-600">
            Thank you, <span className="font-semibold">{form.firstName}</span>.
          </p>
          <div className="mt-5 space-y-2 rounded-lg bg-slate-50 p-4 text-left text-sm text-slate-700">
            {booked.mrn && <p><span className="text-slate-500">Your UHID:</span> <span className="font-mono font-semibold">{booked.mrn}</span></p>}
            {booked.doctorName && <p><span className="text-slate-500">Doctor:</span> <span className="font-semibold">{booked.doctorName}</span></p>}
            {when && <p><span className="text-slate-500">Date:</span> <span className="font-semibold">{when}</span></p>}
            {booked.time && <p><span className="text-slate-500">Time:</span> <span className="font-semibold">{format12Hour(booked.time)}</span></p>}
          </div>
          <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            Please reach <span className="font-semibold">15 minutes early</span> and tell the reception counter your{' '}
            <span className="font-semibold">UHID</span> or <span className="font-semibold">mobile number</span>.
            {booked.alreadyRegistered && <> You were already registered with us, so your existing UHID is used.</>}
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
                <Download className="mr-2 h-4 w-4" /> Download appointment card (PDF)
              </Button>
              <p className="mt-2 text-xs text-slate-400">In the print window, choose &ldquo;Save as PDF&rdquo;.</p>
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
          <h1 className="mt-4 text-xl font-bold text-slate-800">You&rsquo;re all set!</h1>
          <p className="mt-2 text-slate-600">
            Thank you, <span className="font-semibold">{form.firstName}</span>. Your details are saved.
          </p>
          <div className="mt-5 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            Please go to the <span className="font-semibold">reception counter</span> and tell them your{' '}
            <span className="font-semibold">name</span> or{' '}
            <span className="font-semibold">mobile number</span> to finish. No need to fill anything again.
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
        <div className="mb-6 text-center">
          {org?.logoUrl ? (
            <img
              src={org.logoUrl}
              alt={`${org.name} logo`}
              className="mx-auto mb-3 h-20 w-20 rounded-2xl border border-slate-200 bg-white object-contain p-2 shadow-sm"
            />
          ) : (
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
              <UserPlus className="h-8 w-8 text-blue-600" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-slate-800 [text-wrap:balance]">
            {org?.name || 'Patient Registration'}
          </h1>
          {org?.city && <p className="text-sm text-slate-500">{org.city}</p>}
          <p className="mt-3 text-lg font-semibold text-slate-700">Patient Registration</p>
          <p className="mt-1 text-sm text-slate-500">
            Fill your details here to save time at the counter — and book your appointment if you like.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 [&_input:not([type=checkbox])]:h-11 [&_input:not([type=checkbox])]:text-[15px]"
          noValidate
        >
          <PatientDetailsFields
            patientForm={form}
            setField={setField}
            setNameField={setNameField}
            setTextField={setTextField}
            fieldErrors={fieldErrors}
            showMedicoLegal={false}
          />
          <AppointmentFields
            patientForm={form}
            setField={setField}
            setPatientForm={setForm}
            fieldErrors={fieldErrors}
            setFieldErrors={setFieldErrors}
            doctors={doctors}
            departments={departments}
            timetableUrl={(doctorId) => `/public/org/${orgId}/doctor-timetable?doctorId=${encodeURIComponent(doctorId)}`}
            showPriority={false}
            notBookingNote="Leave this unticked to just share your details — the reception counter will register you when you arrive."
          />
          <NotesSection value={form.notes} setField={setField} />

          {formError && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">{formError}</p>
          )}

          <div className="sticky bottom-0 -mx-4 bg-slate-50/80 px-4 py-3 backdrop-blur">
            <Button type="submit" disabled={submitting || !org} className="h-12 w-full text-base">
              {submitting
                ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {form.bookAppointment ? 'Booking…' : 'Submitting…'}</>
                : form.bookAppointment ? 'Book appointment' : 'Submit'}
            </Button>
            <p className="mt-2 text-center text-xs text-slate-400">
              <span className="text-red-500">*</span> marked fields are required. The rest are optional.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
