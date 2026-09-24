import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Users, Phone, MapPin, AlertCircle, Shield, FileText, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhoneInput } from './PhoneInput'
import { sanitizeTextInput, sanitizeMultilineInput } from './textFieldUtils'
import { BLOOD_GROUPS } from '@/components/patients/utils/patientUtils'
import { dobInputBounds } from '@/lib/schemas/patientFormSchema'

// The patient half of registration — who the person is, how to reach them,
// where they live, who to call, and their insurance. Nothing else: no doctor,
// no appointment, no submit button, and not one API call.
//
// It lives on its own because two screens ask for exactly these details and
// they MUST agree, field for field and word for word:
//   - reception's "Register New Patient" (RegisterPatientForm), and
//   - the patient's own phone, from the entrance QR code (SelfRegisterPage).
// They were written twice, so the QR form asked for "Mobile number" while
// reception asked for "Primary Phone", and the QR form never asked for
// locality, district, marital status, second phone, relationship or insurance
// at all — nine fields reception then had to type again at the counter, which
// is the very work the QR code exists to remove.
//
// The caller owns the values and the validation (see patientFormSchema), and
// decides what happens on submit: reception creates the patient and books the
// appointment, the QR page only files a pending self-registration.

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry',
]

export const INSURANCE_PROVIDERS = [
  'CGHS', 'ESIC', 'PM-JAY (Ayushman Bharat)', 'Star Health', 'HDFC ERGO',
  'Niva Bupa', 'Care Health', 'ICICI Lombard', 'Bajaj Allianz', 'LIC Health',
  'United India', 'New India Assurance', 'Oriental Insurance', 'National Insurance',
  'Max Bupa', 'Reliance Health', 'SBI Health', 'Tata AIG',
]

export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Other']

// The date-of-birth picker's range comes from the shared dobInputBounds() —
// the same limit the schema and the server enforce (it used to be a separate
// 120-year copy here). Read at render, not at import: a screen left open
// overnight would otherwise still cap the date at yesterday.

// The stored value is lowercase (the API and the patient list filter on it);
// the label is what the patient reads.
export const GENDERS = [
  { value: 'male',   label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other',  label: 'Other' },
]

// Renders next to a field, right under its Input/Select, for both a Zod
// validation error caught before submit and a validation error the backend
// sends back after it — one place, either source.
export function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
}

/**
 * Free-text notes about the visit. Separate from the fields above because the
 * reception form places it after the appointment section, while the QR page has
 * no appointment section to place it after — one component, two positions.
 */
export function NotesSection({ value, setField }) {
  return (
    <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
        <FileText className="h-4 w-4 text-blue-600" />Notes
      </div>
      <Textarea
        rows={3}
        value={value}
        onChange={e => setField('notes', sanitizeMultilineInput(e.target.value))}
        placeholder="Any additional notes (reason for visit, special instructions, referral details...)"
      />
    </section>
  )
}

/**
 * A short list of choices as buttons the patient taps, instead of a dropdown.
 *
 * On a phone a dropdown is a tap, a scroll and a second tap, with the list
 * covering the form while it is open. These lists are short enough to sit on
 * the screen, so one tap answers the question. Tapping the chosen option again
 * clears it, except where an answer is required.
 *
 * Buttons are at least 44px tall — the smallest target a thumb hits reliably.
 */
function ChoiceChips({ label, value, options, onChange, required = false, error, cols = '' }) {
  return (
    // Phone screens only — the dropdown beside it takes over from sm: up, so a
    // desktop keeps the form it has always had.
    <div className="sm:hidden">
      <Label className="text-xs text-gray-600">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <div className={cn('mt-1 flex flex-wrap gap-2', cols)}>
        {options.map(opt => {
          const selected = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected && !required ? '' : opt.value)}
              // The chosen one has to be obvious at arm's length on a phone in a
              // busy corridor: a tick, a ring around it, a heavier colour and
              // bolder text — colour alone was too easy to miss, and is invisible
              // to a colour-blind patient. Pressing any option dips it slightly,
              // so a tap that did register is felt even before the eye catches up.
              className={cn(
                'flex min-h-[48px] flex-1 basis-[28%] items-center justify-center gap-1.5 rounded-xl border px-3 text-[15px] transition-all active:scale-[0.97]',
                selected
                  ? 'border-blue-600 bg-blue-600 font-semibold text-white shadow-sm ring-2 ring-blue-200'
                  : 'border-gray-300 bg-white font-medium text-gray-700 active:bg-gray-100',
                error && !selected && 'border-red-400',
              )}
            >
              {selected && <Check className="h-4 w-4 shrink-0" strokeWidth={3} />}
              {opt.label}
            </button>
          )
        })}
      </div>
      <FieldError message={error} />
    </div>
  )
}

