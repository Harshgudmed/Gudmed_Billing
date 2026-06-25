import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import KycSection from '@/components/KycSection'
import client from '@/api/client'
import { toast } from 'sonner'

export default function PatientKycPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await client.get('/patient-portal/me')
      setData(res.data)
    } catch (e) {
      toast.error('Failed to load KYC details')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  }

  const primary = data?.branding?.primaryColor || '#2563eb'

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Simple Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mr-4">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
          </Button>
          <div className="font-semibold text-gray-900">Document Uploads</div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <KycSection 
          documents={data?.patientDocuments || []} 
          onUploadSuccess={fetchData} 
          primaryColor={primary} 
        />
      </main>
    </div>
  )
}
