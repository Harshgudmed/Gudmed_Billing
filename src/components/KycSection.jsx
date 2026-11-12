import { useState, useRef } from 'react'
import { UploadCloud, CheckCircle2, FileText, FileImage, File, Loader2, Trash2, Eye, Clock, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import client, { BASE_URL } from '@/api/client'
import { PATIENT_DOC_TYPE_LABEL } from '@/lib/patientDocumentTypes'

// The identity proofs + previous-record types a patient fills in from their
// own portal. Labels come from lib/patientDocumentTypes.js — the same list
// the staff-facing PatientDocumentsPanel (Appointments/OPD/IPD/Insurance-TPA)
// reads, so a document the patient uploads here shows up there under the
// same name, and vice versa.
const KYC_DOC_IDS = ['aadhaar', 'pan', 'employee_id', 'photograph', 'insurance', 'referral', 'lab_report', 'prescription', 'history']
const KYC_DOCS = KYC_DOC_IDS.map((id) => ({ id, label: PATIENT_DOC_TYPE_LABEL[id] }))

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

    // Matches the server's limit (lib/patientDocumentUpload.js) — checking
    // here too avoids a wasted upload that the server would reject anyway.
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File too large (max 20MB)')
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

  // BASE_URL, not a hardcoded '/api': in dev that's what Vite's proxy
  // forwards, but in prod the frontend and backend are on different origins
  // (VITE_API_URL), so a bare '/api/...' resolves against the frontend's own
  // host and its SPA fallback quietly serves index.html instead of the file.
  const getMediaUrl = (url) => (url ? `${BASE_URL}${url}` : '')

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
          accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          capture="environment" 
          onChange={handleFileChange} 
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {KYC_DOCS.map(doc => {
            const uploadedDoc = uploadedDocs[doc.id]
            const isUploaded = !!uploadedDoc
            const isPending = isUploaded && uploadedDoc.verificationStatus === 'PENDING'
            const isVerified = isUploaded && uploadedDoc.verificationStatus === 'VERIFIED'
            const isRejected = isUploaded && uploadedDoc.verificationStatus === 'REJECTED'
            
            // Fallback for older documents before this feature
            const isLegacy = isUploaded && !uploadedDoc.verificationStatus
            const treatedAsVerified = isVerified || isLegacy

            let cardStyle = 'border-dashed border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            if (treatedAsVerified) cardStyle = 'border-green-200 bg-green-50/30'
            else if (isPending) cardStyle = 'border-yellow-200 bg-yellow-50/30'
            else if (isRejected) cardStyle = 'border-red-200 bg-red-50/30'
            
            return (
              <div 
                key={doc.id} 
                className={`relative flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${cardStyle}`}
              >
                {/* Status indicator */}
                {treatedAsVerified ? (
                  <div className="absolute top-3 right-3 text-green-500 bg-white rounded-full">
                    <CheckCircle2 className="h-5 w-5 fill-current text-white bg-green-500 rounded-full" />
                  </div>
                ) : isPending ? (
                  <div className="absolute top-3 right-3 text-yellow-500 bg-white rounded-full">
                    <Clock className="h-5 w-5" />
                  </div>
                ) : isRejected ? (
                  <div className="absolute top-3 right-3 text-red-500 bg-white rounded-full">
                    <XCircle className="h-5 w-5" />
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
                    <FileText className={`h-6 w-6 ${treatedAsVerified ? 'text-green-600' : isPending ? 'text-yellow-600' : isRejected ? 'text-red-600' : 'text-gray-400'}`} />
                  ) : (
                    <FileImage className={`h-6 w-6 ${treatedAsVerified ? 'text-green-600' : isPending ? 'text-yellow-600' : isRejected ? 'text-red-600' : 'text-gray-400'}`} />
                  )}
                </div>
                
                <h3 className="text-sm font-medium text-center text-gray-800 mb-1">{doc.label}</h3>
                
                {treatedAsVerified ? (
                  <span className="text-xs text-green-600 font-medium">Verified / Uploaded</span>
                ) : isPending ? (
                  <span className="text-xs text-yellow-600 font-medium">Verification Pending</span>
                ) : isRejected ? (
                  <div className="flex flex-col items-center w-full">
                    <span className="text-xs text-red-600 font-medium">Rejected</span>
                    {uploadedDoc.rejectionReason && (
                      <span className="text-[10px] text-red-500 text-center mt-1 leading-tight">{uploadedDoc.rejectionReason}</span>
                    )}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-2 text-xs w-full border-red-200 text-red-600 hover:bg-red-50"
                      disabled={uploading && selectedDocType === doc.id}
                      onClick={() => handleUploadClick(doc.id)}
                    >
                      {uploading && selectedDocType === doc.id ? (
                        <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Uploading...</>
                      ) : (
                        'Upload Again'
                      )}
                    </Button>
                  </div>
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
            ) : viewDoc && viewDoc.fileType === 'application/pdf' ? (
              <iframe
                src={getMediaUrl(viewDoc.fileUrl)}
                className="w-full h-full border-0"
                title="Document viewer"
              />
            ) : viewDoc ? (
              // Word files (now accepted on upload) have no inline browser
              // preview — an <iframe> just shows blank — so offer a direct
              // link instead of a dead-looking frame.
              <div className="flex flex-col items-center gap-3 text-center text-gray-500 p-6">
                <File className="h-10 w-10" />
                <p className="text-sm">This file type can't be previewed here.</p>
                <a href={getMediaUrl(viewDoc.fileUrl)} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open it in a new tab</a>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
