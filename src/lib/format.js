// Shared formatting helpers — one place decides how money/numbers look, so
// every screen shows them the SAME way (₹1,00,000.00 in Indian style).

// Money: always ₹ + Indian comma grouping + 2 decimals.
//   formatMoney(1000)      -> "₹1,000.00"
//   formatMoney("2500.5")  -> "₹2,500.50"
//   formatMoney(null)      -> "₹0.00"
export function formatMoney(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Plain number with Indian comma grouping (no ₹, no decimals).
//   formatNumber(1050463) -> "10,50,463"
export function formatNumber(value) {
  return (Number(value) || 0).toLocaleString("en-IN");
}
