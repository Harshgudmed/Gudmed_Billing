import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { toast } from 'sonner'
import { Search, User, Calendar, MapPin, Activity, ClipboardList, Shield, Loader2, X } from 'lucide-react'
import { format } from 'date-fns'
import client from '@/api/client'
import PatientLookup from '@/components/common/PatientLookup'

const deathCertificateSchema = z.object({
  patientId: z.string().min(1, 'Patient is required'),
  dateOfDeath: z.string().min(1, 'Date of death is required'),
  timeOfDeath: z.string().optional(),
  placeOfDeath: z.enum(['inpatient', 'emergency', 'doa', 'home', 'other']),
  locationDetails: z.string().optional(),
  ageAtDeathYears: z.coerce.number().optional().nullable(),
  ageAtDeathMonths: z.coerce.number().optional().nullable(),
  ageAtDeathDays: z.coerce.number().optional().nullable(),
  sex: z.string(),
  maritalStatus: z.string().optional(),
  occupation: z.string().optional(),
  address: z.string().optional(),
  immediateCause: z.string().min(2, 'Immediate cause is required'),
  antecedentCauseB: z.string().optional(),
  antecedentCauseC: z.string().optional(),
  antecedentCauseD: z.string().optional(),
  otherConditions: z.string().optional(),
  mannerOfDeath: z.enum(['natural', 'accident', 'suicide', 'homicide', 'pending', 'undetermined']),
  autopsyPerformed: z.boolean().default(false),
  autopsyFindings: z.string().optional(),
  isMaternalDeath: z.boolean().default(false),
  pregnancyRelated: z.enum(['pregnant', 'within_42_days', 'within_1_year', 'not_related']).optional(),
  certifiedById: z.string().min(1, 'Certifier is required'),
  certifierQualification: z.string().optional(),
  licenseNumber: z.string().optional(),
})

