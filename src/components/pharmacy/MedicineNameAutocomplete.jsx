import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import client from "@/api/client";

// Type-ahead over the open-source Indian medicine catalog (~254k rows).
// As the user types a medicine name, suggestions appear; picking one fires
// onSelect(referenceRow) so the parent can auto-fill composition, company, price…
//
// Props:
//   value: current name text
//   onChange(text): raw text edits
//   onSelect(row): a suggestion was chosen  { name, manufacturer, price, packSize, composition, type }
export default function MedicineNameAutocomplete({ value, onChange, onSelect, placeholder }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef(null);
  const justSelected = useRef(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    // Don't re-search the value we just auto-filled from a selection.
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    const q = (value || "").trim();
    clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await client.get(`/pharmacy/medicine-reference?q=${encodeURIComponent(q)}`);
        setResults(res.data || []);
        setOpen(true);
        setHighlight(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // Close when clicking outside.
  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const choose = (row) => {
    justSelected.current = true;
    onSelect?.(row);
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && highlight >= 0) { e.preventDefault(); choose(results[highlight]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Input
          className="mt-1 pr-8"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder || "Type a medicine name to search…"}
          autoComplete="off"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 mt-0.5 text-muted-foreground">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </span>
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-white shadow-lg">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.id}
              onClick={() => choose(r)}
              onMouseEnter={() => setHighlight(i)}
              className={`block w-full text-left px-3 py-2 text-sm border-b last:border-0 ${i === highlight ? "bg-blue-50" : "hover:bg-gray-50"}`}
            >
              <div className="font-medium text-gray-900">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                {[r.manufacturer, r.composition].filter(Boolean).join(" · ")}
                {r.price ? ` · ₹${r.price}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
