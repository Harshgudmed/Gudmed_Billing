import { useState, useEffect } from 'react'
import { useDebounce } from '@/lib/useDebounce'
import { Search, User, X, Loader2, UserPlus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { format } from 'date-fns'
import { toast } from 'sonner'
import client from '@/api/client'
import { useCreatePatient } from '@/lib/useCreatePatient'

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

const emptyNew = { firstName: '', lastName: '', phonePrimary: '', gender: 'male', age: '' }

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

  async function handleCreate() {
    if (newForm.firstName.trim().length < 2 || newForm.lastName.trim().length < 2) {
      toast.error('Enter first and last name (min 2 characters)')
      return
    }

    const phoneDigits = newForm.phonePrimary.replace(/\D/g, '')
    if (!phoneDigits || phoneDigits.length < 10) {
      toast.error('Enter a valid 10-digit phone number')
      return
    }

    if (!newForm.age || Number(newForm.age) <= 0 || Number(newForm.age) > 150) {
      toast.error('Age is required and must be between 1 and 150')
      return
    }

    const dateOfBirth = new Date()
    dateOfBirth.setFullYear(dateOfBirth.getFullYear() - Number(newForm.age))
    dateOfBirth.setHours(0, 0, 0, 0)
    try {
      const created = await createPatient({
        firstName: newForm.firstName.trim(),
        lastName: newForm.lastName.trim(),
        phonePrimary: newForm.phonePrimary.trim(),
        gender: newForm.gender,
        dateOfBirth: dateOfBirth.toISOString(),
      })
      toast.success(`Patient registered: ${getPatientFullName(created)} (${created.mrn || 'new'})`)
      onSelect(created)
      setAddingNew(false)
      setNewForm(emptyNew)
      setSearch('')
      setOpen(false)
    } catch (err) {
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
      <div className={`rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-3 ${className}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-2 text-blue-800">
            <UserPlus className="h-4 w-4" /> New Patient (not in records)
          </span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setAddingNew(false); setNewForm(emptyNew) }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">First Name *</Label>
            <Input className="mt-1" placeholder="e.g. Rahul"
              value={newForm.firstName} onChange={(e) => setNewForm(p => ({ ...p, firstName: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Last Name *</Label>
            <Input className="mt-1" placeholder="e.g. Sharma"
              value={newForm.lastName} onChange={(e) => setNewForm(p => ({ ...p, lastName: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Phone *</Label>
            <Input className="mt-1" placeholder="10-digit mobile"
              value={newForm.phonePrimary} onChange={(e) => setNewForm(p => ({ ...p, phonePrimary: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Age</Label>
            <Input className="mt-1" type="number" min={0} placeholder="years"
              value={newForm.age} onChange={(e) => setNewForm(p => ({ ...p, age: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Gender</Label>
            <Select value={newForm.gender} onValueChange={(v) => setNewForm(p => ({ ...p, gender: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { setAddingNew(false); setNewForm(emptyNew) }}>Cancel</Button>
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
