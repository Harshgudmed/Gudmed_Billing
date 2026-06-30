import { toast } from "sonner";

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
