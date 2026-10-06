// Money arithmetic on screen — the mirror of backend/src/lib/money.js, so a
// figure the screen works out is the figure the server stores, to the paisa.

/** Round to paisa (2 decimals). null/undefined/text → 0, never NaN. */
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
