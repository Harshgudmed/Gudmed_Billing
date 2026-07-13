import { useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  Users,
  Clock,
  CheckCircle,
  Phone,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/common/Pagination";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useDateFilter } from "@/components/common/DateFilter";
import { useDebounce } from "@/lib/useDebounce";
import { useServerPagination } from "@/lib/useServerPagination";
import client from "@/api/client";
import AppointmentsModule from "@/components/appointments/AppointmentsModule";
import BillingModule from "@/components/billing/BillingModule";

const PRIORITY_COLORS = {
  urgent: "bg-red-500 text-white",
  high: "bg-red-100 text-red-800",
  medium: "bg-yellow-100 text-yellow-800",
  normal: "bg-blue-100 text-blue-800",
  low: "bg-green-100 text-green-800",
};

// Ordered most-urgent first — mirrors the backend rank in lib/queuePriority.js.
const PRIORITY_LEVELS = ["urgent", "high", "medium", "normal", "low"];

// Single-button priority control: each click escalates to the next-more-urgent
// level, wrapping from urgent back to low. Unknown values start from normal.
function nextPriority(current) {
  const idx = PRIORITY_LEVELS.indexOf(current);
  const start = idx === -1 ? PRIORITY_LEVELS.indexOf("normal") : idx;
  return PRIORITY_LEVELS[
    (start - 1 + PRIORITY_LEVELS.length) % PRIORITY_LEVELS.length
  ];
}

const QUEUE_STATUS_COLORS = {
  waiting: "bg-yellow-100 text-yellow-800",
  called: "bg-blue-100 text-blue-800",
  in_progress: "bg-orange-100 text-orange-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
  no_show: "bg-gray-100 text-gray-800",
};

// Tiles double as status filters — clicking "Waiting: 5" lists those 5 patients.
const STAT_TILES = [
  { status: "waiting", label: "Waiting", color: "text-yellow-600" },
  { status: "called", label: "Called", color: "text-blue-600" },
  { status: "in_progress", label: "In Progress", color: "text-orange-600" },
  { status: "completed", label: "Completed", color: "text-green-600" },
];

const QUEUE_PER_PAGE = 10;

function fmtWait(minutes) {
  if (minutes == null) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const TODAY_LABEL = new Date().toLocaleDateString("en-IN", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export default function QueueModule() {
  const [activeTab, setActiveTab] = useState("queue");
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const debouncedSearch = useDebounce(search, 300);
  const dateFilter = useDateFilter("today");

  const queuePage = useServerPagination("/triage", {
    perPage: QUEUE_PER_PAGE,
    params: {
      search: debouncedSearch,
      status: statusFilter,
      startDate: dateFilter.range.startDate,
      endDate: dateFilter.range.endDate,
    },
  });
  const { rows: queue, loading, summary, refresh } = queuePage;

  const setStatus = async (entry, status, successMessage) => {
    setUpdatingId(`${entry.id}_${status}`);
    try {
      const res = await client.patch(`/triage/${entry.id}`, { status });
      if (res.success) {
        toast.success(successMessage);
        refresh();
      } else {
        toast.error(res.error || "Failed to update patient");
      }
    } catch (err) {
      toast.error(err.message || "Failed to update patient");
    } finally {
      setUpdatingId(null);
    }
  };

  // Changing priority re-ranks the row on the server; refresh() re-reads the
  // now-reordered queue (a higher priority floats the patient up).
  const changePriority = async (entry, priority) => {
    if (priority === entry.priority) return;
    setUpdatingId(`${entry.id}_priority`);
    try {
      const res = await client.patch(`/triage/${entry.id}`, { priority });
      if (res.success) {
        toast.success(`Priority set to ${priority}`);
        refresh();
      } else {
        toast.error(res.error || "Failed to change priority");
      }
    } catch (err) {
      toast.error(err.message || "Failed to change priority");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-7 w-7 text-blue-600" />
            Smart Queue Management
          </h1>
          <p className="text-gray-500">{TODAY_LABEL}</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw
            className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        {/* ── Queue Tab ── */}
        <TabsContent value="queue" className="space-y-4">
          {/* Stats row — each tile filters the table below */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {STAT_TILES.map((tile) => {
              const selected = statusFilter === tile.status;
              return (
                <Card
                  key={tile.status}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() =>
                    setStatusFilter(selected ? "all" : tile.status)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setStatusFilter(selected ? "all" : tile.status);
                    }
                  }}
                  className={`cursor-pointer transition-shadow hover:shadow-md ${selected ? "ring-2 ring-blue-500" : ""}`}
                >
                  <CardContent className="pt-4">
                    <p className="text-xs text-gray-500">{tile.label}</p>
                    <p className={`text-2xl font-bold ${tile.color}`}>
                      {summary?.[tile.status] ?? 0}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                className="pl-8"
                placeholder="Search by patient name, UHID or queue number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {dateFilter.control}
            {statusFilter !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500"
                onClick={() => setStatusFilter("all")}
              >
                Clear status
              </Button>
            )}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>UHID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Wait Time</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-10 text-gray-400"
                      >
                        <RefreshCw className="h-5 w-5 animate-spin inline mr-2" />
                        Loading queue...
                      </TableCell>
                    </TableRow>
                  ) : queue.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-10 text-gray-400"
                      >
                        <Clock className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                        <p>No patients in queue</p>
                        <p className="text-xs mt-1">
                          Queue entries from triage will appear here
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    queue.map((entry, idx) => {
                      const patientName = entry.patient
                        ? `${entry.patient.firstName || ""} ${entry.patient.lastName || ""}`.trim() ||
                          "—"
                        : "—";
                      const status = entry.status || "waiting";
                      const priority = entry.priority || "normal";
                      const isCompleted = ["completed", "cancelled"].includes(
                        status,
                      );
                      const rowNumber =
                        (queuePage.page - 1) * QUEUE_PER_PAGE + idx + 1;

                      return (
                        <TableRow
                          key={entry.id}
                          className={isCompleted ? "opacity-50" : ""}
                        >
                          <TableCell className="font-bold text-gray-500">
                            {rowNumber}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{patientName}</div>
                            {entry.patient?.phonePrimary && (
                              <div className="text-xs text-gray-400">
                                {entry.patient.phonePrimary}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {entry.patient?.mrn || "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              status={status}
                              map={QUEUE_STATUS_COLORS}
                            />
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-gray-400" />
                              {fmtWait(entry.waitTime)}
                            </div>
                          </TableCell>
                          <TableCell>
                            {isCompleted ? (
                              <StatusBadge
                                status={priority}
                                map={PRIORITY_COLORS}
                              />
                            ) : (
                              <button
                                type="button"
                                disabled={updatingId === `${entry.id}_priority`}
                                onClick={() =>
                                  changePriority(entry, nextPriority(priority))
                                }
                                title="Click to change priority"
                                className={`px-3 py-1 rounded text-xs font-semibold capitalize transition-opacity hover:opacity-80 disabled:opacity-50 ${PRIORITY_COLORS[priority] || "bg-gray-100 text-gray-800"}`}
                              >
                                {priority}
                              </button>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {!isCompleted && status !== "called" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={updatingId === `${entry.id}_called`}
                                  onClick={() =>
                                    setStatus(
                                      entry,
                                      "called",
                                      `Called: ${patientName}`,
                                    )
                                  }
                                >
                                  <Phone className="h-3.5 w-3.5 mr-1" />
                                  Call
                                </Button>
                              )}
                              {!isCompleted && (
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                  disabled={
                                    updatingId === `${entry.id}_completed`
                                  }
                                  onClick={() =>
                                    setStatus(
                                      entry,
                                      "completed",
                                      "Marked as completed",
                                    )
                                  }
                                >
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                  Complete
                                </Button>
                              )}
                              {isCompleted && (
                                <span className="text-xs text-gray-400 italic">
                                  Done
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <Pagination
                page={queuePage.page}
                totalPages={queuePage.totalPages}
                onPageChange={queuePage.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Appointments Tab ── */}
        <TabsContent value="appointments">
          <AppointmentsModule />
        </TabsContent>

        {/* ── Billing Tab ── */}
        <TabsContent value="billing">
          <BillingModule />
        </TabsContent>
      </Tabs>
    </div>
  );
}
