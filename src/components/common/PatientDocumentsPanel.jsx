import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileText, Image as ImageIcon, Upload, Trash2, ExternalLink, Loader2, AlertCircle, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import { useAuth } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import { showApiError } from '@/lib/apiRequest'

// One panel for a patient's uploaded documents, used in both the OPD
// consultation and the IPD admission. Pass consultationId (OPD) or admissionId
// (IPD) so an upload is tagged to that visit and the list shows only its files;
// pass neither for the patient-wide view.
//
// Uploads and deletes are a doctor's / nurse's; the server enforces the same.

const DOC_TYPES = [
  { value: 'lab_report', label: 'Lab Report' },
  { value: 'radiology', label: 'Radiology / Imaging' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'opd_card', label: 'Previous OPD Card' },
  { value: 'discharge_summary', label: 'Discharge Summary' },
  { value: 'insurance', label: 'Insurance Details' },
  { value: 'referral', label: 'Referral Letter' },
  { value: 'ecg_echo', label: 'ECG / ECHO' },
  { value: 'operative_notes', label: 'Operative / Surgery Notes' },
  { value: 'consent', label: 'Consent Form' },
  { value: 'clinical_photo', label: 'Clinical Photo' },
  { value: 'history', label: 'Previous Records / History' },
  { value: 'other', label: 'Other' },
]
const TYPE_LABEL = Object.fromEntries(DOC_TYPES.map((t) => [t.value, t.label]))
const isImage = (fileType) => (fileType || '').startsWith('image/')
// The server mounts the files under /api too, so the browser reaches them
// through the same proxy the rest of the API uses (and the auth cookie rides
// along on the <img> / <a> request).
const fileHref = (doc) => `/api${doc.fileUrl}`

export default function PatientDocumentsPanel({ patientId, consultationId, admissionId }) {
  const { user } = useAuth()
  const canManage = ['doctor', 'nurse', 'receptionist', 'admin'].includes(user?.role)

  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // Which type's card is mid-upload (for its spinner). The file picker is shared;
  // the clicked card's type is held in a ref until the files come back.
  const [uploadingType, setUploadingType] = useState(null)
  const fileInputRef = useRef(null)
  const pendingType = useRef(null)

  const load = useCallback(async () => {
    if (!patientId) return
    setLoading(true)
    setLoadError(false)
    try {
      const res = await client.get(`/patients/${patientId}/documents`, {
        params: { consultationId, admissionId },
      })
      setDocuments(res.data ?? [])
    } catch (err) {
      setLoadError(true)
      showApiError(err, 'Could not load documents')
    } finally {
      setLoading(false)
    }
  }, [patientId, consultationId, admissionId])

  useEffect(() => { load() }, [load])

  // Clicking a type card opens the shared file picker for that type.
  const pickFiles = (docType) => {
    pendingType.current = docType
    fileInputRef.current?.click()
  }

  const onFilesChosen = async (e) => {
    const chosen = Array.from(e.target.files || [])
    e.target.value = '' // let the same file be re-picked later
    const docType = pendingType.current
    if (!chosen.length || !docType) return
    setUploadingType(docType)
    try {
      const fd = new FormData()
      fd.append('patientId', patientId)
      if (consultationId) fd.append('consultationId', consultationId)
      if (admissionId) fd.append('admissionId', admissionId)
      fd.append('documentType', docType)
      for (const f of chosen) fd.append('documents', f)
      const res = await client.post('/uploads/patient-documents', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success(`${res.count ?? chosen.length} file(s) uploaded`)
      load()
    } catch (err) {
      showApiError(err, 'Upload failed')
    } finally {
      setUploadingType(null)
    }
  }

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.title || 'this document'}"? This cannot be undone.`)) return
    try {
      await client.delete(`/uploads/patient-documents/${doc.id}`)
      toast.success('Document deleted')
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (err) {
      showApiError(err, 'Could not delete the document')
    }
  }

  return (
    <div className="space-y-4">
      {/* One card per document type — each shows its label and an Upload button;
          the staff picks the kind and uploads its file(s) under it. */}
      {canManage && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={onFilesChosen}
            className="hidden"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {DOC_TYPES.map((t) => {
              const count = documents.filter((d) => d.documentType === t.value).length
              const busy = uploadingType === t.value
              return (
                <div key={t.value} className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 p-3 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                    <FileText className="h-5 w-5 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium leading-tight text-blue-700">
                    {t.label}{count > 0 && <span className="font-normal text-gray-400"> ({count})</span>}
                  </p>
                  <Button size="sm" variant="outline" disabled={!!uploadingType} onClick={() => pickFiles(t.value)}>
                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
                    Upload Document
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading documents…</div>
      ) : loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> Could not load documents.
          <button className="underline" onClick={load}>Try again</button>
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm">
          <FolderOpen className="h-8 w-8 mb-2" />
          No documents uploaded yet
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <div className="shrink-0">
                {isImage(doc.fileType) ? (
                  <a href={fileHref(doc)} target="_blank" rel="noreferrer">
                    <img src={fileHref(doc)} alt={doc.title || 'document'} className="h-14 w-14 rounded object-cover border" />
                  </a>
                ) : (
                  <div className="h-14 w-14 rounded border bg-red-50 flex items-center justify-center">
                    <FileText className="h-6 w-6 text-red-500" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{doc.title || 'Untitled'}</p>
                <Badge variant="outline" className="mt-0.5 text-[11px]">
                  {isImage(doc.fileType) ? <ImageIcon className="h-3 w-3 mr-1" /> : <FileText className="h-3 w-3 mr-1" />}
                  {TYPE_LABEL[doc.documentType] || doc.documentType}
                </Badge>
                <p className="text-xs text-gray-400 mt-1">
                  {doc.uploadedByName ? `${doc.uploadedByName} · ` : ''}{formatDateTime(doc.uploadedAt)}
                </p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <a href={fileHref(doc)} target="_blank" rel="noreferrer" title="View" className="p-1.5 rounded hover:bg-gray-100 text-blue-600">
                  <ExternalLink className="h-4 w-4" />
                </a>
                {canManage && (
                  <button onClick={() => remove(doc)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
