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
import { RefreshCw, Loader2, Printer } from "lucide-react";
import { format } from "date-fns";
import { statusBadge } from "../pharmacyHelpers";
import { Pagination } from "@/components/common/Pagination";
import { formatMoney } from "@/lib/format";
import { printPharmacyReceipt } from "@/components/billing/utils/printBilling";

function printSale(sale, orgInfo) {
  let clinic = {};
  try { clinic = JSON.parse(localStorage.getItem("gudmed-clinic-profile") || "{}"); } catch { clinic = {}; }
  printPharmacyReceipt(sale, orgInfo, clinic);
}

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
  orgInfo,
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
              <span className="font-semibold text-green-700">{formatMoney(salesTotal)}</span>
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
                <TableHead className="text-right">Bill</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : sales.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
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
                        {formatMoney(s.totalAmount)}
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
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => printSale(s, orgInfo)}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
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
