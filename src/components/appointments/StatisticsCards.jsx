import { Card, CardContent } from "@/components/ui/card";
import {
  CalendarDays,
  CheckCircle,
  UserCheck,
  Play,
  XCircle,
  AlertCircle,
} from "lucide-react";

// Full, literal Tailwind class strings per stat colour. These must be written out
// in full (not built as `bg-${color}-50`) so Tailwind's scanner generates them —
// dynamically composed class names are silently dropped from the production CSS.
const STAT_CARD_STYLES = {
  blue: { card: "bg-blue-50 border-blue-200", label: "text-blue-600", value: "text-blue-700", icon: "text-blue-400" },
  indigo: { card: "bg-indigo-50 border-indigo-200", label: "text-indigo-600", value: "text-indigo-700", icon: "text-indigo-400" },
  green: { card: "bg-green-50 border-green-200", label: "text-green-600", value: "text-green-700", icon: "text-green-400" },
  orange: { card: "bg-orange-50 border-orange-200", label: "text-orange-600", value: "text-orange-700", icon: "text-orange-400" },
  gray: { card: "bg-gray-50 border-gray-200", label: "text-gray-600", value: "text-gray-700", icon: "text-gray-400" },
  red: { card: "bg-red-50 border-red-200", label: "text-red-600", value: "text-red-700", icon: "text-red-400" },
  amber: { card: "bg-amber-50 border-amber-200", label: "text-amber-600", value: "text-amber-700", icon: "text-amber-400" },
};

// Static card definitions — only `stats[key]` changes per render, so the config
// lives at module scope instead of being rebuilt inside the render.
const STAT_CARDS = [
  { key: "total", label: "Today's Total", color: "blue", Icon: CalendarDays },
  { key: "confirmed", label: "Confirmed", color: "indigo", Icon: CheckCircle },
  { key: "checkedIn", label: "Checked In", color: "green", Icon: UserCheck },
  { key: "inProgress", label: "In Progress", color: "orange", Icon: Play },
  { key: "completed", label: "Completed", color: "gray", Icon: CheckCircle },
  { key: "cancelled", label: "Cancelled", color: "red", Icon: XCircle },
  { key: "noShows", label: "No Shows", color: "amber", Icon: AlertCircle },
];

export default function StatisticsCards({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
      {STAT_CARDS.map(({ key, label, color, Icon }) => {
        const style = STAT_CARD_STYLES[color];
        return (
          <Card key={key} className={style.card}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm ${style.label} font-medium`}>{label}</p>
                  <p className={`text-2xl font-bold ${style.value}`}>
                    {stats[key]}
                  </p>
                </div>
                <Icon className={`h-8 w-8 ${style.icon}`} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
