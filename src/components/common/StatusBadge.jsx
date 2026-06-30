import { Badge } from "@/components/ui/badge";

// Generic status pill. Pass a { status: "tailwind classes" } colour map; the
// label is the status with underscores turned into spaces. Falls back to gray
// for any unmapped status.
//
//   <StatusBadge status={po.status} map={PHARMACY_STATUS_COLORS} />
export function StatusBadge({ status, map = {}, className = "" }) {
  return (
    <Badge className={`${map[status] || "bg-gray-100 text-gray-800"} ${className}`}>
      {(status || "").replace(/_/g, " ")}
    </Badge>
  );
}
