import { useState, useEffect } from 'react'
import { useDebounce } from '@/lib/useDebounce'
import { Search, User, X, Loader2, UserPlus, Users, Phone, MapPin, AlertCircle, Shield } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { format } from 'date-fns'
import { toast } from 'sonner'
import client from '@/api/client'
import { useCreatePatient } from '@/lib/useCreatePatient'
import { cn } from '@/lib/utils'
import { z } from 'zod'
import {
  requiredNameSchema, optionalTextSchema, requiredMobileSchema, optionalMobileSchema,
  optionalEmailSchema, pincodeSchema, requiredDateSchema, issuesToFieldErrors,
} from '@/lib/schemas/patientFormSchema'

// Same field rules as RegisterPatientForm's patientFormSchema, minus the
// appointment-booking fields (this inline form only registers the patient).
const walkInPatientSchema = z.object({
  firstName: requiredNameSchema('First name'),
  middleName: optionalTextSchema,
  lastName: requiredNameSchema('Last name'),
  dateOfBirth: requiredDateSchema('Date of birth'),
  gender: z.enum(['male', 'female', 'other']),
  maritalStatus: optionalTextSchema,
  referredBy: optionalTextSchema,
  mlcNumber: optionalTextSchema,
  bloodGroup: optionalTextSchema,

  phonePrimary: requiredMobileSchema('Primary phone'),
  email: optionalEmailSchema,

  houseNumber: optionalTextSchema,
  street: optionalTextSchema,
  locality: optionalTextSchema,
  city: optionalTextSchema,
  district: optionalTextSchema,
  state: optionalTextSchema,
  pincode: pincodeSchema,

  emergencyContactName: optionalTextSchema,
  emergencyContactPhone: optionalMobileSchema('Emergency contact phone'),
  emergencyContactRelationship: optionalTextSchema,

  hasInsurance: z.boolean().default(false),
  insuranceProvider: optionalTextSchema,
  insuranceId: optionalTextSchema,
})

const INSURANCE_PROVIDERS = [
  'CGHS', 'ESIC', 'PM-JAY (Ayushman Bharat)', 'Star Health', 'HDFC ERGO',
  'Niva Bupa', 'Care Health', 'ICICI Lombard', 'Bajaj Allianz', 'LIC Health',
  'United India', 'New India Assurance', 'Oriental Insurance', 'National Insurance',
  'Max Bupa', 'Reliance Health', 'SBI Health', 'Tata AIG',
]

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry',
]

const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Other']

function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
}

// Imported (not re-exported straight through) so this module can use the name
// itself as well as expose it — `export ... from` creates no local binding.
// The implementation lives in lib/patient.js; this file used to carry its own
// copy, which is how the same patient could read differently on two screens.
import { getFullName as getPatientFullName } from '@/lib/patient'
export { getPatientFullName }

