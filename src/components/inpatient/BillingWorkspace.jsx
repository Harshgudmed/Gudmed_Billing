import { useState, useMemo } from 'react'
import { Search, IndianRupee } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import BillScreen from '@/components/inpatient/BillScreen'
import { drName } from '@/lib/utils'

export default function BillingWorkspace({ admissions, orgInfo }) {
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredPatients = useMemo(() => {
    return admissions.filter((a) => {
      const q = searchQuery.toLowerCase()
      const n = `${a.patient?.firstName || ''} ${a.patient?.lastName || ''}`.toLowerCase()
      return n.includes(q) || (a.patient?.mrn || '').toLowerCase().includes(q)
    })
  }, [admissions, searchQuery])

  // Keep selected patient reference fresh
  const selectedPatientRecord = selectedPatient ? admissions.find(a => a.id === selectedPatient) : null

  return (
    <div className="flex h-[calc(100vh-180px)] overflow-hidden border rounded-xl bg-white shadow-sm">
      {/* LEFT PANEL: Patient List */}
      <div className="w-80 bg-gray-50 border-r flex flex-col">
        <div className="p-4 border-b bg-white">
          <h2 className="font-bold mb-3 flex items-center gap-2 text-gray-800">
            <IndianRupee className="h-5 w-5 text-emerald-600" />
            IPD Billing
          </h2>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <Input 
              placeholder="Search patients..." 
              className="pl-9 bg-gray-50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filteredPatients.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">No admitted patients found.</p>
          ) : (
            filteredPatients.map(a => (
              <button
                key={a.id}
                onClick={() => setSelectedPatient(a.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedPatient === a.id 
                    ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-500' 
                    : 'bg-white border-gray-200 hover:border-emerald-300'
                }`}
              >
                <div className="font-semibold text-sm flex justify-between">
                  <span className="truncate pr-2">{a.patient?.firstName} {a.patient?.lastName}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1 flex justify-between">
                  <span>{a.patient?.mrn}</span>
                  <span>{a.bed?.ward?.name || '—'} / {a.bed?.bedNumber || '—'}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Live Bill Workspace */}
      <div className="flex-1 flex flex-col bg-gray-50 overflow-y-auto">
        {selectedPatientRecord ? (
          <div className="p-6">
            <div className="mb-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-gray-900">
                  {selectedPatientRecord.patient?.firstName} {selectedPatientRecord.patient?.lastName}
                </h3>
                <p className="text-sm text-gray-500">
                  UHID: {selectedPatientRecord.patient?.mrn} | 
                  Admitted: {new Date(selectedPatientRecord.admissionDate).toLocaleDateString()}
                </p>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <BillScreen admission={selectedPatientRecord} orgInfo={orgInfo} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <IndianRupee className="h-16 w-16 mb-4 text-gray-200" />
            <p className="text-lg font-medium text-gray-500">Select a patient to view billing</p>
            <p className="text-sm">Manage live charges, generate drafts, and process payments.</p>
          </div>
        )}
      </div>
    </div>
  )
}
