import { useState, useEffect, useCallback, useMemo } from "react";
import { useOrgSettings } from '@/lib/useOrgSettings'
import { format, addDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
import BarcodeScanner from "./BarcodeScanner";
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

const DRUG_CATEGORIES = [
  "Antibiotics",
  "Analgesics",
  "Antimalarials",
  "Antiretrovirals (ARV)",
  "Cardiovascular",
  "Respiratory",
  "Gastrointestinal",
  "Vitamins",
  "Antidiabetics",
  "Antihelminthics",
  "Antifungals",
  "Topical",
  "Antihistamines",
  "Vaccines",
  "IV Fluids",
  "Other",
];
const DRUG_FORMS = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Ointment",
  "Drops",
  "Inhaler",
  "Suppository",
  "Solution",
  "Suspension",
];
const SCHEDULE_TYPES = ["none", "G", "H", "H1", "X"];

const DRUGS_PER_PAGE = 15
const PHARMACY_BATCHES_PER_PAGE = 10
const PHARMACY_PO_PER_PAGE = 10
const PHARMACY_SALES_PER_PAGE = 10

const DRUG_INTERACTIONS = [
  {
    drugs: ["warfarin", "aspirin"],
    severity: "high",
    message:
      "Warfarin + Aspirin: increased bleeding risk — monitor INR closely.",
  },
  {
    drugs: ["warfarin", "ibuprofen"],
    severity: "high",
    message: "Warfarin + Ibuprofen: increased bleeding risk — avoid NSAIDs.",
  },
  {
    drugs: ["metformin", "alcohol"],
    severity: "moderate",
    message: "Metformin + Alcohol: risk of lactic acidosis — counsel patient.",
  },
  {
    drugs: ["amoxicillin", "methotrexate"],
    severity: "high",
    message: "Amoxicillin + Methotrexate: elevated methotrexate toxicity.",
  },
  {
    drugs: ["ciprofloxacin", "antacid"],
    severity: "moderate",
    message: "Ciprofloxacin + Antacid: reduced absorption — space by 2 h.",
  },
  {
    drugs: ["ssri", "tramadol"],
    severity: "high",
    message: "SSRI + Tramadol: serotonin syndrome risk — use with caution.",
  },
  {
    drugs: ["fluoxetine", "tramadol"],
    severity: "high",
    message: "Fluoxetine + Tramadol: serotonin syndrome risk.",
  },
  {
    drugs: ["simvastatin", "clarithromycin"],
    severity: "high",
    message:
      "Simvastatin + Clarithromycin: severe myopathy / rhabdomyolysis risk.",
  },
  {
    drugs: ["clopidogrel", "omeprazole"],
    severity: "moderate",
    message: "Clopidogrel + Omeprazole: reduced antiplatelet effect.",
  },
  {
    drugs: ["digoxin", "amiodarone"],
    severity: "high",
    message: "Digoxin + Amiodarone: digoxin toxicity — reduce digoxin dose.",
  },
  {
    drugs: ["lithium", "ibuprofen"],
    severity: "high",
    message: "Lithium + Ibuprofen: elevated lithium levels — monitor closely.",
  },
  {
    drugs: ["metronidazole", "alcohol"],
    severity: "high",
    message:
      "Metronidazole + Alcohol: disulfiram-like reaction — alcohol contraindicated.",
  },
];

function checkDrugInteractions(drugNames) {
  const lower = drugNames.map((n) => n.toLowerCase());
  const warnings = [];
  for (const rule of DRUG_INTERACTIONS) {
    const [a, b] = rule.drugs;
    if (lower.some((n) => n.includes(a)) && lower.some((n) => n.includes(b)))
      warnings.push({ severity: rule.severity, message: rule.message });
  }
  return warnings;
}

function printViaIframe(html) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none";
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 1000);
}

function stockBadge(drug) {
  const stock = drug.quantityInStock || 0;
  const min = drug.reorderLevel || 10;
  if (stock === 0) return <Badge variant="destructive">Out of Stock</Badge>;
  if (stock < min)
    return <Badge className="bg-yellow-100 text-yellow-800">Low Stock</Badge>;
  return <Badge className="bg-green-100 text-green-800">In Stock</Badge>;
}

