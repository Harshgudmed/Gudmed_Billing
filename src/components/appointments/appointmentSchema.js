import { z } from "zod";

// ── Appointment form validation (Zod) ───────────────────────────────────────
// Kept separate from the component so the rules are easy to find, reuse, and test.

export const appointmentSchema = z.object({
  patientId: z.string().min(1, "Patient is required"),
  departmentId: z.string().optional(),
  doctorId: z.string().min(1, "Doctor is required"),
  appointmentDate: z.date(),
  appointmentTime: z.string().min(1, "Time is required"),
  appointmentType: z.enum(["new_patient", "follow_up", "emergency"]),
  priority: z.enum(["normal", "urgent"]),
  consultationFee: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const editAppointmentSchema = z.object({
  doctorId: z.string().min(1, "Doctor is required"),
  appointmentDate: z.date(),
  appointmentTime: z.string().min(1, "Time is required"),
  appointmentType: z.enum(["new_patient", "follow_up", "emergency"]),
  priority: z.enum(["normal", "urgent"]),
  status: z.enum([
    "scheduled",
    "confirmed",
    "checked_in",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
    "rescheduled",
  ]),
  chiefComplaint: z.string().min(5, "Chief complaint is required"),
  notes: z.string().optional(),
});
