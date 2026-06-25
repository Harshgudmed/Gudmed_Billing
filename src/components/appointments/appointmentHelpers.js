// Small shared helpers for the Appointments module, used by both the main view
// and the extracted dialog components.

export const parseDate = (date) => (date instanceof Date ? date : new Date(date));

export const getPatientFullName = (patient) => {
  if (!patient) return "Unknown Patient";
  return `${patient.firstName} ${patient.middleName || ""} ${patient.lastName}`.trim();
};

// Sort comparator for appointments by time-of-day. appointmentTime is a
// zero-padded "HH:MM" string, so a plain string compare is chronological.
export const byTime = (a, b) =>
  a.appointmentTime.localeCompare(b.appointmentTime);
