// JSX badge helpers for the Pharmacy module (kept in a .jsx file because they
// return elements). Extracted from PharmacyModule.jsx.
import { Badge } from "@/components/ui/badge";

// Colour-coded stock level badge for a drug row.
export function stockBadge(drug) {
  const stock = drug.quantityInStock || 0;
  const min = drug.reorderLevel || 10;
  if (stock === 0) return <Badge variant="destructive">Out of Stock</Badge>;
  if (stock < min)
    return <Badge className="bg-yellow-100 text-yellow-800">Low Stock</Badge>;
  return <Badge className="bg-green-100 text-green-800">In Stock</Badge>;
}

// Generic status badge shared by prescriptions, purchase orders and sales.
export function statusBadge(status) {
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
