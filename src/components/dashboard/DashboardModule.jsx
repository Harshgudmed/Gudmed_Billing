import { useState, useEffect, useCallback } from 'react'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { AUTH_ENFORCED } from '@/lib/roleConfig'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Users, Calendar, Clock, IndianRupee, FlaskConical, Pill, BedDouble,
  AlertCircle, TrendingUp, Timer, UserPlus, Stethoscope, Receipt, Activity
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

const getStatusBadgeClass = (status) => {
  switch (status) {
    case 'waiting': return 'bg-blue-100 text-blue-800'
    case 'in_progress':
    case 'in_service': return 'bg-green-100 text-green-800'
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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showNewPatient, setShowNewPatient] = useState(false)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const res = await client.get('/dashboard')
      if (res.success) setData(res.data)
    } catch {
      // silently ignore on dashboard
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  const stats = data?.stats || {}
  const upcomingAppointments = data?.upcomingAppointments || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <Button onClick={() => setShowNewPatient(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          New Patient
        </Button>
      </div>
        {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => setShowNewPatient(true)}>
              <UserPlus className="h-6 w-6" />
              <span>New Patient</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => navigate(`${base}/appointments?action=new`)}>
              <Calendar className="h-6 w-6" />
              <span>Book Appointment</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => navigate(`${base}/pre-triage`)}>
              <Stethoscope className="h-6 w-6" />
              <span>Triage Patient</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => navigate(`${base}/laboratory`)}>
              <FlaskConical className="h-6 w-6" />
              <span>Lab Order</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => navigate(`${base}/pharmacy`)}>
              <Pill className="h-6 w-6" />
              <span>Dispense</span>
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2" onClick={() => navigate(`${base}/billing`)}>
              <Receipt className="h-6 w-6" />
              <span>New Invoice</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Primary Stats — every card is clickable and navigates to its module */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:shadow-lg hover:border-blue-300 transition-all" onClick={() => navigate(`${base}/patients`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Patients</CardTitle>
            <Users className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats.totalPatients || 0).toLocaleString()}</div>
            <p className="text-xs text-green-600 flex items-center mt-1">
              <TrendingUp className="h-3 w-3 mr-1" /> Active records
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg hover:border-purple-300 transition-all" onClick={() => navigate(`${base}/appointments`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Today's Appointments</CardTitle>
            <Calendar className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.todayAppointments || 0}</div>
            <p className="text-xs text-gray-500">{stats.checkedInToday || 0} checked in</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg hover:border-orange-300 transition-all" onClick={() => navigate(`${base}/queue`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Queue Waiting</CardTitle>
            <Clock className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.queueWaiting || 0}</div>
            <p className="text-xs text-gray-500">In waiting area</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg hover:border-green-300 transition-all" onClick={() => navigate(`${base}/billing`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Today's Revenue</CardTitle>
            <IndianRupee className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹ {(stats.todayRevenue || 0).toLocaleString()}</div>
            <p className="text-xs text-green-600 flex items-center mt-1">
              <TrendingUp className="h-3 w-3 mr-1" /> Collected today
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats — every card is clickable and navigates to its module */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:shadow-lg hover:border-cyan-300 transition-all" onClick={() => navigate(`${base}/laboratory`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Lab Orders</CardTitle>
            <FlaskConical className="h-5 w-5 text-cyan-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingLabOrders || 0}</div>
            <Progress value={Math.min(100, (stats.pendingLabOrders || 0) * 10)} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg hover:border-pink-300 transition-all" onClick={() => navigate(`${base}/pharmacy`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Prescriptions</CardTitle>
            <Pill className="h-5 w-5 text-pink-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingPrescriptions || 0}</div>
            <Progress value={Math.min(100, (stats.pendingPrescriptions || 0) * 10)} className="mt-2 h-2" />
          </CardContent>
        </Card>

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

        <Card className="cursor-pointer hover:shadow-lg hover:border-red-300 transition-all" onClick={() => navigate(`${base}/opd`)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Critical Alerts</CardTitle>
            <AlertCircle className="h-5 w-5 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.criticalAlerts || 0}</div>
            <p className="text-xs text-red-600">Needs attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Appointments */}
      <div className="grid grid-cols-1 gap-6">
        {/* Today's Appointments */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Today's Appointments</CardTitle>
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
                          {apt.patient?.firstName} {apt.patient?.lastName}
                        </p>
                        <p className="text-sm text-gray-500">
                          {apt.appointmentTime} &bull; {apt.chiefComplaint || 'Consultation'}
                        </p>
                      </div>
                      <Badge className={getStatusBadgeClass(apt.status)}>
                        {apt.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">No appointments today</div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

    

      {/* New Patient Dialog */}
      <Dialog open={showNewPatient} onOpenChange={setShowNewPatient}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <RegisterPatientForm
            onCancel={() => setShowNewPatient(false)}
            onSuccess={() => { setShowNewPatient(false); fetchDashboard() }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
