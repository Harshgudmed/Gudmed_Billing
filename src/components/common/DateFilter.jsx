import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

// Reusable date-range filter shared across modules (Consultations, Patients,
// Pre-Triage, …). Usage:
//
//   const dateFilter = useDateFilter()
//   ...render: {dateFilter.control}
//   ...filter: list.filter(x => dateFilter.matches(x.createdAt))
//
// Modes: all | today | week (Mon–Sun) | month | specific | custom (from/to).
export function matchesDateRange(dateValue, { mode, specificDate, customStart, customEnd }) {
  if (mode === "all" || !dateValue) return true;
  const d = new Date(dateValue);
  if (isNaN(d)) return true;
  const now = new Date();

  if (mode === "today") return d.toDateString() === now.toDateString();
  if (mode === "week") {
    const start = new Date(now);
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    start.setDate(now.getDate() - dow);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return d >= start && d < end;
  }
  if (mode === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (mode === "specific") return !specificDate || d.toDateString() === new Date(specificDate + "T00:00:00").toDateString();
  if (mode === "custom") {
    let ok = true;
    if (customStart) ok = ok && d >= new Date(customStart + "T00:00:00");
    if (customEnd) ok = ok && d <= new Date(customEnd + "T23:59:59");
    return ok;
  }
  return true;
}

const toYMD = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

// Compute { startDate, endDate } (YYYY-MM-DD) for server-side filtering.
export function dateRangeFor({ mode, specificDate, customStart, customEnd }) {
  const now = new Date();
  if (mode === "all") return { startDate: "", endDate: "" };
  if (mode === "today") return { startDate: toYMD(now), endDate: toYMD(now) };
  if (mode === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // Sunday
    return { startDate: toYMD(start), endDate: toYMD(end) };
  }
  if (mode === "month") {
    return { startDate: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: toYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }
  // A half-filled range is not a filter yet. Picking "Specific Date" or "Custom
  // Range" switches the mode BEFORE any date is typed, and typing the start date
  // lands a render before the end date exists — so returning the partial values
  // sent the server two throwaway queries per use, one of them an open-ended
  // range over the whole Patient table. Hold the previous (unfiltered) result
  // until the user has actually finished choosing.
  if (mode === "specific") {
    return specificDate ? { startDate: specificDate, endDate: specificDate } : { startDate: "", endDate: "" };
  }
  if (mode === "custom") {
    return customStart && customEnd ? { startDate: customStart, endDate: customEnd } : { startDate: "", endDate: "" };
  }
  return { startDate: "", endDate: "" };
}

/**
 * @param initialMode  which range to start on ("all", "today", …)
 * @param showClear    whether this control renders its OWN Clear button.
 *
 * Billing sets it false because that screen has four filters and offers one
 * "Clear all" that resets every one of them. With both rendered the toolbar
 * showed "Clear" and "Clear all" side by side — two buttons a step apart, one
 * of which silently does less than the other. A user who presses the wrong one
 * thinks the list is unfiltered when the search box is still narrowing it.
 *
 * Defaults to true, so the modules with a date filter and nothing else keep the
 * button that is their only way to reset it.
 */
export function useDateFilter(initialMode = "all", { showClear = true } = {}) {
  const [mode, setMode] = useState(initialMode);
  const [specificDate, setSpecificDate] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const matches = useCallback(
    (dateValue) => matchesDateRange(dateValue, { mode, specificDate, customStart, customEnd }),
    [mode, specificDate, customStart, customEnd]
  );

  const range = dateRangeFor({ mode, specificDate, customStart, customEnd });

  const active = mode !== "all";
  const reset = () => {
    setMode("all");
    setSpecificDate("");
    setCustomStart("");
    setCustomEnd("");
  };

  // A stable string so callers can reset their pagination on any change.
  const key = `${mode}|${specificDate}|${customStart}|${customEnd}`;

  const control = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={mode} onValueChange={setMode}>
        <SelectTrigger className="w-40"><SelectValue placeholder="Date" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Dates</SelectItem>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="week">This Week</SelectItem>
          <SelectItem value="month">This Month</SelectItem>
          <SelectItem value="specific">Specific Date</SelectItem>
          <SelectItem value="custom">Custom Range</SelectItem>
        </SelectContent>
      </Select>

      {mode === "specific" && (
        <Input type="date" className="w-44" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
      )}

      {mode === "custom" && (
        <>
          <Input type="date" className="w-44" value={customStart} max={customEnd || undefined} onChange={(e) => setCustomStart(e.target.value)} />
          <span className="text-gray-400 text-sm">to</span>
          <Input type="date" className="w-44" value={customEnd} min={customStart || undefined} onChange={(e) => setCustomEnd(e.target.value)} />
        </>
      )}

      {active && showClear && (
        <Button variant="ghost" size="sm" className="text-gray-500" onClick={reset}>
          <X className="h-4 w-4 mr-1" />Clear
        </Button>
      )}
    </div>
  );

  return { mode, matches, active, reset, control, key, range };
}
