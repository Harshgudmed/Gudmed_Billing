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

  // Which patient the UI is currently showing. A response is only written to
  // state if it still matches — otherwise a slow fetch for patient A, resolving
  // after the user switched to patient B, would drop A's records into B's tabs.
  const currentPatientIdRef = useRef(null);

  const fetchRecords = useCallback(async (patientId) => {
    if (!patientId) return;
    try {
      const res = await client.get(`/patients/${patientId}/records`);
      if (patientId !== currentPatientIdRef.current) return; // stale, discard
      if (res.success) {
        setRecords(res.data);
        pollingIntervalRef.current = 30000;
      }
    } catch {
      if (patientId !== currentPatientIdRef.current) return;
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
    currentPatientIdRef.current = selectedPatient?.id ?? null;

    if (!isPollingEnabled || !selectedPatient) {
      pollingIntervalRef.current = 30000;
      return;
    }

    // `timeoutRef` used to be a plain object created inside the effect, and the
    // next tick was only armed AFTER the await. So if the dialog closed while a
    // fetch was in flight, cleanup saw `current === null`, cancelled nothing,
    // and the resolving fetch armed a timer on an abandoned closure that nobody
    // could ever clear — one immortal loop per open/close, each still polling a
    // patient the user had moved on from.
    let stopped = false;
    let timer = null;

    const poll = async () => {
      await fetchRecords(selectedPatient.id);
      if (stopped) return;
      timer = setTimeout(poll, pollingIntervalRef.current);
    };

    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
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
