import { useState } from 'react'
import { format } from 'date-fns'
import { Shield, FileText, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney } from '@/lib/format'
import { getFullName } from '@/lib/patient'

// Billing → Insurance: the hospital's insurance claims, one page at a time from
// the server (GET /insurance?resource=claims). The tiles are the server's counts
// for the whole hospital under the same search, and each tile's status list is
// the very filter it applies when clicked — so a tile always equals the rows
// the list then shows. They were counted from the rows the browser held, and
// "Approved / Settled" opened the approved ones only.
//
// Rendered only inside its tab, for the roles that may read claims, so nobody
// else ever sends the request.

// `status` is what the list is filtered by; a tile's value is the sum of the
// server's per-status counts for the statuses it names.
const TILES = [
  { status: 'all', label: 'Total Claims', tone: 'blue', icon: FileText },
  { status: 'approved,settled', label: 'Approved / Settled', tone: 'green', icon: CheckCircle2 },
  { status: 'pending,submitted', label: 'Pending / Submitted', tone: 'yellow', icon: Clock },
  { status: 'rejected', label: 'Rejected', tone: 'red', icon: XCircle },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pending,submitted', label: 'Pending / Submitted' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved,settled', label: 'Approved / Settled' },
  { value: 'approved', label: 'Approved' },
  { value: 'settled', label: 'Settled' },
  { value: 'rejected', label: 'Rejected' },
]

// Claim statuses as stored by the insurance module (InsuranceClaim.status).
const STATUS_STYLE = {
  approved:  'bg-green-100 text-green-800',
  settled:   'bg-emerald-100 text-emerald-800',
  pending:   'bg-yellow-100 text-yellow-800',
  submitted: 'bg-blue-100 text-blue-800',
  rejected:  'bg-red-100 text-red-800',
}

function tileCount(summary, status) {
  if (!summary) return '—' // not loaded yet, or the first load failed
  if (status === 'all') return summary.total
  return status.split(',').reduce((sum, s) => sum + (summary.byStatus?.[s] || 0), 0)
}

export default function InsuranceClaimsTab() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const debouncedSearch = useDebounce(search, 300)
  const claims = useServerPagination('/insurance', {
    perPage: 10,
    params: { resource: 'claims', search: debouncedSearch, status },
  })
  // Claims are raised and moved on the Insurance / TPA screen.
  useLiveData('insurance', claims.refresh)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-blue-600" />Insurance Claims</CardTitle>
          <CardDescription>Track and manage insurance claims and reimbursements</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="group" aria-label="Which claims" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {TILES.map((t) => (
              <StatCard key={t.status} tone={t.tone} icon={t.icon} label={t.label}
                value={tileCount(claims.summary, t.status)}
                selected={status === t.status} onClick={() => setStatus(t.status)} />
            ))}
          </div>
        </CardContent>
      </Card>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search claim #, patient, UHID, insurer or policy..."
        active={!!search || status !== 'all'}
        onClear={() => { setSearch(''); setStatus('all') }}
      >
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-48" />
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={claims}
            loadingLabel="Loading claims…"
            empty={search || status !== 'all'
              ? 'No claims match your search/filter.'
              : 'No insurance claims yet. Add a policy and raise a claim from the Insurance module.'}
            columns={[
              { header: 'Claim #' }, { header: 'Patient' }, { header: 'Insurance Company' }, { header: 'Policy No.' },
              { header: 'Claimed', className: 'text-right' }, { header: 'Approved', className: 'text-right' },
              { header: 'Submitted' }, { header: 'Status' },
            ]}
            renderRow={(c) => {
              const submitted = c.submittedAt || c.createdAt
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm text-blue-600">{c.claimNumber}</TableCell>
                  <TableCell className="font-medium">{getFullName(c.case?.patient) || '—'}</TableCell>
                  <TableCell className="text-sm">{c.case?.insurerName}</TableCell>
                  <TableCell className="font-mono text-xs text-gray-500">{c.case?.policyNumber || '—'}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(c.claimAmount)}</TableCell>
                  <TableCell className="text-right font-semibold text-green-700">{c.approvedAmount != null ? formatMoney(c.approvedAmount) : '—'}</TableCell>
                  <TableCell className="text-sm text-gray-500">{submitted ? format(new Date(submitted), 'dd MMM yyyy') : '—'}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_STYLE[c.status] || 'bg-gray-100 text-gray-800'}>{c.status}</Badge>
                  </TableCell>
                </TableRow>
              )
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
