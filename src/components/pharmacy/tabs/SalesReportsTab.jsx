// Pharmacy → Sales & Reports tab. SERVER-side paginated: `sales` is the current
// page (period filter applied in the DB). `salesCount` / `salesTotal` come from
// a DB aggregate over the WHOLE period, so the summary is correct at any scale.
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { statusBadge } from "../pharmacyHelpers";
import { Pagination } from "@/components/common/Pagination";

function itemCount(s) {
  try {
    const items = typeof s.items === "string" ? JSON.parse(s.items) : s.items || [];
    return items.length;
  } catch {
    return 0;
  }
}

export default function SalesReportsTab({
  salesPeriod,
  setSalesPeriod,
  sales,        // current page only (server-paged)
  loading,
  page,
  setPage,
  totalPages,
  salesCount,   // total rows across the period (DB count)
  salesTotal,   // total revenue across the period (DB sum)
  refresh,
}) {
  return (
    <TabsContent value="sales" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Select value={salesPeriod} onValueChange={setSalesPeriod}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
          {salesCount > 0 && (
            <span className="text-sm text-gray-600">
              <span className="font-semibold">{salesCount}</span> sales ·{" "}
              <span className="font-semibold text-green-700">₹{salesTotal.toLocaleString()}</span>
            </span>
          )}
        </div>
        <Button variant="outline" onClick={refresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt #</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : sales.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-gray-400"
                  >
                    No sales records
                  </TableCell>
                </TableRow>
              ) : (
                sales.map((s) => {
                  const name = s.patient
                    ? `${s.patient.firstName} ${s.patient.lastName || ""}`.trim()
                    : "Walk-in";
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">
                        {s.receiptNumber}
                      </TableCell>
                      <TableCell>{name}</TableCell>
                      <TableCell>
                        {itemCount(s)} item(s)
                      </TableCell>
                      <TableCell className="font-semibold">
                        ₹{(s.totalAmount || 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="capitalize">
                        {s.paymentMethod || "—"}
                      </TableCell>
                      <TableCell>{statusBadge(s.paymentStatus)}</TableCell>
                      <TableCell>
                        {s.saleDate
                          ? format(
                              new Date(s.saleDate),
                              "dd MMM yyyy HH:mm",
                            )
                          : s.createdAt
                            ? format(
                                new Date(s.createdAt),
                                "dd MMM yyyy HH:mm",
                              )
                            : "—"}
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
