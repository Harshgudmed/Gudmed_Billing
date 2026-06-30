import { useRef, useState } from "react";
import * as XLSX from "xlsx";
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

// Generic Excel/CSV bulk-import dialog. The file is parsed in the browser
// (SheetJS) into JSON rows and POSTed to `endpoint` with mode validate/commit.
//
// Props:
//   open, onClose, onImported
//   title, description
//   endpoint        e.g. "/laboratory/import"
//   itemNoun        e.g. "tests" | "exams" | "medicines"
//   templateColumns string[] (header order)
//   sampleRows      object[] (example rows for the template)
//   templateFileName e.g. "lab-tests-template.xlsx"
const STATUS_STYLES = {
  ok: "bg-green-100 text-green-800",
  duplicate: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
};

export default function BulkImportDialog({
  open,
  onClose,
  onImported,
  title = "Import from Excel / CSV",
  description = "Upload a spreadsheet — each row becomes a record. No manual typing per item.",
  endpoint,
  itemNoun = "records",
  templateColumns = [],
  sampleRows = [],
  templateFileName = "import-template.xlsx",
}) {
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
      const res = await client.post(endpoint, { rows, mode });
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

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: templateColumns });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, templateFileName);
  };

  const s = report?.summary;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

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

        {rows.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Button variant="secondary" onClick={() => run("validate")} disabled={busy}>
              {busy ? "Checking…" : "Validate (dry run)"}
            </Button>
            <Button onClick={() => run("commit")} disabled={busy || committed}>
              {busy ? "Importing…" : committed ? "Imported ✓" : `Import ${rows.length} ${itemNoun}`}
            </Button>
          </div>
        )}

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

        {report?.report?.length > 0 && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="text-left p-2 w-16">Row</th>
                  <th className="text-left p-2 w-24">Status</th>
                  <th className="text-left p-2">Name</th>
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