export function calculatePatientAge(dateOfBirth) {
  if (!dateOfBirth) return null
  const today = new Date()
  const birth = new Date(dateOfBirth)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

const emptyNew = {
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: 'male',
  maritalStatus: '', referredBy: '', mlcNumber: '', bloodGroup: '',
  phonePrimary: '', email: '',
  houseNumber: '', street: '', locality: '', city: '', district: '', state: '', pincode: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
  hasInsurance: false, insuranceProvider: '', insuranceId: '',
}

/**
 * Search registered patients by UHID/name/phone, OR register a new (walk-in)
 * patient inline if they don't exist in the database. Either way, onSelect()
 * receives the patient object for downstream forms.
 */
export default function PatientLookup({
  selectedPatient,
  onSelect,
  onClear,
  placeholder = 'Search by UHID, name, or phone...',
  className = '',
  showHint = true,
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [newForm, setNewForm] = useState(emptyNew)
  const [newFormErrors, setNewFormErrors] = useState({})
  const { createPatient, creating } = useCreatePatient()

  // Debounced search term – API call fires only after 400 ms of no typing
  const debouncedSearch = useDebounce(search, 400)

  // Show spinner immediately when the user starts typing (optimistic UX)
  useEffect(() => {
    if (search.length >= 2) setLoading(true)
    else { setLoading(false); setResults([]) }
  }, [search])

  // Fire the actual API call only after the debounced value settles
  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    const searchTerm = debouncedSearch
    ;(async () => {
      try {
        const res = await client.get('/patients', {
          params: { search: debouncedSearch, limit: 8, status: 'active' },
        })
        if (!cancelled && searchTerm === debouncedSearch) {
          setResults(res.data ?? [])
          setOpen(true)
        }
      } catch {
        if (!cancelled && searchTerm === debouncedSearch) setResults([])
      } finally {
        if (!cancelled && searchTerm === debouncedSearch) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [debouncedSearch])

  const setNewField = (field, value) => {
    setNewForm(prev => ({ ...prev, [field]: value }))
    setNewFormErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  async function handleCreate() {
    setNewFormErrors({})

    const parsed = walkInPatientSchema.safeParse(newForm)
    if (!parsed.success) {
      setNewFormErrors(issuesToFieldErrors(parsed.error.issues))
      toast.error('Please fix the highlighted fields')
      return
    }

    try {
      const created = await createPatient({
        ...newForm,
        hasInsurance: newForm.hasInsurance === true || newForm.hasInsurance === 'true',
      })
      toast.success(`Patient registered: ${getPatientFullName(created)} (${created.mrn || 'new'})`)
      onSelect(created)
      setAddingNew(false)
      setNewForm(emptyNew)
      setNewFormErrors({})
      setSearch('')
      setOpen(false)
    } catch (err) {
      if ((err.status === 400 || err.status === 422) && Array.isArray(err.details)) {
        setNewFormErrors(issuesToFieldErrors(err.details))
      }
      toast.error('Could not register patient: ' + (err.message || 'try again'))
    }
  }

  // ── Selected state ──
  if (selectedPatient) {
    const age = calculatePatientAge(selectedPatient.dateOfBirth)
    return (
      <div className={`flex items-center justify-between gap-3 p-3 bg-green-50 border border-green-200 rounded-lg ${className}`}>
        <div className="flex items-center gap-3 min-w-0">
          <User className="h-5 w-5 text-green-700 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-green-900 truncate">{getPatientFullName(selectedPatient)}</p>
            <p className="text-sm text-green-700">
              UHID: {selectedPatient.mrn}
              {age != null && ` • ${age}y`}
              {selectedPatient.gender && ` • ${selectedPatient.gender}`}
              {selectedPatient.phonePrimary && ` • ${selectedPatient.phonePrimary}`}
            </p>
          </div>
        </div>
        {onClear && (
          <Button type="button" variant="ghost" size="icon" onClick={onClear} aria-label="Clear patient">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    )
  }

  // ── Add-new (walk-in) inline form ──
  if (addingNew) {
    return (
      <div className={`rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-3 max-h-[70vh] overflow-y-auto ${className}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-2 text-blue-800">
            <UserPlus className="h-4 w-4" /> New Patient (not in records)
          </span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setAddingNew(false); setNewForm(emptyNew); setNewFormErrors({}) }}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Patient Details */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <Users className="h-3.5 w-3.5 text-blue-600" />Patient Details
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">First Name *</Label>
              <Input className={cn('mt-1', newFormErrors.firstName && 'border-red-500')} placeholder="e.g. Rahul"
                value={newForm.firstName} onChange={(e) => setNewField('firstName', e.target.value)} />
              <FieldError message={newFormErrors.firstName} />
            </div>
            <div>
              <Label className="text-xs">Middle Name</Label>
              <Input className="mt-1" placeholder="Middle name"
                value={newForm.middleName} onChange={(e) => setNewField('middleName', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Last Name *</Label>
              <Input className={cn('mt-1', newFormErrors.lastName && 'border-red-500')} placeholder="e.g. Sharma"
                value={newForm.lastName} onChange={(e) => setNewField('lastName', e.target.value)} />
              <FieldError message={newFormErrors.lastName} />
            </div>
            <div>
              <Label className="text-xs">Date of Birth *</Label>
              <Input className={cn('mt-1', newFormErrors.dateOfBirth && 'border-red-500')} type="date"
                value={newForm.dateOfBirth} onChange={(e) => setNewField('dateOfBirth', e.target.value)} />
              <FieldError message={newFormErrors.dateOfBirth} />
            </div>
            <div>
              <Label className="text-xs">Gender *</Label>
              <Select value={newForm.gender} onValueChange={(v) => setNewField('gender', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Blood Group</Label>
              <Select value={newForm.bloodGroup} onValueChange={(v) => setNewField('bloodGroup', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                    <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Marital Status</Label>
              <Select value={newForm.maritalStatus} onValueChange={(v) => setNewField('maritalStatus', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {MARITAL_STATUSES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Referred By</Label>
              <Input className="mt-1" placeholder="Doctor / clinic / person"
                value={newForm.referredBy} onChange={(e) => setNewField('referredBy', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">MLC Number</Label>
              <Input className="mt-1" placeholder="Medico-legal case no. (if any)"
                value={newForm.mlcNumber} onChange={(e) => setNewField('mlcNumber', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <Phone className="h-3.5 w-3.5 text-blue-600" />Contact
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Primary Phone *</Label>
              <Input className={cn('mt-1', newFormErrors.phonePrimary && 'border-red-500')} placeholder="+91 XXXXX XXXXX"
                value={newForm.phonePrimary} onChange={(e) => setNewField('phonePrimary', e.target.value)} />
              <FieldError message={newFormErrors.phonePrimary} />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input className={cn('mt-1', newFormErrors.email && 'border-red-500')} type="email" placeholder="patient@email.com"
                value={newForm.email} onChange={(e) => setNewField('email', e.target.value)} />
              <FieldError message={newFormErrors.email} />
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <MapPin className="h-3.5 w-3.5 text-blue-600" />Address
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">House / Flat / Building No.</Label>
              <Input className="mt-1" placeholder="e.g. 12-B"
                value={newForm.houseNumber} onChange={(e) => setNewField('houseNumber', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Street / Block</Label>
              <Input className="mt-1" placeholder="e.g. Block G, MG Road"
                value={newForm.street} onChange={(e) => setNewField('street', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Locality / Area</Label>
              <Input className="mt-1" placeholder="e.g. Andheri West"
                value={newForm.locality} onChange={(e) => setNewField('locality', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Village / Town / City</Label>
              <Input className="mt-1" placeholder="e.g. Mumbai"
                value={newForm.city} onChange={(e) => setNewField('city', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">District</Label>
              <Input className="mt-1" placeholder="e.g. Mumbai Suburban"
                value={newForm.district} onChange={(e) => setNewField('district', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">State</Label>
              <Select value={newForm.state} onValueChange={(v) => setNewField('state', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">PIN Code</Label>
              <Input className={cn('mt-1', newFormErrors.pincode && 'border-red-500')} placeholder="6-digit PIN" inputMode="numeric" maxLength={6}
                value={newForm.pincode} onChange={(e) => setNewField('pincode', e.target.value.replace(/\D/g, ''))} />
              <FieldError message={newFormErrors.pincode} />
            </div>
          </div>
        </div>

        {/* Emergency Contact */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <AlertCircle className="h-3.5 w-3.5 text-blue-600" />Emergency Contact
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Contact Name</Label>
              <Input className="mt-1" placeholder="Contact name"
                value={newForm.emergencyContactName} onChange={(e) => setNewField('emergencyContactName', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Contact Phone</Label>
              <Input className={cn('mt-1', newFormErrors.emergencyContactPhone && 'border-red-500')} placeholder="+91 XXXXX XXXXX"
                value={newForm.emergencyContactPhone} onChange={(e) => setNewField('emergencyContactPhone', e.target.value)} />
              <FieldError message={newFormErrors.emergencyContactPhone} />
            </div>
            <div>
              <Label className="text-xs">Relationship</Label>
              <Input className="mt-1" placeholder="e.g. Spouse"
                value={newForm.emergencyContactRelationship} onChange={(e) => setNewField('emergencyContactRelationship', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Insurance */}
        <div className="space-y-2">
          <label htmlFor="lookupHasInsurance" className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              id="lookupHasInsurance"
              checked={newForm.hasInsurance}
              onChange={(e) => setNewField('hasInsurance', e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            <span className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <Shield className="h-3.5 w-3.5 text-blue-600" />Patient has health insurance
            </span>
          </label>
          {newForm.hasInsurance && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Insurance Provider</Label>
                <Select value={newForm.insuranceProvider} onValueChange={(v) => setNewField('insuranceProvider', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>
                    {INSURANCE_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Insurance ID</Label>
                <Input className="mt-1" placeholder="Policy / Member ID"
                  value={newForm.insuranceId} onChange={(e) => setNewField('insuranceId', e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { setAddingNew(false); setNewForm(emptyNew); setNewFormErrors({}) }}>Cancel</Button>
          <Button type="button" size="sm" onClick={handleCreate} disabled={creating}>
            {creating ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Saving…</> : 'Register & Select'}
          </Button>
        </div>
      </div>
    )
  }

  // ── Search state ──
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          className="pl-9"
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => search.length >= 2 && setOpen(true)}
        />
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>
      {open && search.length >= 2 && (
        <div className="border rounded-md divide-y max-h-48 overflow-y-auto bg-white shadow-sm">
          {results.length === 0 && !loading ? (
            <div className="p-3 text-center">
              <p className="text-sm text-gray-500 mb-2">No patients found for &ldquo;{search}&rdquo;</p>
              <Button type="button" size="sm" variant="outline" className="gap-1.5"
                onClick={() => {
                  // prefill name from the search text if it looks like a name
                  const parts = search.trim().split(/\s+/)
                  setNewForm({ ...emptyNew, firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' })
                  setAddingNew(true); setOpen(false)
                }}>
                <UserPlus className="h-3.5 w-3.5" /> Add as new patient
              </Button>
            </div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between gap-2"
                onClick={() => {
                  onSelect(p)
                  setSearch('')
                  setOpen(false)
                }}
              >
                <div>
                  <p className="font-medium">{getPatientFullName(p)}</p>
                  <p className="text-xs text-gray-500">
                    UHID: {p.mrn}
                    {p.dateOfBirth && ` • DOB: ${format(new Date(p.dateOfBirth), 'dd MMM yyyy')}`}
                    {p.phonePrimary && ` • ${p.phonePrimary}`}
                  </p>
                </div>
                <span className="text-xs text-blue-600 font-medium shrink-0">Select</span>
              </button>
            ))
          )}
        </div>
      )}
      <div className="flex items-center justify-between">
        {showHint ? (
          <p className="text-xs text-gray-500">
            Search registered patients by UHID, name, or phone.
          </p>
        ) : <span />}
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs gap-1 text-blue-600"
          onClick={() => setAddingNew(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Patient not in records? Add new
        </Button>
      </div>
    </div>
  )
}
