import { useCallback, useRef } from "react";

/**
 * Only the NEWEST request may write to the screen.
 *
 * A list that refetches as filters change sends several requests in a row —
 * every pause while typing a search, and two at once when a search is typed on
 * page 2 (one for "page 2 + search", one for the jump back to page 1). They can
 * come back in any order. Without this, whichever answer arrived LAST was
 * shown, even if it was for an older search: on a slow connection Radiology's
 * Orders showed "No orders found" for a patient who was there, because the
 * stale page-2 answer overwrote the right one.
 * Same rule OPD's catalogue pickers already follow (useCatalogueSearch), in one
 * place so every list can use it.
 *
 *   const begin = useLatestRequest()
 *   const isLatest = begin()                // call when the request starts
 *   const res = await client.get(...)
 *   if (!isLatest()) return                 // a newer request has started since
 *   setRows(res.data)
 */
export function useLatestRequest() {
  const seq = useRef(0);
  return useCallback(() => {
    const id = ++seq.current;
    return () => id === seq.current;
  }, []);
}
