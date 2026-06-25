import { useState, useRef } from 'react'
import { UploadCloud, CheckCircle2, FileText, FileImage, File, Loader2, Trash2, Eye } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import client from '@/api/client'

const KYC_DOCS = [
  { id: 'aadhaar', label: 'Aadhaar Card' },
  { id: 'pan', label: 'PAN Card' },
  { id: 'insurance', label: 'Insurance Policy' },
  { id: 'referral', label: 'Referral Letter' },
  { id: 'lab_report', label: 'Previous Lab Reports' },
  { id: 'prescription', label: 'Previous Prescriptions' },
  { id: 'history', label: 'Medical History Report' },
]

export default function KycSection({ documents = [], onUploadSuccess, primaryColor }) {
  const [uploading, setUploading] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState(null)
  const [viewDoc, setViewDoc] = useState(null)
  const fileInputRef = useRef(null)

  const handleUploadClick = (docType) => {
    setSelectedDocType(docType)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !selectedDocType) return

    if (file.size > 50 * 1024 * 1024) {
      toast.error('File too large (Max 50MB)')
      return
    }

    setUploading(true)
    const formData = new FormData()
    formData.append('document', file)
    formData.append('documentType', selectedDocType)

    try {
      const res = await client.post('/patient-portal/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      if (res.success) {
        toast.success('Document uploaded successfully')
        if (onUploadSuccess) onUploadSuccess()
      }
    } catch (err) {
      toast.error(err.message || 'Failed to upload document')
    } finally {
      setUploading(false)
      setSelectedDocType(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (docId) => {
    try {
      const res = await client.delete(`/patient-portal/documents/${docId}`)
      if (res.success) {
        toast.success('Document removed')
        if (onUploadSuccess) onUploadSuccess()
      }
    } catch (err) {
      toast.error(err.message || 'Failed to remove document')
    }
  }

  // Map of uploaded docType -> Document object
  const uploadedDocs = documents.reduce((acc, doc) => {
    acc[doc.documentType] = doc
    return acc
  }, {})

  const getMediaUrl = (url) => {
    if (!url) return ''
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
    const prefix = baseUrl.endsWith('/api') ? baseUrl.slice(0, -4) : baseUrl
    return `${prefix}${url}`
  }

  return (
    <Card className="col-span-full mb-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UploadCloud className="h-5 w-5" style={{ color: primaryColor }} />
          KYC & Medical Documents
        </CardTitle>
        <CardDescription>
          Upload your identity proofs and previous medical records. You can select files or take photos directly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Hidden file input */}
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*,application/pdf"
          capture="environment" 
          onChange={handleFileChange} 
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {KYC_DOCS.map(doc => {
            const uploadedDoc = uploadedDocs[doc.id]
            const isUploaded = !!uploadedDoc
            
            return (
              <div 
                key={doc.id} 
                className={`relative flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                  isUploaded ? 'border-green-200 bg-green-50/30' : 'border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {/* Status indicator */}
                {isUploaded ? (
                  <div className="absolute top-3 right-3 text-green-500 bg-white rounded-full">
                    <CheckCircle2 className="h-5 w-5 fill-current text-white bg-green-500 rounded-full" />
                  </div>
                ) : (
                  <div className="absolute top-3 right-3 text-gray-300">
                    <File className="h-4 w-4" />
                  </div>
                )}

                {/* Delete button if uploaded */}
                {isUploaded && (
                  <div className="absolute top-3 left-3 flex gap-1">
                    <button 
                      onClick={() => setViewDoc(uploadedDoc)}
                      className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-1.5 rounded-full transition-colors"
                      title="View document"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(uploadedDoc.id)}
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-full transition-colors"
                      title="Remove document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <div className="mb-3 p-3 rounded-full bg-white shadow-sm border border-gray-100 mt-2">
                  {doc.id.includes('report') || doc.id.includes('history') || doc.id.includes('prescription') ? (
                    <FileText className={`h-6 w-6 ${isUploaded ? 'text-green-600' : 'text-gray-400'}`} />
                  ) : (
                    <FileImage className={`h-6 w-6 ${isUploaded ? 'text-green-600' : 'text-gray-400'}`} />
                  )}
                </div>
                
                <h3 className="text-sm font-medium text-center text-gray-800 mb-1">{doc.label}</h3>
                
                {isUploaded ? (
                  <span className="text-xs text-green-600 font-medium">Verified / Uploaded</span>
                ) : (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2 text-xs w-full"
                    disabled={uploading && selectedDocType === doc.id}
                    onClick={() => handleUploadClick(doc.id)}
                  >
                    {uploading && selectedDocType === doc.id ? (
                      <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Uploading...</>
                    ) : (
                      'Upload Document'
                    )}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>

      <Dialog open={!!viewDoc} onOpenChange={(o) => !o && setViewDoc(null)}>
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Document Preview</DialogTitle>
            <DialogDescription>
              {KYC_DOCS.find(d => d.id === viewDoc?.documentType)?.label || viewDoc?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded-md border bg-gray-50 flex items-center justify-center p-2 relative">
            {viewDoc && viewDoc.fileType && viewDoc.fileType.includes('image') ? (
              <img 
                src={getMediaUrl(viewDoc.fileUrl)} 
                alt="Document preview" 
                className="max-w-full max-h-full object-contain"
              />
            ) : viewDoc ? (
              <iframe 
                src={getMediaUrl(viewDoc.fileUrl)} 
                className="w-full h-full border-0"
                title="Document viewer"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
