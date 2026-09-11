import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { CheckCircle2, Loader2, UserPlus } from 'lucide-react'
import client from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/common/PhoneInput'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// The public, no-login page a patient reaches by scanning the hospital's QR
// code. They fill their OWN details here before the counter, so reception only
// searches and confirms instead of typing all thirty fields.
//
// Deliberately standalone: no app Shell, no sidebar, no auth. It mounts OUTSIDE
// the authenticated tree (see App.jsx) because a walk-up patient has no account.
// It never creates a Patient or a UHID — only a pending row the counter turns
// into a real registration.

// Only the five fields reception truly needs to find and identify a person are
// required; everything else is optional so a nervous patient on a phone in a
// waiting hall is never blocked by a field they don't know. Reception fills or
// fixes the rest at the counter.
const schema = z.object({
  firstName: z.string().trim().min(2, 'Please enter your first name'),
  middleName: z.string().trim().optional().or(z.literal('')),
  lastName: z.string().trim().min(1, 'Please enter your last name'),
  dateOfBirth: z.string().min(1, 'Please choose your date of birth'),
  gender: z.enum(['male', 'female', 'other'], { errorMap: () => ({ message: 'Please choose' }) }),
  phonePrimary: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  houseNumber: z.string().trim().optional().or(z.literal('')),
  street: z.string().trim().optional().or(z.literal('')),
  city: z.string().trim().optional().or(z.literal('')),
  state: z.string().trim().optional().or(z.literal('')),
  pincode: z.string().trim().regex(/^\d{6}$/, 'PIN must be 6 digits').optional().or(z.literal('')),
  bloodGroup: z.string().optional().or(z.literal('')),
  emergencyContactName: z.string().trim().optional().or(z.literal('')),
  emergencyContactPhone: z.string().trim().optional().or(z.literal('')),
})

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']

const EMPTY = {
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: '',
  phonePrimary: '', email: '',
  houseNumber: '', street: '', city: '', state: '', pincode: '',
  bloodGroup: '', emergencyContactName: '', emergencyContactPhone: '',
}

/** 'yyyy-MM-dd' for today — a birth date can never be in the future. */
function todayYmd() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function Field({ label, required, error, children, hint }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  )
}

export default function SelfRegisterPage() {
  // The hospital id rides in on the QR URL: /self-register?org=<id>.
  const orgId = useMemo(() => new URLSearchParams(window.location.search).get('org') || '', [])

  const [org, setOrg] = useState(null)
  const [orgError, setOrgError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
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

  const set = (k) => (v) => {
    setForm((p) => ({ ...p, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  async function submit(e) {
    e.preventDefault()
    const parsed = schema.safeParse(form)
    if (!parsed.success) {
      const fieldErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      // Jump to the first thing that needs fixing — on a long phone form the
      // error can be well above the button they just pressed.
      const first = document.querySelector('[data-error="true"]')
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setSubmitting(true)
    try {
      // Send only what was filled — blanks stay out of the stored form.
      const payload = { organizationId: orgId }
      for (const [k, v] of Object.entries(parsed.data)) {
        if (v !== undefined && v !== '') payload[k] = v
      }
      await client.post('/public/pre-registration', payload)
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setErrors((prev) => ({ ...prev, _form: err?.message || 'Could not submit. Please try again.' }))
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

        <form onSubmit={submit} className="space-y-4" noValidate>
          {/* Your details */}
          <Section title="Your details" subtitle="As on your ID">
            <div data-error={!!errors.firstName}>
              <Field label="First name" required error={errors.firstName}>
                <Input value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} placeholder="Ramesh" />
              </Field>
            </div>
            <Field label="Middle name" error={errors.middleName}>
              <Input value={form.middleName} onChange={(e) => set('middleName')(e.target.value)} placeholder="(optional)" />
            </Field>
            <div data-error={!!errors.lastName}>
              <Field label="Last name" required error={errors.lastName}>
                <Input value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} placeholder="Kumar" />
              </Field>
            </div>
            <div data-error={!!errors.dateOfBirth}>
              <Field label="Date of birth" required error={errors.dateOfBirth}>
                <Input type="date" max={todayYmd()} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth')(e.target.value)} />
              </Field>
            </div>
            <div data-error={!!errors.gender}>
              <Field label="Gender" required error={errors.gender}>
                <Select value={form.gender} onValueChange={set('gender')}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Blood group" error={errors.bloodGroup} hint="If you know it">
              <Select value={form.bloodGroup} onValueChange={set('bloodGroup')}>
                <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          {/* Contact */}
          <Section title="Contact" subtitle="How the hospital reaches you">
            <div data-error={!!errors.phonePrimary}>
              <Field label="Mobile number" required error={errors.phonePrimary} hint="Reception finds you by this">
                {/* The shared field, not a local `.replace().slice(0, 10)`.
                    Slicing turns "+91 98765 43210" into "9198765432" — ten
                    digits, starts with 9, passes the schema, and reaches
                    nobody. sanitizePhoneInput strips the country code instead,
                    and leaves anything it cannot recognise for the schema to
                    refuse rather than inventing a number from it. */}
                <PhoneInput value={form.phonePrimary} onChange={set('phonePrimary')}
                  placeholder="9876543210" />
              </Field>
            </div>
            <Field label="Email" error={errors.email}>
              <Input type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} placeholder="(optional)" />
            </Field>
          </Section>

          {/* Address — all optional */}
          <Section title="Address" subtitle="Optional — reception can add this">
            <Field label="House / Flat no." error={errors.houseNumber}>
              <Input value={form.houseNumber} onChange={(e) => set('houseNumber')(e.target.value)} />
            </Field>
            <Field label="Street / Area" error={errors.street}>
              <Input value={form.street} onChange={(e) => set('street')(e.target.value)} />
            </Field>
            <Field label="City" error={errors.city}>
              <Input value={form.city} onChange={(e) => set('city')(e.target.value)} placeholder="Mumbai" />
            </Field>
            <Field label="State" error={errors.state}>
              <Input value={form.state} onChange={(e) => set('state')(e.target.value)} placeholder="Maharashtra" />
            </Field>
            <Field label="PIN code" error={errors.pincode}>
              <Input inputMode="numeric" maxLength={6} value={form.pincode}
                onChange={(e) => set('pincode')(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="400001" />
            </Field>
          </Section>

          {/* Emergency contact — optional */}
          <Section title="Emergency contact" subtitle="Optional — someone we can call">
            <Field label="Name" error={errors.emergencyContactName}>
              <Input value={form.emergencyContactName} onChange={(e) => set('emergencyContactName')(e.target.value)} />
            </Field>
            <Field label="Their mobile" error={errors.emergencyContactPhone}>
              {/* Same field, same reason as the mobile above. */}
              <PhoneInput value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} />
            </Field>
          </Section>

          {errors._form && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">{errors._form}</p>
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
