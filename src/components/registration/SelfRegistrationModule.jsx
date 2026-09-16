import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { QrCode, Search, RefreshCw, UserCheck, Trash2, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { TableRow, TableCell } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import client from '@/api/client'
import RegisterPatientForm from '@/components/common/RegisterPatientForm'

// Reception's side of self-service registration: the pending list — people who
// filled the form on their phone and are now at the counter. Reception searches
// by name/phone, opens the pre-filled registration form, adds the doctor +
// appointment, and confirms — which mints the UHID (through the normal
// patient-create path) and clears the pending row.
//
// The QR poster itself lives in Settings → Integrations (SelfRegistrationQr):
// printing it is a set-up-once admin job, not something the counter needs.
//
// Multi-hospital by construction: the pending list is scoped server-side to the
// caller's org (getOrgId), so one hospital never sees or confirms another's
// walk-ups.

const PER_PAGE = 10

const REG_COLUMNS = [
  { header: 'Name' },
  { header: 'Mobile' },
  { header: 'Filled' },
  { header: 'Action', className: 'text-right' },
]

/** "5 min ago" / "2 h ago" — a walk-up's whole life is measured in minutes. */
function timeAgo(iso) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}

export default function SelfRegistrationModule() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [confirming, setConfirming] = useState(null) // the pending row being confirmed

  const pending = useServerPagination('/pre-registration', {
    perPage: PER_PAGE,
    // A counter screen: new walk-ups should appear without pressing Refresh, but
    // this is far lighter than the queue, so a gentle poll is plenty.
    pollMs: 10000,
    params: { search: debouncedSearch },
  })
  const { loading, refresh } = pending

  const removeRow = useCallback(async (row) => {
    try {
      await client.delete(`/pre-registration/${row.id}`)
      toast.success('Removed')
      await refresh()
    } catch (err) {
      toast.error(err?.message || 'Could not remove')
    }
  }, [refresh])

  // Confirm succeeded → the real patient (with UHID) now exists, so drop the
  // pending row and refresh. Delete is best-effort: the patient is already
  // safely created, and the stale row would auto-expire anyway.
  const onConfirmed = useCallback(async (patient) => {
    const row = confirming
    setConfirming(null)
    if (row) await client.delete(`/pre-registration/${row.id}`).catch(() => {})
    await refresh()
    if (patient?.mrn) toast.success(`Registered — UHID ${patient.mrn}`)
  }, [confirming, refresh])

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <QrCode className="h-3.5 w-3.5" /> The registration QR for the entrance is in Settings → Integrations.
      </p>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            className="pl-8"
            placeholder="Find a patient by name or mobile number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={pending}
            columns={REG_COLUMNS}
            loadingLabel="Loading self-registrations…"
            empty={
              <div className="py-12 text-center text-sm text-gray-500">
                No self-registrations waiting. When a patient fills the QR form, they appear here.
              </div>
            }
            renderRow={(row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-slate-800">{row.firstName} {row.lastName}</TableCell>
                <TableCell className="text-slate-600">{row.phonePrimary}</TableCell>
                <TableCell className="text-slate-500">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{timeAgo(row.createdAt)}</span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" onClick={() => setConfirming(row)}>
                      <UserCheck className="mr-1.5 h-4 w-4" /> Confirm &amp; Register
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => removeRow(row)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          />
        </CardContent>
      </Card>

      {/* Confirm → the shared registration form, pre-filled with what the patient
          typed. Reception checks it, adds the doctor + appointment, and submits;
          onSuccess mints the UHID and we clear the pending row. */}
      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {confirming && (
            <RegisterPatientForm
              initialData={confirming.form}
              onSuccess={onConfirmed}
              onCancel={() => setConfirming(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
