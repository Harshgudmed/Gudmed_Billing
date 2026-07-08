import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useOrgSettings } from '@/lib/useOrgSettings'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { format, addDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
const BarcodeScanner = lazy(() => import("./BarcodeScanner"));
import {
  Pill,
  Search,
  Plus,
  Edit,
  Trash2,
  AlertTriangle,
  ShoppingCart,
  CheckCircle,
  XCircle,
  RefreshCw,
  Printer,
  Package,
  Eye,
  FileText,
  Loader2,
  Download,
  Upload,
} from "lucide-react";
import ImportMedicinesDialog from "./ImportMedicinesDialog";
import MedicineNameAutocomplete from "./MedicineNameAutocomplete";
import { printPharmacyReceipt } from "@/components/billing/utils/printBilling";
import PatientLookup from "@/components/common/PatientLookup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import client from "@/api/client";
import { drName } from "@/lib/utils";
import {
  DRUG_CATEGORIES,
  DRUG_FORMS,
  SCHEDULE_TYPES,
  DRUGS_PER_PAGE,
  PHARMACY_BATCHES_PER_PAGE,
  PHARMACY_PO_PER_PAGE,
  PHARMACY_SALES_PER_PAGE,
  emptyDrug,
  emptyBatch,
  checkDrugInteractions,
  printViaIframe,
} from "./pharmacyConstants";
import { stockBadge, statusBadge } from "./pharmacyHelpers";
import DashboardTab from "./tabs/DashboardTab";
import InventoryTab from "./tabs/InventoryTab";
import PrescriptionsTab from "./tabs/PrescriptionsTab";
import BatchesTab from "./tabs/BatchesTab";
import PurchaseOrdersTab from "./tabs/PurchaseOrdersTab";
import SalesReportsTab from "./tabs/SalesReportsTab";

export default function PharmacyModule() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [drugs, setDrugs] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [batches, setBatches] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  // Drug inventory is SERVER-paged (scales to lakhs of drugs): the DB applies
  // search/category + slices the page; the browser only holds one page.
  const debouncedDrugSearch = useDebounce(searchQuery, 300);
  const drugPage = useServerPagination("/pharmacy/drugs", {
    perPage: DRUGS_PER_PAGE,
    params: { search: debouncedDrugSearch, category: categoryFilter },
  });
  const [lowStockPage, setLowStockPage] = useState(1);
  const [batchesPage, setBatchesPage] = useState(1);
  const [poPage, setPoPage] = useState(1);
  const [prescriptionFilter, setPrescriptionFilter] = useState("all");
  const [poStatusFilter, setPoStatusFilter] = useState("all");
  const [salesPeriod, setSalesPeriod] = useState("month"); // today | week | month | all

  // Prescriptions are SERVER-paged (status filter applied in the DB).
  const rxPage = useServerPagination("/pharmacy/prescriptions", {
    perPage: DRUGS_PER_PAGE,
    params: { status: prescriptionFilter === "all" ? "" : prescriptionFilter },
  });

  // Sales are SERVER-paged with the period as a date filter; `summary` carries
  // the period's true revenue (summed in the DB across every matching row).
  const saleStartDate = useMemo(() => {
    if (salesPeriod === "all") return "";
    const d =
      salesPeriod === "today" ? startOfDay(new Date())
      : salesPeriod === "week" ? startOfWeek(new Date(), { weekStartsOn: 1 })
      : startOfMonth(new Date());
    return format(d, "yyyy-MM-dd");
  }, [salesPeriod]);
  const salePage = useServerPagination("/pharmacy/sales", {
    perPage: PHARMACY_SALES_PER_PAGE,
    params: { startDate: saleStartDate },
  });

  // Dashboard KPI counts come from a DB-computed stats endpoint, so they're
  // correct even with hundreds of thousands of drugs/sales.
  const [stats, setStats] = useState(null);
  const fetchStats = useCallback(async () => {
    try {
      const res = await client.get("/pharmacy/stats");
      if (res.success) setStats(res.data);
    } catch { /* ignore */ }
  }, []);

  // Drug dialog
  const [showDrugDialog, setShowDrugDialog] = useState(false);
  const [drugForm, setDrugForm] = useState(emptyDrug);
  const [editingDrugId, setEditingDrugId] = useState(null);
  const [savingDrug, setSavingDrug] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanLooking, setScanLooking] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Fill the drug form from an open-catalog medicine pick. Composition/company/
  // price come straight from the dataset; strength + dosage form are inferred.
  const applyReferenceMedicine = useCallback((row) => {
    const composition = row.composition || "";
    // First strength token in the composition, e.g. "Paracetamol (500mg)" -> 500mg
    const strengthMatch = composition.match(/(\d+(?:\.\d+)?\s?(?:mg\/ml|mcg|mg|ml|iu|%[\s\w/]*|g))/i);
    // Infer dosage form from the pack label (e.g. "strip of 10 tablets")
    const pack = (row.packSize || "").toLowerCase();
    const FORMS = ["tablet", "capsule", "syrup", "injection", "cream", "gel", "drop", "ointment", "solution", "suspension", "powder", "lotion", "spray", "inhaler", "sachet"];
    const formHit = FORMS.find((f) => pack.includes(f));
    setDrugForm((p) => ({
      ...p,
      name: row.name ?? p.name,
      saltName: composition || p.saltName,
      companyName: row.manufacturer ?? p.companyName,
      mrp: row.price ?? p.mrp,
      strength: strengthMatch ? strengthMatch[1].replace(/\s+/g, "") : p.strength,
      form: formHit ? formHit.charAt(0).toUpperCase() + formHit.slice(1) : p.form,
    }));
    toast.success(`Filled "${row.name}" from catalog — set price/stock & save`);
  }, []);

  // Resolve a scanned/typed barcode against the medicine master and auto-fill
  // the form. A miss is not an error — it's the "new medicine" path.
  const handleBarcodeLookup = useCallback(async (code) => {
    const barcode = String(code || "").trim();
    if (!barcode) return;
    setDrugForm((p) => ({ ...p, barcode }));
    setScanLooking(true);
    try {
      const res = await client.get(
        `/pharmacy/drugs/lookup?barcode=${encodeURIComponent(barcode)}`
      );
      if (res?.found && res.data) {
        const d = res.data;
        const batch = d.batches?.[0];
        const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "");
        setDrugForm((p) => ({
          ...p,
          barcode,
          name: d.drugName ?? p.name,
          saltName: d.genericName ?? p.saltName,
          companyName: d.brandName ?? p.companyName,
          category: d.drugCategory ?? p.category,
          form: d.dosageForm ?? p.form,
          strength: d.strength ?? p.strength,
          mrp: d.mrp ?? d.sellingPrice ?? p.mrp,
          rate: d.purchasePrice ?? d.costPrice ?? p.rate,
          minStock: d.reorderLevel ?? p.minStock,
          batchNumber: batch?.batchNumber ?? p.batchNumber,
          expiryDate: batch?.expiryDate ? toDateInput(batch.expiryDate) : p.expiryDate,
          manufacturingDate: batch?.manufactureDate
            ? toDateInput(batch.manufactureDate)
            : p.manufacturingDate,
        }));
        if (res.source === "external") {
          toast.success(
            `Fetched "${d.drugName}" online — complete strength/price/stock, then save`
          );
        } else {
          toast.success(`Found "${d.drugName}" — verify the details and save`);
        }
      } else {
        toast.info("Not found online — fill the details once; future scans auto-fill");
      }
    } catch (err) {
      toast.error(err?.message || "Barcode lookup failed");
    } finally {
      setScanLooking(false);
    }
  }, []);

  // View drug dialog
  const [showViewDrugDialog, setShowViewDrugDialog] = useState(false);
  const [viewingDrug, setViewingDrug] = useState(null);

  // Stock adjust dialog
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState(null);
  const [stockAdjust, setStockAdjust] = useState({ type: "add", amount: 0 });

  // Dispense dialog
  const [showDispenseDialog, setShowDispenseDialog] = useState(false);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [dispensing, setDispensing] = useState(false);
  const [dispenseWarnings, setDispenseWarnings] = useState([]);

  // Batch dialog
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [batchForm, setBatchForm] = useState(emptyBatch);
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [savingBatch, setSavingBatch] = useState(false);
  const [showDeleteBatchConfirm, setShowDeleteBatchConfirm] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);

  // PO dialog
  const [showPoDialog, setShowPoDialog] = useState(false);
  const [poForm, setPoForm] = useState({
    supplierName: "",
    supplierContact: "",
    expectedDeliveryDate: "",
    notes: "",
  });
  const [poItems, setPoItems] = useState([]);
  const [savingPo, setSavingPo] = useState(false);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [selectedPo, setSelectedPo] = useState(null);
  const [receiveItems, setReceiveItems] = useState([]);
  const [receivingPo, setReceivingPo] = useState(false);
  const [showPoViewDialog, setShowPoViewDialog] = useState(false);
  const [viewingPo, setViewingPo] = useState(null);

  // Sale dialog
  const [showSaleDialog, setShowSaleDialog] = useState(false);
  const [saleItems, setSaleItems] = useState([{ drugId: "", quantity: 1 }]);
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [savingSale, setSavingSale] = useState(false);
  const [salePatient, setSalePatient] = useState(null); // selected via shared PatientLookup
  const [saleReferenceDoctor, setSaleReferenceDoctor] = useState("");
  // Split payment across methods (Cash + UPI, etc.). Empty = single-method sale.
  const [splitPayment, setSplitPayment] = useState(false);
  const [salePayments, setSalePayments] = useState([{ paymentMethod: "cash", amount: "" }]);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, pRes, bRes, poRes] = await Promise.all([
        client.get("/pharmacy/drugs?limit=100"),
        client.get("/pharmacy/prescriptions?limit=100"),
        client.get("/pharmacy/batches?limit=100"),
        client.get("/pharmacy/purchase-orders?limit=100"),
      ]);
      if (dRes.success) setDrugs(dRes.data || []);
      if (pRes.success) setPrescriptions(pRes.data || []);
      if (bRes.success) setBatches(bRes.data || []);
      if (poRes.success) setPurchaseOrders(poRes.data || []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    fetchStats(); // DB-computed dashboard KPIs (correct at any scale)
  }, [fetchAll, fetchStats]);
  const { orgInfo: hookOrgInfo } = useOrgSettings()
  useEffect(() => { setOrgInfo(hookOrgInfo) }, [hookOrgInfo])

  // ── Drug CRUD ──────────────────────────────────────────────────────────────

  const handleSaveDrug = async () => {
    if (
      !drugForm.name ||
      !drugForm.category ||
      !drugForm.form ||
      !drugForm.strength
    ) {
      toast.error("Fill all required fields");
      return;
    }
    setSavingDrug(true);
    try {
      const payload = {
        drugName: drugForm.name,
        genericName: drugForm.saltName || undefined,
        brandName: drugForm.companyName || undefined,
        drugCategory: drugForm.category,
        dosageForm: drugForm.form,
        strength: drugForm.strength,
        sellingPrice: parseFloat(drugForm.mrp) || 0,
        mrp: parseFloat(drugForm.mrp) || undefined,
        costPrice: parseFloat(drugForm.rate) || 0,
        purchasePrice: parseFloat(drugForm.rate) || undefined,
        markupPercentage: parseFloat(drugForm.discountPercentage) || 0,
        reorderLevel: parseInt(drugForm.minStock) || 10,
        barcode: drugForm.barcode?.trim() || undefined,
        drugCode: editingDrugId ? undefined : `DRG${Date.now()}`,
        quantityInStock: editingDrugId
          ? undefined
          : parseInt(drugForm.initialQty) || 0,
        requiresPrescription: drugForm.scheduleType !== "none",
        description:
          [
            drugForm.scheduleType !== "none"
              ? `SCH:${drugForm.scheduleType}`
              : "",
            drugForm.scheme ? `Scheme: ${drugForm.scheme}` : "",
          ]
            .filter(Boolean)
            .join(" | ") || undefined,
      };
      const res = editingDrugId
        ? await client.patch(`/pharmacy/drugs/${editingDrugId}`, payload)
        : await client.post("/pharmacy/drugs", payload);
      if (res.success) {
        if (
          !editingDrugId &&
          drugForm.batchNumber &&
          drugForm.expiryDate &&
          parseInt(drugForm.initialQty) > 0
        ) {
          await client.post("/pharmacy/batches", {
            drugId: res.data.id,
            batchNumber: drugForm.batchNumber,
            expiryDate: drugForm.expiryDate,
            manufactureDate: drugForm.manufacturingDate || undefined,
            quantityReceived: parseInt(drugForm.initialQty),
            costPricePerUnit: parseFloat(drugForm.rate) || 0,
          });
        }
        toast.success(editingDrugId ? "Drug updated" : "Drug added");
        setShowDrugDialog(false);
        setDrugForm(emptyDrug);
        setEditingDrugId(null);
        fetchAll();
        drugPage.refresh();
      } else toast.error(res.error || "Failed to save");
    } catch {
      toast.error("Failed to save drug");
    }
    setSavingDrug(false);
  };

  const handleDeleteDrug = async (drug) => {
    try {
      const res = await client.delete(`/pharmacy/drugs/${drug.id}`);
      if (res.success) {
        toast.success("Drug deleted");
        setDeleteConfirm(null);
        fetchAll();
        drugPage.refresh();
      } else toast.error(res.error || "Failed to delete");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const onAdjustStock = async () => {
    if (!selectedDrug) return;
    const current = selectedDrug.quantityInStock || 0;
    const newStock =
      stockAdjust.type === "add"
        ? current + (parseInt(stockAdjust.amount) || 0)
        : Math.max(0, current - (parseInt(stockAdjust.amount) || 0));
    try {
      const res = await client.patch(`/pharmacy/drugs/${selectedDrug.id}`, {
        quantityInStock: newStock,
      });
      if (res.success) {
        toast.success(
          `Stock updated: ${selectedDrug.drugName} → ${newStock} units`,
        );
        setShowStockDialog(false);
        setSelectedDrug(null);
        setStockAdjust({ type: "add", amount: 0 });
        fetchAll();
        drugPage.refresh();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to adjust stock");
    }
  };

  // ── Dispense ───────────────────────────────────────────────────────────────

  const openDispenseDialog = async (rx) => {
    let items = [];
    try {
      items =
        typeof rx.items === "string" ? JSON.parse(rx.items) : rx.items || [];
    } catch {
      items = [];
    }
    setSelectedPrescription({
      ...rx,
      items: items.map((i) => ({ ...i, dispensed: false })),
    });
    const drugNames = items.map((i) => i.drugName || "");
    const interactions = checkDrugInteractions(drugNames);
    const allergyWarnings = [];
    try {
      const res = await client.get(`/patients?id=${rx.patientId}`);
      if (res.success && res.data) {
        let allergies = [];
        try {
          allergies =
            typeof res.data.allergies === "string"
              ? JSON.parse(res.data.allergies)
              : res.data.allergies || [];
        } catch {
          allergies = [];
        }
        for (const allergen of allergies) {
          const al = allergen.toLowerCase();
          for (const dn of drugNames) {
            if (dn.toLowerCase().includes(al) || al.includes(dn.toLowerCase()))
              allergyWarnings.push({
                severity: "high",
                message: `ALLERGY ALERT: Patient is allergic to "${allergen}" — conflicts with "${dn}". Do NOT dispense without physician override.`,
              });
          }
        }
      }
    } catch {
      /* non-blocking */
    }
    setDispenseWarnings([...allergyWarnings, ...interactions]);
    setShowDispenseDialog(true);
  };

  const toggleItemDispensed = (idx) => {
    if (!selectedPrescription) return;
    setSelectedPrescription((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === idx ? { ...item, dispensed: !item.dispensed } : item,
      ),
    }));
  };

  const handlePrintLabel = (rx) => {
    let items = [];
    try {
      items =
        typeof rx.items === "string" ? JSON.parse(rx.items) : rx.items || [];
    } catch {
      items = [];
    }
    const name = rx.patient
      ? `${rx.patient.firstName} ${rx.patient.lastName || ""}`.trim()
      : "Unknown";
    const today = format(new Date(), "dd MMM yyyy HH:mm");
    const totalCost = items.reduce(
      (s, i) => s + (i.unitPrice || 0) * i.quantity,
      0,
    );
    const rows = items
      .map(
        (i) =>
          `<tr><td>${i.drugName || "—"}</td><td>${i.dosage || "—"}</td><td>${i.quantity}</td><td>${i.duration || "—"}</td><td>₹${((i.unitPrice || 0) * i.quantity).toFixed(2)}</td></tr>`,
      )
      .join("");
    printViaIframe(`<!DOCTYPE html><html><head><title>Prescription Label</title>
<style>body{font-family:Arial,sans-serif;margin:20px;color:#000}h1{color:#1e3a5f;font-size:18px}table{width:100%;border-collapse:collapse}th{background:#1e3a5f;color:#fff;padding:6px}td{padding:5px 8px;border-bottom:1px solid #eee;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;background:#f8f9fa;padding:12px;border-radius:6px}.lbl{font-weight:bold;font-size:11px;color:#555}.val{font-size:13px}</style>
</head><body>
<h1>${orgInfo.name} — Pharmacy Label</h1>
<div class="grid">
<div><div class="lbl">Patient</div><div class="val">${name}</div></div>
<div><div class="lbl">UHID</div><div class="val">${rx.patient?.mrn || "—"}</div></div>
<div><div class="lbl">Doctor</div><div class="val">${rx.doctor?.fullName ? drName(rx.doctor.fullName) : "—"}</div></div>
<div><div class="lbl">Date</div><div class="val">${rx.prescriptionDate ? format(new Date(rx.prescriptionDate), "dd MMM yyyy") : "—"}</div></div>
<div><div class="lbl">Dispensed</div><div class="val">${today}</div></div>
<div><div class="lbl">Total</div><div class="val">₹${totalCost.toFixed(2)}</div></div>
</div>
<table><thead><tr><th>Drug</th><th>Dosage</th><th>Qty</th><th>Duration</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`);
  };

  // Bill + print + reset after a successful (full or partial) dispense.
  const afterDispense = async (rx) => {
    const items = rx.items || [];
    const totalCost = items.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0);
    if (rx.patientId && totalCost > 0) {
      try {
        await client.post("/billing", {
          resource: "invoice",
          patientId: rx.patientId,
          items: items.map((i) => ({
            type: "pharmacy",
            description: i.drugName,
            quantity: i.quantity,
            unitPrice: i.unitPrice || 0,
            discount: 0,
            tax: 0,
            total: (i.unitPrice || 0) * i.quantity,
          })),
        })
      } catch (err) {
        console.error('Failed to create billing invoice:', err)
        toast.error('Could not create invoice (but prescription was dispensed)')
      }
    }
    handlePrintLabel(rx);
    setShowDispenseDialog(false);
    setSelectedPrescription(null);
    setDispenseWarnings([]);
    fetchAll();
    rxPage.refresh();   // dispensed prescription left the pending list
    drugPage.refresh(); // stock decremented
    fetchStats();
  };

  // Stock-aware dispensing. The backend validates stock and decrements
  // inventory + batches + writes a ledger row. allowPartial=true dispenses
  // only what's in stock and marks the prescription partially_dispensed.
  const runDispense = async (allowPartial) => {
    if (!selectedPrescription) return;
    setDispensing(true);
    try {
      const res = await client.post(
        `/pharmacy/prescriptions/${selectedPrescription.id}/dispense`,
        { allowPartial },
      );
      toast.success(res.message || "Prescription dispensed");
      afterDispense(selectedPrescription);
    } catch (err) {
      if (err.code === "INSUFFICIENT_STOCK") {
        const shortages = err.details?.shortages || [];
        const summary = shortages
          .map((s) => `${s.drugName}: need ${s.requested}, have ${s.available}`)
          .join("\n");
        // Offer partial dispensing of whatever IS in stock.
        const ok = window.confirm(
          `Insufficient stock:\n\n${summary}\n\nDispense the available quantity now (partial)?`,
        );
        if (ok) {
          await runDispense(true);
          return;
        }
        toast.error("Dispensing blocked — insufficient stock");
      } else {
        toast.error(err.message || "Failed to complete dispensing");
      }
    } finally {
      setDispensing(false);
    }
  };

  const handleCompleteDispense = () => runDispense(false);

  // ── Batch CRUD ─────────────────────────────────────────────────────────────

  const handleSaveBatch = async () => {
    if (!batchForm.drugId || !batchForm.batchNumber || !batchForm.expiryDate) {
      toast.error("Fill required fields");
      return;
    }
    setSavingBatch(true);
    try {
      const payload = {
        ...batchForm,
        quantityReceived: parseInt(batchForm.quantityReceived) || 1,
        costPricePerUnit: parseFloat(batchForm.costPricePerUnit) || 0,
      };
      const res = editingBatchId
        ? await client.patch(`/pharmacy/batches/${editingBatchId}`, payload)
        : await client.post("/pharmacy/batches", payload);
      if (res.success) {
        toast.success(editingBatchId ? "Batch updated" : "Batch added");
        setShowBatchDialog(false);
        setBatchForm(emptyBatch);
        setEditingBatchId(null);
        fetchAll();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to save batch");
    }
    setSavingBatch(false);
  };

  const handleDeleteBatch = async () => {
    if (!selectedBatch) return;
    try {
      const res = await client.delete(`/pharmacy/batches/${selectedBatch.id}`);
      if (res.success) {
        toast.success("Batch removed");
        setShowDeleteBatchConfirm(false);
        setSelectedBatch(null);
        fetchAll();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to remove batch");
    }
  };

  // ── Purchase Orders ────────────────────────────────────────────────────────

  const handleSavePO = async () => {
    if (!poForm.supplierName || poItems.length === 0) {
      toast.error("Add supplier and items");
      return;
    }
    setSavingPo(true);
    try {
      const res = await client.post("/pharmacy/purchase-orders", {
        ...poForm,
        items: poItems,
      });
      if (res.success) {
        toast.success("Purchase order created");
        setShowPoDialog(false);
        setPoForm({
          supplierName: "",
          supplierContact: "",
          expectedDeliveryDate: "",
          notes: "",
        });
        setPoItems([]);
        fetchAll();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to create PO");
    }
    setSavingPo(false);
  };

  const handleUpdatePO = async (id, status) => {
    try {
      const res = await client.patch(`/pharmacy/purchase-orders/${id}`, {
        status,
      });
      if (res.success) {
        toast.success(`PO ${status}`);
        fetchAll();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed");
    }
  };

  const openReceivePO = (po) => {
    setSelectedPo(po);
    const items =
      typeof po.items === "string" ? JSON.parse(po.items) : po.items || [];
    setReceiveItems(
      items.map((i) => ({
        ...i,
        quantityReceived: i.quantityOrdered || i.quantity || 1,
        batchNumber: "",
        expiryDate: "",
        manufactureDate: "",
      })),
    );
    setShowReceiveDialog(true);
  };

  const handleReceivePO = async () => {
    setReceivingPo(true);
    try {
      const res = await client.patch(
        `/pharmacy/purchase-orders/${selectedPo.id}/receive`,
        { items: receiveItems },
      );
      if (res.success) {
        toast.success("PO received — batches created");
        setShowReceiveDialog(false);
        setSelectedPo(null);
        setReceiveItems([]);
        fetchAll();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to receive PO");
    }
    setReceivingPo(false);
  };

  // ── Direct Sale ────────────────────────────────────────────────────────────

  // Prints the SHARED GST-invoice-style pharmacy receipt (same format used by
  // PrescriptionPurchaseModal and the Sales & Reports tab) — uses the actual
  // created sale record (with server-enriched GST%/batch/expiry per item),
  // not a client-side guess, since only the backend knows which batch FIFO drew from.
  const handlePrintSaleReceipt = (sale, paymentMethod) => {
    let clinic = {}
    try { clinic = JSON.parse(localStorage.getItem('gudmed-clinic-profile') || '{}') } catch { clinic = {} }
    printPharmacyReceipt({ ...sale, paymentMethod }, orgInfo, clinic);
  };

  const handleSale = async () => {
    const valid = saleItems.filter((i) => i.drugId && i.quantity > 0);
    if (!valid.length) {
      toast.error("Add items");
      return;
    }
    setSavingSale(true);
    try {
      const items = valid.map((item) => {
        const drug = drugs.find((d) => d.id === item.drugId);
        return {
          drugId: item.drugId,
          drugName: drug?.drugName || "",
          quantity: item.quantity,
          unitPrice: drug?.sellingPrice || 0,
          total: (drug?.sellingPrice || 0) * item.quantity,
        };
      });
      const total = items.reduce((s, i) => s + i.total, 0);
      // When split-payment is on, send the per-method breakdown so the backend
      // stores a multi-payment ledger and the receipt prints a Payment table.
      const splits = splitPayment
        ? salePayments
            .map((p) => ({ paymentMethod: p.paymentMethod, amount: Number(p.amount) || 0 }))
            .filter((p) => p.amount > 0)
        : [];
      const res = await client.post("/pharmacy/sales", {
        items,
        customerName: customerName.trim() || undefined,
        paymentMethod,
        paymentStatus: "paid",
        // Real patient id from the shared PatientLookup → backend fills phone/mrn/uhid
        // from the patient record (single source of truth). Walk-in = no patient.
        patientId: salePatient?.id || undefined,
        phone: salePatient?.phonePrimary || undefined,
        uhid: salePatient?.mrn || undefined,
        referenceDoctor: saleReferenceDoctor.trim() || undefined,
        payments: splits.length ? splits : undefined,
      });
      if (res.success) {
        // Enrich the just-created sale with the selected patient's name/contact so
        // the receipt shows them immediately (the create response has patientId but
        // not the joined patient row).
        const printable = salePatient
          ? {
              ...res.data,
              patientName: `${salePatient.firstName || ""} ${salePatient.lastName || ""}`.trim(),
              phone: res.data.phone || salePatient.phonePrimary,
              uhid: res.data.uhid || salePatient.mrn,
              mrn: res.data.mrn || salePatient.mrn,
            }
          : res.data;
        handlePrintSaleReceipt(printable, paymentMethod);
        toast.success(`Sale completed — ₹${total.toFixed(2)}`);
        setShowSaleDialog(false);
        setSaleItems([{ drugId: "", quantity: 1 }]);
        setCustomerName("");
        setSalePatient(null);
        setSaleReferenceDoctor("");
        setSplitPayment(false);
        setSalePayments([{ paymentMethod: "cash", amount: "" }]);
        fetchAll();
        salePage.refresh(); // new sale appears in the list + period total
        drugPage.refresh(); // stock decremented
        fetchStats();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to record sale");
    }
    setSavingSale(false);
  };

  // Reset pagination when filters change. (Drug inventory, prescriptions and
  // sales reset themselves inside useServerPagination, so they aren't here.)
  useEffect(() => {
    setLowStockPage(1);
  }, [drugs]);

  useEffect(() => {
    setPoPage(1);
  }, [poStatusFilter]);

  // ── Derived values ─────────────────────────────────────────────────────────

  // Dashboard summary values all come from the DB stats endpoint, so they are
  // correct no matter how many drugs/batches exist (never derived from a capped
  // in-browser list). lowStockCount is the strictly-low (yellow) band.
  const expiringBatches = stats?.expiringBatches ?? [];
  const totalStockValue = stats?.stockValue ?? 0;
  const inStockCount  = stats?.inStock ?? 0;
  const lowStockCount = stats ? Math.max(0, stats.lowStock - stats.outOfStock) : 0;
  const outStockCount = stats?.outOfStock ?? 0;
  const lowStockDrugs = stats?.lowStockDrugs ?? [];
  const pendingRx     = prescriptions.filter(p => p.status === "pending");
  const todaySalesTotal = stats?.todaySalesTotal ?? 0;

  // Live pricing calc for drug form
  const mrp = parseFloat(drugForm.mrp) || 0;
  const rate = parseFloat(drugForm.rate) || 0;
  const discPct = parseFloat(drugForm.discountPercentage) || 0;
  const discAmt = mrp * (discPct / 100);
  const netRate = mrp - discAmt;
  const margin = rate > 0 ? (((mrp - rate) / mrp) * 100).toFixed(1) : "—";

  // Sale total
  const saleTotal = saleItems.reduce((s, i) => {
    const d = drugs.find((x) => x.id === i.drugId);
    return s + (d?.sellingPrice || 0) * (i.quantity || 1);
  }, 0);

  // Filtered purchase orders by status
  const filteredPOs = useMemo(
    () => poStatusFilter === "all" ? purchaseOrders : purchaseOrders.filter(po => po.status === poStatusFilter),
    [purchaseOrders, poStatusFilter],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Pill className="h-7 w-7 text-pink-600" />
            Pharmacy
          </h1>
          <p className="text-gray-500">
            Drug inventory, prescriptions &amp; dispensing
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAll}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => setShowSaleDialog(true)}>
            <ShoppingCart className="h-4 w-4 mr-1" />
            Direct Sale
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-1" />
            Import Excel/CSV
          </Button>
          <Button
            onClick={() => {
              setEditingDrugId(null);
              setDrugForm(emptyDrug);
              setShowDrugDialog(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Drug
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="inventory">Drug Inventory</TabsTrigger>
          <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
          <TabsTrigger value="batches">Batches</TabsTrigger>
          <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="sales">Sales & Reports</TabsTrigger>
        </TabsList>

        {/* ── DASHBOARD ── */}
        <DashboardTab
          stats={stats}
          drugs={drugs}
          prescriptions={prescriptions}
          expiringBatches={expiringBatches}
          totalStockValue={totalStockValue}
          todaySalesTotal={todaySalesTotal}
          inStockCount={inStockCount}
          lowStockCount={lowStockCount}
          outStockCount={outStockCount}
          pendingRx={pendingRx}
          lowStockDrugs={lowStockDrugs}
          lowStockPage={lowStockPage}
          setLowStockPage={setLowStockPage}
          setActiveTab={setActiveTab}
          openDispenseDialog={openDispenseDialog}
          setSelectedDrug={setSelectedDrug}
          setStockAdjust={setStockAdjust}
          setShowStockDialog={setShowStockDialog}
        />

        {/* ── INVENTORY ── */}
        <InventoryTab
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          drugs={drugPage.rows}
          loading={drugPage.loading}
          page={drugPage.page}
          setPage={drugPage.setPage}
          totalPages={drugPage.totalPages}
          total={drugPage.total}
          setViewingDrug={setViewingDrug}
          setShowViewDrugDialog={setShowViewDrugDialog}
          setDrugForm={setDrugForm}
          setEditingDrugId={setEditingDrugId}
          setShowDrugDialog={setShowDrugDialog}
          setSelectedDrug={setSelectedDrug}
          setStockAdjust={setStockAdjust}
          setShowStockDialog={setShowStockDialog}
          setDeleteConfirm={setDeleteConfirm}
        />

        {/* ── PRESCRIPTIONS ── */}
        <PrescriptionsTab
          prescriptionFilter={prescriptionFilter}
          setPrescriptionFilter={setPrescriptionFilter}
          prescriptions={rxPage.rows}
          loading={rxPage.loading}
          page={rxPage.page}
          setPage={rxPage.setPage}
          totalPages={rxPage.totalPages}
          openDispenseDialog={openDispenseDialog}
          handlePrintLabel={handlePrintLabel}
        />

        {/* ── BATCHES ── */}
        <BatchesTab
          batches={batches}
          batchesPage={batchesPage}
          setBatchesPage={setBatchesPage}
          setBatchForm={setBatchForm}
          setEditingBatchId={setEditingBatchId}
          setShowBatchDialog={setShowBatchDialog}
          setSelectedBatch={setSelectedBatch}
          setShowDeleteBatchConfirm={setShowDeleteBatchConfirm}
        />

        {/* ── PURCHASE ORDERS ── */}
        <PurchaseOrdersTab
          poStatusFilter={poStatusFilter}
          setPoStatusFilter={setPoStatusFilter}
          filteredPOs={filteredPOs}
          poPage={poPage}
          setPoPage={setPoPage}
          setPoForm={setPoForm}
          setPoItems={setPoItems}
          setShowPoDialog={setShowPoDialog}
          setViewingPo={setViewingPo}
          setShowPoViewDialog={setShowPoViewDialog}
          handleUpdatePO={handleUpdatePO}
          openReceivePO={openReceivePO}
        />

        {/* ── SALES ── */}
        <SalesReportsTab
          salesPeriod={salesPeriod}
          setSalesPeriod={setSalesPeriod}
          sales={salePage.rows}
          loading={salePage.loading}
          page={salePage.page}
          setPage={salePage.setPage}
          totalPages={salePage.totalPages}
          salesCount={salePage.total}
          salesTotal={salePage.summary?.totalAmount ?? 0}
          refresh={salePage.refresh}
          orgInfo={orgInfo}
        />
      </Tabs>

      {/* ── ADD/EDIT DRUG DIALOG ── */}
      <Dialog open={showDrugDialog} onOpenChange={setShowDrugDialog}>
        <DialogContent className="max-w-2xl flex flex-col p-0" style={{ maxHeight: "92vh" }}>
          {/* Header */}
          <div className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="text-lg font-bold">
              {editingDrugId ? "Edit Drug" : "Add New Drug"}
            </DialogTitle>
            <p className="text-sm text-gray-500 mt-0.5">
              Fill in drug details, pricing, scheme, and batch information
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5" style={{ minHeight: 0 }}>

            {/* ── DRUG IDENTITY ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-blue-500 rounded" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Drug Identity</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs font-medium">Medicine Name *</Label>
                  <MedicineNameAutocomplete
                    value={drugForm.name}
                    onChange={(v) => setDrugForm((p) => ({ ...p, name: v }))}
                    onSelect={applyReferenceMedicine}
                    placeholder="Type to search 2.5 lakh Indian medicines…"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Salt / Generic Name</Label>
                  <Input
                    className="mt-1"
                    value={drugForm.saltName}
                    onChange={(e) => setDrugForm((p) => ({ ...p, saltName: e.target.value }))}
                    placeholder="e.g. Paracetamol"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Company / Manufacturer</Label>
                  <Input
                    className="mt-1"
                    value={drugForm.companyName}
                    onChange={(e) => setDrugForm((p) => ({ ...p, companyName: e.target.value }))}
                    placeholder="e.g. Sun Pharma"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Category *</Label>
                  <Select value={drugForm.category} onValueChange={(v) => setDrugForm((p) => ({ ...p, category: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {DRUG_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Form *</Label>
                  <Select value={drugForm.form} onValueChange={(v) => setDrugForm((p) => ({ ...p, form: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select form" /></SelectTrigger>
                    <SelectContent>
                      {DRUG_FORMS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs font-medium">Strength *</Label>
                  <Input
                    className="mt-1"
                    value={drugForm.strength}
                    onChange={(e) => setDrugForm((p) => ({ ...p, strength: e.target.value }))}
                    placeholder="e.g. 500mg, 10mg/5ml"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs font-medium">Barcode</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      value={drugForm.barcode}
                      onChange={(e) => setDrugForm((p) => ({ ...p, barcode: e.target.value }))}
                      onKeyDown={(e) => {
                        // Enter triggers lookup — also how USB keyboard-wedge scanners submit.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleBarcodeLookup(drugForm.barcode);
                        }
                      }}
                      placeholder="Scan or type, then Enter to auto-fill"
                      disabled={scanLooking}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Scan with camera"
                      onClick={() => setShowScanner(true)}
                    >
                      <ScanLine className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── PRICING & SCHEME ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-green-500 rounded" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Pricing &amp; Scheme</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">MRP (₹) *</Label>
                  <Input className="mt-1" type="number" min={0} step="0.01" placeholder="0"
                    value={drugForm.mrp}
                    onChange={(e) => setDrugForm((p) => ({ ...p, mrp: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs font-medium">Purchase Rate (₹) *</Label>
                  <Input className="mt-1" type="number" min={0} step="0.01" placeholder="0"
                    value={drugForm.rate}
                    onChange={(e) => setDrugForm((p) => ({ ...p, rate: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs font-medium">Discount %</Label>
                  <Input className="mt-1" type="number" min={0} max={100} placeholder="0"
                    value={drugForm.discountPercentage}
                    onChange={(e) => setDrugForm((p) => ({ ...p, discountPercentage: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs font-medium">Scheme</Label>
                  <Input className="mt-1" placeholder="e.g. 10+1, 5+1 Free"
                    value={drugForm.scheme}
                    onChange={(e) => setDrugForm((p) => ({ ...p, scheme: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs font-medium">Min Stock</Label>
                  <Input className="mt-1" type="number" min={0} placeholder="0"
                    value={drugForm.minStock}
                    onChange={(e) => setDrugForm((p) => ({ ...p, minStock: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs font-medium">Schedule</Label>
                  <Select value={drugForm.scheduleType} onValueChange={(v) => setDrugForm((p) => ({ ...p, scheduleType: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_TYPES.map((s) => <SelectItem key={s} value={s}>{s === "none" ? "None (OTC)" : `Sch-${s}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(mrp > 0 || rate > 0) && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 grid grid-cols-4 gap-3 text-center text-sm">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase">MRP</p>
                    <p className="font-bold text-gray-800">₹{Number(mrp).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase">Discount</p>
                    <p className="font-bold text-red-600">–₹{discAmt.toFixed(2)} ({discPct}%)</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase">Net Rate</p>
                    <p className="font-bold text-green-700">₹{netRate.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase">Margin</p>
                    <p className="font-bold text-blue-700">{margin}%</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── BATCH INFORMATION ── */}
            {!editingDrugId && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 bg-orange-500 rounded" />
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Batch Information</span>
                  <span className="text-[11px] text-gray-400 normal-case font-normal">(Optional — adds opening stock)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">Batch Number</Label>
                    <Input className="mt-1" placeholder="e.g. BN2024001"
                      value={drugForm.batchNumber}
                      onChange={(e) => setDrugForm((p) => ({ ...p, batchNumber: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Opening Quantity</Label>
                    <Input className="mt-1" type="number" min={0} placeholder="0"
                      value={drugForm.initialQty}
                      onChange={(e) => setDrugForm((p) => ({ ...p, initialQty: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs font-medium">Expiry Date</Label>
                    <Input className="mt-1" type="date"
                      value={drugForm.expiryDate}
                      onChange={(e) => setDrugForm((p) => ({ ...p, expiryDate: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t shrink-0 flex justify-end gap-2 bg-gray-50">
            <Button variant="outline" onClick={() => setShowDrugDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveDrug} disabled={savingDrug}>
              {savingDrug ? "Saving..." : editingDrugId ? "Update" : "Add Drug"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Suspense fallback={null}>
        <BarcodeScanner
          open={showScanner}
          onClose={() => setShowScanner(false)}
          onScan={handleBarcodeLookup}
        />
      </Suspense>

      <ImportMedicinesDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={fetchAll}
      />

      {/* ── VIEW DRUG ── */}
      <Dialog open={showViewDrugDialog} onOpenChange={setShowViewDrugDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Drug Details</DialogTitle>
          </DialogHeader>
          {viewingDrug && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 bg-blue-50 p-3 rounded-lg">
                <div>
                  <p className="text-gray-500 font-medium">Drug Name</p>
                  <p className="font-semibold">{viewingDrug.drugName}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Generic</p>
                  <p>{viewingDrug.genericName || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Category</p>
                  <p>{viewingDrug.drugCategory || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Form / Strength</p>
                  <p>
                    {viewingDrug.dosageForm} {viewingDrug.strength}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">MRP</p>
                  <p className="font-bold text-green-700">
                    ₹{(viewingDrug.sellingPrice || 0).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Stock</p>
                  <p>{viewingDrug.quantityInStock || 0} units</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Min Stock</p>
                  <p>{viewingDrug.reorderLevel || 10}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Status</p>
                  {stockBadge(viewingDrug)}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowViewDrugDialog(false)}
            >
              Close
            </Button>
            {viewingDrug && (
              <Button
                onClick={() => {
                  setShowViewDrugDialog(false);
                  setDrugForm({
                    name: viewingDrug.drugName,
                    saltName: viewingDrug.genericName || "",
                    companyName: viewingDrug.brandName || "",
                    category: viewingDrug.drugCategory || "",
                    form: viewingDrug.dosageForm || "",
                    strength: viewingDrug.strength || "",
                    mrp: viewingDrug.sellingPrice || 0,
                    rate: viewingDrug.costPrice || 0,
                    discountPercentage: viewingDrug.markupPercentage || 0,
                    scheme: "",
                    scheduleType: "none",
                    initialQty: 0,
                    minStock: viewingDrug.reorderLevel || 10,
                    batchNumber: "",
                    expiryDate: "",
                    manufacturingDate: "",
                    barcode: viewingDrug.drugCode || "",
                  });
                  setEditingDrugId(viewingDrug.id);
                  setShowDrugDialog(true);
                }}
              >
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── STOCK ADJUST ── */}
      <Dialog open={showStockDialog} onOpenChange={setShowStockDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock — {selectedDrug?.drugName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-center bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Current Stock</p>
              <p className="text-3xl font-bold text-blue-600">
                {selectedDrug?.quantityInStock || 0}
              </p>
              <p className="text-xs text-gray-400">units</p>
            </div>
            <div>
              <Label>Adjustment Type</Label>
              <Select
                value={stockAdjust.type}
                onValueChange={(v) =>
                  setStockAdjust((p) => ({ ...p, type: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add Stock</SelectItem>
                  <SelectItem value="remove">Remove Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input
                type="number"
                min={0}
                value={stockAdjust.amount}
                onChange={(e) =>
                  setStockAdjust((p) => ({
                    ...p,
                    amount: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </div>
            {stockAdjust.amount > 0 && (
              <div className="text-center text-sm">
                <span className="text-gray-500">New Stock: </span>
                <span className="font-bold text-green-700">
                  {stockAdjust.type === "add"
                    ? (selectedDrug?.quantityInStock || 0) + stockAdjust.amount
                    : Math.max(
                        0,
                        (selectedDrug?.quantityInStock || 0) -
                          stockAdjust.amount,
                      )}{" "}
                  units
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStockDialog(false)}>
              Cancel
            </Button>
            <Button onClick={onAdjustStock} disabled={!stockAdjust.amount}>
              Update Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DISPENSE ── */}
      <Dialog open={showDispenseDialog} onOpenChange={setShowDispenseDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Dispense Prescription</DialogTitle>
          </DialogHeader>
          {selectedPrescription &&
            (() => {
              const items = selectedPrescription.items || [];
              const name = selectedPrescription.patient
                ? `${selectedPrescription.patient.firstName} ${selectedPrescription.patient.lastName || ""}`.trim()
                : "Unknown";
              return (
                <div className="space-y-3">
                  {dispenseWarnings.length > 0 && (
                    <div className="space-y-2">
                      {dispenseWarnings.map((w, i) => (
                        <div
                          key={i}
                          className={`flex gap-2 p-3 rounded-lg border text-sm ${w.severity === "high" ? "bg-red-50 border-red-200 text-red-800" : "bg-yellow-50 border-yellow-200 text-yellow-800"}`}
                        >
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          <p>{w.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">Patient: </span>
                      <span className="font-medium">{name}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">UHID: </span>
                      <span className="font-mono">
                        {selectedPrescription.patient?.mrn || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Doctor: </span>
                      <span>
                        {selectedPrescription.doctor?.fullName || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Date: </span>
                      <span>
                        {selectedPrescription.prescriptionDate
                          ? format(
                              new Date(selectedPrescription.prescriptionDate),
                              "dd MMM yyyy",
                            )
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Items</p>
                    <div className="space-y-1">
                      {items.map((item, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-3 p-2 rounded text-sm ${item.dispensed ? "bg-green-50" : "bg-gray-50"}`}
                        >
                          <Checkbox
                            checked={item.dispensed}
                            onCheckedChange={() => toggleItemDispensed(i)}
                          />
                          <span className="flex-1 font-medium">
                            {item.drugName || item.drugId}
                          </span>
                          <span className="text-gray-500">
                            Qty: {item.quantity}
                          </span>
                          {item.dosage && (
                            <span className="text-gray-400 text-xs">
                              {item.dosage}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDispenseDialog(false);
                setDispenseWarnings([]);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCompleteDispense} disabled={dispensing}>
              <CheckCircle className="h-4 w-4 mr-1" />
              {dispensing ? "Dispensing..." : "Mark Dispensed & Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ADD/EDIT BATCH ── */}
      <Dialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingBatchId ? "Edit Batch" : "Add Drug Batch"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Drug *</Label>
              <Select
                value={batchForm.drugId}
                onValueChange={(v) =>
                  setBatchForm((p) => ({ ...p, drugId: v }))
                }
                disabled={!!editingBatchId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select drug" />
                </SelectTrigger>
                <SelectContent>
                  {drugs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.drugName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Batch # *</Label>
                <Input
                  value={batchForm.batchNumber}
                  onChange={(e) =>
                    setBatchForm((p) => ({ ...p, batchNumber: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Qty Received *</Label>
                <Input
                  type="number"
                  min={1}
                  value={batchForm.quantityReceived}
                  onChange={(e) =>
                    setBatchForm((p) => ({
                      ...p,
                      quantityReceived: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Mfg Date</Label>
                <Input
                  type="date"
                  value={batchForm.manufactureDate}
                  onChange={(e) =>
                    setBatchForm((p) => ({
                      ...p,
                      manufactureDate: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Expiry Date *</Label>
                <Input
                  type="date"
                  value={batchForm.expiryDate}
                  onChange={(e) =>
                    setBatchForm((p) => ({ ...p, expiryDate: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label>Cost/Unit (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={batchForm.costPricePerUnit}
                  onChange={(e) =>
                    setBatchForm((p) => ({
                      ...p,
                      costPricePerUnit: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Supplier</Label>
                <Input
                  value={batchForm.supplierName}
                  onChange={(e) =>
                    setBatchForm((p) => ({
                      ...p,
                      supplierName: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>Invoice #</Label>
                <Input
                  value={batchForm.supplierInvoice}
                  onChange={(e) =>
                    setBatchForm((p) => ({
                      ...p,
                      supplierInvoice: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>PO Number</Label>
                <Input
                  value={batchForm.purchaseOrderNumber}
                  onChange={(e) =>
                    setBatchForm((p) => ({
                      ...p,
                      purchaseOrderNumber: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveBatch} disabled={savingBatch}>
              {savingBatch
                ? "Saving..."
                : editingBatchId
                  ? "Update"
                  : "Add Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE BATCH CONFIRM ── */}
      <Dialog
        open={showDeleteBatchConfirm}
        onOpenChange={setShowDeleteBatchConfirm}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Batch?</DialogTitle>
          </DialogHeader>
          <p className="text-gray-600">
            Remove batch <strong>{selectedBatch?.batchNumber}</strong>? Stock
            will be decremented by remaining quantity.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteBatchConfirm(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteBatch}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── NEW PO ── */}
      <Dialog open={showPoDialog} onOpenChange={setShowPoDialog}>
        <DialogContent className="max-w-2xl flex flex-col p-0" style={{ maxHeight: "92vh" }}>
          {/* Header */}
          <div className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="text-lg font-bold">Add Purchase Order</DialogTitle>
            <p className="text-sm text-gray-500 mt-0.5">Fill in supplier details, pricing, scheme, and drug items</p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5" style={{ minHeight: 0 }}>

            {/* ── SUPPLIER DETAILS ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-blue-500 rounded" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Supplier Details</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs font-medium">Supplier / Company Name *</Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g., Sun Pharma Distributors"
                    value={poForm.supplierName}
                    onChange={(e) => setPoForm((p) => ({ ...p, supplierName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Contact / Phone</Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g., 9876543210"
                    value={poForm.supplierContact}
                    onChange={(e) => setPoForm((p) => ({ ...p, supplierContact: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Email</Label>
                  <Input
                    className="mt-1"
                    type="email"
                    placeholder="supplier@example.com"
                    value={poForm.supplierEmail || ""}
                    onChange={(e) => setPoForm((p) => ({ ...p, supplierEmail: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* ── ORDER DETAILS ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-orange-500 rounded" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Order Details</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium">Expected Delivery Date</Label>
                  <Input
                    className="mt-1"
                    type="date"
                    value={poForm.expectedDeliveryDate}
                    onChange={(e) => setPoForm((p) => ({ ...p, expectedDeliveryDate: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Notes / Remarks</Label>
                  <Input
                    className="mt-1"
                    placeholder="Any special instructions..."
                    value={poForm.notes}
                    onChange={(e) => setPoForm((p) => ({ ...p, notes: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* ── DRUG ITEMS ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 bg-green-500 rounded" />
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Drug Items</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPoItems((p) => [
                      ...p,
                      {
                        drugId: "", drugName: "", saltName: "", companyName: "",
                        category: "", form: "", strength: "",
                        mrp: 0, rate: 0, discountPercentage: 0, scheme: "",
                        quantityOrdered: 1, quantityReceived: 0,
                        unitCost: 0, totalCost: 0,
                        batchNumber: "", expiryDate: "", manufactureDate: "",
                      },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Drug
                </Button>
              </div>

              {poItems.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-lg py-8 text-center text-gray-400 text-sm">
                  No drugs added. Click "Add Drug" to start.
                </div>
              ) : (
                <div className="space-y-3">
                  {poItems.map((item, idx) => {
                    const qty  = item.quantityOrdered || 1;
                    const rate = item.rate || item.unitCost || 0;
                    const disc = item.discountPercentage || 0;
                    const netRate  = rate - (rate * disc / 100);
                    const lineTotal = qty * netRate;

                    return (
                      <div key={idx} className="border rounded-lg p-3 bg-gray-50 space-y-3">
                        {/* Row header */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-500">Item #{idx + 1}</span>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:text-red-600"
                            onClick={() => setPoItems((p) => p.filter((_, i) => i !== idx))}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Drug Identity */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-3">
                            <Label className="text-[10px] font-medium text-gray-500">Medicine Name *</Label>
                            <Input
                              className="mt-0.5 h-8 text-sm"
                              placeholder="e.g., Paracetamol 500mg Tablet"
                              value={item.drugName}
                              onChange={(e) =>
                                setPoItems((p) => p.map((x, i) => i === idx ? { ...x, drugName: e.target.value } : x))
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] font-medium text-gray-500">Salt / Generic</Label>
                            <Input className="mt-0.5 h-8 text-sm" placeholder="e.g., Paracetamol"
                              value={item.saltName || ""}
                              onChange={(e) =>
                                setPoItems((p) => p.map((x, i) => i === idx ? { ...x, saltName: e.target.value } : x))
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] font-medium text-gray-500">Company / Brand</Label>
                            <Input className="mt-0.5 h-8 text-sm" placeholder="e.g., Sun Pharma"
                              value={item.companyName || ""}
                              onChange={(e) =>
                                setPoItems((p) => p.map((x, i) => i === idx ? { ...x, companyName: e.target.value } : x))
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] font-medium text-gray-500">Strength</Label>
                            <Input className="mt-0.5 h-8 text-sm" placeholder="e.g., 500mg"
                              value={item.strength || ""}
                              onChange={(e) =>
                                setPoItems((p) => p.map((x, i) => i === idx ? { ...x, strength: e.target.value } : x))
                              }
                            />
                          </div>
                        </div>

                        {/* Pricing */}
                        <div className="grid grid-cols-4 gap-2">
                          <div>
                            <Label className="text-[10px] font-medium text-gray-500">MRP (₹) *</Label>
                            <Input type="number" min={0} step="0.01" className="mt-0.5 h-8 text-sm"
                              placeholder="0"
                              value={item.mrp || ""}
                              onChange={(e) =>
                                setPoItems((p) => p.map((x, i) => i === idx ? { ...x, mrp: parseFloat(e.target.value) || 0 } : x))
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] font-medium text-gray-500">Purchase Rate (₹) *</Label>
                            <Input type="number" min={0} step="0.01" className="mt-0.5 h-8 text-sm"
                              placeholder="0"
                              value={item.rate || ""}
                              onChange={(e) => {
                                const r = parseFloat(e.target.value) || 0;
                                setPoItems((p) => p.map((x, i) => i === idx
                                  ? { ...x, rate: r, unitCost: r, totalCost: x.quantityOrdered * r }
                                  : x));
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] font-medium text-gray-500">Discount %</Label>
                            <Input type="number" min={0} max={100} className="mt-0.5 h-8 text-sm"
                              placeholder="0"
                              value={item.discountPercentage || ""}
                              onChange={(e) =>
                                setPoItems((p) => p.map((x, i) => i === idx ? { ...x, discountPercentage: parseFloat(e.target.value) || 0 } : x))
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] font-medium text-gray-500">Scheme</Label>
                            <Input className="mt-0.5 h-8 text-sm" placeholder="e.g., 10+1, 5+1 Free"
                              value={item.scheme || ""}
                              onChange={(e) =>
                                setPoItems((p) => p.map((x, i) => i === idx ? { ...x, scheme: e.target.value } : x))
                              }
                            />
                          </div>
                        </div>

                        {/* Qty + live total */}
                        <div className="flex items-end gap-3">
                          <div className="w-28">
                            <Label className="text-[10px] font-medium text-gray-500">Qty Ordered *</Label>
                            <Input type="number" min={1} className="mt-0.5 h-8 text-sm"
                              value={item.quantityOrdered}
                              onChange={(e) => {
                                const q = parseInt(e.target.value) || 1;
                                setPoItems((p) => p.map((x, i) => i === idx
                                  ? { ...x, quantityOrdered: q, totalCost: q * (x.rate || x.unitCost || 0) }
                                  : x));
                              }}
                            />
                          </div>
                          {(item.mrp > 0 || item.rate > 0) && (
                            <div className="flex-1 rounded border border-green-200 bg-green-50 px-3 py-1.5 grid grid-cols-3 gap-2 text-center">
                              <div>
                                <p className="text-[9px] text-gray-400 uppercase font-semibold">Net Rate</p>
                                <p className="text-xs font-bold text-green-700">₹{netRate.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-gray-400 uppercase font-semibold">Line Total</p>
                                <p className="text-xs font-bold text-gray-800">₹{lineTotal.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-gray-400 uppercase font-semibold">Disc</p>
                                <p className="text-xs font-bold text-red-600">{disc}%</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Grand total */}
              {poItems.length > 0 && (
                <div className="mt-3 flex justify-end">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-2 text-right">
                    <p className="text-[10px] text-gray-500 uppercase font-semibold">Grand Total</p>
                    <p className="text-lg font-bold text-blue-700">
                      ₹{poItems.reduce((s, i) => {
                        const r = i.rate || i.unitCost || 0;
                        const net = r - (r * (i.discountPercentage || 0) / 100);
                        return s + (i.quantityOrdered || 1) * net;
                      }, 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t shrink-0 flex justify-end gap-2 bg-gray-50">
            <Button variant="outline" onClick={() => setShowPoDialog(false)}>Cancel</Button>
            <Button onClick={handleSavePO} disabled={savingPo}>
              {savingPo ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : "Create Purchase Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── RECEIVE PO ── */}
      <Dialog open={showReceiveDialog} onOpenChange={setShowReceiveDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receive PO — {selectedPo?.poNumber}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 mb-3">
            Fill batch details to create inventory batches.
          </p>
          <div className="space-y-3">
            {receiveItems.map((item, idx) => (
              <div key={idx} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {item.drugName || `Item ${idx + 1}`}
                  </p>
                  <p className="text-sm text-gray-500">
                    Ordered: {item.quantityOrdered || item.quantity}
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <Label className="text-xs">Qty Received *</Label>
                    <Input
                      type="number"
                      min={0}
                      value={item.quantityReceived}
                      onChange={(e) =>
                        setReceiveItems((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  quantityReceived:
                                    parseInt(e.target.value) || 0,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Batch # *</Label>
                    <Input
                      value={item.batchNumber}
                      onChange={(e) =>
                        setReceiveItems((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? { ...x, batchNumber: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Expiry Date *</Label>
                    <Input
                      type="date"
                      value={item.expiryDate}
                      onChange={(e) =>
                        setReceiveItems((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? { ...x, expiryDate: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Mfg Date</Label>
                    <Input
                      type="date"
                      value={item.manufactureDate}
                      onChange={(e) =>
                        setReceiveItems((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? { ...x, manufactureDate: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
            {receiveItems.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                No items in this PO
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowReceiveDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleReceivePO} disabled={receivingPo}>
              {receivingPo
                ? "Receiving..."
                : "Confirm Receipt & Create Batches"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── VIEW PO ── */}
      <Dialog open={showPoViewDialog} onOpenChange={setShowPoViewDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Purchase Order — {viewingPo?.poNumber}</DialogTitle>
          </DialogHeader>
          {viewingPo &&
            (() => {
              const items =
                typeof viewingPo.items === "string"
                  ? JSON.parse(viewingPo.items)
                  : viewingPo.items || [];
              return (
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-lg">
                    <div>
                      <p className="text-gray-500 font-medium">Supplier</p>
                      <p className="font-semibold">{viewingPo.supplierName}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium">Status</p>
                      {statusBadge(viewingPo.status)}
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium">Order Date</p>
                      <p>
                        {viewingPo.orderDate
                          ? format(new Date(viewingPo.orderDate), "dd MMM yyyy")
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium">Expected</p>
                      <p>
                        {viewingPo.expectedDeliveryDate
                          ? format(
                              new Date(viewingPo.expectedDeliveryDate),
                              "dd MMM yyyy",
                            )
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Drug</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Unit Cost</TableHead>
                        <TableHead>Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((i, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{i.drugName || "—"}</TableCell>
                          <TableCell>
                            {i.quantityOrdered || i.quantity}
                          </TableCell>
                          <TableCell>₹{(i.unitCost || 0).toFixed(2)}</TableCell>
                          <TableCell>
                            ₹{(i.totalCost || 0).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="text-right font-semibold">
                    Total: ₹{(viewingPo.totalAmount || 0).toFixed(2)}
                  </div>
                  {viewingPo.notes && (
                    <p className="text-gray-500">Notes: {viewingPo.notes}</p>
                  )}
                </div>
              );
            })()}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPoViewDialog(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DIRECT SALE ── */}
      <Dialog open={showSaleDialog} onOpenChange={setShowSaleDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Direct Sale (OTC)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Customer Name <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input
                placeholder="Walk-in customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            {saleItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Select
                    value={item.drugId}
                    onValueChange={(v) =>
                      setSaleItems((p) =>
                        p.map((x, i) => (i === idx ? { ...x, drugId: v } : x)),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Drug" />
                    </SelectTrigger>
                    <SelectContent>
                      {drugs
                        .filter((d) => (d.quantityInStock || 0) > 0)
                        .map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.drugName} — Stock: {d.quantityInStock}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-20">
                  <Input
                    type="number"
                    min={1}
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) =>
                      setSaleItems((p) =>
                        p.map((x, i) =>
                          i === idx
                            ? { ...x, quantity: parseInt(e.target.value) || 1 }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500"
                  onClick={() =>
                    setSaleItems((p) => p.filter((_, i) => i !== idx))
                  }
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSaleItems((p) => [...p, { drugId: "", quantity: 1 }])
              }
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
            {saleTotal > 0 && (
              <div className="bg-gray-50 rounded-lg p-2 text-sm text-right font-semibold">
                Total: ₹{saleTotal.toFixed(2)}
              </div>
            )}
            {!splitPayment ? (
              <div>
                <div className="flex items-center justify-between">
                  <Label>Payment Method</Label>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => {
                      setSplitPayment(true);
                      setSalePayments([{ paymentMethod: "cash", amount: saleTotal ? saleTotal.toFixed(2) : "" }]);
                    }}
                  >
                    + Split payment
                  </button>
                </div>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Split Payment</Label>
                  <button
                    type="button"
                    className="text-xs text-gray-500 hover:underline"
                    onClick={() => setSplitPayment(false)}
                  >
                    Use single method
                  </button>
                </div>
                {salePayments.map((p, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Select
                      value={p.paymentMethod}
                      onValueChange={(v) =>
                        setSalePayments((prev) => prev.map((x, i) => (i === idx ? { ...x, paymentMethod: v } : x)))
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                        <SelectItem value="insurance">Insurance</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0}
                      className="w-28"
                      placeholder="Amount"
                      value={p.amount}
                      onChange={(e) =>
                        setSalePayments((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500"
                      onClick={() => setSalePayments((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSalePayments((prev) => [...prev, { paymentMethod: "upi", amount: "" }])}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Payment
                </Button>
                {(() => {
                  const paidSum = salePayments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
                  const diff = saleTotal - paidSum;
                  return (
                    <div className={`text-xs text-right font-semibold ${Math.abs(diff) < 0.01 ? "text-green-600" : "text-amber-600"}`}>
                      Paid: ₹{paidSum.toFixed(2)} / ₹{saleTotal.toFixed(2)}
                      {Math.abs(diff) >= 0.01 && ` — ${diff > 0 ? "remaining" : "excess"} ₹${Math.abs(diff).toFixed(2)}`}
                    </div>
                  );
                })()}
              </div>
            )}

            <hr className="my-2" />

            <div className="text-xs font-semibold text-gray-600">PATIENT INFO (Optional)</div>

            {/* Shared PatientLookup — search/select a registered patient (or add new).
                Name, phone, UHID auto-fill from the DB; no manual typing. */}
            <PatientLookup
              selectedPatient={salePatient}
              onSelect={(p) => setSalePatient(p)}
              onClear={() => setSalePatient(null)}
              placeholder="Search patient by UHID, name, or phone..."
            />

            <div>
              <Label className="text-xs">Reference Doctor</Label>
              <Input
                placeholder="Doctor name"
                value={saleReferenceDoctor}
                onChange={(e) => setSaleReferenceDoctor(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaleDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSale} disabled={savingSale}>
              {savingSale ? "Processing..." : "Complete Sale & Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE DRUG CONFIRM ── */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Drug?</DialogTitle>
          </DialogHeader>
          <p className="text-gray-600">
            Delete <strong>{deleteConfirm?.drugName}</strong>? This cannot be
            undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDeleteDrug(deleteConfirm)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
