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

// A timestamp -> "20 Jul 2026, 12:20 PM".
//
// Payment rows were rendering their raw API value, so a receipt line read
// "2026-07-20T06:50:01.555Z" — the stored UTC instant, verbatim, next to an
// invoice header that said "18 Jul 2026". Same screen, two formats, and the
// raw one was in the wrong timezone for the reader.
//
// `withTime` is on by default because the timestamps that reach users here are
// moments (a payment taken, a receipt issued) where the time of day is part of
// the record. Pass false for a plain calendar date.
//
// An unparseable or missing value returns '' rather than "Invalid Date".
export function formatDateTime(value, { withTime = true } = {}) {
  if (value == null || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("en-IN", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  return `${date}, ${time}`;
}

// A stored "HH:mm" clock time -> how a patient reads it.
//   formatTime12h("13:45") -> "1:45 PM"
//   formatTime12h("09:00") -> "9:00 AM"
//   formatTime12h("00:30") -> "12:30 AM"
//
// Times are STORED as zero-padded 24-hour "HH:mm" (see the backend's
// normalizeTimeHHMM — appointment times are sorted as strings, so the padded
// 24h form is what makes that sort chronological). That storage format was
// also being shown to users verbatim on the appointment screens, while the
// display board converted to 12-hour and the timetable's native <input
// type="time"> rendered in the browser's locale — so the SAME slot read as
// "13:45", "1:45 PM" and "01:45 PM" on three screens.
//
// Display goes through here; storage stays 24h. Never feed the result back
// into a form value or a sort.
export function formatTime12h(hhmm) {
  const [h, m] = String(hhmm ?? "").split(":").map(Number);
  // Unparseable input is returned untouched rather than shown as "NaN:NaN" —
  // a malformed time should look wrong, not crash the row it sits in.
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm ?? "";
  const suffix = h < 12 || h === 24 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}
