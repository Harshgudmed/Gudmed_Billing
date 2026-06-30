import { useState, useEffect } from 'react'
import { ClipboardList, FlaskConical, Stethoscope, FileText, IndianRupee } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ProgressNotesPanel from '@/components/inpatient/ProgressNotesPanel'
import ClinicalOrdersTab from '@/components/inpatient/ClinicalOrdersTab'
import ConsultationsTab from '@/components/inpatient/ConsultationsTab'
import ReportsTab from '@/components/inpatient/ReportsTab'
import client from '@/api/client'

// Combined doctor workspace using sub-tabs to prevent vertical scroll fatigue
export default function NotesAndOrders({ admitted = [] }) {
  const [selectedId, setSelectedId] = useState('')
  const [activeTab, setActiveTab] = useState('notes')
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])

  // Automatically select first patient
  useEffect(() => { 
    if (!selectedId && admitted.length) setSelectedId(admitted[0].id) 
  }, [admitted, selectedId])

  // Fetch reference data for consultations (only needed if not provided by parent, but we do it internally for safety)
  useEffect(() => {
    async function loadRefs() {
      try {
        const [u, d] = await Promise.all([
          client.get('/settings?resource=users'),
          client.get('/settings?resource=departments')
        ])
        if (u.success) setDoctors((u.data || []).filter(x => x.role === 'doctor' && x.isActive !== false))
        if (d.success) setDepartments(d.data || [])
      } catch (err) {
        console.error('Failed to load consultation refs', err)
      }
    }
    loadRefs()
  }, [])

  if (!admitted.length) {
    return <Card><CardContent className="py-14 text-center text-gray-400">No admitted patients. Admit a patient to write notes and place orders.</CardContent></Card>
  }

  const selectedPatientRecord = admitted.find(a => a.id === selectedId)

  return (
    <div className="space-y-4">
      {/* Patient Selector */}
      <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
        <Label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Patient:</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-80 h-9 bg-gray-50/50"><SelectValue placeholder="Select admitted patient" /></SelectTrigger>
          <SelectContent>
            {admitted.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {(a.patient?.firstName || '') + ' ' + (a.patient?.lastName || '')} · Bed {a.bed?.bedNumber || '—'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sub-Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start h-12 bg-white border border-gray-100 rounded-xl p-1">
          <TabsTrigger value="notes" className="gap-2 data-[state=active]:bg-cyan-50 data-[state=active]:text-cyan-700 data-[state=active]:shadow-sm">
            <ClipboardList className="h-4 w-4" /> Doctor Notes
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-2 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-sm">
            <FlaskConical className="h-4 w-4" /> Clinical Orders
          </TabsTrigger>
          <TabsTrigger value="consultations" className="gap-2 data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:shadow-sm">
            <Stethoscope className="h-4 w-4" /> Specialist Consultations
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm">
            <FileText className="h-4 w-4" /> Reports
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="notes" className="m-0 border-none p-0 outline-none">
            <ProgressNotesPanel admitted={admitted} admissionId={selectedId} />
          </TabsContent>

          <TabsContent value="orders" className="m-0 border-none p-0 outline-none">
            <ClinicalOrdersTab admitted={admitted} admissionId={selectedId} />
          </TabsContent>

          <TabsContent value="consultations" className="m-0 border-none p-0 outline-none">
            {selectedPatientRecord ? (
              <ConsultationsTab 
                admission={selectedPatientRecord} 
                doctors={doctors} 
                departments={departments} 
              />
            ) : (
              <p className="text-sm text-gray-500 py-10 text-center">Select a patient to view consultations.</p>
            )}
          </TabsContent>

          <TabsContent value="reports" className="m-0 border-none p-0 outline-none">
            <ReportsTab admissionId={selectedId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
