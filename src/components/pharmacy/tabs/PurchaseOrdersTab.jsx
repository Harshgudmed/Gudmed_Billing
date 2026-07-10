// Pharmacy → Purchase Orders tab. Status filter + paginated PO table with
// view/submit/approve/receive/cancel actions. State + handlers from PharmacyModule.
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Eye, XCircle } from "lucide-react";
import { format } from "date-fns";
import { statusBadge } from "../pharmacyHelpers";
import { Pagination } from "@/components/common/Pagination";
import { formatMoney } from "@/lib/format";

export default function PurchaseOrdersTab({
  poStatusFilter,
  setPoStatusFilter,
  purchaseOrders,
  loading,
  page,
  setPage,
  totalPages,
  setPoForm,
  setPoItems,
  setShowPoDialog,
  setViewingPo,
  setShowPoViewDialog,
  handleUpdatePO,
  openReceivePO,
}) {
  // The server returns exactly one page of rows (useServerPagination), so this
  // renders them as-is — slicing here would drop rows from every page but the first.
  const rows = purchaseOrders || [];
  return (
    <TabsContent value="purchase-orders" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Select value={poStatusFilter} onValueChange={setPoStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() => {
            setPoForm({
              supplierName: "",
              supplierContact: "",
              expectedDeliveryDate: "",
              notes: "",
            });
            setPoItems([]);
            setShowPoDialog(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          New PO
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-gray-400"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-gray-400"
                  >
                    No purchase orders
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono">
                      {po.poNumber}
                    </TableCell>
                    <TableCell>{po.supplierName}</TableCell>
                    <TableCell>
                      {po.orderDate
                        ? format(new Date(po.orderDate), "dd MMM yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {po.expectedDeliveryDate
                        ? format(
                            new Date(po.expectedDeliveryDate),
                            "dd MMM yyyy",
                          )
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {formatMoney(po.totalAmount)}
                    </TableCell>
                    <TableCell>{statusBadge(po.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setViewingPo(po);
                            setShowPoViewDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {po.status === "draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleUpdatePO(po.id, "submitted")
                            }
                          >
                            Submit
                          </Button>
                        )}
                        {po.status === "submitted" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleUpdatePO(po.id, "approved")
                            }
                          >
                            Approve
                          </Button>
                        )}
                        {po.status === "approved" && (
                          <Button
                            size="sm"
                            onClick={() => openReceivePO(po)}
                          >
                            Receive
                          </Button>
                        )}
                        {(po.status === "draft" ||
                          po.status === "submitted") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500"
                            onClick={() =>
                              handleUpdatePO(po.id, "cancelled")
                            }
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </TabsContent>
  );
}
