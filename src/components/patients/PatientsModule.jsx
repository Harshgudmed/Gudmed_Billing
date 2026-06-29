import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { getOrgSettings } from '@/lib/orgSettings';
import client from '@/api/client';

// UI Components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Plus, Search, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, UserPlus, Loader2 } from 'lucide-react';

// Common Components
import RegisterPatientForm from '@/components/common/RegisterPatientForm';
import { useDateFilter } from '@/components/common/DateFilter';

// Extracted Patients Components & Hooks
import { getFullName, patientSchema } from './utils/patientUtils';
import { printOpdPrescription } from './utils/printPrescription';
import { usePatients } from './hooks/usePatients';
import { usePatientRecords } from './hooks/usePatientRecords';
import PatientListTable from './components/PatientListTable';
import PatientForm from './components/PatientForm';
import PatientProfile from './components/PatientProfile';

// Full, literal class strings so Tailwind keeps them at build time. Dynamic
// strings like `bg-${color}-50` get purged in production and the colors vanish.
const STAT_STYLES = {
  blue:   { card: 'bg-blue-50 border-blue-200',     label: 'text-blue-600',   val: 'text-blue-700',   icon: 'text-blue-400' },
  green:  { card: 'bg-green-50 border-green-200',   label: 'text-green-600',  val: 'text-green-700',  icon: 'text-green-400' },
  purple: { card: 'bg-purple-50 border-purple-200', label: 'text-purple-600', val: 'text-purple-700', icon: 'text-purple-400' },
  amber:  { card: 'bg-amber-50 border-amber-200',   label: 'text-amber-600',  val: 'text-amber-700',  icon: 'text-amber-400' },
};

