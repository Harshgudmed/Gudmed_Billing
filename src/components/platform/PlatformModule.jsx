import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Building2, CheckCircle2, PauseCircle, Plus, Pencil, Trash2, LogOut, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar } from '@/components/common/FilterBar'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { Pagination } from '@/components/common/Pagination'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useAuth } from '@/lib/auth'
import { HOSPITAL_LOGO } from '@/lib/brand'
import { platformApi, PLATFORM_ENDPOINT } from '@/api/platformApi'
import HospitalDialog from './HospitalDialog'
import { MODULE_CATALOG } from './moduleCatalog'

// The platform owner's home: every hospital on GudMed, what each has bought, and
// the way to add or change one. A hospital's patients, staff or bills are never
// shown here — only the hospital's own record.

const PLAN_LABEL = { basic: 'Basic', standard: 'Standard', pro: 'Pro' }
const STATUS_STYLE = {
  trial: 'border-blue-200 bg-blue-50 text-blue-700',
  active: 'border-green-200 bg-green-50 text-green-700',
  suspended: 'border-amber-200 bg-amber-50 text-amber-800',
  expired: 'border-red-200 bg-red-50 text-red-700',
}

// "9 of 15", or "No limit yet" for a hospital from before plans.
function modulesBought(hospital) {
  if (!hospital.modulesAllowed) return { text: 'No limit yet', limited: false }
  return { text: `${Object.keys(hospital.modulesAllowed).length} of ${MODULE_CATALOG.length}`, limited: true }
}

const endsOn = (hospital) => (hospital.subscriptionEndsAt
  ? new Date(hospital.subscriptionEndsAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : 'No end date')

function PlanBadges({ hospital }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{PLAN_LABEL[hospital.subscriptionTier] || hospital.subscriptionTier}</Badge>
      <Badge variant="outline" className={STATUS_STYLE[hospital.subscriptionStatus] || ''}>{hospital.subscriptionStatus}</Badge>
      {!hospital.isActive && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Inactive</Badge>}
    </div>
  )
}