function statusBadge(status) {
  const map = {
    pending: "bg-blue-100 text-blue-800",
    dispensed: "bg-green-100 text-green-800",
    fully_dispensed: "bg-green-100 text-green-800",
    partially_dispensed: "bg-yellow-100 text-yellow-800",
    cancelled: "bg-red-100 text-red-800",
    draft: "bg-purple-100 text-purple-800",
    submitted: "bg-blue-100 text-blue-800",
    approved: "bg-teal-100 text-teal-800",
    received: "bg-green-100 text-green-800",
    paid: "bg-green-100 text-green-800",
  };
  return (
    <Badge className={map[status] || "bg-gray-100 text-gray-800"}>
      {(status || "").replace(/_/g, " ")}
    </Badge>
  );
}

const emptyDrug = {
  name: "",
  saltName: "",
  companyName: "",
  category: "",
  form: "",
  strength: "",
  mrp: 0,
  rate: 0,
  discountPercentage: 0,
  scheme: "",
  scheduleType: "none",
  initialQty: 0,
  minStock: 10,
  batchNumber: "",
  expiryDate: "",
  manufacturingDate: "",
  barcode: "",
};
const emptyBatch = {
  drugId: "",
  batchNumber: "",
  expiryDate: "",
  manufactureDate: "",
  quantityReceived: 1,
  costPricePerUnit: 0,
  supplierName: "",
  supplierInvoice: "",
  purchaseOrderNumber: "",
};

