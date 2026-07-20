import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  format,
  addDays,
  addWeeks,
  subWeeks,
  startOfWeek,
  isToday,
} from "date-fns";
import { drName } from "@/lib/utils";
import { STATUS_CONFIG } from "./appointmentConstants";
import { StatusBadge } from "./AppointmentBadges";
import { getFullName } from "@/lib/patient";
import { formatTime12h } from "@/lib/format";

// weekData is keyed by day ("yyyy-MM-dd") → { rows, total }. rows is a bounded
// preview (first N) the server already returns sorted by time; total is the real
// per-day count, used to know whether there is more to auto-load.
const emptyDay = { rows: [], total: 0 };

// One day's column — owns the scroll container AND the IntersectionObserver that
// watches its own bottom sentinel, so scrolling near the end of a day silently
// fetches the next chunk from the server (real pagination, not a client-side
// reveal) instead of a "+N more" the user had to click.
function DayColumn({ day, dayAppointments, total, isCurrentDay, getPatient, onLoadMoreDay, loadingMoreDay }) {
  const ymd = format(day, "yyyy-MM-dd");
  const hidden = total - dayAppointments.length;
  const isLoadingThis = loadingMoreDay === ymd;

  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  // Guards against firing a second request for this day while one is already
  // in flight — the parent's loadingMoreDay only tracks ONE day at a time, but
  // the observer can re-fire on every intersection frame.
  const requestingRef = useRef(false);

  useEffect(() => {
    if (loadingMoreDay !== ymd) requestingRef.current = false;
  }, [loadingMoreDay, ymd]);

  useEffect(() => {
    if (hidden <= 0) return undefined; // fully loaded — nothing to watch
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return undefined;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !requestingRef.current) {
          requestingRef.current = true;
          onLoadMoreDay(ymd);
        }
      },
      { root, rootMargin: "150px", threshold: 0 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [ymd, hidden, onLoadMoreDay]);

  return (
    <div
      ref={scrollRef}
      className={`border-r last:border-r-0 p-2 space-y-1 max-h-[65vh] overflow-y-auto no-scrollbar ${isCurrentDay ? "bg-blue-50/30" : ""}`}
    >
      {total === 0 && <p className="text-xs text-gray-300 text-center mt-4">—</p>}
      {dayAppointments.map((appointment) => {
        const patient = appointment.patient || getPatient(appointment.patientId);
        const patientName = patient
          ? getFullName(patient)
          : "Unknown";
        const statusConfig = STATUS_CONFIG[appointment.status] || STATUS_CONFIG.scheduled;
        return (
          <div
            key={appointment.id}
            className={`rounded p-1.5 text-xs cursor-pointer hover:opacity-80 ${statusConfig.bgColor}`}
          >
            <div className="font-semibold truncate">{formatTime12h(appointment.appointmentTime)}</div>
            <div className="truncate">{patientName}</div>
            {appointment.doctor && (
              <div className="truncate text-gray-500">{drName(appointment.doctor.fullName)}</div>
            )}
            <StatusBadge status={appointment.status} showIcon={false} className="text-[9px] px-1 py-0" />
          </div>
        );
      })}
      {/* Bottom sentinel: invisible unless a fetch is in flight. Its mere
          presence in the viewport (via the observer above) is the trigger —
          no button, no "+N more" label. */}
      {hidden > 0 && (
        <div ref={sentinelRef} className="h-6 flex items-center justify-center">
          {isLoadingThis && <Loader2 className="h-3 w-3 animate-spin text-gray-300" />}
        </div>
      )}
    </div>
  );
}

export default function WeeklyView({
  currentWeek,
  setCurrentWeek,
  weekData,
  onLoadMoreDay,
  loadingMoreDay,
  getPatient,
}) {
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              Weekly Calendar — {format(currentWeek, "dd MMM")} –{" "}
              {format(addDays(currentWeek, 6), "dd MMM yyyy")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))
                }
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="grid grid-cols-7 border-b">
            {Array.from({ length: 7 }).map((_, i) => {
              const day = addDays(currentWeek, i);
              const isCurrentDay = isToday(day);
              return (
                <div
                  key={i}
                  className={`p-3 text-center border-r last:border-r-0 ${isCurrentDay ? "bg-blue-50" : ""}`}
                >
                  <div
                    className={`text-xs font-semibold uppercase ${isCurrentDay ? "text-blue-600" : "text-gray-500"}`}
                  >
                    {format(day, "EEE")}
                  </div>
                  <div
                    className={`text-2xl font-bold mt-1 ${isCurrentDay ? "text-blue-600" : "text-gray-800"}`}
                  >
                    {format(day, "d")}
                  </div>
                  <div className="text-xs text-gray-400">{format(day, "MMM")}</div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-7 min-h-[400px]">
            {Array.from({ length: 7 }).map((_, i) => {
              const day = addDays(currentWeek, i);
              const { rows: dayAppointments, total } =
                weekData[format(day, "yyyy-MM-dd")] || emptyDay;
              return (
                <DayColumn
                  key={i}
                  day={day}
                  dayAppointments={dayAppointments}
                  total={total}
                  isCurrentDay={isToday(day)}
                  getPatient={getPatient}
                  onLoadMoreDay={onLoadMoreDay}
                  loadingMoreDay={loadingMoreDay}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-4">
        {Array.from({ length: 7 }).map((_, i) => {
          const day = addDays(currentWeek, i);
          const count = (weekData[format(day, "yyyy-MM-dd")] || emptyDay).total;
          return (
            <div
              key={i}
              className={`rounded-lg border p-3 text-center ${isToday(day) ? "border-blue-400 bg-blue-50" : "bg-white"}`}
            >
              <div className="text-sm font-medium text-gray-600">
                {format(day, "EEEE")}
              </div>
              <div className="text-2xl font-bold text-blue-600">{count}</div>
              <div className="text-xs text-gray-400">appointments</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
