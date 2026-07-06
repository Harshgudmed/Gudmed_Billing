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
  "Dosage Form", "Strength", "Barcode", "MRP", "Selling Price",
  "Purchase Price", "GST", "Reorder Level", "Current Stock", "Batch Number",
  "Expiry Date", "Mfg Date", "Supplier",
];
const SAMPLE_ROWS = [
  {
    "Medicine Name": "Paracetamol 500mg", "Generic Name": "Paracetamol", "Brand Name": "Calpol",
    Manufacturer: "GSK", Category: "analgesic", "Dosage Form": "tablet", Strength: "500mg",
    Barcode: "8901234567890", MRP: 25, "Selling Price": 25,
    "Purchase Price": 15, GST: 12, "Reorder Level": 20, "Current Stock": 100,
    "Batch Number": "PCM-001", "Expiry Date": "12/2027", "Mfg Date": "01/2026", Supplier: "MedSupply Co",
  },
  {
    "Medicine Name": "Amoxicillin 250mg", "Generic Name": "Amoxicillin", "Brand Name": "Mox",
    Manufacturer: "Cipla", Category: "antibiotic", "Dosage Form": "capsule", Strength: "250mg",
    Barcode: "8907654321098", MRP: 55, "Selling Price": 55,
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
  const [progress, setProgress] = useState(null); // { current, total } while chunk-importing
  const fileRef = useRef(null);

  const reset = () => {
    setRows([]);
    setFileName("");
    setReport(null);
    setCommitted(false);
    setProgress(null);
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

  // Big files (e.g. 2 lakh rows) can't be sent in one request — the JSON body
  // would blow past the server's 50MB / 5000-row limits (413). So we send the
  // rows in sequential CHUNKS and merge the results. The backend already skips
  // duplicates, so re-running a chunk is safe.
  const CHUNK_SIZE = 2000;   // well under the 5000-row backend cap
  const PROBLEM_CAP = 500;   // keep the on-screen report light for huge files

  const run = async (mode) => {
    if (!rows.length) {
      toast.error("Choose a file first");
      return;
    }
    setBusy(true);
    setReport(null);

    const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
    const summary = { total: 0, created: 0, duplicates: 0, errors: 0 };
    const problems = []; // only non-ok rows, capped

    try {
      for (let c = 0; c < totalChunks; c++) {
        const start = c * CHUNK_SIZE;
        const chunk = rows.slice(start, start + CHUNK_SIZE);
        setProgress({ current: c + 1, total: totalChunks });

        try {
          const res = await client.post("/pharmacy/import", { rows: chunk, mode });
          const cs = res.summary || {};
          summary.total += cs.total || 0;
          summary.created += cs.created || 0;
          summary.duplicates += cs.duplicates || 0;
          summary.errors += cs.errors || 0;
          for (const r of res.report || []) {
            // remap the chunk-local row number back to the real file row number
            if (r.status !== "ok" && problems.length < PROBLEM_CAP) {
              problems.push({ ...r, rowNo: start + r.rowNo });
            }
          }
        } catch (err) {
          // one bad chunk shouldn't abort the whole import — record and continue
          summary.errors += chunk.length;
          if (problems.length < PROBLEM_CAP) {
            problems.push({
              rowNo: start + 2,
              status: "error",
              name: null,
              message: `Batch ${c + 1}/${totalChunks} failed: ${err.message || "request failed"}`,
            });
          }
        }
      }

      const message =
        mode === "validate"
          ? `Validation: ${summary.created} ready, ${summary.duplicates} duplicates, ${summary.errors} errors (of ${summary.total})`
          : `Imported ${summary.created} medicines (${summary.duplicates} duplicates skipped, ${summary.errors} errors)`;

      setReport({ summary, report: problems, message });
      if (mode === "commit") {
        setCommitted(true);
        toast.success(message);
        onImported?.();
      } else {
        toast.info(message);
      }
    } finally {
      setBusy(false);
      setProgress(null);
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
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => run("validate")} disabled={busy}>
                {busy ? "Checking…" : "Validate (dry run)"}
              </Button>
              <Button onClick={() => run("commit")} disabled={busy || committed}>
                {busy ? "Importing…" : committed ? "Imported ✓" : `Import ${rows.length} medicines`}
              </Button>
            </div>
            {progress && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Processing batch {progress.current} of {progress.total}
                  {" · "}
                  {Math.min(progress.current * CHUNK_SIZE, rows.length).toLocaleString()} / {rows.length.toLocaleString()} rows
                </div>
                <div className="h-2 w-full rounded bg-gray-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
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

        {/* Per-row report — only issues (duplicates/errors), successful rows are counted in the summary above */}
        {report?.report?.length > 0 && (
          <>
          <p className="text-xs text-muted-foreground mt-2">
            Showing issues only (duplicates / errors){report.report.length >= PROBLEM_CAP ? ` — first ${PROBLEM_CAP}` : ""}. Successful rows are in the summary above.
          </p>
          <div className="mt-1 max-h-72 overflow-y-auto rounded border">
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
          </>
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
