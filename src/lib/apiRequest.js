import { toast } from "sonner";

/**
 * Shows a failed request as a toast a receptionist can act on: a bold title
 * and one sentence saying what is wrong and what to do next.
 *
 * The server writes those words for the refusals it knows about (a taken
 * slot, a doctor on leave, a bill already issued …) and sends them as
 * `title` + `error`. Everything else is translated here, so nobody is shown
 * "Network Error", "Validation error" or a bare "Failed to create appointment"
 * with no idea why.
 *
 * @param {Error}  err            what the API client threw (see api/client.js)
 * @param {string} fallbackTitle  the heading when the server sent none,
 *                                e.g. "Couldn't book appointment"
 */
export function showApiError(err, fallbackTitle = "Something went wrong") {
  // No response at all: the request never reached the server.
  if (!err?.status) {
    toast.error("Can't reach the server", {
      description: "Check your internet connection and try again.",
    });
    return;
  }
  // The server broke, not the request — its message is not for the user.
  if (err.status >= 500) {
    toast.error(fallbackTitle, {
      description: "Something went wrong on our side. Please try again in a moment.",
    });
    return;
  }
  // A form field the server rejected: name the field, in words — the raw
  // message is often just "Required", which says nothing about WHAT is.
  if (!err.title && Array.isArray(err.details) && err.details.length) {
    const issue = err.details[0] || {};
    const field = String(issue.path?.[issue.path.length - 1] ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase();
    const label = field ? field.charAt(0).toUpperCase() + field.slice(1) : "";
    const description = !label
      ? issue.message || "Some details are missing or invalid."
      : issue.message === "Required"
        ? `${label} is required.`
        : `${label}: ${issue.message}`;
    toast.error("Please check the details", { description });
    return;
  }
  toast.error(err.title || fallbackTitle, {
    description: err.message || "Please try again.",
  });
}

// Wraps an API call so callers don't repeat the same try/catch + toast block.
// Shows an error toast on failure (and an optional success toast), returns the
// response data on success or null on failure — so the caller can branch:
//
//   const drug = await apiRequest(client.post("/pharmacy/drugs", body),
//     { success: "Drug saved" });
//   if (drug) fetchAll();
export async function apiRequest(promise, { success, error = "Something went wrong" } = {}) {
  try {
    const res = await promise;
    if (res?.success === false) {
      toast.error(res.error || error);
      return null;
    }
    if (success) toast.success(success);
    return res?.data ?? res;
  } catch (e) {
    toast.error(e?.message || error);
    return null;
  }
}
