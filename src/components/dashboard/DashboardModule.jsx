import { useState, useEffect, useCallback } from 'react'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { AUTH_ENFORCED } from '@/lib/roleConfig'
import { useEnabledModules } from '@/lib/useEnabledModules'
import { billingAccess } from '@/lib/billing'
import { formatDistanceToNow, format, isSameDay } from 'date-fns'
import {
  Users, Calendar, Clock, IndianRupee, FlaskConical, Pill, BedDouble,
  AlertCircle, TrendingUp, Timer, UserPlus, Stethoscope, Receipt, Activity, ShoppingCart
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import client from '@/api/client'
import RegisterPatientForm from '@/components/common/RegisterPatientForm'
import { formatTime12h, formatMoney } from "@/lib/format";
import { getFullName } from "@/lib/patient";

// Quick actions, each tied to the module it opens. A role sees only the ones
// its sidebar has (roleCanOpen) — a billing desk is not offered Triage or
// Dispense, which would only bounce it back here.
const QUICK_ACTIONS = [
  { key: 'patients', label: 'New Patient', icon: UserPlus, newPatient: true },
  { key: 'appointments', label: 'Book Appointment', icon: Calendar, path: 'appointments?action=new' },
  { key: 'preTriage', label: 'Triage Patient', icon: Stethoscope, path: 'pre-triage' },
  { key: 'laboratory', label: 'Lab Order', icon: FlaskConical, path: 'laboratory' },
  { key: 'pharmacy', label: 'Dispense', icon: Pill, path: 'pharmacy' },
  { key: 'billing', label: 'New Invoice', icon: Receipt, path: 'billing' },
  { key: 'purchase', label: 'Purchase & Supply Chain', icon: ShoppingCart, path: 'purchase' },
]
// Full class names, never built from a number: Tailwind only ships classes it can find written out.
const ACTION_COLS = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7' }

const getStatusBadgeClass = (status) => {
  switch (status) {
    case 'waiting': return 'bg-blue-100 text-blue-800'
    case 'in_progress': return 'bg-green-100 text-green-800'
    case 'completed': return 'bg-gray-100 text-gray-800'
    case 'cancelled': return 'bg-red-100 text-red-800'
    case 'scheduled': return 'bg-purple-100 text-purple-800'
    case 'checked_in': return 'bg-yellow-100 text-yellow-800'
    case 'confirmed': return 'bg-teal-100 text-teal-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

export default function DashboardModule() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const role = user?.role || 'admin'
  // Legacy/demo mode (AUTH off) uses flat routes (/patients); role mode uses /:role/patients.
  const base = AUTH_ENFORCED ? `/${role}` : ''
  const { orgInfo } = useOrgSettings() // Now automatically updates when settings change
  // Every tile and button below opens a module; each shows only for a role
  // whose sidebar has that module, in a hospital that has it switched on.
  const { canOpen } = useEnabledModules()
  // Finance opens Billing to approve and review, not to raise a bill.
  const raises = billingAccess(user?.role).canRaise
  const actions = QUICK_ACTIONS.filter((a) => canOpen(a.key))
    .map((a) => (a.key === 'billing' && !raises ? { ...a, label: 'Billing' } : a))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // A failed read keeps the last figures and says so; it used to be swallowed,
  // and every tile read 0 with "No upcoming appointments" under it.
  const [loadFailed, setLoadFailed] = useState(false)
  const [showNewPatient, setShowNewPatient] = useState(false)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const res = await client.get('/dashboard')
      if (res.success) { setData(res.data); setLoadFailed(false) }
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  const stats = data?.stats || {}
  const upcomingAppointments = data?.upcomingAppointments || []
  // A figure that was never loaded shows "—", not a 0 the hospital never had.
  const shown = (n) => (data ? n || 0 : '—')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
        </div>
        {canOpen('patients') && (
          <Button onClick={() => setShowNewPatient(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            New Patient
          </Button>
        )}
      </div>
      {loadFailed && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {data
            ? 'Could not refresh the dashboard — showing the figures last loaded.'
            : 'Could not load the dashboard figures. Check the connection, then try again.'}
          <button type="button" onClick={fetchDashboard} className="ml-2 font-medium underline underline-offset-2">Try again</button>
        </p>
      )}
      {/* Quick Actions — only this role's */}
      {actions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`grid grid-cols-2 md:grid-cols-4 ${ACTION_COLS[actions.length]} gap-4`}>
              {actions.map((a) => (
                <Button key={a.key} variant="outline" className="h-20 flex-col gap-2"
                  onClick={() => (a.newPatient ? setShowNewPatient(true) : navigate(`${base}/${a.path}`))}>
                  <a.icon className="h-6 w-6" />
                  <span>{a.label}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Primary Stats — every card is clickable and navigates to its module */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {canOpen('patients') && <Card className="cursor-pointer hover:shadow-lg hover:border-blue-300 transition-all" onClick={() => navigate(`${base}/patients`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Patients</CardTitle>
            <Users className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data ? (stats.totalPatients || 0).toLocaleString() : '—'}</div>
            <p className="text-xs text-green-600 flex items-center mt-1">
              <TrendingUp className="h-3 w-3 mr-1" /> Active records
            </p>
          </CardContent>
        </Card>}

        {canOpen('appointments') && <Card className="cursor-pointer hover:shadow-lg hover:border-purple-300 transition-all" onClick={() => navigate(`${base}/appointments`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Today's Appointments</CardTitle>
            <Calendar className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shown(stats.todayAppointments)}</div>
            <p className="text-xs text-gray-500">{shown(stats.checkedInToday)} checked in</p>
          </CardContent>
        </Card>}

        {canOpen('queue') && <Card className="cursor-pointer hover:shadow-lg hover:border-orange-300 transition-all" onClick={() => navigate(`${base}/queue`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Queue Waiting</CardTitle>
            <Clock className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shown(stats.queueWaiting)}</div>
            <p className="text-xs text-gray-500">In waiting area</p>
          </CardContent>
        </Card>}

        {/* Absent for a doctor — the API omits the figure rather than sending a
            zero, because "₹0" is a claim about the hospital's day and this card
            also navigates to Billing, which a doctor's workspace has no route
            for. Every other role still gets it. */}
        {stats.todayRevenue !== undefined && canOpen('billing') && (
          <Card className="cursor-pointer hover:shadow-lg hover:border-green-300 transition-all" onClick={() => navigate(`${base}/billing`)}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Today's Revenue</CardTitle>
              <IndianRupee className="h-5 w-5 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatMoney(stats.todayRevenue || 0)}</div>
              <p className="text-xs text-green-600 flex items-center mt-1">
                <TrendingUp className="h-3 w-3 mr-1" /> Collected today
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Secondary Stats — every card is clickable and navigates to its module */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {canOpen('laboratory') && <Card className="cursor-pointer hover:shadow-lg hover:border-cyan-300 transition-all" onClick={() => navigate(`${base}/laboratory`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Lab Orders</CardTitle>
            <FlaskConical className="h-5 w-5 text-cyan-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shown(stats.pendingLabOrders)}</div>
            <Progress value={Math.min(100, (stats.pendingLabOrders || 0) * 10)} className="mt-2 h-2" />
          </CardContent>
        </Card>}

        {canOpen('pharmacy') && <Card className="cursor-pointer hover:shadow-lg hover:border-pink-300 transition-all" onClick={() => navigate(`${base}/pharmacy`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Prescriptions</CardTitle>
            <Pill className="h-5 w-5 text-pink-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shown(stats.pendingPrescriptions)}</div>
            <Progress value={Math.min(100, (stats.pendingPrescriptions || 0) * 10)} className="mt-2 h-2" />
          </CardContent>
        </Card>}

        {/* Same as Revenue above: ward occupancy belongs to the hospital, not to
            one doctor, and this card navigates to Inpatient — another module a
            doctor's workspace does not carry. */}
        {stats.occupiedBeds !== undefined && canOpen('inpatient') && (
          <Card className="cursor-pointer hover:shadow-lg hover:border-indigo-300 transition-all" onClick={() => navigate(`${base}/inpatient`)}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Bed Occupancy</CardTitle>
              <BedDouble className="h-5 w-5 text-indigo-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(stats.occupiedBeds || 0)}/{((stats.occupiedBeds || 0) + (stats.availableBeds || 0)) || 0}
              </div>
              <Progress
                value={((stats.occupiedBeds || 0) + (stats.availableBeds || 0)) > 0
                  ? ((stats.occupiedBeds || 0) / ((stats.occupiedBeds || 0) + (stats.availableBeds || 0))) * 100
                  : 0}
                className="mt-2 h-2"
              />
            </CardContent>
          </Card>
        )}

        {canOpen('inpatient') && <Card className="cursor-pointer hover:shadow-lg hover:border-red-300 transition-all" onClick={() => navigate(`${base}/inpatient`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Critical Alerts</CardTitle>
            <AlertCircle className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{shown(stats.criticalAlerts)}</div>
            <p className="text-xs text-red-600">Needs attention</p>
          </CardContent>
        </Card>}
      </div>

      {/* Appointments — for the roles that work with them */}
      {canOpen('appointments') && <div className="grid grid-cols-1 gap-6">
        {/* Today's Appointments */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              {/* "Upcoming", not "Today's". The query behind this list is bounded
                  below only — `appointmentDate: { gte: today }` — so it has
                  always carried today AND everything after it, which is why the
                  stat tile above could read 1 while three rows sat under a
                  heading claiming they were all today's. */}
              <CardTitle>Upcoming Appointments</CardTitle>
              <Button variant="outline" size="sm" onClick={() => navigate(`${base}/appointments`)}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {upcomingAppointments.length > 0 ? (
                <div className="space-y-3">
                  {upcomingAppointments.slice(0, 10).map((apt) => (
                    <div key={apt.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {getFullName(apt.patient)}
                        </p>
                        {/* The day is named, because this list spans days. A row
                            reading only "3:00 PM" was indistinguishable from
                            today's when it was a week away. Today says "Today"
                            rather than a date, so the common case stays short. */}
                        <p className="text-sm text-gray-500">
                          {isSameDay(new Date(apt.appointmentDate), new Date())
                            ? 'Today'
                            : format(new Date(apt.appointmentDate), 'EEE d MMM')}
                          {' · '}{formatTime12h(apt.appointmentTime)} &bull; {apt.chiefComplaint || 'Consultation'}
                        </p>
                      </div>
                      <Badge className={getStatusBadgeClass(apt.status)}>
                        {apt.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {data ? 'No upcoming appointments' : loadFailed ? 'Appointments could not be loaded.' : 'Loading…'}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>}

    

      {/* New Patient Dialog */}
      <Dialog open={showNewPatient} onOpenChange={setShowNewPatient}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:w-[95vw] sm:max-h-[90vh] sm:p-6">
          <RegisterPatientForm
            onCancel={() => setShowNewPatient(false)}
            onSuccess={() => { setShowNewPatient(false); fetchDashboard() }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