export default function DeathCertificateForm({ initialData, onSuccess }) {
  const [patients, setPatients] = useState([])
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm({
    resolver: zodResolver(deathCertificateSchema),
    defaultValues: initialData || {
      patientId: '',
      dateOfDeath: format(new Date(), 'yyyy-MM-dd'),
      timeOfDeath: '',
      placeOfDeath: 'inpatient',
      locationDetails: '',
      ageAtDeathYears: null,
      ageAtDeathMonths: null,
      ageAtDeathDays: null,
      sex: '',
      maritalStatus: '',
      occupation: '',
      address: '',
      immediateCause: '',
      antecedentCauseB: '',
      antecedentCauseC: '',
      antecedentCauseD: '',
      otherConditions: '',
      mannerOfDeath: 'natural',
      autopsyPerformed: false,
      autopsyFindings: '',
      isMaternalDeath: false,
      pregnancyRelated: undefined,
      certifiedById: 'user-doctor1',
      certifierQualification: 'MD, Internist',
      licenseNumber: '',
    },
  })

  useEffect(() => {
    client.get('/patients').then(res => {
      if (res.success) setPatients(res.data || [])
    })
  }, [])

  const filteredPatients = useMemo(() => {
    if (!patientSearch) return []
    const lower = patientSearch.toLowerCase()
    return patients.filter(p =>
      p.firstName.toLowerCase().includes(lower) ||
      p.lastName.toLowerCase().includes(lower) ||
      p.mrn.toLowerCase().includes(lower)
    ).slice(0, 5)
  }, [patients, patientSearch])

  function handleSelectPatient(patient) {
    setSelectedPatient(patient)
    form.setValue('patientId', patient.id)
    form.setValue('sex', patient.gender)
    const dob = new Date(patient.dateOfBirth)
    const now = new Date()
    form.setValue('ageAtDeathYears', now.getFullYear() - dob.getFullYear())
    form.setValue('address', [
      patient.houseNumber, patient.street, patient.locality,
      patient.city, patient.district, patient.state,
    ].filter(Boolean).join(', ') + (patient.pincode ? ` - ${patient.pincode}` : ''))
    setPatientSearch('')
  }

  async function onSubmit(data) {
    setIsSubmitting(true)
    try {
      const url = '/death-certificates'
      const method = initialData ? 'patch' : 'post'
      const payload = initialData ? { id: initialData.id, ...data } : data
      const res = await client[method](url, payload)
      if (!res.success) throw new Error(res.error || 'Failed')
      toast.success(initialData ? 'Certificate updated successfully' : 'Death certificate created successfully')
      if (onSuccess) onSuccess()
    } catch (e) {
      toast.error(e.message || 'Failed to save death certificate')
    } finally {
      setIsSubmitting(false)
    }
  }

  const watchAutopsy = form.watch('autopsyPerformed')
  const watchMaternal = form.watch('isMaternalDeath')

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-5xl mx-auto pb-20">
        {/* Patient Selection */}
        {!selectedPatient && !initialData ? (
          <Card className="border-blue-200">
            <CardHeader className="bg-blue-50">
              <CardTitle className="text-blue-800 flex items-center gap-2"><User className="h-5 w-5" /> Select Patient</CardTitle>
              <CardDescription>Search for the deceased patient record</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <PatientLookup
                showHint={false}
                selectedPatient={null}
                onSelect={handleSelectPatient}
              />
            </CardContent>
          </Card>
        ) : (selectedPatient || initialData) && (
          <Card className="border-green-200">
            <CardHeader className="bg-green-50 py-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-green-800 flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName}` : 'Patient Selected'}
                </CardTitle>
                <CardDescription>
                  {selectedPatient ? `UHID: ${selectedPatient.mrn}` : 'Edit mode'}
                </CardDescription>
              </div>
              {selectedPatient && (
                <Button variant="ghost" size="icon" onClick={() => setSelectedPatient(null)}>
                  <X className="h-5 w-5" />
                </Button>
              )}
            </CardHeader>
          </Card>
        )}

        {(selectedPatient || initialData) && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Death Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2"><Calendar className="h-5 w-5 text-gray-400" /> Death Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="dateOfDeath" render={({ field }) => (
                      <FormItem><FormLabel>Date of Death</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="timeOfDeath" render={({ field }) => (
                      <FormItem><FormLabel>Time of Death</FormLabel><FormControl><Input type="time" {...field} /></FormControl></FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="placeOfDeath" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Place of Death</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="inpatient">Inpatient Ward</SelectItem>
                          <SelectItem value="emergency">Emergency Room</SelectItem>
                          <SelectItem value="doa">Brought in Dead (DOA)</SelectItem>
                          <SelectItem value="home">Home</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="locationDetails" render={({ field }) => (
                    <FormItem><FormLabel>Location Details (Optional)</FormLabel><FormControl><Input placeholder="e.g. Ward name, Bed #" {...field} /></FormControl></FormItem>
                  )} />
                </CardContent>
              </Card>

              {/* Demographics Snapshot */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2"><MapPin className="h-5 w-5 text-gray-400" /> Demographics Snapshot</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {['ageAtDeathYears', 'ageAtDeathMonths', 'ageAtDeathDays'].map((name, i) => (
                      <FormField key={name} control={form.control} name={name} render={({ field }) => (
                        <FormItem>
                          <FormLabel>{['Years', 'Months', 'Days'][i]}</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} />
                          </FormControl>
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="sex" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sex</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select sex" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="maritalStatus" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marital Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="single">Single</SelectItem>
                            <SelectItem value="married">Married</SelectItem>
                            <SelectItem value="widowed">Widowed</SelectItem>
                            <SelectItem value="divorced">Divorced</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Cause of Death */}
            <Card className="border-orange-200">
              <CardHeader className="bg-orange-50">
                <CardTitle className="text-orange-800 flex items-center gap-2"><Activity className="h-5 w-5" /> Cause of Death: Standard Format</CardTitle>
                <CardDescription>Disease or condition directly leading to death</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="space-y-4">
                  <Label>Part I: Chain of Events (Immediate cause first)</Label>
                  <div className="space-y-4 border-l-2 border-orange-200 pl-4 py-2">
                    {[
                      { name: 'immediateCause', label: '(a) Immediate cause (last disease/condition)', placeholder: 'e.g. Septic Shock' },
                      { name: 'antecedentCauseB', label: '(b) Due to (or as a consequence of)', placeholder: 'e.g. Peritonitis' },
                      { name: 'antecedentCauseC', label: '(c) Due to (or as a consequence of)', placeholder: 'e.g. Ruptured Appendix' },
                      { name: 'antecedentCauseD', label: '(d) Due to (or as a consequence of)', placeholder: 'e.g. Contributing factor' },
                    ].map(({ name, label, placeholder }) => (
                      <FormField key={name} control={form.control} name={name} render={({ field }) => (
                        <FormItem>
                          <FormLabel>{label}</FormLabel>
                          <FormControl><Input placeholder={placeholder} {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ))}
                  </div>
                </div>
                <FormField control={form.control} name="otherConditions" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Part II: Other significant conditions contributing to death</FormLabel>
                    <FormControl><Textarea placeholder="e.g. Diabetes, Hypertension" {...field} /></FormControl>
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
                  <FormField control={form.control} name="mannerOfDeath" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Manner of Death</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="natural">Natural</SelectItem>
                          <SelectItem value="accident">Accident</SelectItem>
                          <SelectItem value="suicide">Suicide</SelectItem>
                          <SelectItem value="homicide">Homicide</SelectItem>
                          <SelectItem value="pending">Pending Investigation</SelectItem>
                          <SelectItem value="undetermined">Undetermined</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex flex-col gap-4 justify-center">
                    <FormField control={form.control} name="autopsyPerformed" render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Autopsy Performed?</FormLabel>
                        </div>
                      </FormItem>
                    )} />
                    {watchAutopsy && (
                      <FormField control={form.control} name="autopsyFindings" render={({ field }) => (
                        <FormItem><FormControl><Input placeholder="Autopsy Findings" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                      )} />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Maternal & Certification */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ClipboardList className="h-5 w-5 text-gray-400" /> Maternal Death Info</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="isMaternalDeath" render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={checked => { field.onChange(checked); if (!checked) form.setValue('pregnancyRelated', undefined) }} />
                      </FormControl>
                      <div className="space-y-1 leading-none"><FormLabel>Is this a maternal death?</FormLabel></div>
                    </FormItem>
                  )} />
                  {watchMaternal && (
                    <FormField control={form.control} name="pregnancyRelated" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Relationship to Pregnancy</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="pregnant">Was pregnant at time of death</SelectItem>
                            <SelectItem value="within_42_days">Within 42 days of delivery/termination</SelectItem>
                            <SelectItem value="within_1_year">Within 1 year of delivery/termination</SelectItem>
                            <SelectItem value="not_related">Not pregnant within past year</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Shield className="h-5 w-5 text-gray-400" /> Certification</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="certifiedById" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Certified By</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="user-doctor1">Dr. Priya Mehta (General Medicine)</SelectItem>
                          <SelectItem value="user-doctor2">Dr. Rahul Verma (Emergency Medicine)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="certifierQualification" render={({ field }) => (
                      <FormItem><FormLabel>Qualification</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="licenseNumber" render={({ field }) => (
                      <FormItem><FormLabel>License Number</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end gap-4 mt-8">
              <Button type="button" variant="outline" onClick={() => onSuccess && onSuccess()} disabled={isSubmitting}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700 min-w-[150px]" disabled={isSubmitting}>
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : 'Generate Certificate'}
              </Button>
            </div>
          </>
        )}
      </form>
    </Form>
  )
}
