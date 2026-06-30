// Pharmacy → Drug Inventory tab. SERVER-SIDE paginated: `drugs` is just the
// current page (fetched from the backend with search/category applied in the
// DB), so this scales to hundreds of thousands of drugs. State + handlers come
// from PharmacyModule.
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Edit, Trash2, Package, Eye, Loader2 } from "lucide-react";
import { DRUG_CATEGORIES } from "../pharmacyConstants";
import { stockBadge } from "../pharmacyHelpers";
import { Pagination } from "@/components/common/Pagination";

export default function InventoryTab({
  searchQuery,
  setSearchQuery,
  categoryFilter,
  setCategoryFilter,
  drugs,        // current page only (server-paged)
  loading,
  page,
  setPage,
  totalPages,
  total,
  setViewingDrug,
  setShowViewDrugDialog,
  setDrugForm,
  setEditingDrugId,
  setShowDrugDialog,
  setSelectedDrug,
  setStockAdjust,
  setShowStockDialog,
  setDeleteConfirm,
}) {
  return (
    <TabsContent value="inventory" className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search drugs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {DRUG_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Drug Name</TableHead>
                <TableHead>Generic</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Form / Strength</TableHead>
                <TableHead>MRP (₹)</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : drugs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-gray-400"
                  >
                    No drugs found
                  </TableCell>
                </TableRow>
              ) : (
                drugs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.drugName}
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {d.genericName || "—"}
                    </TableCell>
                    <TableCell>{d.drugCategory || "—"}</TableCell>
                    <TableCell>
                      {d.dosageForm} {d.strength}
                    </TableCell>
                    <TableCell>
                      ₹{(d.sellingPrice || 0).toFixed(2)}
                    </TableCell>
                    <TableCell>{d.quantityInStock || 0}</TableCell>
                    <TableCell>{stockBadge(d)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="View"
                          onClick={() => {
                            setViewingDrug(d);
                            setShowViewDrugDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Edit"
                          onClick={() => {
                            setDrugForm({
                              name: d.drugName,
                              saltName: d.genericName || "",
                              companyName: d.brandName || "",
                              category: d.drugCategory || "",
                              form: d.dosageForm || "",
                              strength: d.strength || "",
                              mrp: d.sellingPrice || 0,
                              rate: d.costPrice || 0,
                              discountPercentage: d.markupPercentage || 0,
                              scheme: "",
                              scheduleType: "none",
                              initialQty: 0,
                              minStock: d.reorderLevel || 10,
                              batchNumber: "",
                              expiryDate: "",
                              manufacturingDate: "",
                              barcode: d.drugCode || "",
                            });
                            setEditingDrugId(d.id);
                            setShowDrugDialog(true);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Adjust Stock"
                          onClick={() => {
                            setSelectedDrug(d);
                            setStockAdjust({ type: "add", amount: 0 });
                            setShowStockDialog(true);
                          }}
                        >
                          <Package className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500"
                          onClick={() => setDeleteConfirm(d)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
