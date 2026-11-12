import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/common/StatCard'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { FileText, Upload, Trash2, Eye, Printer, Download, Loader2, AlertCircle, FolderOpen, ZoomIn, ZoomOut, RotateCcw, ChevronDown, CheckCircle2, XCircle, Clock, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import client, { BASE_URL } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import { showApiError } from '@/lib/apiRequest'
import { printViaIframe, escapeHtml, gudmedDocument, infoBox } from '@/lib/printTemplate'
import { getOrgSettings } from '@/lib/orgSettings'
import { useLiveData } from '@/lib/useLiveData'
import { PATIENT_DOC_TYPES as DOC_TYPES, PATIENT_DOC_TYPE_LABEL as TYPE_LABEL, groupDocTypes } from '@/lib/patientDocumentTypes'

// Most rejections are one of a handful of recurring reasons — picking one is
// faster and more consistent than typing it out each time. "Other" still
// opens a free-text box for anything that doesn't fit.
const COMMON_REJECT_REASONS = [
  'Blurry / unreadable image',
  'Wrong document uploaded',
  'Document incomplete (pages missing)',
  'Name / details do not match patient record',
  'Document not signed / stamped',
]

const VERIFY_STYLE = {
  VERIFIED: { label: 'Verified', cls: 'border-green-200 bg-green-50 text-green-700', Icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', cls: 'border-red-200 bg-red-50 text-red-700', Icon: XCircle },
  PENDING: { label: 'Pending review', cls: 'border-amber-200 bg-amber-50 text-amber-700', Icon: Clock },
}

// One panel for a patient's uploaded documents, used in OPD, IPD, Appointments
// and Insurance/TPA. Pass consultationId (OPD) or admissionId (IPD) so an
// upload is tagged to that visit and the list shows only its files; pass
// neither for the patient-wide view. Document types come from
// lib/patientDocumentTypes.js — the same list the patient's own KYC page
// (KycSection.jsx) uploads against, so an Aadhaar/PAN/insurance document the
// patient uploads shows up here too, under the same label. Pass `types` to
// show only a subset of upload cards (e.g. TPA_DOC_TYPES in the Insurance/TPA
// module) — the document list below is never filtered by it, so a document
// of any type still shows wherever it was actually uploaded.
const isImage = (fileType) => (fileType || '').startsWith('image/')
const isPdf = (fileType) => fileType === 'application/pdf'
// Word files have no browser-native preview; offer them as a download/open
// from the preview dialog instead of an empty or broken iframe.
const isPreviewable = (fileType) => isImage(fileType) || isPdf(fileType)
// BASE_URL, not a hardcoded '/api': in dev that's what Vite's proxy forwards,
// but in prod the frontend and backend are on different origins, so a bare
// '/api/...' resolves against the frontend's own host and 404s there (its
// SPA fallback then quietly serves index.html instead of the file).
const fileHref = (doc) => `${BASE_URL}${doc.fileUrl}`
// The server stores files under a random generated name
// (document-172...-....pdf); a staff member downloading it for a claim file
// wants it named after the patient and the document, not that.
const downloadName = (doc, patientName) => {
  const ext = (doc.fileUrl.match(/\.[a-zA-Z0-9]+$/) || [''])[0]
  const label = TYPE_LABEL[doc.documentType] || doc.documentType || 'document'
  const parts = [patientName, label].filter(Boolean)
  const safe = parts.join(' - ').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_')
  return `${safe}${ext}`
}
const downloadDoc = (doc, patientName) => {
  const a = document.createElement('a')
  a.href = fileHref(doc)
  a.download = downloadName(doc, patientName)
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// One checklist slot per document type: "uploaded" counts any file under
// that type, "verified"/"pending"/"rejected" look at the latest file's
// status, and "pending uploads" is only the required (non-optional) types
// still missing — matches the group header's X/Y badge above.
function checklistStats(types, documents) {
  const required = types.filter((t) => !t.optional)
  let uploaded = 0, verified = 0, pendingVerification = 0, rejected = 0
  for (const t of types) {
    const latest = documents.find((d) => d.documentType === t.value)
    if (!latest) continue
    uploaded++
    if (latest.verificationStatus === 'VERIFIED') verified++
    else if (latest.verificationStatus === 'REJECTED') rejected++
    else pendingVerification++
  }
  const pendingUploads = required.filter((t) => !documents.some((d) => d.documentType === t.value)).length
  return { totalRequired: required.length, uploaded, verified, pendingUploads, pendingVerification, rejected }
}

export default function PatientDocumentsPanel({ patientId, consultationId, admissionId, types = DOC_TYPES, patientInfo, claimInfo }) {
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

  // The document shown in the in-page preview dialog (View no longer opens a
  // new tab — the user asked to see it without leaving the screen, and print
  // it from there).
  const [previewDoc, setPreviewDoc] = useState(null)
  const previewFrameRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [rejectDoc, setRejectDoc] = useState(null)
  const [rejectChoice, setRejectChoice] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  // Fresh zoom every time a different (or the same, reopened) image is shown.
  useEffect(() => { if (previewDoc) setZoom(1) }, [previewDoc])

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
  // A document uploaded from this screen, another staff screen, or the
  // patient's own portal all write through /patients or /patient-portal —
  // re-read on either so the checklist ticks off without a manual refresh.
  useLiveData(['patients', 'patient-portal'], load)

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

  // A PDF's native viewer (inside the iframe) handles its own print dialog;
  // an image has none, so it's wrapped in a minimal printable page instead.
  const printPreview = () => {
    if (!previewDoc) return
    if (isImage(previewDoc.fileType)) {
      const name = [patientInfo?.name, previewDoc.title || TYPE_LABEL[previewDoc.documentType]].filter(Boolean).join(' - ')
      printViaIframe(`<!doctype html><html><head><title>${escapeHtml(name || 'Document')}</title></head>
        <body style="margin:0;display:flex;justify-content:center"><img src="${fileHref(previewDoc)}" style="max-width:100%;height:auto" /></body></html>`, name)
    } else {
      previewFrameRef.current?.contentWindow?.print()
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

  // Uploading a file is not the same as it being correct — a staff member
  // marks it verified or rejected (with a reason) separately; the patient's
  // own portal shows this same status read-only.
  const verify = async (doc, status, reason) => {
    try {
      const res = await client.patch(`/patients/${patientId}/documents/${doc.id}/verify`, { status, reason })
      toast.success(status === 'VERIFIED' ? 'Document verified' : 'Document rejected')
      // The server's plain update result has no uploadedByName/verifiedByName
      // (listDocuments resolves those with a separate lookup) — keep the
      // uploader's name from what we already had, and the reviewer is
      // whoever is doing this right now, so the card doesn't blank both
      // names out until the next full reload.
      setDocuments((prev) => prev.map((d) => (
        d.id === doc.id ? { ...res.data, uploadedByName: d.uploadedByName, verifiedByName: user?.fullName || null } : d
      )))
    } catch (err) {
      showApiError(err, 'Could not update verification')
    }
  }

  const confirmReject = () => {
    const reason = rejectChoice === 'Other' ? rejectReason.trim() : rejectChoice
    if (!reason) return
    verify(rejectDoc, 'REJECTED', reason)
    setRejectDoc(null)
    setRejectChoice('')
    setRejectReason('')
  }

  // An A4 printable checklist — every type in every group, with its
  // uploaded/verified checkbox, who touched it and when, built the same way
  // every other GudMed printout is (gudmedDocument/infoBox), so it matches
  // the hospital's letterhead and signs off the same as a purchase document.
  const printChecklist = async () => {
    const stats = checklistStats(types, documents)
    // Required (marked with *) documents still missing — let the staff
    // member confirm rather than silently hand a TPA an incomplete checklist.
    if (stats.pendingUploads > 0) {
      const ok = window.confirm(
        `${stats.pendingUploads} required document(s) are still not uploaded. Print the checklist anyway?`
      )
      if (!ok) return
    }
    const org = await getOrgSettings()

    const patientCells = [
      { label: 'Patient Name', value: patientInfo?.name },
      { label: 'UHID', value: patientInfo?.uhid },
      { label: 'Encounter No.', value: patientInfo?.encounterNo },
      { label: 'Insurance Company', value: claimInfo?.insurerName },
      { label: 'TPA', value: claimInfo?.tpaName },
      { label: 'Policy No.', value: claimInfo?.policyNumber },
      { label: 'Claim No.', value: claimInfo?.claimNumber },
    ].filter((c) => c.value)

    const summaryCells = [
      { label: 'Total Required', value: stats.totalRequired },
      { label: 'Uploaded', value: stats.uploaded },
      { label: 'Verified', value: stats.verified },
      { label: 'Pending Upload', value: stats.pendingUploads },
      { label: 'Pending Verification', value: stats.pendingVerification },
      { label: 'Rejected', value: stats.rejected },
    ]

    const groupTables = groupDocTypes(types).map((g) => {
      const rows = g.types.map((t, i) => {
        const latest = documents.find((d) => d.documentType === t.value)
        const uploadedBox = latest ? '&#9745;' : '&#9744;'
        const verifiedBox = latest?.verificationStatus === 'VERIFIED' ? '&#9745;' : '&#9744;'
        const status = !latest
          ? (t.optional ? 'Not Applicable' : 'Not Uploaded')
          : (VERIFY_STYLE[latest.verificationStatus]?.label || latest.verificationStatus)
        const uploadedBy = latest
          ? `${escapeHtml(latest.uploadedByName || '—')}<br>${formatDateTime(latest.uploadedAt)}` : '—'
        const verifiedBy = latest?.verifiedByName
          ? `${escapeHtml(latest.verifiedByName)}<br>${formatDateTime(latest.verifiedAt)}` : '—'
        const remarks = latest?.rejectionReason
          ? escapeHtml(latest.rejectionReason)
          : (t.optional && !latest ? 'Marked optional — not required for this case' : '')
        return `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(t.label)}${t.optional ? ' <i>(optional)</i>' : ''}</td>
          <td style="text-align:center">${uploadedBox}</td>
          <td style="text-align:center">${verifiedBox}</td>
          <td>${escapeHtml(status)}</td>
          <td>${uploadedBy}</td>
          <td>${verifiedBy}</td>
          <td>${remarks}</td>
        </tr>`
      }).join('')
      return `<div class="note-bar"><b>${escapeHtml(g.label)}</b></div>
        <table><thead><tr>
          <th>#</th><th>Document</th><th>Uploaded</th><th>Verified</th><th>Status</th>
          <th>Uploaded By / Date</th><th>Verified By / Date</th><th>Remarks</th>
        </tr></thead><tbody>${rows}</tbody></table>`
    }).join('')

    const signatureGrid = `<div class="signature-grid">
      <div class="signature-cell">Prepared by</div>
      <div class="signature-cell">Verified by</div>
      <div class="signature-cell">Authorised Signature</div>
    </div>`

    const body = `
      ${patientCells.length ? infoBox('Patient & Claim Details', patientCells) : ''}
      ${infoBox('Checklist Summary', summaryCells)}
      ${groupTables}
      ${signatureGrid}
    `

    // The browser's "Save as PDF" uses this <title> as the default filename —
    // put the patient's name in it so the saved file is identifiable.
    const checklistTitle = patientInfo?.name
      ? `TPA Checklist - ${patientInfo.name}`
      : 'TPA Document Checklist'

    printViaIframe(gudmedDocument({
      orgInfo: org,
      title: checklistTitle,
      banner: 'TPA / INSURANCE DOCUMENT CHECKLIST',
      subtitle: 'Insurance / TPA Department',
      headerRight: `Printed: ${formatDateTime(new Date())}`,
      body,
      variant: 'purchase',
    }), checklistTitle)
  }

  const stats = checklistStats(types, documents)

  return (
    <div className="space-y-4">
      {/* Live counters — recomputed from `documents` on every render, so they
          tick up the moment an upload/verify/reject comes in (useLiveData
          above re-reads documents automatically). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard tone="purple" icon={ClipboardList} label="Total Required" value={stats.totalRequired} />
        <StatCard tone="blue" icon={Upload} label="Uploaded" value={stats.uploaded} />
        <StatCard tone="green" icon={CheckCircle2} label="Verified" value={stats.verified} />
        <StatCard tone="yellow" icon={Clock} label="Pending Upload" value={stats.pendingUploads} />
        <StatCard tone="orange" icon={Clock} label="Pending Verification" value={stats.pendingVerification} />
        <StatCard tone="red" icon={XCircle} label="Rejected" value={stats.rejected} />
      </div>

      {canManage && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={printChecklist}>
            <Printer className="h-4 w-4 mr-1.5" />Print TPA Checklist
          </Button>
        </div>
      )}

      {/* One card per document type — each shows its label and an Upload button;
          the staff picks the kind and uploads its file(s) under it. */}
      {canManage && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={onFilesChosen}
            className="hidden"
          />
          {/* One collapsible section per journey stage (identity, admission,
              treatment, billing, claim) instead of one long flat grid —
              <details> gives expand/collapse with no extra state. Each
              section defaults open. */}
          <div className="space-y-2">
            {groupDocTypes(types).map((g) => {
              // Every card in the group (required + optional) counts here, so
              // the badge matches what's visibly on screen — a group with 5
              // cards and 1 uploaded reads "1/5", not "1/3" with the 2
              // optional cards silently left out of the denominator.
              const groupDone = g.types.filter((t) => documents.some((d) => d.documentType === t.value)).length
              return (
              <details key={g.id} open className="group rounded-lg border border-blue-100 overflow-hidden">
                <summary className="flex cursor-pointer select-none items-center justify-between gap-2 border-l-4 border-blue-600 bg-blue-50 px-3 py-2.5 text-sm font-bold tracking-wide text-blue-900 [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    {g.label}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${groupDone === g.types.length ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {groupDone}/{g.types.length}
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-blue-500 transition-transform group-open:rotate-180" />
                </summary>
                {/* Sized off the panel's own width (not the viewport), capped
                    at 3 per row so cards stay a readable size on a wide
                    dialog instead of stretching thin. */}
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 p-3 [&>*]:min-w-0">
                  {g.types.map((t) => {
                    // documents is already newest-first (server orders by
                    // uploadedAt desc), so the first match is the latest of this type.
                    const docsOfType = documents.filter((d) => d.documentType === t.value)
                    const latest = docsOfType[0]
                    const busy = uploadingType === t.value
                    return (
                      <div key={t.value} className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 p-3 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 shrink-0">
                          <FileText className="h-5 w-5 text-gray-400" />
                        </div>
                        {/* flex-1 + flex centring keeps every card's button row at the
                            same baseline whether its label wraps to one line or two. */}
                        <p className="flex-1 flex items-center text-sm font-medium leading-tight text-blue-700">
                          {t.label}
                          {!t.optional && <span className="text-red-500" title="Required">&nbsp;*</span>}
                          {t.optional && <span className="font-normal text-gray-400">&nbsp;(optional)</span>}
                          {docsOfType.length > 0 && <span className="font-normal text-gray-400">&nbsp;({docsOfType.length})</span>}
                        </p>
                        <div className="flex w-full gap-1.5">
                          {latest && (
                            <Button
                              type="button" size="sm" variant="outline" className="flex-1"
                              title={`View ${docsOfType.length > 1 ? 'latest' : ''} ${t.label}`.trim()}
                              onClick={() => setPreviewDoc(latest)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="flex-1" disabled={!!uploadingType} onClick={() => pickFiles(t.value)}>
                            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin shrink-0" /> : <Upload className="mr-1.5 h-4 w-4 shrink-0" />}
                            Upload
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </details>
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
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
          {documents.map((doc) => (
            <div key={doc.id} className="flex flex-col rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="flex items-start gap-3 p-3">
                <button type="button" className="shrink-0" onClick={() => setPreviewDoc(doc)} title="View">
                  {isImage(doc.fileType) ? (
                    <img src={fileHref(doc)} alt={doc.title || 'document'} className="h-12 w-12 rounded object-cover border" />
                  ) : (
                    <div className="h-12 w-12 rounded border bg-red-50 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-red-500" />
                    </div>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  {/* The type is what identifies a document in this checklist — lead
                      with it; the raw uploaded filename is secondary, truncated
                      rather than wrapped so it never dominates the card. */}
                  <p className="font-medium text-sm leading-tight">{TYPE_LABEL[doc.documentType] || doc.documentType}</p>
                  <p className="text-xs text-gray-400 truncate" title={doc.title || ''}>{doc.title || 'Untitled'}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {/* Uploading a file and it being correct are two different
                        things — this is the server's verificationStatus, not an
                        upload-success indicator. */}
                    {(() => {
                      const v = VERIFY_STYLE[doc.verificationStatus] || VERIFY_STYLE.PENDING
                      return (
                        <Badge variant="outline" className={`text-[11px] ${v.cls}`}>
                          <v.Icon className="h-3 w-3 mr-1" />{v.label}
                        </Badge>
                      )
                    })()}
                  </div>
                  {doc.verificationStatus === 'REJECTED' && doc.rejectionReason && (
                    <p className="text-xs text-red-600 mt-1">{doc.rejectionReason}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {doc.uploadedByName ? `${doc.uploadedByName} · ` : ''}{formatDateTime(doc.uploadedAt)}
                  </p>
                </div>
              </div>
              {/* Actions in one row along the bottom, not a tall stack down the
                  right side — a card used to end in a column of 4 icons with
                  mostly empty space beside them. */}
              <div className="flex items-center justify-end gap-1 border-t border-gray-100 bg-gray-50 px-2 py-1">
                <button type="button" onClick={() => setPreviewDoc(doc)} title="View" className="p-1.5 rounded hover:bg-gray-200 text-blue-600">
                  <Eye className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => downloadDoc(doc, patientInfo?.name)} title="Download" className="p-1.5 rounded hover:bg-gray-200 text-blue-600">
                  <Download className="h-4 w-4" />
                </button>
                {canManage && doc.verificationStatus !== 'VERIFIED' && (
                  <button type="button" onClick={() => verify(doc, 'VERIFIED')} title="Mark verified" className="p-1.5 rounded hover:bg-green-100 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                )}
                {canManage && doc.verificationStatus !== 'REJECTED' && (
                  <button type="button" onClick={() => { setRejectDoc(doc); setRejectChoice(''); setRejectReason('') }} title="Reject" className="p-1.5 rounded hover:bg-red-100 text-red-500">
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
                {canManage && (
                  <button onClick={() => remove(doc)} title="Delete" className="p-1.5 rounded hover:bg-red-100 text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* In-page preview, full-screen — View used to open a new tab; now it
          opens here, with zoom (images) and a Print button for the file shown. */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="w-screen h-screen max-w-none sm:max-w-none rounded-none p-4 flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{previewDoc?.title || (previewDoc && (TYPE_LABEL[previewDoc.documentType] || previewDoc.documentType)) || 'Document'}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-md border bg-gray-50 flex items-center justify-center">
            {previewDoc && isImage(previewDoc.fileType) ? (
              <img
                src={fileHref(previewDoc)}
                alt={previewDoc.title || 'document'}
                style={{ transform: `scale(${zoom})` }}
                className="max-w-full max-h-full object-contain transition-transform"
              />
            ) : previewDoc && isPdf(previewDoc.fileType) ? (
              <iframe ref={previewFrameRef} src={fileHref(previewDoc)} title="Document preview" className="w-full h-full border-0" />
            ) : previewDoc ? (
              <div className="flex flex-col items-center gap-3 text-center text-gray-500 p-6">
                <FileText className="h-10 w-10" />
                <p className="text-sm">This file type can't be previewed here.</p>
                <a href={fileHref(previewDoc)} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open it in a new tab</a>
                <Button type="button" variant="outline" onClick={() => downloadDoc(previewDoc, patientInfo?.name)}><Download className="h-4 w-4 mr-1.5" />Download</Button>
              </div>
            ) : null}
          </div>
          <DialogFooter className="justify-between sm:justify-between">
            {/* Zoom only makes sense for an image — a PDF/Word file has its own
                native zoom (the PDF viewer, or the app it opens in). */}
            {previewDoc && isImage(previewDoc.fileType) ? (
              <div className="flex items-center gap-1">
                <Button type="button" size="icon" variant="outline" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center text-sm text-gray-600 tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button type="button" size="icon" variant="outline" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} title="Zoom in">
                  <ZoomIn className="h-4 w-4" />
                </Button>
                {zoom !== 1 && (
                  <Button type="button" size="icon" variant="outline" onClick={() => setZoom(1)} title="Reset zoom">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : <div />}
            <div className="flex gap-2">
              {previewDoc && isPreviewable(previewDoc.fileType) && (
                <>
                  <Button type="button" variant="outline" onClick={() => downloadDoc(previewDoc, patientInfo?.name)}><Download className="h-4 w-4 mr-1.5" />Download</Button>
                  <Button type="button" variant="outline" onClick={printPreview}><Printer className="h-4 w-4 mr-1.5" />Print</Button>
                </>
              )}
              <Button type="button" variant="outline" onClick={() => setPreviewDoc(null)}>Close</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectDoc} onOpenChange={(o) => !o && setRejectDoc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {rejectDoc?.title || (rejectDoc && (TYPE_LABEL[rejectDoc.documentType] || rejectDoc.documentType))}
            </p>
            <p className="text-sm font-medium text-gray-900">Reason for rejection</p>
            <div className="space-y-1.5">
              {COMMON_REJECT_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 has-[:checked]:border-red-300 has-[:checked]:bg-red-50">
                  <input type="radio" name="reject-reason" value={r} checked={rejectChoice === r} onChange={() => setRejectChoice(r)} />
                  {r}
                </label>
              ))}
              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 has-[:checked]:border-red-300 has-[:checked]:bg-red-50">
                <input type="radio" name="reject-reason" value="Other" checked={rejectChoice === 'Other'} onChange={() => setRejectChoice('Other')} />
                Other
              </label>
            </div>
            {rejectChoice === 'Other' && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-900" htmlFor="reject-other-reason">Type the reason</label>
                <Textarea
                  id="reject-other-reason"
                  autoFocus
                  rows={3}
                  placeholder="e.g. Policy number mismatch"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectDoc(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectChoice || (rejectChoice === 'Other' && !rejectReason.trim())}
              onClick={confirmReject}
            >
              Reject document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
