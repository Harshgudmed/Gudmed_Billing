import { useState, useEffect, useMemo, useCallback } from "react";
import client from "@/api/client";

// Owns the server data for the Appointments module. Reference data (doctors,
// departments) is loaded once; appointments are fetched per view (date window or
// page) so the whole table is never loaded into the browser. Patient details
// come included on each appointment, so patients aren't bulk-loaded either.
export function useAppointments() {
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped on every data change — lets stats refetch only after mutations
  // (not on every tab switch / date-range load).
  const [mutationCount, setMutationCount] = useState(0);
  const bumpMutations = useCallback(() => setMutationCount((c) => c + 1), []);

  // Reference data only (users → doctors, departments, OPD services).
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [usersResult, departmentsResult] =
      await Promise.allSettled([
        client.get("/settings?resource=users"),
        client.get("/settings?resource=departments"),
      ]);
    if (usersResult.status === "fulfilled")
      setUsers(usersResult.value?.data ?? []);
    if (departmentsResult.status === "fulfilled")
      setDepartments(departmentsResult.value?.data ?? []);
    if (usersResult.status === "rejected")
      setError(
        usersResult.reason instanceof Error
          ? usersResult.reason.message
          : "Some data failed to load",
      );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load the appointments for a date window (used by the calendar/week/today/
  // doctor-slots tabs) into shared state. Bounded → safe at any table size.
  const loadAppointmentsRange = useCallback(async (dateFrom, dateTo) => {
    const params = new URLSearchParams({ dateFrom, dateTo, limit: "1000" });
    const res = await client.get(`/appointments?${params.toString()}`);
    setAppointments(res.data ?? []);
  }, []);

  // Today's status counts, computed by the DB.
  const fetchStats = useCallback(async (date) => {
    const res = await client.get(`/appointments/stats${date ? `?date=${date}` : ""}`);
    return res.data ?? {};
  }, []);

  const doctors = useMemo(
    () => users.filter((user) => user.role === "doctor" && user.isActive),
    [users],
  );

  // O(1) Map lookup instead of O(n) array scan on every render
  const patientsMap = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient])),
    [patients],
  );
  const getPatient = useCallback(
    (patientId) => patientsMap.get(patientId) ?? null,
    [patientsMap],
  );
  const getDoctor = useCallback(
    (doctorId) => doctors.find((doctor) => doctor.id === doctorId),
    [doctors],
  );

  const createAppointment = useCallback(async (data) => {
    const res = await client.post("/appointments", data);
    const appointment = res.data;
    setAppointments((prev) => [...prev, appointment]);
    bumpMutations();
    return appointment;
  }, [bumpMutations]);

  const updateAppointment = useCallback(async (id, updates) => {
    const res = await client.patch(`/appointments/${id}`, updates);
    const appointment = res.data;
    setAppointments((prev) =>
      prev.map((existing) => (existing.id === id ? { ...existing, ...appointment } : existing)),
    );
    bumpMutations();
    return appointment;
  }, [bumpMutations]);

  // Atomic reschedule: backend creates the new appointment and marks the old one
  // "rescheduled" in one transaction. We then reflect both rows in local state.
  const rescheduleAppointment = useCallback(async (id, { appointmentDate, appointmentTime }) => {
    const res = await client.post(`/appointments/${id}/reschedule`, { appointmentDate, appointmentTime });
    const created = res.data;
    setAppointments((prev) => [
      ...prev.map((existing) => (existing.id === id ? { ...existing, status: "rescheduled" } : existing)),
      created,
    ]);
    bumpMutations();
    return created;
  }, [bumpMutations]);

  // One request updates many appointments' status (was N separate PATCH calls).
  const bulkUpdateStatus = useCallback(async (ids, status) => {
    await client.patch("/appointments/bulk/status", { ids, status });
    const idSet = new Set(ids);
    setAppointments((prev) =>
      prev.map((existing) => (idSet.has(existing.id) ? { ...existing, status } : existing)),
    );
    bumpMutations();
  }, [bumpMutations]);

  // Server-side paginated + filtered list (used by the List tab so it never
  // loads the whole table into the browser).
  const fetchAppointmentsPage = useCallback(
    async ({ page = 1, pageSize = 50, date, search, status, doctorId, department } = {}) => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      if (date) params.set("date", date);
      if (search) params.set("search", search);
      if (status && status !== "all") params.set("status", status);
      if (doctorId && doctorId !== "all") params.set("doctorId", doctorId);
      if (department && department !== "all") params.set("department", department);
      const res = await client.get(`/appointments?${params.toString()}`);
      return { rows: res.data ?? [], total: res.meta?.total ?? 0 };
    },
    [],
  );

  return {
    appointments,
    doctors,
    departments,
    loading,
    error,
    fetchData,
    getPatient,
    getDoctor,
    createAppointment,
    updateAppointment,
    rescheduleAppointment,
    bulkUpdateStatus,
    fetchAppointmentsPage,
    loadAppointmentsRange,
    fetchStats,
    mutationCount,
    setPatients,
  };
}
