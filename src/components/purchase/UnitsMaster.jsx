import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Loader2, Ruler } from 'lucide-react'
import { toast } from 'sonner'
import { Pagination } from '@/components/common/Pagination'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { showApiError } from '@/lib/apiRequest'
import { purchaseApi } from '@/api/purchaseApi'

// Units of measure:
//   editable={false} (default): read-only, with a pointer to where they change —
//                        not shown anywhere today; kept for a read-only view
//   Settings → Integrations  editable={true}:  add, edit, retire, delete
// The server decides what is allowed (a default unit keeps its code and kind,
// a unit an item counts in cannot be retired); this screen offers only what
// can succeed and shows the server's reason when something cannot.

export const KIND_LABEL = { count: 'Count', pack: 'Pack', weight: 'Weight', length: 'Length', volume: 'Volume', time: 'Time' }
// One colour per kind so the list reads at a glance (full class strings: Tailwind does not ship built ones).
const KIND_STYLE = {
  count: 'border-blue-200 bg-blue-50 text-blue-700',
  pack: 'border-violet-200 bg-violet-50 text-violet-700',
  weight: 'border-amber-200 bg-amber-50 text-amber-700',
  length: 'border-teal-200 bg-teal-50 text-teal-700',
  volume: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  time: 'border-rose-200 bg-rose-50 text-rose-700',
}
// The card has no padding of its own, so the first and last columns carry it.
const HEAD = 'h-11 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500 first:pl-6 last:pr-6'
const CELL = 'py-3 first:pl-6 last:pr-6'
const EMPTY = { code: '', name: '', kind: 'count', allowsFraction: false }
const PER_PAGE = 10
const KIND_FILTER = [{ value: 'all', label: 'All kinds' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))]

