import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Loader2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney } from '@/lib/format'
import { APPROVER_LABEL } from './requestMeta'

// Who approves how much, for purchase requests. Each row is one level; a
// request needs every level whose amount it reaches, in order. Below the rows,
// the rules are read back in plain words for each amount band — the check an
// administrator actually needs ("so a ₹30,000 request goes to…").
//
// A request already sent keeps the levels it was sent with; these rules apply
// to requests sent after saving.

// Two sets of rules, chosen at the top: purchase REQUESTS (is it needed?) and
// purchase ORDERS (the money — the order carries the real price and GST).
const DOCS = {
  PR: { tab: 'Purchase requests', title: 'Approval rules — purchase requests', what: 'Who must agree a request is needed, by its approximate total.', noun: 'requests' },
  PO: { tab: 'Purchase orders', title: 'Approval rules — purchase orders', what: 'Who must approve an order before it goes to the vendor, by its total with GST — the real price.', noun: 'orders' },
}

// `onSaved` — told after a save, so the setup checklist can tick "Approval rules".
export default function ApprovalRulesSettings({ onSaved }) {
  const [doc, setDoc] = useState('PR')
  const [rows, setRows] = useState([])
  const [roles, setRoles] = useState([])
  const [isDefault, setIsDefault] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const apply = (d) => {
    setRows(d.rules.map((r) => ({ approverRole: r.approverRole, minAmount: String(r.minAmount) })))
    setRoles(d.roles)
    setIsDefault(d.isDefault)
  }
  useEffect(() => {
    setLoading(true)
    purchaseApi.getApprovalRules(doc)
      .then((r) => apply(r.data))
      .catch((err) => showApiError(err, 'Could not load the approval rules'))
      .finally(() => setLoading(false))
  }, [doc])

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  // The rules in words, one line per amount band.
  const bands = useMemo(() => {
    const parsed = rows.map((r, i) => ({ level: i + 1, role: r.approverRole, min: Number(r.minAmount) || 0 }))
    const starts = [...new Set([0, ...parsed.map((p) => p.min)])].sort((a, b) => a - b)
    return starts.map((from, i) => ({
      from, to: starts[i + 1],
      chain: parsed.filter((p) => from >= p.min),
    }))
  }, [rows])

  const save = async () => {
    setSaving(true)
    try {
      const r = await purchaseApi.saveApprovalRules(rows.map((x) => ({ approverRole: x.approverRole, minAmount: Number(x.minAmount) || 0 })), doc)
      apply(r.data)
      onSaved?.()
      toast.success(`Approval rules saved — they apply to ${DOCS[doc].noun} sent from now on`)
    } catch (err) {
      showApiError(err, 'Could not save the approval rules')
    } finally {
      setSaving(false)
    }
  }

  const switcher = (
    <div role="tablist" aria-label="Which document" className="inline-flex rounded-md border bg-gray-50 p-1">
      {Object.entries(DOCS).map(([key, d]) => (
        <button key={key} type="button" role="tab" aria-selected={doc === key} onClick={() => setDoc(key)}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${doc === key ? 'bg-white font-semibold text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
          {d.tab}
        </button>
      ))}
    </div>
  )

  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        {switcher}
        <CardTitle className="text-lg">{DOCS[doc].title}</CardTitle>
        <CardDescription>
          {DOCS[doc].what}
          {isDefault && ` Not set yet: an administrator approves every one of the ${DOCS[doc].noun}.`}
        </CardDescription>
      </CardHeader>
      {loading ? <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading…</div> : (
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
              <span className="mr-1 inline-flex h-7 items-center rounded-full bg-[#2E4168] px-3 text-xs font-semibold text-white">Level {i + 1}</span>
              <Select value={r.approverRole} onValueChange={(v) => setRow(i, { approverRole: v })}>
                <SelectTrigger className="w-52" aria-label={`Who approves level ${i + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{APPROVER_LABEL[role] || role}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-sm text-gray-500">approves when the total is</span>
              <span className="text-sm">₹</span>
              <Input className="w-32 text-right" inputMode="decimal" aria-label={`Level ${i + 1} from amount`}
                value={r.minAmount} onChange={(e) => setRow(i, { minAmount: e.target.value })} />
              <span className="text-sm text-gray-500">or more</span>
              {i === rows.length - 1 && i > 0 && (
                <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Remove level ${i + 1}`} onClick={() => setRows((rs) => rs.slice(0, -1))}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              )}
            </div>
          ))}
          {rows.length < 5 && (
            <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, {
              approverRole: rs.length ? 'finance_controller' : 'admin',
              minAmount: rs.length ? String(Math.max(25000, Number(rs[rs.length - 1].minAmount) || 0)) : '0',
            }])}>
              <Plus className="h-4 w-4 mr-1" />Add level
            </Button>
          )}
        </div>

        <div className="rounded-md bg-gray-50 px-4 py-3 text-sm space-y-1">
          <p className="font-medium text-gray-700">So a request of…</p>
          {bands.map((b) => (
            <p key={b.from} className="flex flex-wrap items-center gap-1">
              <span className="w-56 text-gray-600 tabular-nums">
                {b.to != null ? `${formatMoney(b.from)} – ${formatMoney(b.to - 0.01)}` : `${formatMoney(b.from)} and above`}
              </span>
              {b.chain.length === 0 ? <span className="text-green-700">is approved on sending</span> : b.chain.map((c, i) => (
                <span key={c.level} className="inline-flex items-center gap-1">
                  {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-gray-400" />}
                  {APPROVER_LABEL[c.role] || c.role}
                </span>
              ))}
            </p>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save rules</Button>
        </div>
      </CardContent>
      )}
    </Card>
  )
}
