import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Loader2, LogOut, CalendarDays, Pill, FlaskConical, Scan, Wallet, User,
  AlertTriangle, Activity, RefreshCw, History, Eye, UploadCloud, ChevronRight
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import Logo from '@/components/Logo'
import client from '@/api/client'
import { useAuth } from '@/lib/auth'
import { Link } from 'react-router-dom'

// Doctor names in the data already include a "Dr." prefix for most records — don't double it.
function docName(name) {
  if (!name) return '—'
  return /^dr\.?\s/i.test(name.trim()) ? name : `Dr. ${name}`
}

// How often the dashboard silently re-syncs with the server (ms).
const POLL_MS = 10000

function isLightColor(hex) {
  const h = (hex || '#ffffff').replace('#', '')
  if (h.length !== 6) return true
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}
function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '—' }
}
function age(dob) {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
}
function money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN') }
function ago(date) {
  if (!date) return ''
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg p-2" style={{ backgroundColor: `${accent}15`, color: accent }}><Icon className="h-5 w-5" /></div>
        <div>
          <div className="text-xl font-bold leading-none">{value}</div>
          <div className="text-xs text-gray-500 mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function statusBadge(status) {
  const map = {
    scheduled: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-700',
    cancelled: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
  }
  return <Badge className={map[(status || '').toLowerCase()] || 'bg-gray-100 text-gray-700'}>{status || '—'}</Badge>
}