export default function UnitsMaster({ units, editable = false, onChanged }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [page, setPage] = useState(1)

  // Filtered here: a hospital has tens of units, not thousands. A change of
  // filter goes back to page 1; a unit retired on page 2 stays where it is.
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return units.filter((u) => (kind === 'all' || u.kind === kind)
      && (!term || u.code.toLowerCase().includes(term) || u.name.toLowerCase().includes(term)))
  }, [units, search, kind])
  const totalPages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const pageRows = shown.slice((Math.min(page, totalPages) - 1) * PER_PAGE, Math.min(page, totalPages) * PER_PAGE)

  const startAdd = () => { setEditing(null); setForm(EMPTY); setOpen(true) }
  const startEdit = (u) => { setEditing(u); setForm({ code: u.code, name: u.name, kind: u.kind, allowsFraction: u.allowsFraction }); setOpen(true) }

  const save = async () => {
    setSaving(true)
    try {
      if (editing) {
        // A default unit keeps its code and kind; send only what may change.
        const body = editing.isSystem ? { name: form.name, allowsFraction: form.allowsFraction } : form
        await purchaseApi.updateUnit(editing.id, body)
      } else {
        await purchaseApi.createUnit(form)
      }
      toast.success(editing ? 'Unit updated' : 'Unit added')
      setOpen(false)
      onChanged?.()
    } catch (err) {
      showApiError(err, editing ? 'Could not update the unit' : 'Could not add the unit')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (u) => {
    try {
      await purchaseApi.updateUnit(u.id, { isActive: !u.isActive })
      toast.success(u.isActive ? `${u.name} retired` : `${u.name} restored`)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not change the unit')
    }
  }

  const remove = async (u) => {
    if (!window.confirm(`Delete the unit "${u.name}" (${u.code})? This cannot be undone.`)) return
    try {
      await purchaseApi.deleteUnit(u.id)
      toast.success(`${u.name} deleted`)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not delete the unit')
    }
  }

  return (
    <Card className="overflow-hidden shadow-sm">
      <CardHeader className="border-b bg-white pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Ruler className="h-5 w-5" /></span>
            <div className="min-w-0">
            <CardTitle className="text-lg">Units of measure</CardTitle>
            <CardDescription>
              How quantities are counted on requests, orders and stock — Piece for chairs, Metre for fabric, Day for manpower.
              {!editable && ' An administrator adds and changes units in Settings → Integrations → Purchase Setup.'}
            </CardDescription>
            </div>
          </div>
          {editable && <Button onClick={startAdd} className="shrink-0"><Plus className="h-4 w-4 mr-1" />Add unit</Button>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-b bg-white px-6 py-3">
          <FilterBar
            search={search}
            onSearchChange={(v) => { setSearch(v); setPage(1) }}
            placeholder="Search by code or name…"
            active={!!search || kind !== 'all'}
            onClear={() => { setSearch(''); setKind('all'); setPage(1) }}
          >
            <FilterSelect value={kind} onChange={(v) => { setKind(v); setPage(1) }} options={KIND_FILTER} className="w-40" />
          </FilterBar>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Code</TableHead>
              <TableHead className={HEAD}>Name</TableHead>
              <TableHead className={HEAD}>Kind</TableHead>
              <TableHead className={HEAD}>Decimals allowed</TableHead>
              <TableHead className={HEAD}>Source</TableHead>
              {editable && <TableHead className={`${HEAD} w-56`}><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((u) => (
              <TableRow key={u.id} className={`hover:bg-blue-50/40 ${u.isActive === false ? 'opacity-60' : ''}`}>
                <TableCell className={CELL}><span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs font-semibold text-gray-700">{u.code}</span></TableCell>
                <TableCell className={`${CELL} font-semibold text-gray-900`}>{u.name}</TableCell>
                <TableCell className={CELL}>
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${KIND_STYLE[u.kind] || 'border-gray-200 bg-gray-50 text-gray-700'}`}>{KIND_LABEL[u.kind] || u.kind}</span>
                </TableCell>
                <TableCell className={`${CELL} text-gray-600`}>{u.allowsFraction ? 'Yes (e.g. 2.5)' : 'Whole numbers only'}</TableCell>
                <TableCell className={CELL}>
                  {u.isActive === false ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Retired</Badge>
                    : u.isSystem ? <Badge variant="outline" className="text-gray-600">Default</Badge> : <Badge>Your own</Badge>}
                </TableCell>
                {editable && (
                  <TableCell className={CELL}>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(u)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
                      <Button size="sm" variant="ghost" className={u.isActive === false ? 'text-green-700' : 'text-amber-700'} onClick={() => toggleActive(u)}>
                        {u.isActive === false ? 'Restore' : 'Retire'}
                      </Button>
                      {!u.isSystem && (
                        <Button size="icon" variant="ghost" aria-label={`Delete ${u.name}`} onClick={() => remove(u)}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {pageRows.length === 0 && (
              <TableRow><TableCell colSpan={editable ? 6 : 5} className="py-10 text-center text-sm text-gray-500">No unit matches this search.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-gray-50/60 px-6 py-3 text-sm text-gray-600">
          <span>
            {shown.length === 0 ? 'No units' : `Showing ${(Math.min(page, totalPages) - 1) * PER_PAGE + 1}–${Math.min(Math.min(page, totalPages) * PER_PAGE, shown.length)} of ${shown.length} units`}
          </span>
        </div>
        <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} />
      </CardContent>

      {editable && (
        <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? `Edit unit — ${editing.name}` : 'Add unit'}</DialogTitle>
              <DialogDescription>
                {editing?.isSystem ? 'A default unit keeps its code (printed on orders) and kind. Its name and decimals can change.' : 'The code is printed on orders next to the quantity, e.g. 20 CYL.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="u-code">Code *</Label>
                <Input id="u-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  maxLength={8} className="font-mono uppercase" disabled={editing?.isSystem} placeholder="e.g. CYL" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="u-name">Name *</Label>
                <Input id="u-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Cylinder" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="u-kind">Kind</Label>
                <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))} disabled={editing?.isSystem}>
                  <SelectTrigger id="u-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(KIND_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch id="u-frac" checked={form.allowsFraction} onCheckedChange={(v) => setForm((f) => ({ ...f, allowsFraction: v }))} />
                <Label htmlFor="u-frac">Decimals allowed (2.5)</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving || !form.code.trim() || form.name.trim().length < 2}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? 'Save changes' : 'Add unit'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  )
}
