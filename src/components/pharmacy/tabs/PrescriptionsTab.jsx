// Pharmacy → Prescriptions tab. SERVER-side paginated: `prescriptions` is just
// the current page (status filter applied in the DB). State + handlers come
// from PharmacyModule.
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle, Printer, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { statusBadge } from "../pharmacyHelpers";
import { Pagination } from "@/components/common/Pagination";

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
}) {
  return (
    <TabsContent value="prescriptions" className="space-y-4">
      <Select
        value={prescriptionFilter}
        onValueChange={setPrescriptionFilter}
      >
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="fully_dispensed">Dispensed</SelectItem>
          <SelectItem value="partially_dispensed">Partial</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>
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
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : prescriptions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-gray-400"
                  >
                    No prescriptions
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
                    ? `${rx.patient.firstName} ${rx.patient.lastName || ""}`.trim()
                    : "Unknown";
                  return (
                    <TableRow key={rx.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="font-mono">
                        {rx.patient?.mrn || "—"}
                      </TableCell>
                      <TableCell>{rx.doctor?.fullName || "—"}</TableCell>
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
