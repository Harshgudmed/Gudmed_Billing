import { Card, CardContent } from "@/components/ui/card";
import { drName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarDays,
  Plus,
  Search,
  MoreVertical,
  Edit,
  CheckCircle,
  Bell,
  UserCheck,
  Play,
  RefreshCcw,
  XCircle,
  AlertCircle,
  Printer,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { getPatientFullName } from "./appointmentHelpers";
import {
  STATUS_CONFIG,
  APPOINTMENTS_LIST_PER_PAGE,
} from "./appointmentConstants";
import { StatusBadge, TypeBadge } from "./AppointmentBadges";

export default function AppointmentsListView({
  searchQuery,
  setSearchQuery,
  selectedDate,
  setSelectedDate,
  statusFilter,
  setStatusFilter,
  departmentFilter,
  setDepartmentFilter,
  doctorFilter,
  setDoctorFilter,
  uniqueDepartments,
  filterDoctors,
  filteredAppointments,
  total,
  getPatient,
  selectedAppointmentIds,
  toggleAppointmentSelection,
  toggleAllAppointments,
  clearSelection,
  onBulkStatusUpdate,
  appointmentsListPage,
  setAppointmentsListPage,
  onScheduleNew,
  onEdit,
  onConfirm,
  onCheckIn,
  onStartConsultation,
  onComplete,
  onNoShow,
  onSendReminder,
  onReschedule,
  onCancelAppointment,
  onPrint,
}) {
  // `filteredAppointments` is already the current server-fetched page (sorted by
  // the backend); `total` is the full match count used for pagination.
  const totalPages = Math.ceil(total / APPOINTMENTS_LIST_PER_PAGE);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by patient, doctor, UHID..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Input
              type="date"
              className="w-[180px]"
              value={format(selectedDate, "yyyy-MM-dd")}
              onChange={(e) =>
                e.target.value && setSelectedDate(new Date(e.target.value))
              }
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([key, value]) => (
                  <SelectItem key={key} value={key}>
                    {value.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {uniqueDepartments.map((department) => (
                  <SelectItem key={department.id} value={department.name}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={doctorFilter} onValueChange={setDoctorFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Doctors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Doctors</SelectItem>
                {filterDoctors.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {drName(doctor.fullName)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {total === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CalendarDays className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No appointments found</p>
              <Button variant="outline" className="mt-4" onClick={onScheduleNew}>
                <Plus className="h-4 w-4 mr-2" />
                Schedule Appointment
              </Button>
            </div>
          ) : (
            <>
              {selectedAppointmentIds.size > 0 && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 border-b border-blue-200">
                  <span className="text-sm font-medium text-blue-700">
                    {selectedAppointmentIds.size} selected
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onBulkStatusUpdate("confirmed")}
                  >
                    Confirm All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onBulkStatusUpdate("cancelled")}
                  >
                    Cancel All
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onBulkStatusUpdate("no_show")}
                  >
                    No-Show All
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>
                    Clear
                  </Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          selectedAppointmentIds.size ===
                            filteredAppointments.length &&
                          filteredAppointments.length > 0
                        }
                        onCheckedChange={toggleAllAppointments}
                      />
                    </TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Chief Complaint</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAppointments.map((appointment) => {
                    const patient = appointment.patient || getPatient(appointment.patientId);
                    const doctor = appointment.doctor;
                    return (
                      <TableRow
                        key={appointment.id}
                        className={
                          selectedAppointmentIds.has(appointment.id)
                            ? "bg-blue-50"
                            : ""
                        }
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedAppointmentIds.has(appointment.id)}
                            onCheckedChange={() =>
                              toggleAppointmentSelection(appointment.id)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-mono font-medium">
                            {appointment.appointmentTime}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-blue-100 text-blue-700">
                                {patient?.firstName?.[0]}
                                {patient?.lastName?.[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">
                                {getPatientFullName(patient || null)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {patient?.mrn}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {doctor?.fullName ? drName(doctor.fullName) : "Unassigned"}
                          </div>
                          <div className="text-xs text-gray-500">
                            {doctor?.specialization}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div
                            className="max-w-[200px] truncate"
                            title={appointment.chiefComplaint || ""}
                          >
                            {appointment.chiefComplaint || "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={appointment.appointmentType} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={appointment.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onEdit(appointment)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {appointment.status === "scheduled" && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => onConfirm(appointment)}
                                  >
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    Confirm
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => onSendReminder(appointment)}
                                  >
                                    <Bell className="mr-2 h-4 w-4" />
                                    Send Reminder
                                  </DropdownMenuItem>
                                </>
                              )}
                              {(appointment.status === "scheduled" ||
                                appointment.status === "confirmed") && (
                                <DropdownMenuItem
                                  onClick={() => onCheckIn(appointment)}
                                >
                                  <UserCheck className="mr-2 h-4 w-4" />
                                  Check In
                                </DropdownMenuItem>
                              )}
                              {(appointment.status === "scheduled" ||
                                appointment.status === "confirmed" ||
                                appointment.status === "checked_in") && (
                                <DropdownMenuItem
                                  onClick={() => onStartConsultation(appointment)}
                                >
                                  <Play className="mr-2 h-4 w-4" />
                                  Start Consultation
                                </DropdownMenuItem>
                              )}
                              {appointment.status === "in_progress" && (
                                <DropdownMenuItem
                                  onClick={() => onComplete(appointment)}
                                >
                                  <CheckCircle className="mr-2 h-4 w-4" />
                                  Complete
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {(appointment.status === "scheduled" ||
                                appointment.status === "confirmed") && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => onReschedule(appointment)}
                                  >
                                    <RefreshCcw className="mr-2 h-4 w-4" />
                                    Reschedule
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    onClick={() => onCancelAppointment(appointment)}
                                  >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    Cancel
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-amber-600"
                                    onClick={() => onNoShow(appointment)}
                                  >
                                    <AlertCircle className="mr-2 h-4 w-4" />
                                    Mark No-Show
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onPrint(appointment)}>
                                <Printer className="mr-2 h-4 w-4" />
                                Print Appointment Card
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {total > APPOINTMENTS_LIST_PER_PAGE && (
                <div className="flex items-center justify-end gap-2 p-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setAppointmentsListPage((prev) => Math.max(1, prev - 1))
                    }
                    disabled={appointmentsListPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-gray-600">
                    Page {appointmentsListPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setAppointmentsListPage((prev) =>
                        Math.min(totalPages, prev + 1),
                      )
                    }
                    disabled={appointmentsListPage === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
