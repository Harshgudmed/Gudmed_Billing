import { useState, useEffect, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Pencil, Archive, Wrench, AlertCircle, Paperclip, FileText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import client, { BASE_URL } from '@/api/client'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime, localYmd } from '@/lib/format'

// BASE_URL, not a hardcoded '/api': in dev that's what Vite's proxy forwards,
// but in prod the frontend and backend are on different origins, so a bare
// '/api/...' resolves against the frontend's own host and 404s there.
const fileHref = (doc) => `${BASE_URL}${doc.fileUrl}`

const STATUS_BADGE = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  UNDER_REPAIR: 'bg-orange-50 text-orange-700 border-orange-200',
  RETIRED: 'bg-blue-50 text-blue-700 border-blue-200',
  DISPOSED: 'bg-gray-100 text-gray-500 border-gray-200',
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm">{value ?? <span className="text-gray-400">—</span>}</div>
    </div>
  )
}

export default function AssetDetail({ id, open, onOpenChange, onChanged, canManage, onEdit }) {
  const [asset, setAsset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  // A parent's onChanged/onEdit recreated inline would re-trigger this effect
  // every render; keep the latest in a ref so the effect only depends on id/open.
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  // One shared hidden file input for every row's paperclip — which row it was
  // clicked for is held in a ref until the file comes back, same pattern
  // PatientDocumentsPanel uses for its per-type upload buttons.
  const fileInputRef = useRef(null)
  const pendingLogId = useRef(null)
  const [uploadingLogId, setUploadingLogId] = useState(null)

  const pickBillFile = (logId) => {
    pendingLogId.current = logId
    fileInputRef.current?.click()
  }

  const onBillFileChosen = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const logId = pendingLogId.current
    if (!file || !logId) return
    setUploadingLogId(logId)
    try {
      const fd = new FormData()
      fd.append('maintenanceLogId', logId)
      fd.append('document', file)
      await client.post('/uploads/asset-maintenance-documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('Bill/receipt attached')
      load()
    } catch (err) {
      showApiError(err, 'Could not attach the file')
    } finally {
      setUploadingLogId(null)
    }
  }

  const removeBillFile = async (docId) => {
    if (!window.confirm('Remove this attachment?')) return
    try {
      await client.delete(`/uploads/asset-maintenance-documents/${docId}`)
      toast.success('Attachment removed')
      load()
    } catch (err) {
      showApiError(err, 'Could not remove the attachment')
    }
  }

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await client.get(`/assets/${id}`)
      setAsset(res.data)
    } catch (err) {
      showApiError(err, 'Could not load the asset')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { if (open) load() }, [open, load])

  const retire = async () => {
    if (!window.confirm(`Mark "${asset.name}" as disposed? This cannot be undone.`)) return
    try {
      await client.patch(`/assets/${asset.id}/retire`)
      toast.success('Asset marked as disposed')
      load()
      onChangedRef.current?.()
    } catch (err) {
      showApiError(err, 'Could not retire the asset')
    }
  }

  if (!asset && !loading) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {loading && !asset ? (
          <>
            <DialogHeader><DialogTitle>Loading asset…</DialogTitle></DialogHeader>
            <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          </>
        ) : asset && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {asset.name}
                <Badge variant="outline" className={STATUS_BADGE[asset.status] || ''}>{asset.status.replace('_', ' ')}</Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-4 border rounded-md p-3">
              <InfoRow label="Asset Tag" value={<span className="font-mono">{asset.assetTag}</span>} />
              <InfoRow label="Category" value={asset.category} />
              <InfoRow label="Serial Number" value={asset.serialNumber} />
              <InfoRow label="Department" value={asset.department?.name} />
              <InfoRow label="Location" value={asset.location} />
              <InfoRow label="Vendor" value={asset.vendor?.name} />
              <InfoRow label="Purchase Date" value={asset.purchaseDate && formatDateTime(asset.purchaseDate, { withTime: false })} />
              <InfoRow label="Purchase Cost" value={asset.purchaseCost != null && formatMoney(asset.purchaseCost)} />
              <InfoRow label="Book Value" value={asset.bookValue != null && formatMoney(asset.bookValue)} />
              <InfoRow label="Warranty Expiry" value={asset.warrantyExpiry && (
                <span className={asset.warrantyExpired ? 'text-red-600' : ''}>
                  {formatDateTime(asset.warrantyExpiry, { withTime: false })}{asset.warrantyExpired ? ' (expired)' : ''}
                </span>
              )} />
              <InfoRow label="AMC Vendor" value={asset.amcVendor?.name} />
              <InfoRow label="AMC Expiry" value={asset.amcExpiry && (
                <span className={asset.amcExpired ? 'text-red-600' : ''}>
                  {formatDateTime(asset.amcExpiry, { withTime: false })}{asset.amcExpired ? ' (expired)' : ''}
                </span>
              )} />
            </div>

            {asset.notes && <p className="text-sm text-gray-600 border-l-4 border-gray-200 pl-3">{asset.notes}</p>}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Wrench className="h-4 w-4" />Maintenance History
                  {asset.nextMaintenanceDue && (
                    <Badge variant="outline" className={asset.maintenanceOverdue ? 'bg-red-50 text-red-700 border-red-200' : asset.maintenanceDueSoon ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : ''}>
                      Next due {formatDateTime(asset.nextMaintenanceDue, { withTime: false })}
                    </Badge>
                  )}
                </div>
                {canManage && <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>Log maintenance</Button>}
              </div>
              <input ref={fileInputRef} type="file" className="hidden"
                accept="image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={onBillFileChosen} />
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Performed</TableHead><TableHead>Scheduled For</TableHead>
                    <TableHead>By</TableHead><TableHead>Cost</TableHead><TableHead>Notes</TableHead><TableHead>Bill / Receipt</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(asset.maintenanceLogs || []).length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-6 text-gray-400">No maintenance logged yet</TableCell></TableRow>
                    ) : asset.maintenanceLogs.map((m) => {
                      const early = m.scheduledFor && new Date(m.performedAt) < new Date(m.scheduledFor)
                      const late = m.scheduledFor && new Date(m.performedAt) > new Date(m.scheduledFor)
                      return (
                        <TableRow key={m.id}>
                          <TableCell>{formatDateTime(m.performedAt, { withTime: false })}</TableCell>
                          <TableCell>
                            {m.scheduledFor ? formatDateTime(m.scheduledFor, { withTime: false }) : <span className="text-gray-400">—</span>}
                            {early && <Badge variant="outline" className="ml-1 text-[11px] bg-green-50 text-green-700 border-green-200">Early</Badge>}
                            {late && <Badge variant="outline" className="ml-1 text-[11px] bg-amber-50 text-amber-700 border-amber-200">Late</Badge>}
                          </TableCell>
                          <TableCell>{m.performedBy || m.vendor?.name || <span className="text-gray-400">—</span>}</TableCell>
                          <TableCell>{m.cost != null ? formatMoney(m.cost) : <span className="text-gray-400">—</span>}</TableCell>
                          <TableCell className="max-w-[220px] truncate">{m.notes}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1">
                              {(m.documents || []).map((d) => (
                                <span key={d.id} className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px]">
                                  <a href={fileHref(d)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline" title={d.fileName}>
                                    <FileText className="h-3 w-3" />{d.fileName.length > 14 ? `${d.fileName.slice(0, 11)}…` : d.fileName}
                                  </a>
                                  {canManage && (
                                    <button type="button" onClick={() => removeBillFile(d.id)} title="Remove" className="text-gray-400 hover:text-red-600">
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </span>
                              ))}
                              {canManage && (
                                <button type="button" onClick={() => pickBillFile(m.id)} disabled={uploadingLogId === m.id}
                                  title="Attach bill/receipt" className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50">
                                  {uploadingLogId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <DialogFooter className="justify-between sm:justify-between">
              {canManage && asset.status !== 'DISPOSED' ? (
                <Button type="button" variant="outline" className="text-red-600 hover:bg-red-50" onClick={retire}>
                  <Archive className="h-4 w-4 mr-1.5" />Mark disposed
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                {canManage && (
                  <Button type="button" variant="outline" onClick={() => onEdit?.(asset)}>
                    <Pencil className="h-4 w-4 mr-1.5" />Edit
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            </DialogFooter>

            <LogMaintenanceDialog
              open={logOpen} onOpenChange={setLogOpen} asset={asset}
              onLogged={() => { load(); onChangedRef.current?.() }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LogMaintenanceDialog({ open, onOpenChange, asset, onLogged }) {
  const [performedAt, setPerformedAt] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setPerformedAt(localYmd()); setPerformedBy(''); setCost(''); setNotes('') }
  }, [open])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await client.post(`/assets/${asset.id}/maintenance`, { performedAt, performedBy, cost: cost || null, notes })
      toast.success('Maintenance logged — next due date updated')
      onOpenChange(false)
      onLogged?.()
    } catch (err) {
      showApiError(err, 'Could not log maintenance')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Log maintenance — {asset.assetTag}</DialogTitle></DialogHeader>
        {asset.maintenanceIntervalDays ? (
          <p className="text-xs text-gray-500 flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Next maintenance will be rescheduled to {asset.maintenanceIntervalDays} days after the date entered below.
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Performed On *</Label><Input type="date" required className="mt-1" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} /></div>
          <div><Label>Performed By / Vendor</Label><Input className="mt-1" value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} placeholder="e.g. BioMed Services" /></div>
          <div><Label>Cost (₹)</Label><Input type="number" step="0.01" className="mt-1" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div><Label>Notes</Label><Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log maintenance</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
