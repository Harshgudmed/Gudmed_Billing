import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  UserPlus, Users, Phone, MapPin, AlertCircle, Shield, Stethoscope,
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
import { drName } from '@/lib/utils'

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry',
]

const INSURANCE_PROVIDERS = [
  'CGHS', 'ESIC', 'PM-JAY (Ayushman Bharat)', 'Star Health', 'HDFC ERGO',
  'Niva Bupa', 'Care Health', 'ICICI Lombard', 'Bajaj Allianz', 'LIC Health',
  'United India', 'New India Assurance', 'Oriental Insurance', 'National Insurance',
  'Max Bupa', 'Reliance Health', 'SBI Health', 'Tata AIG',
]

const APPOINTMENT_TYPES = ['OPD', 'Emergency', 'Follow-up', 'Specialist', 'Teleconsultation', 'Procedure']
const PRIORITY_LEVELS = ['Routine', 'Urgent', 'Emergency', 'Critical']

const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Other']

const emptyPatientForm = {
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: 'male',
  maritalStatus: '', referredBy: '', mlcNumber: '',
  phonePrimary: '', phoneSecondary: '', email: '',
  region: '', zone: '', woreda: '', kebele: '', houseNumber: '', postalCode: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
  bloodGroup: '', hasInsurance: false, insuranceProvider: '', insuranceId: '',
  // Appointment — booked together with registration
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
 */
export default function RegisterPatientForm({ onSuccess, onCancel }) {
  const [patientForm, setPatientForm] = useState(emptyPatientForm)
  const [savingPatient, setSavingPatient] = useState(false)
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])

  useEffect(() => {
    client.get('/settings?resource=users')
      .then(res => { if (res.success) setDoctors((res.data ?? []).filter(u => u.role === 'doctor')) })
      .catch(() => {})
    client.get('/settings?resource=departments')
      .then(res => { if (res.success) setDepartments(res.data ?? []) })
      .catch(() => {})
  }, [])

  const setField = (field, value) => setPatientForm(prev => ({ ...prev, [field]: value }))

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
    // Registration also books an appointment, so a doctor + date are required.
    if (!patientForm.doctor || !patientForm.appointmentDate) {
      toast.error('Please select a doctor and an appointment date')
      return
    }
    setSavingPatient(true)
    try {
      const res = await client.post('/patients', {
        ...patientForm,
        hasInsurance: patientForm.hasInsurance === true || patientForm.hasInsurance === 'true',
      })
      if (res.success) {
        const patientId = res.data?.id

        // Book the first appointment (best-effort — never lose the patient)
        let appointmentBooked = false
        if (patientId && patientForm.doctor && patientForm.appointmentDate) {
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
            appointmentBooked = true
          } catch (err) {
            toast.error(`Patient registered, but the appointment booking failed: ${err.message || 'unknown error'}`)
          }
        }

        toast.success(appointmentBooked
          ? `Patient ${res.data.mrn} registered & appointment booked`
          : `Patient UHID ${res.data.mrn} registered successfully`)
        setPatientForm(emptyPatientForm)
        onSuccess?.(res.data)
      } else {
        toast.error(res.error || 'Failed to register patient')
      }
    } catch {
      toast.error('Failed to register patient')
    } finally {
      setSavingPatient(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-blue-600" />
          Register New Patient
        </DialogTitle>
        <DialogDescription>Enter the patient's details and book their first appointment.</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={handleRegisterPatient}
        className="space-y-5 [&_input:not([type=checkbox])]:h-11 [&_input:not([type=checkbox])]:text-[15px] [&_button]:h-11"
      >
        {/* Personal Information */}
        <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Users className="h-4 w-4 text-blue-600" />Patient Details
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-gray-600">First Name <span className="text-red-500">*</span></Label>
              <Input className="mt-1" value={patientForm.firstName} onChange={e => setField('firstName', e.target.value)} required placeholder="First name" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Middle Name</Label>
              <Input className="mt-1" value={patientForm.middleName} onChange={e => setField('middleName', e.target.value)} placeholder="Middle name" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Last Name <span className="text-red-500">*</span></Label>
              <Input className="mt-1" value={patientForm.lastName} onChange={e => setField('lastName', e.target.value)} required placeholder="Last name" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-gray-600">Date of Birth <span className="text-red-500">*</span></Label>
              <Input className="mt-1" type="date" value={patientForm.dateOfBirth} onChange={e => setField('dateOfBirth', e.target.value)} required />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Gender <span className="text-red-500">*</span></Label>
              <Select value={patientForm.gender} onValueChange={v => setField('gender', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-600">Blood Group</Label>
              <Select value={patientForm.bloodGroup} onValueChange={v => setField('bloodGroup', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                    <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
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
              <Input className="mt-1" value={patientForm.referredBy} onChange={e => setField('referredBy', e.target.value)} placeholder="Doctor / clinic / person" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">MLC Number</Label>
              <Input className="mt-1" value={patientForm.mlcNumber} onChange={e => setField('mlcNumber', e.target.value)} placeholder="Medico-legal case no. (if any)" />
            </div>
          </div>
        </section>

        {/* Contact */}
        <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Phone className="h-4 w-4 text-blue-600" />Contact
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-600">Primary Phone <span className="text-red-500">*</span></Label>
              <Input className="mt-1" value={patientForm.phonePrimary} onChange={e => setField('phonePrimary', e.target.value)} placeholder="+91 XXXXX XXXXX" required />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Email</Label>
              <Input className="mt-1" type="email" value={patientForm.email} onChange={e => setField('email', e.target.value)} placeholder="patient@email.com" />
            </div>
          </div>
        </section>

        {/* Address */}
        <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <MapPin className="h-4 w-4 text-blue-600" />Address
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-600">House / Flat / Building No.</Label>
              <Input className="mt-1" value={patientForm.houseNumber} onChange={e => setField('houseNumber', e.target.value)} placeholder="e.g. 12-B" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Village / Town</Label>
              <Input className="mt-1" value={patientForm.kebele} onChange={e => setField('kebele', e.target.value)} placeholder="Village or town" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-gray-600">City / District</Label>
              <Input className="mt-1" value={patientForm.zone} onChange={e => setField('zone', e.target.value)} placeholder="City or district" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">State</Label>
              <Select value={patientForm.region} onValueChange={v => setField('region', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-600">PIN Code</Label>
              <Input className="mt-1" value={patientForm.postalCode} onChange={e => setField('postalCode', e.target.value)} placeholder="6-digit PIN" inputMode="numeric" maxLength={6} />
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
              <Input className="mt-1" value={patientForm.emergencyContactName} onChange={e => setField('emergencyContactName', e.target.value)} placeholder="Contact name" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Contact Phone</Label>
              <Input className="mt-1" value={patientForm.emergencyContactPhone} onChange={e => setField('emergencyContactPhone', e.target.value)} placeholder="+91 XXXXX XXXXX" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">Relationship</Label>
              <Input className="mt-1" value={patientForm.emergencyContactRelationship} onChange={e => setField('emergencyContactRelationship', e.target.value)} placeholder="e.g. Spouse" />
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <Input className="mt-1" value={patientForm.insuranceId} onChange={e => setField('insuranceId', e.target.value)} placeholder="Policy / Member ID" />
              </div>
            </div>
          )}
        </section>

        {/* Appointment Details — booked together with registration */}
        <div className="rounded-lg border p-4 space-y-3 bg-blue-50/50 border-blue-200">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-blue-700">Appointment Details</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  setPatientForm(prev => ({ ...prev, doctor: v, consultationFee: doc?.consultationFee != null ? String(doc.consultationFee) : '' }))
                }}
                placeholder={availableDoctors.length ? 'Select doctor' : (patientForm.department ? 'No doctors in department' : 'Select doctor')}
                searchPlaceholder="Search doctors..."
                emptyText="No doctors found"
                disabled={availableDoctors.length === 0}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-600 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Date <span className="text-red-500">*</span></Label>
              <Input className="mt-1" type="date" value={patientForm.appointmentDate} onChange={e => setField('appointmentDate', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-gray-600 flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Time</Label>
              <Input className="mt-1" type="time" value={patientForm.appointmentTime} onChange={e => setField('appointmentTime', e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs text-gray-600 flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" />Consultation Fee (₹)</Label>
            <Input className="mt-1 bg-gray-100 cursor-not-allowed text-gray-700" type="number" readOnly tabIndex={-1} value={patientForm.consultationFee} placeholder="Set by selected doctor" />
          </div>
        </div>

        {/* Notes */}
        <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <FileText className="h-4 w-4 text-blue-600" />Notes
          </div>
          <Textarea
            rows={3}
            value={patientForm.notes}
            onChange={e => setField('notes', e.target.value)}
            placeholder="Any additional notes (reason for visit, special instructions, referral details...)"
          />
        </section>

        <div className="flex justify-end gap-3 pt-3 border-t">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={savingPatient}>
            {savingPatient ? 'Registering...' : 'Register Patient'}
          </Button>
        </div>
      </form>
    </>
  )
}
