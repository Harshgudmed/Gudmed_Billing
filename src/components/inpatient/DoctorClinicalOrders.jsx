import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, Stethoscope } from 'lucide-react'
import client from '@/api/client'
import NotesAndOrders from '@/components/inpatient/NotesAndOrders'

// Doctor portal — "Clinical Orders" for the logged-in doctor's OWN admitted patients.
// Reuses the ward ClinicalOrdersTab (search → order → timeline). Orders placed here
// appear on the ward/nursing dashboard within ~10s (both poll the same data).
export default function DoctorClinicalOrders() {
  const [admitted, setAdmitted] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await client.get('/inpatient?resource=admissions&mine=true&status=admitted')
      setAdmitted(res.data || [])
    } catch { toast.error('Failed to load your patients') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  // refresh the patient list periodically (new admissions assigned to me)
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t) }, [load])

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-600 text-white"><Stethoscope className="h-5 w-5" /></span>
        <div>
          <h1 className="text-xl font-bold leading-tight">Doctor Notes &amp; Orders</h1>
          <p className="text-sm text-gray-500">Your admitted patients — write notes and order Pharmacy / Lab / Radiology / Procedure. Updates live on the ward dashboard.</p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading your patients…</div>
      ) : admitted.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <Stethoscope className="h-8 w-8 mx-auto mb-2 text-gray-200" />
          You have no admitted patients right now. Patients where you are the attending or admitting doctor will appear here.
        </div>
      ) : (
        <NotesAndOrders admitted={admitted} />
      )}
    </div>
  )
}