export default function PlatformModule() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const hospitals = useServerPagination(PLATFORM_ENDPOINT, { perPage: 10, params: { search: debouncedSearch } })
  const { rows, loading, error, summary, page, totalPages, setPage, refresh } = hospitals
  const [dialog, setDialog] = useState({ open: false, hospital: null })
  const [created, setCreated] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function save(payload) {
    if (dialog.hospital) {
      await platformApi.update(dialog.hospital.id, payload)
      toast.success('Changes saved')
    } else {
      await platformApi.create(payload)
      setCreated({ name: payload.name, email: payload.admin.email, password: payload.admin.password })
    }
    setDialog({ open: false, hospital: null })
    refresh()
  }

  async function removeHospital() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await platformApi.delete(deleteTarget.id, confirmText.trim())
      toast.success(`${deleteTarget.name} removed`)
      closeDelete()
      refresh()
    } catch (e) {
      // The client throws an Error with `.message` (api/client.js); the server's
      // reason (records kept, wrong code) is in it.
      toast.error(e?.message || 'Could not remove the hospital')
    } finally {
      setDeleting(false)
    }
  }

  const closeDelete = () => { setDeleteTarget(null); setConfirmText('') }

  async function signOut() {
    setSigningOut(true)
    await logout()
    navigate('/platform/login', { replace: true })
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error(`Could not copy — select the ${what.toLowerCase()} and copy it by hand`)
    }
  }

  const openAdd = () => setDialog({ open: true, hospital: null })
  const openEdit = (hospital) => setDialog({ open: true, hospital })

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src={HOSPITAL_LOGO} alt="" className="h-9 w-9 shrink-0 rounded-lg object-contain" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">GudMed Platform</p>
              <p className="truncate text-xs text-slate-500">{user?.fullName || user?.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut} disabled={signingOut}>
            {signingOut ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Hospitals</h1>
            <p className="text-sm text-slate-500">Every hospital on GudMed and the modules each one has bought.</p>
          </div>
          <Button onClick={openAdd} className="w-full sm:w-auto"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add hospital</Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <StatCard tone="blue" icon={Building2} label="Hospitals" value={summary?.total ?? '–'} />
          <StatCard tone="green" icon={CheckCircle2} label="Active" value={summary?.active ?? '–'} />
          <StatCard tone="red" icon={PauseCircle} label="Inactive" value={summary?.inactive ?? '–'} />
        </div>

        <div className="rounded-xl border bg-white">
          <div className="border-b p-3 sm:p-4">
            <FilterBar
              search={search} onSearchChange={setSearch}
              placeholder="Search by hospital name, code or city…"
              active={!!search} onClear={() => setSearch('')}
            />
          </div>

          {/* Wide screens: a table. */}
          <div className="hidden md:block">
            <PaginatedTable
              pagination={hospitals}
              empty={search ? 'No hospital matches this search' : 'No hospitals yet — add the first one'}
              columns={[
                { header: 'Hospital' }, { header: 'Plan' }, { header: 'Modules bought' },
                { header: 'Staff', className: 'text-right' }, { header: '', className: 'w-24' },
              ]}
              renderRow={(h) => {
                const bought = modulesBought(h)
                return (
                  <TableRow key={h.id} className={h.isActive ? '' : 'opacity-70'}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{h.name}</p>
                      <p className="text-xs text-slate-500"><span className="font-mono">{h.slug}</span>{h.city ? ` · ${h.city}` : ''}</p>
                    </TableCell>
                    <TableCell>
                      <PlanBadges hospital={h} />
                      <p className="mt-1 text-xs text-slate-500">Ends: {endsOn(h)}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={bought.limited ? '' : 'border-amber-200 bg-amber-50 text-amber-800'}>{bought.text}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{h.staffCount}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => openEdit(h)} aria-label={`Edit ${h.name}`}><Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Edit</Button>
                        <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setDeleteTarget(h)} aria-label={`Delete ${h.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              }}
            />
          </div>

          {/* Phones and tablets: one card per hospital. */}
          <div className="md:hidden">
            {error && rows.length === 0 ? (
              <p role="alert" className="p-6 text-center text-sm text-red-600">
                Could not load the hospitals: {error}.{' '}
                <button type="button" onClick={refresh} className="font-medium underline underline-offset-2">Try again</button>
              </p>
            ) : loading && rows.length === 0 ? (
              <p className="p-8 text-center text-gray-400"><Loader2 className="inline-block h-5 w-5 animate-spin" /></p>
            ) : rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">{search ? 'No hospital matches this search' : 'No hospitals yet — add the first one'}</p>
            ) : (
              <ul className="divide-y">
                {rows.map((h) => {
                  const bought = modulesBought(h)
                  return (
                    <li key={h.id} className={`space-y-2 p-4 ${h.isActive ? '' : 'opacity-70'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{h.name}</p>
                          <p className="truncate text-xs text-slate-500"><span className="font-mono">{h.slug}</span>{h.city ? ` · ${h.city}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" onClick={() => openEdit(h)} aria-label={`Edit ${h.name}`}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                          <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setDeleteTarget(h)} aria-label={`Delete ${h.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                        </div>
                      </div>
                      <PlanBadges hospital={h} />
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>Modules: <strong>{bought.text}</strong></span>
                        <span>Staff: <strong className="tabular-nums">{h.staffCount}</strong></span>
                        <span>Ends: {endsOn(h)}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </div>
      </main>

      <HospitalDialog open={dialog.open} hospital={dialog.hospital} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} onSubmit={save} />

      {/* Remove an empty hospital. One with patients, bills or bookings keeps
          its records — the server refuses and says so; switch it off instead. */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) closeDelete() }}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This removes the hospital and its staff logins. A hospital that has any patient, bill or appointment keeps its records — switch it off instead of removing it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-slug">Type the hospital code <span className="font-mono font-semibold text-slate-900">{deleteTarget?.slug}</span> to confirm</Label>
            <Input id="confirm-slug" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className="font-mono" />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeDelete} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={removeHospital} disabled={deleting || confirmText.trim().toLowerCase() !== deleteTarget?.slug}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Remove hospital
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shown once, right after a hospital is added: what to hand over. */}
      <Dialog open={!!created} onOpenChange={(open) => { if (!open) setCreated(null) }}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>{created?.name} is ready</DialogTitle>
            <DialogDescription>Give the administrator these details. The password is not shown again after you close this.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-3 text-sm">
            {[['Sign-in page', `${window.location.origin}/admin/login`], ['E-mail', created?.email], ['Password', created?.password]].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="break-all font-mono text-slate-900">{value}</dd>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => copy(value, label)} aria-label={`Copy ${label}`}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            ))}
          </dl>
          <DialogFooter><Button onClick={() => setCreated(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