export default function PatientsModule() {
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' });

  useEffect(() => {
    const loadOrgSettings = async () => {
      try {
        const settings = await getOrgSettings()
        setOrgInfo(settings)
      } catch (err) {
        console.error('Failed to load organization settings:', err)
      }
    }

    loadOrgSettings()
  }, []);

  const location = useLocation();
  const dateFilter = useDateFilter();
  const { startDate: dfStart, endDate: dfEnd } = dateFilter.range;

  const {
    patients, total, loading, error, search, setSearch,
    status, setStatus, offset, setOffset, limit, refresh: fetchPatients
  } = usePatients({ dfStart, dfEnd, limit: 10 });

  // Dialog states
  const [showRegDialog, setShowRegDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  
  // Selection states
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [viewTab, setViewTab] = useState('overview');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-open registration dialog from query params
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('register') === '1' || location.state?.openNew) {
      setShowRegDialog(true);
    }
  }, [location.search, location.state]);

  // Hook for fetching a single patient's records
  const {
    records, recordsLoading, fetchRecords, cancelAppointment, cancellingId
  } = usePatientRecords(selectedPatient, showViewDialog);

  // Form setup for editing
  const form = useForm({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      firstName: '', middleName: '', lastName: '', dateOfBirth: '',
      gender: 'male', phonePrimary: '', phoneSecondary: '', email: '',
      region: '', zone: '', woreda: '', kebele: '',
      emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
      bloodGroup: '', hasInsurance: false, insuranceProvider: '', insuranceId: '',
    },
  });

  const openPatient = useCallback((patient, tab = 'overview') => {
    setSelectedPatient(patient);
    setViewTab(tab);
    setShowViewDialog(true);
    fetchRecords(patient.id);
  }, [fetchRecords]);

  const openEdit = (patient) => {
    setSelectedPatient(patient);
    form.reset({
      firstName: patient.firstName || '', middleName: patient.middleName || '', lastName: patient.lastName || '',
      dateOfBirth: patient.dateOfBirth ? format(new Date(patient.dateOfBirth), 'yyyy-MM-dd') : '',
      gender: patient.gender || 'male', phonePrimary: patient.phonePrimary || '', phoneSecondary: patient.phoneSecondary || '',
      email: patient.email || '', region: patient.region || '', zone: patient.zone || '',
      woreda: patient.woreda || '', kebele: patient.kebele || '',
      emergencyContactName: patient.emergencyContactName || '', emergencyContactPhone: patient.emergencyContactPhone || '',
      emergencyContactRelationship: patient.emergencyContactRelationship || '', bloodGroup: patient.bloodGroup || '',
      hasInsurance: patient.hasInsurance || false, insuranceProvider: patient.insuranceProvider || '', insuranceId: patient.insuranceId || '',
    });
    setShowEditDialog(true);
  };

  const onEdit = async (data) => {
    if (!selectedPatient) return;
    try {
      setIsSubmitting(true);
      await client.patch(`/patients/${selectedPatient.id}`, data);
      toast.success('Patient updated successfully');
      setShowEditDialog(false);
      fetchPatients();
    } catch (err) {
      toast.error(err.message || 'Failed to update patient');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePatient = async (patient) => {
    if (!window.confirm(
      `Deactivate patient "${getFullName(patient)}" (${patient.mrn})?\n\n` +
      `This will hide them from the active patient list but keep all medical records.\n` +
      `You can reactivate them later from the "Inactive" filter if needed.`
    )) return;
    try {
      const res = await client.delete(`/patients/${patient.id}`);
      if (res.success) {
        toast.success(`Patient ${patient.mrn} deactivated successfully`);
        fetchPatients();
      } else {
        toast.error(res.error || 'Failed to deactivate patient');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to deactivate patient');
    }
  };

  const handlePrintCard = (patient) => {
    printOpdPrescription(patient, orgInfo);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8 text-blue-600" />
            Patients
          </h1>
          <p className="text-gray-500">Manage patient records and registrations</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchPatients}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Dialog open={showRegDialog} onOpenChange={(open) => { setShowRegDialog(open); if (!open) form.reset(); }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Register Patient</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
              <RegisterPatientForm
                onCancel={() => setShowRegDialog(false)}
                onSuccess={() => { setShowRegDialog(false); fetchPatients(); }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Patients', val: total, color: 'blue' },
          { label: 'Loaded', val: patients.length, color: 'green' },
          { label: 'Insured', val: patients.filter(p => p.hasInsurance).length, color: 'purple' },
          { label: 'VIP', val: patients.filter(p => p.isVip).length, color: 'amber' },
        ].map(({ label, val, color }) => {
          const s = STAT_STYLES[color];
          return (
            <Card key={label} className={s.card}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${s.label}`}>{label}</p>
                  <p className={`text-2xl font-bold ${s.val}`}>{val}</p>
                </div>
                <Users className={`h-8 w-8 ${s.icon}`} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-10"
            placeholder="Search by name, UHID, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Patients</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {dateFilter.control}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-3" />
              <p className="text-red-600 mb-3">{error}</p>
              <Button onClick={fetchPatients} variant="outline"><RefreshCw className="h-4 w-4 mr-2" />Retry</Button>
            </div>
          ) : patients.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No patients found</p>
              <Button className="mt-4" onClick={() => setShowRegDialog(true)}>
                <UserPlus className="h-4 w-4 mr-2" />Register First Patient
              </Button>
            </div>
          ) : (
            <PatientListTable 
              patients={patients}
              openPatient={openPatient}
              handlePrintCard={handlePrintCard}
              handleDeletePatient={handleDeletePatient}
            />
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} patients
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              <ChevronLeft className="h-4 w-4 mr-1" />Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Patient Profile Dialog */}
      <PatientProfile 
        selectedPatient={selectedPatient}
        showViewDialog={showViewDialog}
        setShowViewDialog={setShowViewDialog}
        records={records}
        recordsLoading={recordsLoading}
        fetchRecords={fetchRecords}
        viewTab={viewTab}
        setViewTab={setViewTab}
        cancelAppointment={cancelAppointment}
        cancellingId={cancellingId}
        openEdit={openEdit}
        orgInfo={orgInfo}
      />

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Patient</DialogTitle>
          </DialogHeader>
          <PatientForm form={form} isSubmitting={isSubmitting} onSubmitFn={onEdit} submitLabel="Save Changes" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
