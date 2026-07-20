import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PatientLookup from '@/components/common/PatientLookup'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ShieldCheck, Plus, Search, Trash2, Loader2, AlertCircle, FileText, Users, Clock } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'

import { formatMoney as inr } from '@/lib/format'
import { getFullName } from "@/lib/patient";
const STATUS_STYLES = { Active: 'bg-green-100 text-green-700', Expired: 'bg-red-100 text-red-700', Inactive: 'bg-gray-200 text-gray-600' }
const CLAIM_STYLES = {
  pending: 'bg-orange-100 text-orange-700', submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', settled: 'bg-emerald-100 text-emerald-700',
}

const EMPTY_CASE = { patientId: '', payerType: 'INSURANCE', insurerName: '', tpaName: '', policyNumber: '', coverageLimit: '', status: 'Active', notes: '' }
const EMPTY_CLAIM = { claimAmount: '', approvedAmount: '', status: 'pending', diagnosis: '', remarks: '' }

export default function InsuranceModule() {
  const [cases, setCases] = useState([])
  const [stats, setStats] = useState({ tpaPatients: 0, insurancePatients: 0, claimsPending: 0 })
  const [selectedPatient, setSelectedPatient] = useState(null) // via shared PatientLookup
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [payerFilter, setPayerFilter] = useState('all')

  const [caseOpen, setCaseOpen] = useState(false)
  const [caseForm, setCaseForm] = useState(EMPTY_CASE)
  const [savingCase, setSavingCase] = useState(false)

  const [claimCase, setClaimCase] = useState(null) // the case whose claims dialog is open
  const [claimForm, setClaimForm] = useState(EMPTY_CLAIM)
  const [savingClaim, setSavingClaim] = useState(false)

  async function fetchCases() {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (payerFilter !== 'all') params.set('payerType', payerFilter)
      const res = await client.get(`/insurance?${params}`)
      if (res.success) { setCases(res.data || []); if (res.stats) setStats(res.stats) }
      else setError(res.error || 'Failed to load')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { fetchCases() }, [search, payerFilter])

  // Keep the open claims dialog in sync with refreshed data.
  useEffect(() => {
    if (claimCase) {
      const fresh = cases.find(c => c.id === claimCase.id)
      if (fresh) setClaimCase(fresh)
    }
  }, [cases]) // eslint-disable-line react-hooks/exhaustive-deps


  const setCase = (k, v) => setCaseForm(f => ({ ...f, [k]: v }))
  const setClaim = (k, v) => setClaimForm(f => ({ ...f, [k]: v }))

  async function handleCreateCase(e) {
    e.preventDefault()
    if (!caseForm.patientId) { toast.error('Select a patient'); return }
    if (!caseForm.insurerName) { toast.error('Enter the insurer name'); return }
    setSavingCase(true)
    try {
      const res = await client.post('/insurance', caseForm)
      if (res.success) { toast.success('Policy added'); setCaseForm(EMPTY_CASE); setSelectedPatient(null); setCaseOpen(false); fetchCases() }
      else toast.error(res.error || 'Failed to add')
    } catch (e) { toast.error(e.message || 'Failed to add') } finally { setSavingCase(false) }
  }

  async function handleAddClaim(e) {
    e.preventDefault()
    if (!claimForm.claimAmount) { toast.error('Enter the claim amount'); return }
    setSavingClaim(true)
    try {
      const res = await client.post('/insurance?resource=claims', { caseId: claimCase.id, ...claimForm })
      if (res.success) { toast.success(`Claim ${res.data.claimNumber} filed`); setClaimForm(EMPTY_CLAIM); fetchCases() }
      else toast.error(res.error || 'Failed to file claim')
    } catch (e) { toast.error(e.message || 'Failed to file claim') } finally { setSavingClaim(false) }
  }

  async function changeClaimStatus(id, status) {
    try {
      const res = await client.patch('/insurance?resource=claims', { id, status })
      if (res.success) fetchCases()
    } catch { toast.error('Failed to update claim') }
  }

  async function deleteCase(id) {
    if (!confirm('Delete this policy and all its claims?')) return
    try {
      const res = await client.delete(`/insurance?id=${id}`)
      if (res.success) { toast.success('Deleted'); fetchCases() }
    } catch { toast.error('Failed to delete') }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold">TPA / Insurance</h1>
            <p className="text-gray-500">Payer policies &amp; claim tracking</p>
          </div>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { setCaseForm(EMPTY_CASE); setCaseOpen(true) }}>
          <Plus className="h-4 w-4 mr-2" /> New Policy
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2"><Users className="h-4 w-4" /> TPA Patients</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.tpaPatients}</div></CardContent></Card>
        <Card><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2"><FileText className="h-4 w-4" /> Insurance Patients</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.insurancePatients}</div></CardContent></Card>
        <Card className="border-l-4 border-l-orange-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2"><Clock className="h-4 w-4" /> Claims Pending</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.claimsPending}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-600" /> TPA &amp; Insurance Cases</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full md:w-64">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input placeholder="Search name, insurer, policy..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Select value={payerFilter} onValueChange={setPayerFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payers</SelectItem>
                  <SelectItem value="INSURANCE">Insurance</SelectItem>
                  <SelectItem value="TPA">TPA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && cases.length === 0 ? (
            <div className="flex justify-center p-10"><Loader2 className="h-7 w-7 animate-spin text-[#2E4168]" /></div>
          ) : error ? (
            <div className="flex flex-col items-center p-8 text-center text-red-600"><AlertCircle className="h-8 w-8 mb-2" />{error}<Button variant="outline" className="mt-3" onClick={fetchCases}>Retry</Button></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>TPA / Insurer</TableHead><TableHead>Policy No.</TableHead>
                  <TableHead>Limit</TableHead><TableHead>Used</TableHead><TableHead>Balance</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-gray-500">No insurance/TPA cases yet.</TableCell></TableRow>
                ) : cases.map(c => (
                  <TableRow key={c.id}>
                    <TableCell>{c.patient ? getFullName(c.patient) : '—'}</TableCell>
                    <TableCell>
                      <div>{c.insurerName}</div>
                      <div className="text-xs text-gray-500">{c.payerType === 'TPA' ? (c.tpaName ? `TPA · ${c.tpaName}` : 'TPA') : 'Insurance'}</div>
                    </TableCell>
                    <TableCell className="font-mono">{c.policyNumber || '—'}</TableCell>
                    <TableCell>{inr(c.coverageLimit)}</TableCell>
                    <TableCell>{inr(c.amountUsed)}</TableCell>
                    <TableCell className="font-medium text-green-600">{inr(c.balance)}</TableCell>
                    <TableCell><Badge className={`${STATUS_STYLES[c.status] || ''} hover:opacity-90`}>{c.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => { setClaimForm(EMPTY_CLAIM); setClaimCase(c) }}>
                          <FileText className="h-4 w-4 mr-1" /> Claim{c.claims?.length ? ` (${c.claims.length})` : ''}
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-600 hover:bg-red-50" onClick={() => deleteCase(c.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New policy dialog */}
      <Dialog open={caseOpen} onOpenChange={setCaseOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Insurance / TPA Policy</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateCase} className="space-y-4">
            <div>
              <Label>Patient *</Label>
              <PatientLookup
                selectedPatient={selectedPatient}
                onSelect={(p) => { setSelectedPatient(p); setCase('patientId', p.id) }}
                onClear={() => { setSelectedPatient(null); setCase('patientId', '') }}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payer Type</Label>
                <Select value={caseForm.payerType} onValueChange={v => setCase('payerType', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="INSURANCE">Insurance</SelectItem><SelectItem value="TPA">TPA</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={caseForm.status} onValueChange={v => setCase('status', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Expired">Expired</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Insurer Name *</Label><Input className="mt-1" placeholder="e.g. Star Health, HDFC Ergo" value={caseForm.insurerName} onChange={e => setCase('insurerName', e.target.value)} /></div>
            {caseForm.payerType === 'TPA' && <div><Label>TPA Name</Label><Input className="mt-1" placeholder="e.g. Medi Assist, Paramount" value={caseForm.tpaName} onChange={e => setCase('tpaName', e.target.value)} /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Policy No.</Label><Input className="mt-1" placeholder="Policy number" value={caseForm.policyNumber} onChange={e => setCase('policyNumber', e.target.value)} /></div>
              <div><Label>Coverage Limit (₹)</Label><Input className="mt-1" type="number" placeholder="₹" value={caseForm.coverageLimit} onChange={e => setCase('coverageLimit', e.target.value)} /></div>
            </div>
            <div><Label>Notes</Label><Textarea className="mt-1" rows={2} value={caseForm.notes} onChange={e => setCase('notes', e.target.value)} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCaseOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={savingCase}>
                {savingCase ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Claims dialog */}
      <Dialog open={!!claimCase} onOpenChange={(o) => { if (!o) setClaimCase(null) }}>
        <DialogContent className="max-w-2xl">
          {claimCase && (
            <>
              <DialogHeader>
                <DialogTitle>Claims — {claimCase.patient ? getFullName(claimCase.patient) : ''}</DialogTitle>
              </DialogHeader>
              <div className="text-sm text-gray-600 -mt-2">
                {claimCase.insurerName} · Limit {inr(claimCase.coverageLimit)} · Used {inr(claimCase.amountUsed)} · Balance <span className="font-medium text-green-600">{inr(claimCase.balance)}</span>
              </div>

              <div className="max-h-52 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim #</TableHead><TableHead>Amount</TableHead><TableHead>Approved</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(claimCase.claims || []).length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-6 text-gray-500">No claims filed yet.</TableCell></TableRow>
                    ) : claimCase.claims.map(cl => (
                      <TableRow key={cl.id}>
                        <TableCell className="font-mono">{cl.claimNumber}</TableCell>
                        <TableCell>{inr(cl.claimAmount)}</TableCell>
                        <TableCell>{cl.approvedAmount != null ? inr(cl.approvedAmount) : '—'}</TableCell>
                        <TableCell>
                          <Select value={cl.status} onValueChange={v => changeClaimStatus(cl.id, v)}>
                            <SelectTrigger className={`h-7 w-[120px] border-0 capitalize ${CLAIM_STYLES[cl.status] || ''}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="submitted">Submitted</SelectItem>
                              <SelectItem value="approved">Approved</SelectItem>
                              <SelectItem value="rejected">Rejected</SelectItem>
                              <SelectItem value="settled">Settled</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <form onSubmit={handleAddClaim} className="space-y-3 border-t pt-4">
                <div className="font-medium text-sm">File a new claim</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Claim Amount (₹) *</Label><Input className="mt-1" type="number" value={claimForm.claimAmount} onChange={e => setClaim('claimAmount', e.target.value)} /></div>
                  <div><Label>Approved Amount (₹)</Label><Input className="mt-1" type="number" value={claimForm.approvedAmount} onChange={e => setClaim('approvedAmount', e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <Select value={claimForm.status} onValueChange={v => setClaim('status', v)}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="settled">Settled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Diagnosis</Label><Input className="mt-1" value={claimForm.diagnosis} onChange={e => setClaim('diagnosis', e.target.value)} /></div>
                </div>
                <div><Label>Remarks</Label><Input className="mt-1" value={claimForm.remarks} onChange={e => setClaim('remarks', e.target.value)} /></div>
                <DialogFooter>
                  <Button type="submit" className="bg-green-600 hover:bg-green-700" disabled={savingClaim}>
                    {savingClaim ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} File Claim
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