/**
 * @param {object}   patientForm   the form values (firstName, phonePrimary, …)
 * @param {function} setField      (name, value) — stores the value as given
 * @param {function} setNameField  (name, value) — for person/place names
 * @param {function} setTextField  (name, value) — for free text
 * @param {object}   fieldErrors   { fieldName: 'message' }
 * @param {boolean}  showMedicoLegal  the MLC (medico-legal case) number — a
 *                   hospital record about the visit, not something a patient
 *                   fills in on their own phone. Defaults to true so reception
 *                   keeps the form it has always had. "Referred By" is shown
 *                   either way: the patient knows who sent them.
 * @param {boolean}  patientFilling  on a PHONE-SIZED screen only, gender, blood
 *                   group and marital status become tappable options instead of
 *                   dropdowns — for the QR page, which is filled in on a phone.
 *                   From sm: up (tablet, desktop) the dropdowns are shown as
 *                   before, and reception is unaffected either way: it does not
 *                   pass this. Same fields, same stored values, both ways.
 */
export default function PatientDetailsFields({
  patientForm,
  setField,
  setNameField,
  setTextField,
  fieldErrors = {},
  showMedicoLegal = true,
  patientFilling = false,
}) {
  return (
    <>
      {/* Personal Information */}
      <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Users className="h-4 w-4 text-blue-600" />Patient Details
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 [&>div]:min-w-0">
          <div>
            <Label className="text-xs text-gray-600">First Name <span className="text-red-500">*</span></Label>
            <Input className={cn('mt-1', fieldErrors.firstName && 'border-red-500')} value={patientForm.firstName} onChange={e => setNameField('firstName', e.target.value)} required placeholder="First name" />
            <FieldError message={fieldErrors.firstName} />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Middle Name</Label>
            <Input className="mt-1" value={patientForm.middleName} onChange={e => setNameField('middleName', e.target.value)} placeholder="Middle name" />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Last Name <span className="text-red-500">*</span></Label>
            <Input className={cn('mt-1', fieldErrors.lastName && 'border-red-500')} value={patientForm.lastName} onChange={e => setNameField('lastName', e.target.value)} required placeholder="Last name" />
            <FieldError message={fieldErrors.lastName} />
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 [&>div]:min-w-0">
          <div>
            <Label className="text-xs text-gray-600">Date of Birth <span className="text-red-500">*</span></Label>
            <Input
              className={cn('mt-1', fieldErrors.dateOfBirth && 'border-red-500')}
              type="date"
              value={patientForm.dateOfBirth}
              onChange={e => setField('dateOfBirth', e.target.value)}
              required
              // A patient filling this on their own phone gets the date picker
              // from tapping anywhere in the field, not just the small icon at
              // its edge, and the picker opens within a sensible range instead
              // of at today — a birth date is never in the future, and the year
              // list starts at a plausible one rather than scrolling from 2026.
              // The range applies to reception too, so a picked date can never
              // be out of range; a typed one is caught by the schema on save.
              min={dobInputBounds().min}
              max={dobInputBounds().max}
              {...(patientFilling ? {
                onClick: e => { try { e.currentTarget.showPicker?.() } catch { /* not allowed here — the icon still works */ } },
              } : {})}
            />
            <FieldError message={fieldErrors.dateOfBirth} />
          </div>
          {patientFilling && (
            <ChoiceChips
              label="Gender"
              required
              value={patientForm.gender}
              onChange={v => setField('gender', v)}
              error={fieldErrors.gender}
              options={GENDERS}
            />
          )}
          <div className={cn(patientFilling && 'hidden sm:block')}>
            <Label className="text-xs text-gray-600">Gender <span className="text-red-500">*</span></Label>
            <Select value={patientForm.gender} onValueChange={v => setField('gender', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GENDERS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {patientFilling && (
            <ChoiceChips
              label="Blood Group"
              value={patientForm.bloodGroup}
              onChange={v => setField('bloodGroup', v)}
              error={fieldErrors.bloodGroup}
              options={BLOOD_GROUPS.map(bg => ({ value: bg, label: bg }))}
              cols="[&>button]:basis-[20%]"
            />
          )}
          <div className={cn(patientFilling && 'hidden sm:block')}>
            <Label className="text-xs text-gray-600">Blood Group</Label>
            <Select value={patientForm.bloodGroup} onValueChange={v => setField('bloodGroup', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {BLOOD_GROUPS.map(bg => (
                  <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 [&>div]:min-w-0">
          {patientFilling && (
            <ChoiceChips
              label="Marital Status"
              value={patientForm.maritalStatus}
              onChange={v => setField('maritalStatus', v)}
              error={fieldErrors.maritalStatus}
              options={MARITAL_STATUSES.map(m => ({ value: m, label: m }))}
            />
          )}
          <div className={cn(patientFilling && 'hidden sm:block')}>
            <Label className="text-xs text-gray-600">Marital Status</Label>
            <Select value={patientForm.maritalStatus} onValueChange={v => setField('maritalStatus', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {MARITAL_STATUSES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-gray-600">Referred By</Label>
            <Input className="mt-1" value={patientForm.referredBy} onChange={e => setNameField('referredBy', e.target.value)} placeholder="Doctor / clinic / person" />
          </div>
          {showMedicoLegal && (
            <>
              <div>
                <Label className="text-xs text-gray-600">MLC Number</Label>
                <Input className="mt-1" spellCheck={false} autoCorrect="off" value={patientForm.mlcNumber} onChange={e => setTextField('mlcNumber', e.target.value)} placeholder="Medico-legal case no. (if any)" />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Contact */}
      <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Phone className="h-4 w-4 text-blue-600" />Contact
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
          <div>
            <Label className="text-xs text-gray-600">Primary Phone <span className="text-red-500">*</span></Label>
            <PhoneInput className={cn('mt-1', fieldErrors.phonePrimary && 'border-red-500')} value={patientForm.phonePrimary} onChange={v => setField('phonePrimary', v)} placeholder="Enter mobile number" required />
            <FieldError message={fieldErrors.phonePrimary} />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Email</Label>
            <Input className={cn('mt-1', fieldErrors.email && 'border-red-500')} type="email" value={patientForm.email} onChange={e => setField('email', sanitizeTextInput(e.target.value))} placeholder="patient@email.com" />
            <FieldError message={fieldErrors.email} />
          </div>
        </div>
      </section>

      {/* Address */}
      <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <MapPin className="h-4 w-4 text-blue-600" />Address
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
          <div>
            <Label className="text-xs text-gray-600">House / Flat / Building No.</Label>
            <Input className="mt-1" value={patientForm.houseNumber} onChange={e => setTextField('houseNumber', e.target.value)} placeholder="e.g. Flat 12B" />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Street / Block</Label>
            <Input className="mt-1" value={patientForm.street} onChange={e => setTextField('street', e.target.value)} placeholder="e.g. Block G, MG Road" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-gray-600">Locality / Area</Label>
            <Input className="mt-1" value={patientForm.locality} onChange={e => setNameField('locality', e.target.value)} placeholder="e.g. Andheri West" />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Village / Town / City <span className="text-red-500">*</span></Label>
            <Input className={cn('mt-1', fieldErrors.city && 'border-red-500')} value={patientForm.city} onChange={e => setNameField('city', e.target.value)} placeholder="e.g. Mumbai" required />
            <FieldError message={fieldErrors.city} />
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 [&>div]:min-w-0">
          <div>
            <Label className="text-xs text-gray-600">District</Label>
            <Input className="mt-1" value={patientForm.district} onChange={e => setNameField('district', e.target.value)} placeholder="e.g. Mumbai Suburban" />
          </div>
          <div>
            <Label className="text-xs text-gray-600">State <span className="text-red-500">*</span></Label>
            <Select value={patientForm.state} onValueChange={v => setField('state', v)}>
              <SelectTrigger className={cn('mt-1', fieldErrors.state && 'border-red-500')}><SelectValue placeholder="Select State" /></SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.state} />
          </div>
          <div>
            <Label className="text-xs text-gray-600">PIN Code <span className="text-red-500">*</span></Label>
            <Input className={cn('mt-1', fieldErrors.pincode && 'border-red-500')} value={patientForm.pincode} onChange={e => setField('pincode', e.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit PIN code" inputMode="numeric" maxLength={6} required />
            <FieldError message={fieldErrors.pincode} />
          </div>
        </div>
      </section>

      {/* Emergency Contact */}
      <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <AlertCircle className="h-4 w-4 text-blue-600" />Emergency Contact
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-gray-600">Contact Name</Label>
            <Input className="mt-1" value={patientForm.emergencyContactName} onChange={e => setNameField('emergencyContactName', e.target.value)} placeholder="Contact name" />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Contact Phone</Label>
            <PhoneInput className={cn('mt-1', fieldErrors.emergencyContactPhone && 'border-red-500')} value={patientForm.emergencyContactPhone} onChange={v => setField('emergencyContactPhone', v)} placeholder="Enter mobile number" />
            <FieldError message={fieldErrors.emergencyContactPhone} />
          </div>
          <div>
            <Label className="text-xs text-gray-600">Relationship</Label>
            <Input className="mt-1" value={patientForm.emergencyContactRelationship} onChange={e => setNameField('emergencyContactRelationship', e.target.value)} placeholder="e.g. Spouse" />
          </div>
        </div>
      </section>

      {/* Insurance */}
      <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
        <label htmlFor="hasInsurance" className="flex items-center gap-2 cursor-pointer w-fit">
          <input
            type="checkbox"
            id="hasInsurance"
            checked={patientForm.hasInsurance}
            onChange={e => setField('hasInsurance', e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Shield className="h-4 w-4 text-blue-600" />Patient has health insurance
          </span>
        </label>
        {patientForm.hasInsurance && (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
            <div>
              <Label className="text-xs text-gray-600">Insurance Provider</Label>
              <Select value={patientForm.insuranceProvider} onValueChange={v => setField('insuranceProvider', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>
                  {INSURANCE_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-600">Insurance ID</Label>
              <Input className="mt-1" spellCheck={false} autoCorrect="off" value={patientForm.insuranceId} onChange={e => setTextField('insuranceId', e.target.value)} placeholder="Policy / Member ID" />
            </div>
          </div>
        )}
      </section>
    </>
  )
}
