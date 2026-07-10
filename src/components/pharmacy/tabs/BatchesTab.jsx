// Pharmacy → Batches tab. Paginated batch table with add/edit/delete actions
// and expiry status badges. State + handlers come from PharmacyModule.
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { emptyBatch, PHARMACY_BATCHES_PER_PAGE } from "../pharmacyConstants";
import { Pagination } from "@/components/common/Pagination";

// `batches` is ONE server-fetched page. It used to be the whole table, which this
// tab sliced client-side via `batchesPage` — a prop that no longer exists, so the
// slice ran on NaN bounds and silently rendered an empty table.
export default function BatchesTab({
  batches = [],
  loading,
  page,
  setPage,
  totalPages,
  setBatchForm,
  setEditingBatchId,
  setShowBatchDialog,
  setSelectedBatch,
  setShowDeleteBatchConfirm,
}) {
  return (
    <TabsContent value="batches" className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setBatchForm(emptyBatch);
            setEditingBatchId(null);
            setShowBatchDialog(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Batch
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Drug</TableHead>
                <TableHead>Batch #</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-400">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-gray-400"
                  >
                    No batches
                  </TableCell>
                </TableRow>
              ) : (() => {
                return batches.map((b) => {
                  const dl = Math.ceil(
                    (new Date(b.expiryDate) - new Date()) / 86400000,
                  );
                  return (
                    <TableRow key={b.id}>
                      <TableCell>{b.drug?.drugName || "—"}</TableCell>
                      <TableCell className="font-mono">
                        {b.batchNumber}
                      </TableCell>
                      <TableCell>{b.quantityReceived}</TableCell>
                      <TableCell>{b.quantityRemaining}</TableCell>
                      <TableCell>
                        {format(new Date(b.expiryDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>{b.supplierName || "—"}</TableCell>
                      <TableCell>
                        {dl < 0 ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : dl <= 30 ? (
                          <Badge className="bg-red-100 text-red-800">
                            {dl}d left
                          </Badge>
                        ) : dl <= 90 ? (
                          <Badge className="bg-yellow-100 text-yellow-800">
                            {dl}d left
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-800">
                            Active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setBatchForm({
                                drugId: b.drugId,
                                drugName: b.drug?.drugName || "",
                                batchNumber: b.batchNumber,
                                expiryDate: b.expiryDate
                                  ? new Date(b.expiryDate)
                                      .toISOString()
                                      .split("T")[0]
                                  : "",
                                manufactureDate: b.manufactureDate
                                  ? new Date(b.manufactureDate)
                                      .toISOString()
                                      .split("T")[0]
                                  : "",
                                quantityReceived: b.quantityReceived,
                                costPricePerUnit: b.costPricePerUnit || 0,
                                supplierName: b.supplierName || "",
                                supplierInvoice: b.supplierInvoice || "",
                                purchaseOrderNumber:
                                  b.purchaseOrderNumber || "",
                              });
                              setEditingBatchId(b.id);
                              setShowBatchDialog(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500"
                            onClick={() => {
                              setSelectedBatch(b);
                              setShowDeleteBatchConfirm(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                });
              })()}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </CardContent>
      </Card>
    </TabsContent>
  );
}
