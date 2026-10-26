import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Loader2, Ban, RotateCcw, TrendingUp, Building2, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, localYmd } from '@/lib/format'
import { useMe } from './requestMeta'
import { usePickList } from './usePickList'
import client from '@/api/client'

// CapEx, OpEx and project budgets — what the hospital has approved to spend.
// Purchase requests link to a budget so approved vs spent is tracked in one place.

const BUDGET_TYPES = [
  { value: 'opex', label: 'OpEx — Operating Expenditure', icon: TrendingUp, desc: 'Day-to-day consumables and recurring expenses' },
  { value: 'capex', label: 'CapEx — Capital Expenditure', icon: Building2, desc: 'New machines, equipment, construction' },
  { value: 'project', label: 'Project Budget', icon: FolderOpen, desc: 'Named initiative, e.g. New Wing Construction' },
]

const TYPE_BADGE = {
  opex:    { label: 'OpEx',    className: 'border-blue-200 bg-blue-50 text-blue-700' },
  capex:   { label: 'CapEx',   className: 'border-purple-200 bg-purple-50 text-purple-700' },
  project: { label: 'Project', className: 'border-amber-200 bg-amber-50 text-amber-700' },
}

const currentFY = () => {
  const now = new Date()
  const yr  = now.getFullYear()
  return now.getMonth() >= 3 ? `${yr}-${String(yr + 1).slice(2)}` : `${yr - 1}-${String(yr).slice(2)}`
}

const EMPTY = {
  name: '', budgetType: 'opex', departmentId: '', projectName: '',
  financialYear: currentFY(), allocatedAmount: '', approvedDate: '', approvedById: '', notes: '',
}

