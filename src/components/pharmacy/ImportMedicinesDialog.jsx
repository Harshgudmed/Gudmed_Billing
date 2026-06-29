import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import client from "@/api/client";

// Bulk-import medicines from an Excel/CSV "purchase list". The file is parsed in
// the browser (SheetJS) into JSON rows and sent to POST /pharmacy/import, which
// validates (dry run) or commits (creates medicine + batch + opening stock).
const TEMPLATE_COLUMNS = [
  "Medicine Name", "Generic Name", "Brand Name", "Manufacturer", "Category",
  "Dosage Form", "Strength", "Barcode", "HSN Code", "MRP", "Selling Price",
  "Purchase Price", "GST", "Reorder Level", "Current Stock", "Batch Number",
  "Expiry Date", "Mfg Date", "Supplier",
];
const SAMPLE_ROWS = [
  {
    "Medicine Name": "Paracetamol 500mg", "Generic Name": "Paracetamol", "Brand Name": "Calpol",
    Manufacturer: "GSK", Category: "analgesic", "Dosage Form": "tablet", Strength: "500mg",
    Barcode: "8901234567890", "HSN Code": "3004", MRP: 25, "Selling Price": 25,
    "Purchase Price": 15, GST: 12, "Reorder Level": 20, "Current Stock": 100,
    "Batch Number": "PCM-001", "Expiry Date": "12/2027", "Mfg Date": "01/2026", Supplier: "MedSupply Co",
  },
  {
    "Medicine Name": "Amoxicillin 250mg", "Generic Name": "Amoxicillin", "Brand Name": "Mox",
    Manufacturer: "Cipla", Category: "antibiotic", "Dosage Form": "capsule", Strength: "250mg",
    Barcode: "8907654321098", "HSN Code": "3004", MRP: 55, "Selling Price": 55,
    "Purchase Price": 32, GST: 12, "Reorder Level": 30, "Current Stock": 200,
    "Batch Number": "AMX-07", "Expiry Date": "06/2027", "Mfg Date": "06/2025", Supplier: "Cipla Distributors",
  },
];

const STATUS_STYLES = {
  ok: "bg-green-100 text-green-800",
  duplicate: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
};

export default function ImportMedicinesDialog({ open, onClose, onImported }) {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const fileRef = useRef(null);

  const reset = () => {
    setRows([]);
    setFileName("");
    setReport(null);
    setCommitted(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose?.();
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReport(null);
    setCommitted(false);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!parsed.length) {
        toast.error("No rows found in that file");
        setRows([]);
        return;
      }
      setRows(parsed);
      toast.success(`Loaded ${parsed.length} row(s) from ${file.name}`);
    } catch (err) {
      toast.error("Could not read file: " + (err.message || ""));
      setRows([]);
    }
  };

  const run = async (mode) => {
    if (!rows.length) {
      toast.error("Choose a file first");
      return;
    }
    setBusy(true);
    try {
      const res = await client.post("/pharmacy/import", { rows, mode });
      setReport(res);
      if (mode === "commit") {
        setCommitted(true);
        toast.success(res.message);
        onImported?.();
      } else {
        toast.info(res.message);
      }
    } catch (err) {
      toast.error(err.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(SAMPLE_ROWS, { header: TEMPLATE_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Medicines");
    XLSX.writeFile(wb, "medicine-import-template.xlsx");
  };

  const s = report?.summary;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import medicines from Excel / CSV</DialogTitle>
          <DialogDescription>
            Upload your purchase list — each row becomes a medicine with its stock,
            batch, price and barcode. No manual typing per item.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 — template + file */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" /> Download template
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            className="hidden"
            id="medicine-import-file"
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Choose file
          </Button>

          {fileName && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <FileSpreadsheet className="h-4 w-4" /> {fileName} · {rows.length} rows
            </span>
          )}
        </div>

        {/* Step 2 — actions */}
        {rows.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Button variant="secondary" onClick={() => run("validate")} disabled={busy}>
              {busy ? "Checking…" : "Validate (dry run)"}
            </Button>
            <Button onClick={() => run("commit")} disabled={busy || committed}>
              {busy ? "Importing…" : committed ? "Imported ✓" : `Import ${rows.length} medicines`}
            </Button>
          </div>
        )}

        {/* Summary */}
        {s && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge className="bg-green-100 text-green-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {committed ? "Created" : "Ready"}: {s.created}
            </Badge>
            <Badge className="bg-amber-100 text-amber-800">
              <Copy className="h-3 w-3 mr-1" /> Duplicates: {s.duplicates}
            </Badge>
            <Badge className="bg-red-100 text-red-800">
              <AlertCircle className="h-3 w-3 mr-1" /> Errors: {s.errors}
            </Badge>
            <Badge variant="outline">Total: {s.total}</Badge>
          </div>
        )}

        {/* Per-row report */}
        {report?.report?.length > 0 && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="text-left p-2 w-16">Row</th>
                  <th className="text-left p-2 w-24">Status</th>
                  <th className="text-left p-2">Medicine</th>
                  <th className="text-left p-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {report.report.map((r) => (
                  <tr key={r.rowNo} className="border-t">
                    <td className="p-2 text-muted-foreground">{r.rowNo}</td>
                    <td className="p-2">
                      <Badge className={STATUS_STYLES[r.status] || ""}>{r.status}</Badge>
                    </td>
                    <td className="p-2">{r.name || "—"}</td>
                    <td className="p-2 text-muted-foreground">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {committed ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