export default function PatientDashboard() {
  const { logout } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [report, setReport] = useState(null) // { type:'lab'|'radiology', order }
  const [, force] = useState(0) // re-render the "updated Xs ago" label
  const firstLoad = useRef(true)

  const fetchData = useCallback(async (silent) => {
    if (silent) setRefreshing(true)
    try {
      const res = await client.get('/patient-portal/me')
      setData(res.data)
      setLastUpdated(new Date())
    } catch (e) {
      if (!silent) toast.error(e.message || 'Failed to load your dashboard')
    } finally {
      if (firstLoad.current) { setLoading(false); firstLoad.current = false }
      if (silent) setRefreshing(false)
    }
  }, [])

  // Initial load + live sync: poll on an interval and whenever the tab regains focus.
  useEffect(() => {
    fetchData(false)
    const interval = setInterval(() => fetchData(true), POLL_MS)
    const onFocus = () => { if (document.visibilityState !== 'hidden') fetchData(true) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const tick = setInterval(() => force((n) => n + 1), 5000) // refresh the timestamp label
    return () => {
      clearInterval(interval); clearInterval(tick)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [fetchData])

  // Apply hospital branding to the document once we have it.
  useEffect(() => {
    if (data?.branding?.hospitalName) document.title = `${data.branding.hospitalName} · Patient Portal`
  }, [data?.branding?.hospitalName])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  }
  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Could not load your data.</div>
  }

  const { branding = {}, profile, stats, upcomingAppointments, appointments, prescriptions, labOrders, radiologyOrders, billing, patientDocuments = [] } = data
  const navbar = branding.navbarColor || '#2E4168'
  const primary = branding.primaryColor || '#2563eb'
  const onDark = !isLightColor(navbar)
  const headTextClass = onDark ? 'text-white' : 'text-gray-900'
  const headSubClass = onDark ? 'text-white/70' : 'text-gray-500'
  const a = age(profile.dateOfBirth)

  // Past / history = everything that isn't an upcoming visit.
  const upcomingIds = new Set(upcomingAppointments.map((x) => x.id))
  const pastAppointments = appointments.filter((x) => !upcomingIds.has(x.id))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Branded header */}
      <header className="border-b transition-colors" style={{ backgroundColor: navbar }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div>
              <div className={`font-bold leading-tight ${headTextClass}`}>{branding.hospitalName || 'Patient Portal'}</div>
              <div className={`text-xs ${headSubClass}`}>
                {profile.fullName} · UHID {profile.mrn}{a != null ? ` · ${a}y` : ''}{profile.gender ? ` · ${profile.gender}` : ''}{profile.bloodGroup ? ` · ${profile.bloodGroup}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Live sync indicator */}
            <div className={`hidden sm:flex items-center gap-1.5 text-xs ${headSubClass}`} title="Auto-syncing with the hospital">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              {refreshing ? 'Syncing…' : `Live · ${ago(lastUpdated)}`}
            </div>
            <Button
              variant="outline" size="sm"
              onClick={logout}
              className={onDark ? 'bg-white/10 text-white border-white/30 hover:bg-white/20' : ''}
            >
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={CalendarDays} label="Upcoming visits" value={stats.upcomingAppointments} accent={primary} />
          <StatCard icon={Activity} label="Total visits" value={stats.totalAppointments} accent="#6366f1" />
          <StatCard icon={Pill} label="Prescriptions" value={stats.prescriptions} accent="#9333ea" />
          <StatCard icon={FlaskConical} label="Lab reports" value={stats.labReports} accent="#d97706" />
          <StatCard icon={Scan} label="Radiology" value={stats.radiologyReports} accent="#0891b2" />
          <StatCard icon={Wallet} label="Balance due" value={money(stats.balanceDue)} accent={stats.balanceDue > 0 ? '#dc2626' : '#16a34a'} />
        </div>

        {/* KYC Link Card */}
        <Link to="/patient/kyc" className="block col-span-full">
          <Card className="hover:border-blue-300 hover:shadow-md transition-all cursor-pointer bg-blue-50/30">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                  <UploadCloud className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Upload KYC & Medical Documents</h3>
                  <p className="text-sm text-gray-500">Aadhaar, PAN, Insurance, Reports, and Prescriptions</p>
                </div>
              </div>
              <div className="text-blue-600 flex items-center text-sm font-medium">
                Manage Documents <ChevronRight className="h-4 w-4 ml-1" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Upcoming appointments */}
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" style={{ color: primary }} /> Upcoming Appointments</CardTitle></CardHeader>
            <CardContent>
              {upcomingAppointments.length === 0 ? (
                <p className="text-sm text-gray-500">No upcoming appointments. New bookings appear here automatically.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingAppointments.map((appt) => (
                    <div key={appt.id} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <div className="text-sm font-medium">{fmtDate(appt.appointmentDate)} {appt.appointmentTime ? `· ${appt.appointmentTime}` : ''}</div>
                        <div className="text-xs text-gray-500">{docName(appt.doctor?.fullName)}{appt.doctor?.specialization ? ` · ${appt.doctor.specialization}` : ''}</div>
                      </div>
                      {statusBadge(appt.status)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Medical info */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" style={{ color: primary }} /> My Information</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-gray-500 mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Allergies</div>
                {profile.allergies.length ? profile.allergies.map((x, i) => <Badge key={i} variant="outline" className="mr-1 mb-1">{x}</Badge>) : <span className="text-gray-400">None recorded</span>}
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Chronic conditions</div>
                {profile.chronicConditions.length ? profile.chronicConditions.map((x, i) => <Badge key={i} variant="outline" className="mr-1 mb-1">{x}</Badge>) : <span className="text-gray-400">None recorded</span>}
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Contact</div>
                <div>{profile.phonePrimary || '—'}</div>
                {profile.email && <div className="text-gray-500">{profile.email}</div>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Prescriptions */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Pill className="h-4 w-4" style={{ color: primary }} /> Prescriptions</CardTitle></CardHeader>
            <CardContent>
              {prescriptions.length === 0 ? <p className="text-sm text-gray-500">No prescriptions yet.</p> : (
                <div className="space-y-2">
                  {prescriptions.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                      <div>
                        <div className="font-medium">{fmtDate(p.createdAt)}</div>
                        <div className="text-xs text-gray-500">{docName(p.doctor?.fullName)}</div>
                      </div>
                      {statusBadge(p.status)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reports */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><FlaskConical className="h-4 w-4" style={{ color: primary }} /> Lab & Radiology Reports</CardTitle></CardHeader>
            <CardContent>
              {labOrders.length === 0 && radiologyOrders.length === 0 ? (
                <p className="text-sm text-gray-500">No reports yet.</p>
              ) : (
                <div className="space-y-2">
                  {labOrders.slice(0, 4).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setReport({ type: 'lab', order: o })}
                      className="flex w-full items-center justify-between rounded-md border p-2.5 text-sm text-left hover:border-amber-300 hover:bg-amber-50/40 transition-colors"
                    >
                      <div className="flex items-center gap-2"><FlaskConical className="h-3.5 w-3.5 text-amber-600" /> Lab · {fmtDate(o.createdAt)}</div>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline">{o.results?.length ? `${o.results.length} result(s)` : o.status}</Badge>
                        <Eye className="h-3.5 w-3.5 text-gray-400" />
                      </span>
                    </button>
                  ))}
                  {radiologyOrders.slice(0, 4).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setReport({ type: 'radiology', order: o })}
                      className="flex w-full items-center justify-between rounded-md border p-2.5 text-sm text-left hover:border-cyan-300 hover:bg-cyan-50/40 transition-colors"
                    >
                      <div className="flex items-center gap-2"><Scan className="h-3.5 w-3.5 text-cyan-600" /> {o.exam?.name || 'Radiology'} · {fmtDate(o.createdAt)}</div>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline">{o.report ? 'Report ready' : o.status}</Badge>
                        <Eye className="h-3.5 w-3.5 text-gray-400" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Visit history */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" style={{ color: primary }} /> Visit History</CardTitle></CardHeader>
          <CardContent>
            {pastAppointments.length === 0 ? <p className="text-sm text-gray-500">No past visits.</p> : (
              <div className="space-y-2">
                {pastAppointments.slice(0, 8).map((appt) => (
                  <div key={appt.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                    <div>
                      <span className="font-medium">{fmtDate(appt.appointmentDate)}</span>
                      <span className="text-gray-500"> · {docName(appt.doctor?.fullName)}</span>
                    </div>
                    {statusBadge(appt.status)}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Billing */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" style={{ color: primary }} /> Billing Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><div className="text-lg font-bold">{money(billing.totalBilled)}</div><div className="text-xs text-gray-500">Total billed</div></div>
              <div><div className="text-lg font-bold text-green-600">{money(billing.totalPaid)}</div><div className="text-xs text-gray-500">Paid</div></div>
              <div><div className={`text-lg font-bold ${billing.balanceDue > 0 ? 'text-red-600' : 'text-green-600'}`}>{money(billing.balanceDue)}</div><div className="text-xs text-gray-500">Balance due</div></div>
            </div>
          </CardContent>
        </Card>

        {/* Manual refresh + footer note */}
        <div className="flex items-center justify-center gap-2 pb-4 text-xs text-gray-400">
          <button onClick={() => fetchData(true)} className="flex items-center gap-1 hover:text-gray-600">
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh now
          </button>
          <span>· Updates automatically every {POLL_MS / 1000}s</span>
        </div>
      </main>

      {/* Report viewer — patients can open their own lab / radiology reports */}
      <Dialog open={!!report} onOpenChange={(o) => { if (!o) setReport(null) }}>
        <DialogContent className="max-w-lg">
          {report?.type === 'lab' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-amber-600" /> Lab Report</DialogTitle>
                <DialogDescription>{fmtDate(report.order.createdAt)}</DialogDescription>
              </DialogHeader>
              {report.order.results?.length ? (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {report.order.results.map((r) => (
                    <div key={r.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.test?.name || 'Test'}</span>
                        {r.isCritical
                          ? <Badge className="bg-red-100 text-red-700">Critical</Badge>
                          : r.isAbnormal
                            ? <Badge className="bg-yellow-100 text-yellow-800">{r.flag || 'Abnormal'}</Badge>
                            : <Badge className="bg-green-100 text-green-700">Normal</Badge>}
                      </div>
                      <div className="mt-1 text-gray-700">Result: <span className="font-semibold">{r.resultValue}{r.resultUnit ? ` ${r.resultUnit}` : ''}</span></div>
                      {(r.referenceRangeText || r.referenceRangeMin != null) && (
                        <div className="text-xs text-gray-500">Reference: {r.referenceRangeText || `${r.referenceRangeMin ?? ''} – ${r.referenceRangeMax ?? ''}`}</div>
                      )}
                      {r.comment && <div className="text-xs text-gray-500 mt-1">{r.comment}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Your sample is being processed. Results will appear here automatically once ready.</p>
              )}
            </>
          )}
          {report?.type === 'radiology' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Scan className="h-4 w-4 text-cyan-600" /> {report.order.exam?.name || 'Radiology'} Report</DialogTitle>
                <DialogDescription>{fmtDate(report.order.createdAt)} · {report.order.report?.status || report.order.status}</DialogDescription>
              </DialogHeader>
              {report.order.report ? (
                <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
                  {report.order.report.technique && <div><div className="text-xs font-semibold text-gray-500">Technique</div><p>{report.order.report.technique}</p></div>}
                  {report.order.report.findings && <div><div className="text-xs font-semibold text-gray-500">Findings</div><p className="whitespace-pre-wrap">{report.order.report.findings}</p></div>}
                  {report.order.report.impression && <div><div className="text-xs font-semibold text-gray-500">Impression</div><p className="whitespace-pre-wrap">{report.order.report.impression}</p></div>}
                  {report.order.report.recommendations && <div><div className="text-xs font-semibold text-gray-500">Recommendations</div><p className="whitespace-pre-wrap">{report.order.report.recommendations}</p></div>}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Your report is being prepared and will appear here automatically once ready.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
