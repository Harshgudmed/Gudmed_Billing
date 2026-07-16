import { useState, useEffect } from 'react'
import { Loader2, FlaskConical, Scan, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import client from '@/api/client'

// Read-only Lab + Radiology reports for the selected admitted patient.
// Backend merges both result sets (keyed by patientId) into one date-sorted list.
const STATUS_STYLE = {
  completed: 'bg-green-100 text-green-800',
  reported: 'bg-green-100 text-green-800',
  in_progress: 'bg-amber-100 text-amber-800',
  sample_collected: 'bg-blue-100 text-blue-800',
  scheduled: 'bg-blue-100 text-blue-800',
  pending: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-rose-100 text-rose-700',
}

const fmtDate = (d) => {
  try { return format(new Date(d), 'dd MMM yyyy, hh:mm a') } catch { return '' }
}

function StatusBadge({ status }) {
  if (!status) return null
  return (
    <Badge variant="secondary" className={STATUS_STYLE[status] || 'bg-gray-100 text-gray-700'}>
      {String(status).replace(/_/g, ' ')}
    </Badge>
  )
}

// One lab order → a card with its result rows (abnormal/critical highlighted).
function LabCard({ r }) {
  return (
    <Card className="border-l-4 border-l-sky-400">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-sky-600 shrink-0" />
            <div>
              <p className="font-semibold text-sm text-gray-800">{r.name}</p>
              <p className="text-xs text-gray-400">Pathology · {fmtDate(r.date)}</p>
            </div>
          </div>
          <StatusBadge status={r.status} />
        </div>

        {r.results.length > 0 ? (
          <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
            {r.results.map((res, i) => {
              const tone = res.isCritical
                ? 'text-red-700 font-semibold'
                : res.isAbnormal
                  ? 'text-amber-700 font-medium'
                  : 'text-gray-800'
              return (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                  <span className="text-gray-600">{res.testName}</span>
                  <span className="flex items-center gap-2">
                    <span className={tone}>
                      {res.value}{res.unit ? ` ${res.unit}` : ''}
                    </span>
                    {res.flag && (
                      <span className={`text-[11px] font-bold ${res.isCritical ? 'text-red-600' : res.isAbnormal ? 'text-amber-600' : 'text-gray-400'}`}>
                        {res.flag}
                      </span>
                    )}
                    {res.refRange && (
                      <span className="text-[11px] text-gray-400">({res.refRange})</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-400 italic">Results not entered yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

// One radiology order → a card with impression + findings (critical banner if any).
function RadCard({ r }) {
  return (
    <Card className="border-l-4 border-l-indigo-400">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Scan className="h-4 w-4 text-indigo-600 shrink-0" />
            <div>
              <p className="font-semibold text-sm text-gray-800">{r.name}</p>
              <p className="text-xs text-gray-400">Radiology · {fmtDate(r.date)}</p>
            </div>
          </div>
          <StatusBadge status={r.status} />
        </div>

        {r.hasCriticalFindings && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Critical findings reported
          </div>
        )}

        {r.impression ? (
          <div className="mt-3 space-y-2 text-sm">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Impression</p>
              <p className="whitespace-pre-wrap text-gray-800">{r.impression}</p>
            </div>
            {r.findings && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Findings</p>
                <p className="whitespace-pre-wrap text-gray-700">{r.findings}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-400 italic">Report not finalized yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function ReportsTab({ admissionId }) {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!admissionId) { setReports([]); return }
    let alive = true
    setLoading(true)
    client.get(`/inpatient?resource=patient-reports&admissionId=${admissionId}`)
      .then((res) => { if (alive && res.success) setReports(res.data || []) })
      .catch(() => { if (alive) setReports([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [admissionId])

  if (loading) {
    return <div className="py-14 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-[#2E4168]" /></div>
  }
  if (!reports.length) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-gray-400">
          No lab or radiology reports for this patient yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {reports.map((r) =>
        r.kind === 'LAB'
          ? <LabCard key={r.id} r={r} />
          : <RadCard key={r.id} r={r} />,
      )}
    </div>
  )
}
