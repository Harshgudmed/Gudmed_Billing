// Small shared helpers for the Appointments module, used by both the main view
// and the extracted dialog components.

import { getFullName } from "@/lib/patient";

export const parseDate = (date) => (date instanceof Date ? date : new Date(date));

// Delegates to the shared builder so every screen assembles a name the same
// way. The old inline version left a DOUBLE space where the middle name would
// go whenever a patient had none ("Priya  Sharma"), because it interpolated an
// empty string between two spaces and only trimmed the ends.
export const getPatientFullName = (patient) =>
  (patient ? getFullName(patient) : "") || "Unknown Patient";

// Sort comparator for appointments by time-of-day. appointmentTime is a
// zero-padded "HH:MM" string, so a plain string compare is chronological.
export const byTime = (a, b) =>
  a.appointmentTime.localeCompare(b.appointmentTime);
