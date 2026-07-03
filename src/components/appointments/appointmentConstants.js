import {
  CalendarDays,
  CheckCircle,
  UserCheck,
  Play,
  XCircle,
  AlertCircle,
  RefreshCcw,
} from "lucide-react";

// ── Static data for the Appointments module ──────────────────────────────────
// Pure constants only — no component state or logic lives here.

// Bookable time slots (morning + afternoon blocks)
export const TIME_SLOTS = [
  "08:00", "08:15", "08:30", "08:45",
  "09:00", "09:15", "09:30", "09:45",
  "10:00", "10:15", "10:30", "10:45",
  "11:00", "11:15", "11:30", "11:45",
  "14:00", "14:15", "14:30", "14:45",
  "15:00", "15:15", "15:30", "15:45",
  "16:00", "16:15", "16:30", "16:45",
];



export const APPOINTMENTS_LIST_PER_PAGE = 15;

// Status → label, colors, and icon (used by badges across every view)
export const STATUS_CONFIG = {
  scheduled:   { label: "Scheduled",   color: "text-blue-700",   bgColor: "bg-blue-100",   icon: CalendarDays },
  confirmed:   { label: "Confirmed",   color: "text-indigo-700", bgColor: "bg-indigo-100", icon: CheckCircle },
  checked_in:  { label: "Checked In",  color: "text-green-700",  bgColor: "bg-green-100",  icon: UserCheck },
  in_progress: { label: "In Progress", color: "text-orange-700", bgColor: "bg-orange-100", icon: Play },
  completed:   { label: "Completed",   color: "text-gray-700",   bgColor: "bg-gray-100",   icon: CheckCircle },
  cancelled:   { label: "Cancelled",   color: "text-red-700",    bgColor: "bg-red-100",    icon: XCircle },
  no_show:     { label: "No Show",     color: "text-amber-700",  bgColor: "bg-amber-100",  icon: AlertCircle },
  rescheduled: { label: "Rescheduled", color: "text-purple-700", bgColor: "bg-purple-100", icon: RefreshCcw },
};

export const APPOINTMENT_TYPE_CONFIG = {
  new_patient: { label: "New Patient", color: "bg-cyan-100 text-cyan-700" },
  follow_up:   { label: "Follow-up",   color: "bg-emerald-100 text-emerald-700" },
  emergency:   { label: "Emergency",   color: "bg-red-100 text-red-700" },
};

// Groups appointment statuses by lifecycle stage, for the Today tab's
// upcoming/completed split. Module-level (not inside a component) so it's a
// stable reference — safe to add to a useMemo/useEffect dependency array later
// without breaking memoization.
export const APPOINTMENT_STATUSES = {
  upcoming: ["scheduled", "confirmed", "checked_in", "in_progress"],
  completed: ["completed", "cancelled", "no_show", "rescheduled"],
};