export default function PharmacyModule() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [drugs, setDrugs] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [batches, setBatches] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [drugInventoryPage, setDrugInventoryPage] = useState(1)
  const [prescriptionsPage, setPrescriptionsPage] = useState(1)
  const [lowStockPage, setLowStockPage] = useState(1);
  const [batchesPage, setBatchesPage] = useState(1);
  const [poPage, setPoPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [prescriptionFilter, setPrescriptionFilter] = useState("all");
  const [poStatusFilter, setPoStatusFilter] = useState("all");
  const [salesPeriod, setSalesPeriod] = useState("month"); // today | week | month | all

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
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [savingSale, setSavingSale] = useState(false);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, pRes, bRes, poRes] = await Promise.all([
        client.get("/pharmacy/drugs?limit=5000"),
        client.get("/pharmacy/prescriptions?limit=5000"),
        client.get("/pharmacy/batches?limit=5000"),
        client.get("/pharmacy/purchase-orders?limit=5000"),
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

  const fetchSales = useCallback(async () => {
    try {
      const res = await client.get("/pharmacy/sales");
      if (res.success) {
        setSales(
          (res.data || []).map((s) => ({
            ...s,
            items:
              typeof s.items === "string" ? JSON.parse(s.items) : s.items || [],
          })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchSales(); // also load sales on mount so dashboard Today's Sales is populated
  }, [fetchAll, fetchSales]);
  const { orgInfo: hookOrgInfo } = useOrgSettings()
  useEffect(() => { setOrgInfo(hookOrgInfo) }, [hookOrgInfo])
  useEffect(() => {
    if (activeTab === "sales") fetchSales();
  }, [activeTab, fetchSales]);

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

  const handlePrintSaleReceipt = (items, total, payment) => {
    const now = format(new Date(), "dd MMM yyyy HH:mm");
    const receiptNo = `RCP${Date.now().toString().slice(-8)}`;
    const rows = items
      .map((item) => {
        const drug = drugs.find((d) => d.id === item.drugId);
        if (!drug) return "";
        const subtotal = (drug.sellingPrice || 0) * item.quantity;
        return `<tr><td>${drug.drugName}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:right">₹${(drug.sellingPrice || 0).toFixed(2)}</td><td style="text-align:right">₹${subtotal.toFixed(2)}</td></tr>`;
      })
      .join("");
    printViaIframe(`<!DOCTYPE html><html><head><title>OTC Receipt</title>
<style>body{font-family:Arial,sans-serif;font-size:11pt;padding:16px}.hosp{font-size:16pt;font-weight:bold;color:#1e3a5f;text-align:center}.banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px;font-size:11pt;font-weight:bold;margin:8px 0}table{width:100%;border-collapse:collapse;font-size:10pt}th{background:#1e3a5f;color:#fff;padding:5px 8px;text-align:left}td{padding:5px 8px;border-bottom:1px solid #eee}.total-row td{font-weight:bold;background:#f0f4f8;border-top:2px solid #1e3a5f}.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:8px}</style></head><body>
<div class="hosp">${orgInfo.name}</div>
<div class="banner">SALE RECEIPT</div>
<p>Receipt: <strong>${receiptNo}</strong> &nbsp;|&nbsp; Date: <strong>${now}</strong> &nbsp;|&nbsp; Payment: <strong>${payment.toUpperCase()}</strong></p>
<table><thead><tr><th>Drug</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>${rows}<tr class="total-row"><td colspan="3" style="text-align:right">TOTAL</td><td style="text-align:right">₹${total.toFixed(2)}</td></tr></tbody></table>
<div class="footer">${orgInfo.name} • Printed: ${now}</div>
</body></html>`);
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
      const res = await client.post("/pharmacy/sales", {
        items,
        paymentMethod,
        paymentStatus: "paid",
      });
      if (res.success) {
        handlePrintSaleReceipt(valid, total, paymentMethod);
        toast.success(`Sale completed — ₹${total.toFixed(2)}`);
        setShowSaleDialog(false);
        setSaleItems([{ drugId: "", quantity: 1 }]);
        fetchAll();
      } else toast.error(res.error || "Failed");
    } catch {
      toast.error("Failed to record sale");
    }
    setSavingSale(false);
  };

  // Reset pagination when filters change
  useEffect(() => {
    setDrugInventoryPage(1);
  }, [searchQuery, categoryFilter]);

  useEffect(() => {
    setPrescriptionsPage(1);
  }, [prescriptionFilter]);

  useEffect(() => {
    setLowStockPage(1);
  }, [drugs]);

  useEffect(() => {
    setPoPage(1);
  }, [poStatusFilter]);

  useEffect(() => {
    setSalesPage(1);
  }, [salesPeriod]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const filteredDrugs = drugs.filter((d) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      (d.drugName || "").toLowerCase().includes(q) ||
      (d.genericName || "").toLowerCase().includes(q) ||
      (d.drugCode || "").toLowerCase().includes(q);
    const matchCat =
      categoryFilter === "all" || d.drugCategory === categoryFilter;
    return matchSearch && matchCat;
  });
  const filteredRx = prescriptions.filter(
    (p) => prescriptionFilter === "all" || p.status === prescriptionFilter,
  );
  const expiringBatches = batches.filter(
    (b) =>
      new Date(b.expiryDate) <= addDays(new Date(), 90) &&
      (b.quantityRemaining || 0) > 0,
  );
  const totalStockValue = drugs.reduce(
    (s, d) => s + (d.quantityInStock || 0) * (d.sellingPrice || 0),
    0,
  );

  // Dashboard derived values
  const inStockCount  = drugs.filter(d => (d.quantityInStock || 0) > (d.reorderLevel || 10)).length;
  const lowStockCount = drugs.filter(d => (d.quantityInStock || 0) > 0 && (d.quantityInStock || 0) <= (d.reorderLevel || 10)).length;
  const outStockCount = drugs.filter(d => (d.quantityInStock || 0) === 0).length;
  const lowStockDrugs = drugs.filter(d => (d.quantityInStock || 0) <= (d.reorderLevel || 10));
  const pendingRx     = prescriptions.filter(p => p.status === "pending");
  const todaySalesTotal = useMemo(() => {
    const todayStart = startOfDay(new Date());
    return sales
      .filter(s => { const d = s.saleDate || s.createdAt; return d && new Date(d) >= todayStart; })
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
  }, [sales]);

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

  // Filtered sales by period
  const filteredSales = useMemo(() => {
    if (salesPeriod === "all") return sales;
    const cutoff =
      salesPeriod === "today" ? startOfDay(new Date()) :
      salesPeriod === "week"  ? startOfWeek(new Date(), { weekStartsOn: 1 }) :
                                startOfMonth(new Date());
    return sales.filter(s => {
      const d = s.saleDate || s.createdAt;
      return d && new Date(d) >= cutoff;
    });
  }, [sales, salesPeriod]);

  // Sales summary for period
  const salesTotal = useMemo(
    () => filteredSales.reduce((s, sale) => s + (sale.totalAmount || 0), 0),
    [filteredSales],
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
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              {
                label: "Total Drugs",
                value: drugs.length,
                color: "text-blue-600",
              },
              {
                label: "Low Stock",
                value: drugs.filter(
                  (d) =>
                    (d.quantityInStock || 0) > 0 &&
                    (d.quantityInStock || 0) < (d.reorderLevel || 10),
                ).length,
                color: "text-yellow-600",
              },
              {
                label: "Out of Stock",
                value: drugs.filter((d) => (d.quantityInStock || 0) === 0)
                  .length,
                color: "text-red-600",
              },
              {
                label: "Pending Rx",
                value: prescriptions.filter((p) => p.status === "pending")
                  .length,
                color: "text-purple-600",
              },
              {
                label: "Expiring (90d)",
                value: expiringBatches.length,
                color: "text-orange-600",
              },
              {
                label: "Stock Value",
                value: `₹${totalStockValue.toLocaleString()}`,
                color: "text-green-600",
              },
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
                  <span className="font-bold text-green-700 text-lg">₹{totalStockValue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Today's Sales</span>
                  <span className="font-bold text-gray-800">₹{todaySalesTotal.toLocaleString()}</span>
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
                      const totalPages = Math.ceil(lowStockDrugs.length / ITEMS_PER_PAGE)
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
                {lowStockDrugs.length > 10 && (() => {
                  const ITEMS_PER_PAGE = 10
                  const totalPages = Math.ceil(lowStockDrugs.length / ITEMS_PER_PAGE)
                  return (
                    <div className="flex items-center justify-end gap-2 p-4 border-t">
                      <Button variant="outline" size="sm" onClick={() => setLowStockPage(p => Math.max(1, p - 1))} disabled={lowStockPage === 1}>
                        <ChevronLeft className="h-4 w-4 mr-1" />Previous
                      </Button>
                      <span className="text-sm text-gray-600">Page {lowStockPage} of {totalPages}</span>
                      <Button variant="outline" size="sm" onClick={() => setLowStockPage(p => Math.min(totalPages, p + 1))} disabled={lowStockPage === totalPages}>
                        Next<ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  )
                })()}
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

        {/* ── INVENTORY ── */}
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
                  ) : filteredDrugs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-gray-400"
                      >
                        No drugs found
                      </TableCell>
                    </TableRow>
                  ) : (() => {
                    const totalPages = Math.ceil(filteredDrugs.length / DRUGS_PER_PAGE);
                    const startIdx = (drugInventoryPage - 1) * DRUGS_PER_PAGE;
                    const endIdx = startIdx + DRUGS_PER_PAGE;
                    const paginatedDrugs = filteredDrugs.slice(startIdx, endIdx);
                    return paginatedDrugs.map((d) => (
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
                    ));
                  })()}
                </TableBody>
              </Table>
              {filteredDrugs.length > DRUGS_PER_PAGE && (() => {
                const totalPages = Math.ceil(filteredDrugs.length / DRUGS_PER_PAGE);
                return (
                  <div className="flex items-center justify-end gap-2 p-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDrugInventoryPage(p => Math.max(1, p - 1))}
                      disabled={drugInventoryPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-600">
                      Page {drugInventoryPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDrugInventoryPage(p => Math.min(totalPages, p + 1))}
                      disabled={drugInventoryPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PRESCRIPTIONS ── */}
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
                  {filteredRx.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-gray-400"
                      >
                        No prescriptions
                      </TableCell>
                    </TableRow>
                  ) : (() => {
                    const totalPages = Math.ceil(filteredRx.length / DRUGS_PER_PAGE)
                    const startIdx = (prescriptionsPage - 1) * DRUGS_PER_PAGE
                    const endIdx = startIdx + DRUGS_PER_PAGE
                    const paginatedRx = filteredRx.slice(startIdx, endIdx)
                    return paginatedRx.map((rx) => {
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
                  })()}
                </TableBody>
              </Table>
              {filteredRx.length > DRUGS_PER_PAGE && (() => {
                const totalPages = Math.ceil(filteredRx.length / DRUGS_PER_PAGE)
                return (
                  <div className="flex items-center justify-end gap-2 p-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrescriptionsPage(p => Math.max(1, p - 1))}
                      disabled={prescriptionsPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />Previous
                    </Button>
                    <span className="text-sm text-gray-600">
                      Page {prescriptionsPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrescriptionsPage(p => Math.min(totalPages, p + 1))}
                      disabled={prescriptionsPage === totalPages}
                    >
                      Next<ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BATCHES ── */}
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
                  {batches.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-gray-400"
                      >
                        No batches
                      </TableCell>
                    </TableRow>
                  ) : (() => {
                    const totalPages = Math.ceil(batches.length / PHARMACY_BATCHES_PER_PAGE);
                    const startIdx = (batchesPage - 1) * PHARMACY_BATCHES_PER_PAGE;
                    const endIdx = startIdx + PHARMACY_BATCHES_PER_PAGE;
                    const paginatedBatches = batches.slice(startIdx, endIdx);
                    return paginatedBatches.map((b) => {
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
              {(() => {
                const totalPages = Math.ceil(batches.length / PHARMACY_BATCHES_PER_PAGE);
                return totalPages > 1 ? (
                  <div className="flex items-center justify-end gap-2 p-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBatchesPage(p => Math.max(1, p - 1))}
                      disabled={batchesPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-600">
                      Page {batchesPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBatchesPage(p => Math.min(totalPages, p + 1))}
                      disabled={batchesPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                ) : null;
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PURCHASE ORDERS ── */}
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
                  {filteredPOs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-gray-400"
                      >
                        No purchase orders
                      </TableCell>
                    </TableRow>
                  ) : (() => {
                    const totalPages = Math.ceil(filteredPOs.length / PHARMACY_PO_PER_PAGE);
                    const startIdx = (poPage - 1) * PHARMACY_PO_PER_PAGE;
                    const endIdx = startIdx + PHARMACY_PO_PER_PAGE;
                    const paginatedPOs = filteredPOs.slice(startIdx, endIdx);
                    return paginatedPOs.map((po) => (
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
                          ₹{(po.totalAmount || 0).toLocaleString()}
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
                    ));
                  })()}
                </TableBody>
              </Table>
              {(() => {
                const totalPages = Math.ceil(filteredPOs.length / PHARMACY_PO_PER_PAGE);
                return totalPages > 1 ? (
                  <div className="flex items-center justify-end gap-2 p-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPoPage(p => Math.max(1, p - 1))}
                      disabled={poPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-600">
                      Page {poPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPoPage(p => Math.min(totalPages, p + 1))}
                      disabled={poPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                ) : null;
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SALES ── */}
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
              {filteredSales.length > 0 && (
                <span className="text-sm text-gray-600">
                  <span className="font-semibold">{filteredSales.length}</span> sales ·{" "}
                  <span className="font-semibold text-green-700">₹{salesTotal.toLocaleString()}</span>
                </span>
              )}
            </div>
            <Button variant="outline" onClick={fetchSales}>
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
                  {filteredSales.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-gray-400"
                      >
                        No sales records
                      </TableCell>
                    </TableRow>
                  ) : (() => {
                    const totalPages = Math.ceil(filteredSales.length / PHARMACY_SALES_PER_PAGE);
                    const startIdx = (salesPage - 1) * PHARMACY_SALES_PER_PAGE;
                    const endIdx = startIdx + PHARMACY_SALES_PER_PAGE;
                    const paginatedSales = filteredSales.slice(startIdx, endIdx);
                    return paginatedSales.map((s) => {
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
                            {(s.items || []).length} item(s)
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
                    });
                  })()}
                </TableBody>
              </Table>
              {(() => {
                const totalPages = Math.ceil(filteredSales.length / PHARMACY_SALES_PER_PAGE);
                return totalPages > 1 ? (
                  <div className="flex items-center justify-end gap-2 p-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSalesPage(p => Math.max(1, p - 1))}
                      disabled={salesPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-600">
                      Page {salesPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSalesPage(p => Math.min(totalPages, p + 1))}
                      disabled={salesPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                ) : null;
              })()}
            </CardContent>
          </Card>
        </TabsContent>
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

      <BarcodeScanner
        open={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleBarcodeLookup}
      />

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
            <div>
              <Label>Payment Method</Label>
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
