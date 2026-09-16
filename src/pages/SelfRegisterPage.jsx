import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, UserPlus } from 'lucide-react'
import client from '@/api/client'
import { Button } from '@/components/ui/button'
import PatientDetailsFields from '@/components/common/PatientDetailsFields'
import { patientDetailsSchema, issuesToFieldErrors } from '@/lib/schemas/patientFormSchema'
import { sanitizeTextInput, sanitizeNameInput } from '@/components/common/textFieldUtils'

// The public, no-login page a patient reaches by scanning the hospital's QR
// code. They fill their OWN details here before the counter, so reception only
// searches and confirms instead of typing all thirty fields.
//
// Deliberately standalone: no app Shell, no sidebar, no auth. It mounts OUTSIDE
// the authenticated tree (see App.jsx) because a walk-up patient has no account.
// It never creates a Patient or a UHID — only a pending row the counter turns
// into a real registration.
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
// Two reception-only fields are hidden (showMedicoLegal): "Referred By" and
// "MLC Number" are the hospital's record of the visit, not the patient's to
// fill in.

const EMPTY = {
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: 'male',
  maritalStatus: '', referredBy: '', mlcNumber: '',
  phonePrimary: '', phoneSecondary: '', email: '',
  houseNumber: '', street: '', locality: '', city: '', district: '', state: '', pincode: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
  bloodGroup: '', hasInsurance: false, insuranceProvider: '', insuranceId: '',
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

    const parsed = patientDetailsSchema.safeParse(form)
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
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <UserPlus className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            {org ? `Register at ${org.name}` : 'Patient Registration'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Fill your details here to save time at the counter. It takes about a minute.
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

          {formError && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">{formError}</p>
          )}

          <div className="sticky bottom-0 -mx-4 bg-slate-50/80 px-4 py-3 backdrop-blur">
            <Button type="submit" disabled={submitting || !org} className="h-12 w-full text-base">
              {submitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Submitting…</> : 'Submit'}
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
