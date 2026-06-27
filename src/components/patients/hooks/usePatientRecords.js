import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import client from '@/api/client';

export function usePatientRecords(selectedPatient, isPollingEnabled = false) {
  const [records, setRecords] = useState({
    labOrders: [],
    radiologyOrders: [],
    admissions: [],
    appointments: [],
    invoices: [],
    patientDocuments: [],
    billing: null
  });
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const pollingIntervalRef = useRef(30000);

  const fetchRecords = useCallback(async (patientId) => {
    if (!patientId) return;
    try {
      const res = await client.get(`/patients/${patientId}/records`);
      if (res.success) {
        setRecords(res.data);
        pollingIntervalRef.current = 30000;
      }
    } catch {
      pollingIntervalRef.current = Math.min(pollingIntervalRef.current * 1.5, 300000);
    }
  }, []);

  const cancelAppointment = useCallback(async (appt) => {
    if (!window.confirm('Cancel this appointment?')) return;
    setCancellingId(appt.id);
    try {
      const res = await client.patch(`/appointments/${appt.id}`, { status: 'cancelled' });
      if (res.success !== false) {
        toast.success('Appointment cancelled');
        if (selectedPatient) fetchRecords(selectedPatient.id);
      } else {
        toast.error(res.error || 'Failed to cancel');
      }
    } catch (err) {
      toast.error('Failed to cancel appointment');
    } finally {
      setCancellingId(null);
    }
  }, [selectedPatient, fetchRecords]);

  useEffect(() => {
    if (!isPollingEnabled || !selectedPatient) {
      pollingIntervalRef.current = 30000;
      return;
    }

    const poll = async () => {
      await fetchRecords(selectedPatient.id);
      timeoutRef.current = setTimeout(poll, pollingIntervalRef.current);
    };

    const timeoutRef = { current: null };
    poll();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isPollingEnabled, selectedPatient, fetchRecords]);

  return {
    records,
    setRecords,
    recordsLoading,
    setRecordsLoading,
    fetchRecords,
    cancelAppointment,
    cancellingId
  };
}
