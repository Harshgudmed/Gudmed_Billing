import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";
import { STATUS_CONFIG, APPOINTMENT_TYPE_CONFIG } from "./appointmentConstants";

// One source of truth for the coloured status pill used across every view
// (Today / List / Monthly / Weekly). Pass `showIcon={false}` and a `className`
// for the compact weekly variant.
export function StatusBadge({ status, showIcon = true, className = "" }) {
  const info = STATUS_CONFIG[status] || STATUS_CONFIG.scheduled;
  const Icon = info.icon || CalendarDays;
  return (
    <Badge className={`${info.bgColor} ${info.color} border-0 ${className}`}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {info.label}
    </Badge>
  );
}

// Appointment-type pill (New Patient / Follow-up / Emergency). Defaults to
// "new_patient" when the type is missing, matching the booking default.
export function TypeBadge({ type, className = "" }) {
  const info = APPOINTMENT_TYPE_CONFIG[type || "new_patient"];
  return (
    <Badge variant="outline" className={`${info?.color} ${className}`}>
      {info?.label}
    </Badge>
  );
}
