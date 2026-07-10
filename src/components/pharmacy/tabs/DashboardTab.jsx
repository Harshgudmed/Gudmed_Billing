// Pharmacy → Dashboard tab. Display-only: shows KPI cards, stock overview,
// pending prescriptions, low-stock drugs and expiring batches.
// All data + actions are passed in as props from PharmacyModule (no local state).
import { TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Package } from "lucide-react";
import { format } from "date-fns";
import { stockBadge } from "../pharmacyHelpers";
import { formatMoney } from "@/lib/format";
import { Pagination } from "@/components/common/Pagination";

// The list props default to [] on purpose. `stats` arrives one render AFTER the
// first paint, and every KPI below reads `stats?.x ?? someList.length` — so an
// undefined list crashed the whole page on mount ("Cannot read properties of
// undefined (reading 'length')") until stats resolved.
export default function DashboardTab({
  stats,
  drugs = [],
  prescriptions = [],
  expiringBatches = [],
  totalStockValue,
  todaySalesTotal,
  inStockCount,
  lowStockCount,
  outStockCount,
  pendingRx = [],
  lowStockDrugs = [],
  lowStockPage,
  setLowStockPage,
  setActiveTab,
  openDispenseDialog,
  setSelectedDrug,
  setStockAdjust,
  setShowStockDialog,
}) {
  return (
    <TabsContent value="dashboard" className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          {
            label: "Total Drugs",
            value: stats?.totalDrugs ?? drugs.length,
            color: "text-blue-600",
          },
          {
            label: "Low Stock",
            value: stats?.lowStock ?? drugs.filter(
              (d) =>
                (d.quantityInStock || 0) > 0 &&
                (d.quantityInStock || 0) < (d.reorderLevel || 10),
            ).length,
            color: "text-yellow-600",
          },
          {
            label: "Out of Stock",
            value: stats?.outOfStock ?? drugs.filter((d) => (d.quantityInStock || 0) === 0)
              .length,
            color: "text-red-600",
          },
          {
            label: "Pending Rx",
            value: stats?.pendingPrescriptions ?? prescriptions.filter((p) => p.status === "pending")
              .length,
            color: "text-purple-600",
          },
          {
            label: "Expiring (90d)",
            value: expiringBatches.length,
            color: "text-orange-600",
          },
          // {
          //   label: "Stock Value",
          //   value: `₹${totalStockValue.toLocaleString()}`,
          //   color: "text-green-600",
          // },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <p className="text-xs text-gray-500 font-medium">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* ── Stock Overview + Pending Prescriptions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Stock Overview */}
        <Card>
          <CardHeader><CardTitle className="text-base">Stock Overview</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Total Stock Value</span>
              <span className="font-bold text-green-700 text-lg">{formatMoney(totalStockValue)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Today's Sales</span>
              <span className="font-bold text-gray-800">{formatMoney(todaySalesTotal)}</span>
            </div>
            <div className="pt-2 border-t">
              <p className="text-sm font-semibold mb-2">Stock Status Distribution</p>
              <div className="flex items-center gap-5 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block" />
                  In Stock: <strong>{inStockCount}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500 inline-block" />
                  Low: <strong>{lowStockCount}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block" />
                  Out: <strong>{outStockCount}</strong>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pending Prescriptions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pending Prescriptions</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setActiveTab("prescriptions")}>
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {pendingRx.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No pending prescriptions</p>
            ) : (
              <div className="space-y-2">
                {pendingRx.slice(0, 5).map(rx => {
                  let items = [];
                  try { items = typeof rx.items === "string" ? JSON.parse(rx.items) : (rx.items || []) } catch { items = [] }
                  const name = rx.patient ? `${rx.patient.firstName} ${rx.patient.lastName || ""}`.trim() : "Unknown";
                  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                  const time = rx.prescriptionDate ? format(new Date(rx.prescriptionDate), "HH:mm") : "—";
                  return (
                    <div key={rx.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="h-9 w-9 rounded-full bg-gray-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{name}</p>
                        <p className="text-xs text-gray-500">{items.length} item{items.length !== 1 ? "s" : ""} · {time}</p>
                      </div>
                      <Button size="sm" onClick={() => openDispenseDialog(rx)}>
                        Dispense
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Low Stock Drugs ── */}
      {lowStockDrugs.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-yellow-700 flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5" /> Low Stock Drugs
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setActiveTab("inventory")}>
                Manage Inventory
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drug Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>Min. Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const ITEMS_PER_PAGE = 10
                  const startIdx = (lowStockPage - 1) * ITEMS_PER_PAGE
                  const endIdx = startIdx + ITEMS_PER_PAGE
                  const paginatedLowStock = lowStockDrugs.slice(startIdx, endIdx)
                  return paginatedLowStock.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.drugName}</TableCell>
                      <TableCell>{d.drugCategory || "—"}</TableCell>
                      <TableCell className={`font-semibold ${(d.quantityInStock || 0) === 0 ? "text-red-600" : "text-yellow-600"}`}>
                        {d.quantityInStock || 0}
                      </TableCell>
                      <TableCell>{d.reorderLevel || 10}</TableCell>
                      <TableCell>{stockBadge(d)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => { setSelectedDrug(d); setStockAdjust({ type: "add", amount: 0 }); setShowStockDialog(true); }}
                        >
                          <Package className="h-3 w-3 mr-1" /> Restock
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                })()}
              </TableBody>
            </Table>
            <Pagination
              page={lowStockPage}
              totalPages={Math.ceil(lowStockDrugs.length / 10)}
              onPageChange={setLowStockPage}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Expiring Batches ── */}
      {expiringBatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-orange-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Expiring Batches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drug</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Days Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiringBatches.slice(0, 10).map((b) => {
                  const dl = Math.ceil(
                    (new Date(b.expiryDate) - new Date()) / 86400000,
                  );
                  return (
                    <TableRow key={b.id}>
                      <TableCell>{b.drug?.drugName || "—"}</TableCell>
                      <TableCell className="font-mono">
                        {b.batchNumber}
                      </TableCell>
                      <TableCell>{b.quantityRemaining}</TableCell>
                      <TableCell>
                        {format(new Date(b.expiryDate), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            dl <= 30
                              ? "bg-red-100 text-red-800"
                              : "bg-yellow-100 text-yellow-800"
                          }
                        >
                          {dl}d
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}
