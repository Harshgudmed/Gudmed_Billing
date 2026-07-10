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
import PosDrugCombo from './PosDrugCombo';
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
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const debouncedDrugSearch = useDebounce(searchQuery, 300);
  const drugPage = useServerPagination("/pharmacy/drugs", {
    perPage: DRUGS_PER_PAGE,
    params: { search: debouncedDrugSearch, category: categoryFilter },
  });
  const [lowStockPage, setLowStockPage] = useState(1);
  const batchPage = useServerPagination("/pharmacy/batches", { perPage: PHARMACY_BATCHES_PER_PAGE });
  const [poStatusFilter, setPoStatusFilter] = useState("all");
  const poPage = useServerPagination("/pharmacy/purchase-orders", { 
    perPage: PHARMACY_PO_PER_PAGE,
    params: { status: poStatusFilter === "all" ? "" : poStatusFilter }
  });
  const [prescriptionFilter, setPrescriptionFilter] = useState("all");
  const [salesPeriod, setSalesPeriod] = useState("month"); 

  const rxPage = useServerPagination("/pharmacy/prescriptions", {
    perPage: DRUGS_PER_PAGE,
    params: { status: prescriptionFilter === "all" ? "" : prescriptionFilter },
  });

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

  const [stats, setStats] = useState(null);
  const fetchStats = useCallback(async () => {
    try {
      const res = await client.get("/pharmacy/stats");
      if (res.success) setStats(res.data);
    } catch { /* ignore */ }
  }, []);

  const [showDrugDialog, setShowDrugDialog] = useState(false);
  const [drugForm, setDrugForm] = useState(emptyDrug);
  const [editingDrugId, setEditingDrugId] = useState(null);
  const [savingDrug, setSavingDrug] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanLooking, setScanLooking] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const applyReferenceMedicine = useCallback((row) => {
    const composition = row.composition || "";
    const strengthMatch = composition.match(/(\d+(?:\.\d+)?\s?(?:mg\/ml|mcg|mg|ml|iu|%[\s\w/]*|g))/i);
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

  const [showViewDrugDialog, setShowViewDrugDialog] = useState(false);
  const [viewingDrug, setViewingDrug] = useState(null);
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState(null);
  const [stockAdjust, setStockAdjust] = useState({ type: "add", amount: 0 });
  const [showDispenseDialog, setShowDispenseDialog] = useState(false);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [dispensing, setDispensing] = useState(false);
  const [dispenseWarnings, setDispenseWarnings] = useState([]);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [batchForm, setBatchForm] = useState(emptyBatch);
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [savingBatch, setSavingBatch] = useState(false);
  const [showDeleteBatchConfirm, setShowDeleteBatchConfirm] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showPoDialog, setShowPoDialog] = useState(false);
  const [poForm, setPoForm] = useState({ supplierName: "", supplierContact: "", expectedDeliveryDate: "", notes: "" });
  const [poItems, setPoItems] = useState([]);
  const [savingPo, setSavingPo] = useState(false);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [selectedPo, setSelectedPo] = useState(null);
  const [receiveItems, setReceiveItems] = useState([]);
  const [receivingPo, setReceivingPo] = useState(false);
  const [showPoViewDialog, setShowPoViewDialog] = useState(false);
  const [viewingPo, setViewingPo] = useState(null);
  const [showSaleDialog, setShowSaleDialog] = useState(false);
  const [saleItems, setSaleItems] = useState([{ drugId: "", drugName: "", sellingPrice: 0, quantity: 1 }]);
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [savingSale, setSavingSale] = useState(false);
  const [salePatient, setSalePatient] = useState(null);
  const [saleReferenceDoctor, setSaleReferenceDoctor] = useState("");
  const [splitPayment, setSplitPayment] = useState(false);
  const [salePayments, setSalePayments] = useState([{ paymentMethod: "cash", amount: "" }]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Basket total for the OTC sale dialog. This used to be derived by looking each
  // row's drugId up in a full in-memory `drugs` list; that state is gone now that
  // the drug list is server-paginated, so every sale row carries the price the
  // picker selected. Mirrors the per-line maths in handleSale().
  const saleTotal = useMemo(
    () =>
      saleItems.reduce(
        (sum, i) =>
          i.drugId ? sum + (Number(i.sellingPrice) || 0) * (Number(i.quantity) || 0) : sum,
        0,
      ),
    [saleItems],
  );

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);
  const { orgInfo: hookOrgInfo } = useOrgSettings()
  useEffect(() => { setOrgInfo(hookOrgInfo) }, [hookOrgInfo])

  const handleSaveDrug = async () => {
    if (!drugForm.name || !drugForm.category || !drugForm.form || !drugForm.strength) {
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
        quantityInStock: editingDrugId ? undefined : parseInt(drugForm.initialQty) || 0,
        requiresPrescription: drugForm.scheduleType !== "none",
        description: [drugForm.scheduleType !== "none" ? `SCH:${drugForm.scheduleType}` : "", drugForm.scheme ? `Scheme: ${drugForm.scheme}` : ""].filter(Boolean).join(" | ") || undefined,
      };
      const res = editingDrugId ? await client.patch(`/pharmacy/drugs/${editingDrugId}`, payload) : await client.post("/pharmacy/drugs", payload);
      if (res.success) {
        if (!editingDrugId && drugForm.batchNumber && drugForm.expiryDate && parseInt(drugForm.initialQty) > 0) {
          await client.post("/pharmacy/batches", { drugId: res.data.id, batchNumber: drugForm.batchNumber, expiryDate: drugForm.expiryDate, manufactureDate: drugForm.manufacturingDate || undefined, quantityReceived: parseInt(drugForm.initialQty), costPricePerUnit: parseFloat(drugForm.rate) || 0 });
        }
        toast.success(editingDrugId ? "Drug updated" : "Drug added");
        setShowDrugDialog(false);
        setDrugForm(emptyDrug);
        setEditingDrugId(null);
        drugPage.refresh();
      } else toast.error(res.error || "Failed to save");
    } catch {
      toast.error("Failed to save drug");
    }
    setSavingDrug(false);
  };

  const onAdjustStock = async () => {
    if (!selectedDrug) return;
    const current = selectedDrug.quantityInStock || 0;
    const newStock = stockAdjust.type === "add" ? current + (parseInt(stockAdjust.amount) || 0) : Math.max(0, current - (parseInt(stockAdjust.amount) || 0));
    try {
      const res = await client.patch(`/pharmacy/drugs/${selectedDrug.id}`, { quantityInStock: newStock });
      if (res.success) {
        toast.success(`Stock updated`);
        setShowStockDialog(false);
        setSelectedDrug(null);
        setStockAdjust({ type: "add", amount: 0 });
        drugPage.refresh();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to adjust stock");
    }
  };

  const openDispenseDialog = async (rx) => {
    let items = [];
    try { items = typeof rx.items === "string" ? JSON.parse(rx.items) : rx.items || []; } catch { items = []; }
    setSelectedPrescription({ ...rx, items: items.map((i) => ({ ...i, dispensed: false })) });
    const drugNames = items.map((i) => i.drugName || "");
    const interactions = checkDrugInteractions(drugNames);
    const allergyWarnings = [];
    try {
      const res = await client.get(`/patients?id=${rx.patientId}`);
      if (res.success && res.data) {
        let allergies = [];
        try { allergies = typeof res.data.allergies === "string" ? JSON.parse(res.data.allergies) : res.data.allergies || []; } catch { allergies = []; }
        for (const allergen of allergies) {
          const al = allergen.toLowerCase();
          for (const dn of drugNames) {
            if (dn.toLowerCase().includes(al) || al.includes(dn.toLowerCase()))
              allergyWarnings.push({ severity: "high", message: `ALLERGY ALERT: Patient is allergic to "${allergen}"` });
          }
        }
      }
    } catch { }
    setDispenseWarnings([...allergyWarnings, ...interactions]);
    setShowDispenseDialog(true);
  };

  const toggleItemDispensed = (idx) => {
    if (!selectedPrescription) return;
    setSelectedPrescription((prev) => ({ ...prev, items: prev.items.map((item, i) => i === idx ? { ...item, dispensed: !item.dispensed } : item) }));
  };

  const handlePrintLabel = (rx) => {
    let items = [];
    try { items = typeof rx.items === "string" ? JSON.parse(rx.items) : rx.items || []; } catch { items = []; }
    const name = rx.patient ? `${rx.patient.firstName} ${rx.patient.lastName || ""}`.trim() : "Unknown";
    const today = format(new Date(), "dd MMM yyyy HH:mm");
    const totalCost = items.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0);
    const rows = items.map((i) => `<tr><td>${i.drugName || "—"}</td><td>${i.dosage || "—"}</td><td>${i.quantity}</td><td>${i.duration || "—"}</td><td>₹${((i.unitPrice || 0) * i.quantity).toFixed(2)}</td></tr>`).join("");
    printViaIframe(`<!DOCTYPE html><html><body><h1>${orgInfo.name} — Pharmacy Label</h1><div>Patient: ${name}</div><table><thead><tr><th>Drug</th><th>Dosage</th><th>Qty</th><th>Duration</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  };

  const afterDispense = async (rx) => {
    const items = rx.items || [];
    const totalCost = items.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0);
    if (rx.patientId && totalCost > 0) {
      try {
        await client.post("/billing", { resource: "invoice", patientId: rx.patientId, items: items.map((i) => ({ type: "pharmacy", description: i.drugName, quantity: i.quantity, unitPrice: i.unitPrice || 0, total: (i.unitPrice || 0) * i.quantity })) })
      } catch (err) { console.error(err); }
    }
    handlePrintLabel(rx);
    setShowDispenseDialog(false);
    setSelectedPrescription(null);
    setDispenseWarnings([]);
    rxPage.refresh();
    drugPage.refresh();
    fetchStats();
  };

  const runDispense = async (allowPartial) => {
    if (!selectedPrescription) return;
    setDispensing(true);
    try {
      const res = await client.post(`/pharmacy/prescriptions/${selectedPrescription.id}/dispense`, { allowPartial });
      toast.success(res.message || "Prescription dispensed");
      afterDispense(selectedPrescription);
    } catch (err) {
      if (err.code === "INSUFFICIENT_STOCK") {
        const ok = window.confirm(`Insufficient stock. Dispense available?`);
        if (ok) { await runDispense(true); return; }
        toast.error("Dispensing blocked");
      } else { toast.error(err.message || "Failed"); }
    } finally { setDispensing(false); }
  };

  const handleCompleteDispense = () => runDispense(false);

  const handleSaveBatch = async () => {
    if (!batchForm.drugId || !batchForm.batchNumber || !batchForm.expiryDate) {
      toast.error("Fill required fields");
      return;
    }
    setSavingBatch(true);
    try {
      const payload = { ...batchForm, quantityReceived: parseInt(batchForm.quantityReceived) || 1, costPricePerUnit: parseFloat(batchForm.costPricePerUnit) || 0 };
      const res = editingBatchId ? await client.patch(`/pharmacy/batches/${editingBatchId}`, payload) : await client.post("/pharmacy/batches", payload);
      if (res.success) {
        toast.success(editingBatchId ? "Batch updated" : "Batch added");
        setShowBatchDialog(false);
        setBatchForm(emptyBatch);
        setEditingBatchId(null);
        batchPage.refresh();
      } else toast.error(res.error || "Failed");
    } catch { toast.error("Failed to save batch"); }
    setSavingBatch(false);
  };

  // The delete-drug confirm dialog called this, but it was never defined — clicking
  // "Delete" threw `handleDeleteDrug is not defined` and took the module down.
  const handleDeleteDrug = async (drug) => {
    if (!drug?.id) return;
    try {
      const res = await client.delete(`/pharmacy/drugs/${drug.id}`);
      if (res.success) {
        toast.success("Drug removed");
        setDeleteConfirm(null);
        drugPage.refresh();
        fetchStats();
      } else toast.error(res.error || "Failed");
    } catch { toast.error("Failed to remove drug"); }
  };

  const handleDeleteBatch = async () => {
    if (!selectedBatch) return;
    try {
      const res = await client.delete(`/pharmacy/batches/${selectedBatch.id}`);
      if (res.success) {
        toast.success("Batch removed");
        setShowDeleteBatchConfirm(false);
        setSelectedBatch(null);
        batchPage.refresh();
      } else toast.error(res.error || "Failed");
    } catch { toast.error("Failed to remove batch"); }
  };

  const handleSavePO = async () => {
    if (!poForm.supplierName || poItems.length === 0) {
      toast.error("Add supplier and items");
      return;
    }
    setSavingPo(true);
    try {
      const res = await client.post("/pharmacy/purchase-orders", { ...poForm, items: poItems });
      if (res.success) {
        toast.success("Purchase order created");
        setShowPoDialog(false);
        setPoForm({ supplierName: "", supplierContact: "", expectedDeliveryDate: "", notes: "" });
        setPoItems([]);
        poPage.refresh();
      } else toast.error(res.error || "Failed");
    } catch { toast.error("Failed to create PO"); }
    setSavingPo(false);
  };

  const handleUpdatePO = async (id, status) => {
    try {
      const res = await client.patch(`/pharmacy/purchase-orders/${id}`, { status });
      if (res.success) {
        toast.success(`PO ${status}`);
        poPage.refresh();
        if (status === "received") { drugPage.refresh(); batchPage.refresh(); }
      } else toast.error(res.error || "Failed");
    } catch { toast.error("Failed"); }
  };

  const openReceivePO = (po) => {
    setSelectedPo(po);
    const items = typeof po.items === "string" ? JSON.parse(po.items) : po.items || [];
    setReceiveItems(items.map((i) => ({ ...i, quantityReceived: i.quantityOrdered || i.quantity || 1, batchNumber: "", expiryDate: "", manufactureDate: "" })));
    setShowReceiveDialog(true);
  };

  const handleReceivePO = async () => {
    setReceivingPo(true);
    try {
      const res = await client.patch(`/pharmacy/purchase-orders/${selectedPo.id}/receive`, { items: receiveItems });
      if (res.success) {
        toast.success("PO received — batches created");
        setShowReceiveDialog(false);
        setSelectedPo(null);
        setReceiveItems([]);
        poPage.refresh();
        batchPage.refresh();
      } else toast.error(res.error || "Failed");
    } catch { toast.error("Failed to receive PO"); }
    setReceivingPo(false);
  };

  const handlePrintSaleReceipt = (sale, paymentMethod, format = 'invoice') => {
    let clinic = {};
    try { clinic = JSON.parse(localStorage.getItem('gudmed-clinic-profile') || '{}'); } catch { }
    printPharmacyReceipt({ ...sale, paymentMethod }, orgInfo, clinic, { format });
  };

  const handleSale = async (format = 'invoice') => {
    const valid = saleItems.filter((i) => i.drugId && i.quantity > 0);
    if (!valid.length) { toast.error("Add items"); return; }
    setSavingSale(true);
    try {
      const items = valid.map((item) => ({ drugId: item.drugId, drugName: item.drugName || "", quantity: item.quantity, unitPrice: item.sellingPrice || 0, total: (item.sellingPrice || 0) * item.quantity }));
      const res = await client.post("/pharmacy/sales", { items, customerName: customerName.trim() || undefined, paymentMethod, paymentStatus: "paid", patientId: salePatient?.id || undefined, phone: salePatient?.phonePrimary || undefined, uhid: salePatient?.mrn || undefined, referenceDoctor: saleReferenceDoctor.trim() || undefined, payments: splitPayment ? salePayments.filter(p => p.amount > 0) : undefined });
      if (res.success) {
        handlePrintSaleReceipt(res.data, paymentMethod, format);
        toast.success(`Sale completed`);
        setShowSaleDialog(false);
        setSaleItems([{ drugId: "", quantity: 1 }]);
        setSalePatient(null);
        salePage.refresh();
        drugPage.refresh();
        fetchStats();
      } else toast.error(res.error || "Failed");
    } catch { toast.error("Failed to record sale"); }
    setSavingSale(false);
  };

  const expiringBatches = stats?.expiringBatches ?? [];
  const totalStockValue = stats?.stockValue ?? 0;
  const inStockCount  = stats?.inStock ?? 0;
  const lowStockCount = stats ? Math.max(0, stats.lowStock - stats.outOfStock) : 0;
  const outStockCount = stats?.outOfStock ?? 0;
  const lowStockDrugs = stats?.lowStockDrugs ?? [];

  // Preview list for the dashboard's "Pending Prescriptions" card. The KPI count
  // beside it comes from stats.pendingPrescriptions (whole table); this is only the
  // handful shown, drawn from the prescriptions page currently loaded.
  const pendingRx = useMemo(
    () => rxPage.rows.filter((p) => p.status === "pending"),
    [rxPage.rows],
  );
  const todaySalesTotal = stats?.todaySalesTotal ?? 0;

  const mrp = parseFloat(drugForm.mrp) || 0;
  const rate = parseFloat(drugForm.rate) || 0;
  const discPct = parseFloat(drugForm.discountPercentage) || 0;
  const discAmt = mrp * (discPct / 100);
  const netRate = mrp - discAmt;
  const margin = rate > 0 ? (((mrp - rate) / mrp) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Pill className="h-7 w-7 text-pink-600" />
            Pharmacy
          </h1>
          <p className="text-gray-500">Drug inventory, prescriptions &amp; dispensing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { drugPage.refresh(); batchPage.refresh(); poPage.refresh(); rxPage.refresh(); salePage.refresh(); fetchStats(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" onClick={() => setShowSaleDialog(true)}>
            <ShoppingCart className="h-4 w-4 mr-1" /> Direct Sale
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-1" /> Import Excel/CSV
          </Button>
          <Button onClick={() => { setEditingDrugId(null); setDrugForm(emptyDrug); setShowDrugDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Drug
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
        <ImportMedicinesDialog
          open={showImport}
          onClose={() => setShowImport(false)}
          onImported={() => drugPage.refresh()}
        />

        <DashboardTab
          stats={stats}
          drugs={drugPage.rows}
          prescriptions={rxPage.rows}
          pendingRx={pendingRx}
          expiringBatches={expiringBatches}
          totalStockValue={totalStockValue}
          todaySalesTotal={todaySalesTotal}
          inStockCount={inStockCount}
          lowStockCount={lowStockCount}
          outStockCount={outStockCount}
          lowStockDrugs={lowStockDrugs}
          lowStockPage={lowStockPage}
          setLowStockPage={setLowStockPage}
          setActiveTab={setActiveTab}
          openDispenseDialog={openDispenseDialog}
          setSelectedDrug={setSelectedDrug}
          setStockAdjust={setStockAdjust}
          setShowStockDialog={setShowStockDialog}
        />

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

        <BatchesTab
          batches={batchPage.rows}
          loading={batchPage.loading}
          page={batchPage.page}
          setPage={batchPage.setPage}
          totalPages={batchPage.totalPages}
          setBatchForm={setBatchForm}
          setEditingBatchId={setEditingBatchId}
          setShowBatchDialog={setShowBatchDialog}
          setSelectedBatch={setSelectedBatch}
          setShowDeleteBatchConfirm={setShowDeleteBatchConfirm}
        />

        <PurchaseOrdersTab
          poStatusFilter={poStatusFilter}
          setPoStatusFilter={setPoStatusFilter}
          purchaseOrders={poPage.rows}
          loading={poPage.loading}
          page={poPage.page}
          setPage={poPage.setPage}
          totalPages={poPage.totalPages}
          setPoForm={setPoForm}
          setPoItems={setPoItems}
          setShowPoDialog={setShowPoDialog}
          setViewingPo={setViewingPo}
          setShowPoViewDialog={setShowPoViewDialog}
          handleUpdatePO={handleUpdatePO}
          openReceivePO={openReceivePO}
        />

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

      <Dialog open={showDrugDialog} onOpenChange={setShowDrugDialog}>
        <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
          <DialogTitle>{editingDrugId ? "Edit Drug" : "Add New Drug"}</DialogTitle>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="col-span-2">
              <Label>Medicine Name *</Label>
              <MedicineNameAutocomplete value={drugForm.name} onChange={(v) => setDrugForm((p) => ({ ...p, name: v }))} onSelect={applyReferenceMedicine} />
            </div>
            <div>
              <Label>Salt / Generic Name</Label>
              <Input value={drugForm.saltName} onChange={(e) => setDrugForm((p) => ({ ...p, saltName: e.target.value }))} />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={drugForm.category} onValueChange={(v) => setDrugForm((p) => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DRUG_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dosage Form *</Label>
              <Input placeholder="Tablet, Syrup, Injection..." value={drugForm.form} onChange={(e) => setDrugForm((p) => ({ ...p, form: e.target.value }))} />
            </div>
            <div>
              <Label>Strength</Label>
              <Input placeholder="500mg, 10ml..." value={drugForm.strength} onChange={(e) => setDrugForm((p) => ({ ...p, strength: e.target.value }))} />
            </div>
            <div>
              <Label>MRP (Selling Price) *</Label>
              <Input type="number" min="0" step="0.01" value={drugForm.mrp} onChange={(e) => setDrugForm((p) => ({ ...p, mrp: e.target.value }))} />
            </div>
            <div>
              <Label>Purchase Rate (Cost)</Label>
              <Input type="number" min="0" step="0.01" value={drugForm.rate} onChange={(e) => setDrugForm((p) => ({ ...p, rate: e.target.value }))} />
            </div>
            <div>
              <Label>Min Stock (Reorder Level)</Label>
              <Input type="number" min="0" value={drugForm.minStock} onChange={(e) => setDrugForm((p) => ({ ...p, minStock: e.target.value }))} />
            </div>
            <div>
              <Label>Manufacturer / Company</Label>
              <Input value={drugForm.companyName} onChange={(e) => setDrugForm((p) => ({ ...p, companyName: e.target.value }))} />
            </div>

            <div className="col-span-2 mt-2">
              <hr className="mb-2" />
              <p className="text-xs font-semibold text-gray-500 uppercase">Initial Stock & Batch (Optional)</p>
            </div>
            
            <div>
              <Label>Initial Stock Qty</Label>
              <Input type="number" min="0" value={drugForm.initialQty} onChange={(e) => setDrugForm((p) => ({ ...p, initialQty: e.target.value }))} />
            </div>
            <div>
              <Label>Batch Number</Label>
              <Input value={drugForm.batchNumber} onChange={(e) => setDrugForm((p) => ({ ...p, batchNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Expiry Date</Label>
              <Input type="date" value={drugForm.expiryDate} onChange={(e) => setDrugForm((p) => ({ ...p, expiryDate: e.target.value }))} />
            </div>
            <div>
              <Label>Mfg Date</Label>
              <Input type="date" value={drugForm.manufacturingDate} onChange={(e) => setDrugForm((p) => ({ ...p, manufacturingDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveDrug}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {/* Was `drugs.map(...)`, a state that stopped existing when the drug
                  list moved to server pagination — it crashed the whole module.
                  A page of rows would be the wrong source anyway: the drug being
                  restocked is usually not on the currently visible page.
                  `inStockOnly={false}` because a batch is added precisely when the
                  stock is zero. */}
              <PosDrugCombo
                inStockOnly={false}
                disabled={!!editingBatchId}
                selectedName={batchForm.drugName}
                placeholder="Search drug to add a batch for..."
                onSelect={(d) =>
                  setBatchForm((p) => ({ ...p, drugId: d.id, drugName: d.drugName }))
                }
              />
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
                  <PosDrugCombo 
                    selectedName={item.drugName}
                    onSelect={(d) => 
                      setSaleItems((p) =>
                        p.map((x, i) => (i === idx ? { ...x, drugId: d.id, drugName: d.drugName, sellingPrice: d.sellingPrice } : x)),
                      )
                    } 
                  />
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
            <div className="flex gap-2">
              <Button variant="outline" className="border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => handleSale('detailed')} disabled={savingSale}>
                {savingSale ? "Processing..." : "Complete & Print History"}
              </Button>
              <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => handleSale('invoice')} disabled={savingSale}>
                {savingSale ? "Processing..." : "Complete & Print Invoice"}
              </Button>
            </div>
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