export default function BudgetsMaster() {
  const { canManageMasters } = useMe()
  const [typeFilter, setTypeFilter] = useState('all')
  const [fyFilter, setFyFilter]   = useState(currentFY())
  const [budgets, setBudgets]     = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError]  = useState(false)

  const departments = usePickList(() => client.get('/settings?resource=departments'))

  const [open, setOpen]         = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)

  const loadBudgets = async () => {
    setLoadingList(true)
    setListError(false)
    try {
      const params = {}
      if (fyFilter) params.financialYear = fyFilter
      if (typeFilter !== 'all') params.budgetType = typeFilter
      const res = await purchaseApi.getBudgets(params)
      setBudgets(res.data ?? [])
    } catch (err) {
      setListError(true)
      showApiError(err, 'Could not load budgets')
    } finally {
      setLoadingList(false)
    }
  }

  // Load on first render and when filters change
  useState(() => { loadBudgets() }, [])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }))

  const startAdd = () => { setEditingId(null); setForm(EMPTY); setOpen(true) }
  const startEdit = (b) => {
    setForm({
      name:           b.name,
      budgetType:     b.budgetType,
      departmentId:   b.departmentId || '',
      projectName:    b.projectName  || '',
      financialYear:  b.financialYear,
      allocatedAmount: String(b.allocatedAmount),
      approvedDate:   b.approvedDate ? String(b.approvedDate).slice(0, 10) : '',
      approvedById:   b.approvedById || '',
      notes:          b.notes        || '',
    })
    setEditingId(b.id)
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) return toast.error('Budget name is required')
    if (!form.allocatedAmount || Number(form.allocatedAmount) <= 0) return toast.error('Allocated amount must be greater than 0')
    setSaving(true)
    try {
      const body = {
        ...form,
        departmentId:   form.departmentId   || null,
        projectName:    form.budgetType === 'project' ? (form.projectName || null) : null,
        approvedDate:   form.approvedDate   || null,
        approvedById:   form.approvedById   || null,
        notes:          form.notes          || null,
        allocatedAmount: Number(form.allocatedAmount),
      }
      if (editingId) await purchaseApi.updateBudget(editingId, body)
      else           await purchaseApi.createBudget(body)
      toast.success(editingId ? 'Budget updated' : 'Budget created')
      setOpen(false)
      loadBudgets()
    } catch (err) {
      showApiError(err, editingId ? 'Could not update budget' : 'Could not create budget')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (b) => {
    try {
      await purchaseApi.updateBudget(b.id, { isActive: !b.isActive })
      toast.success(b.isActive ? `${b.code} closed` : `${b.code} re-opened`)
      loadBudgets()
    } catch (err) { showApiError(err, 'Could not update budget') }
  }

  const FY_OPTIONS = (() => {
    const yr = new Date().getFullYear()
    return [-1, 0, 1].map((d) => {
      const y = yr + d
      return { value: `${y}-${String(y + 1).slice(2)}`, label: `FY ${y}-${String(y + 1).slice(2)}` }
    })
  })()

  return (
    <div className="space-y-4">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={fyFilter} onValueChange={(v) => { setFyFilter(v); setTimeout(loadBudgets, 0) }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{FY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setTimeout(loadBudgets, 0) }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {BUDGET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label.split(' — ')[0]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={loadBudgets} disabled={loadingList}>
          {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
        </Button>
        <div className="flex-1" />
        {canManageMasters && <Button onClick={startAdd}><Plus className="h-4 w-4 mr-1" />New Budget</Button>}
      </div>

      {/* Budget cards */}
      {loadingList ? (
        <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading budgets…</div>
      ) : listError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load budgets. <button className="underline" onClick={loadBudgets}>Try again</button></div>
      ) : budgets.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-500 text-sm">No budgets found for this period. {canManageMasters && <button className="text-blue-600 underline" onClick={startAdd}>Create the first one</button>}</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {budgets.map((b) => {
            const tb = TYPE_BADGE[b.budgetType] || TYPE_BADGE.opex
            const pct = b.allocatedAmount > 0 ? Math.min(100, (b.spentAmount / b.allocatedAmount) * 100) : 0
            const overBudget = b.spentAmount > b.allocatedAmount
            return (
              <Card key={b.id} className={b.isActive ? '' : 'opacity-60'}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-gray-500">{b.code}</span>
                        <Badge variant="outline" className={tb.className}>{tb.label}</Badge>
                        {!b.isActive && <Badge variant="outline">Closed</Badge>}
                      </div>
                      <p className="font-semibold text-sm mt-0.5 leading-tight">{b.name}</p>
                      {b.projectName && <p className="text-xs text-gray-500">📁 {b.projectName}</p>}
                      {b.department && <p className="text-xs text-gray-500">🏥 {b.department.name}</p>}
                    </div>
                    {canManageMasters && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => startEdit(b)}><Pencil className="h-4 w-4" /></Button>
                        {b.isActive
                          ? <Button size="icon" variant="ghost" className="text-red-500" onClick={() => toggleActive(b)}><Ban className="h-4 w-4" /></Button>
                          : <Button size="icon" variant="ghost" className="text-green-600" onClick={() => toggleActive(b)}><RotateCcw className="h-4 w-4" /></Button>}
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Spent</span>
                      <span className={overBudget ? 'font-semibold text-red-600' : 'font-semibold'}>{formatMoney(b.spentAmount)} / {formatMoney(b.allocatedAmount)}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${overBudget ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-green-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>{pct.toFixed(0)}% used</span>
                      <span>Balance: {formatMoney(b.allocatedAmount - b.spentAmount)}</span>
                    </div>
                  </div>

                  <div className="flex justify-between text-xs text-gray-400">
                    <span>FY {b.financialYear}</span>
                    {b.approvedDate && <span>Approved {new Date(b.approvedDate).toLocaleDateString('en-IN')}</span>}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Budget' : 'New Budget'}</DialogTitle>
            <DialogDescription>Define what has been approved to spend — department, type, and total amount.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="b-name">Budget Name <span className="text-red-500">*</span></Label>
              <Input id="b-name" value={form.name} onChange={set('name')} placeholder="e.g. ICU Annual Consumables 2026-27" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="b-type">Budget Type <span className="text-red-500">*</span></Label>
                <Select value={form.budgetType} onValueChange={(v) => setForm((f) => ({ ...f, budgetType: v }))}>
                  <SelectTrigger id="b-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BUDGET_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <div>
                          <p className="font-medium">{t.label.split(' — ')[0]}</p>
                          <p className="text-xs text-gray-500">{t.desc}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="b-fy">Financial Year <span className="text-red-500">*</span></Label>
                <Input id="b-fy" value={form.financialYear} onChange={set('financialYear')} placeholder="2026-27" />
              </div>
            </div>

            {form.budgetType === 'project' && (
              <div className="space-y-1">
                <Label htmlFor="b-proj">Project Name</Label>
                <Input id="b-proj" value={form.projectName} onChange={set('projectName')} placeholder="e.g. New Wing Construction" />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="b-dept">Department <span className="text-xs font-normal text-gray-400">(optional — leave blank for hospital-wide)</span></Label>
              <Select value={form.departmentId || '__none'} onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v === '__none' ? '' : v }))}>
                <SelectTrigger id="b-dept"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Hospital-wide (no specific dept)</SelectItem>
                  {departments.list.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="b-amt">Allocated Amount ₹ <span className="text-red-500">*</span></Label>
                <Input id="b-amt" inputMode="decimal" value={form.allocatedAmount} onChange={set('allocatedAmount')} placeholder="e.g. 500000" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="b-date">Approved Date</Label>
                <Input id="b-date" type="date" max={localYmd()} value={form.approvedDate} onChange={set('approvedDate')} />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="b-by">Approved By <span className="text-xs font-normal text-gray-400">(optional — name or designation)</span></Label>
              <Input id="b-by" value={form.approvedById} onChange={set('approvedById')} placeholder="e.g. Hospital Director / Finance Committee" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="b-notes">Notes <span className="text-xs font-normal text-gray-400">(optional)</span></Label>
              <Textarea id="b-notes" rows={2} value={form.notes} onChange={set('notes')} placeholder="e.g. Approved in board meeting dated 01-Apr-2026" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.allocatedAmount}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Save changes' : 'Create budget'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
