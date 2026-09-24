// Pharmacy → Prescriptions tab. SERVER-side paginated: `prescriptions` is just
// the current page (status filter applied in the DB). State + handlers come
// from PharmacyModule.
import { TabsContent } from "@/components/ui/tabs";
import { drName } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CheckCircle, Printer, Loader2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { FilterBar, FilterSelect } from "@/components/common/FilterBar";
import { statusBadge } from "../pharmacyHelpers";

const RX_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "fully_dispensed", label: "Dispensed" },
  { value: "partially_dispensed", label: "Partial" },
  { value: "cancelled", label: "Cancelled" },
];
import { Pagination } from "@/components/common/Pagination";
import { getFullName } from "@/lib/patient";

export default function PrescriptionsTab({
  prescriptionFilter,
  setPrescriptionFilter,
  prescriptions,   // current page only (server-paged)
  loading,
  page,
  setPage,
  totalPages,
  openDispenseDialog,
  handlePrintLabel,
  search = "",     // searched on the server: patient name / UHID / phone, doctor
  setSearch,
  onCancel,        // close a pending prescription the patient did not collect here
}) {
  return (
    <TabsContent value="prescriptions" className="space-y-4">
      {/* The shared filter row (components/common/FilterBar). */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search patient, UHID, phone or doctor..."
        active={!!search || prescriptionFilter !== "all"}
        onClear={() => { setSearch(""); setPrescriptionFilter("all") }}
      >
        <FilterSelect
          value={prescriptionFilter}
          onChange={setPrescriptionFilter}
          className="w-52"
          options={RX_STATUS_OPTIONS}
        />
      </FilterBar>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>UHID</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-[#2E4168] mx-auto" />
                  </TableCell>
                </TableRow>
              ) : prescriptions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-gray-400"
                  >
                    {search.trim() ? "No prescriptions match your search" : "No prescriptions"}
                  </TableCell>
                </TableRow>
              ) : (
                prescriptions.map((rx) => {
                  let items = [];
                  try {
                    items =
                      typeof rx.items === "string"
                        ? JSON.parse(rx.items)
                        : rx.items || [];
                  } catch {
                    items = [];
                  }
                  const name = rx.patient
                    ? getFullName(rx.patient)
                    : "Unknown";
                  return (
                    <TableRow key={rx.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="font-mono">
                        {rx.patient?.mrn || "—"}
                      </TableCell>
                      <TableCell>{rx.doctor?.fullName ? drName(rx.doctor.fullName) : "—"}</TableCell>
                      <TableCell>
                        {rx.prescriptionDate
                          ? format(
                              new Date(rx.prescriptionDate),
                              "dd MMM yyyy",
                            )
                          : "—"}
                      </TableCell>
                      <TableCell>{items.length} item(s)</TableCell>
                      <TableCell>{statusBadge(rx.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {rx.status === "pending" && (
                            <Button
                              size="sm"
                              onClick={() => openDispenseDialog(rx)}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Dispense
                            </Button>
                          )}
                          {rx.status === "pending" && onCancel && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="The patient did not take this medicine here"
                              onClick={() => onCancel(rx)}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Print label"
                            onClick={() => handlePrintLabel(rx)}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </CardContent>
      </Card>
    </TabsContent>
  );
}
