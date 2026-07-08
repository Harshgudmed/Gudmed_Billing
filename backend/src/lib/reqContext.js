// Shared per-request context helpers — the single source of truth for the
// cross-cutting values every controller needs: which tenant (org) is acting,
// who is acting, and how service errors are returned.
//
// WHY THIS FILE EXISTS: these three lines used to be copy-pasted into ~34
// controllers. Centralising them means a change (e.g. tightening tenant
// resolution for security) is made ONCE here and every controller follows.

/**
 * Resolve the caller's organization (tenant) id.
 *
 * NOTE: today this keeps the existing demo-friendly fallback so nothing breaks.
 * When auth is enforced, tighten THIS ONE function (e.g. `return req.organizationId`
 * and reject when missing) — every controller inherits the fix automatically,
 * which also closes the multi-tenant "fail-open" gap.
 */
export function getOrgId(req) {
  return req.organizationId || process.env.ORGANIZATION_ID || "org-demo";
}

/** Actor (who-did-it) snapshot from the auth context — for audit + record stamping. */
export function getActor(req) {
  return {
    id: req.user?.id || req.user?.userId || null,
    name: req.user?.fullName || null,
    role: req.user?.role || null,
  };
}

/** Standard error responder preserving a service error's HTTP status + code. */
export function svcErr(res, e) {
  return res
    .status(e.status || 500)
    .json({ success: false, code: e.code, error: e.message });
}

/**
 * Coerce a user-supplied money/quantity value to a safe, non-negative, finite
 * number. Blank/null → fallback (default 0). Rejects negatives, NaN and Infinity
 * by returning `null` — callers should treat null as "invalid input" and 400.
 * Prevents `Number("abc")` (NaN) or a negative charge from poisoning stored totals.
 */
export function safeMoney(value, { fallback = 0 } = {}) {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
