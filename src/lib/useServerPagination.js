import { useState, useEffect, useCallback, useRef } from "react";
import client from "@/api/client";

// Server-side pagination: fetches ONE page from the backend, so it works on
// tables with hundreds of thousands / millions of rows (the DB does the
// slicing — the browser only ever holds one page).
//
// `params` are extra query params (filters/search). Changing them resets to
// page 1. Expects the backend response to carry a total count as either
// `pagination.totalRecords` (pharmacy controllers) or `meta.total`.
//
//   const dp = useServerPagination("/pharmacy/drugs", {
//     perPage: 15,
//     params: { search: debouncedSearch, category },
//   });
//   dp.rows  dp.page  dp.setPage  dp.totalPages  dp.loading  dp.refresh()
//   pollMs: 5000  — optional live refresh; omit for a normal, static list.
export function useServerPagination(endpoint, { perPage = 15, params = {}, pollMs = 0 } = {}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Some endpoints return an extra `summary` block (e.g. sales revenue across
  // the whole filtered set, not just this page). Exposed for those callers.
  const [summary, setSummary] = useState(null);

  // Stable string key so the effects only re-run when a filter value actually
  // changes (not on every parent re-render that rebuilds the params object).
  const paramKey = JSON.stringify(params);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({
      ...JSON.parse(paramKey),
      page: String(page),
      limit: String(perPage),
    });
    // Drop empty params so we don't send ?search=&category=
    for (const [k, v] of [...qs.entries()]) {
      if (v === "" || v === "all" || v == null) qs.delete(k);
    }
    try {
      const res = await client.get(`${endpoint}?${qs.toString()}`);
      setRows(res.data ?? []);
      setTotal(res.pagination?.totalRecords ?? res.meta?.total ?? 0);
      setSummary(res.summary ?? null);
    } catch {
      setRows([]);
      setTotal(0);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, perPage, paramKey]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Opt-in live refresh (`pollMs`). A live screen — the queue, where reception
  // books a patient and expects to see them appear — must not require anyone to
  // press Refresh.
  //
  // Paused while the tab is hidden: a queue left open on a spare monitor
  // overnight would otherwise poll thousands of times against a page nobody is
  // looking at. Refetches once immediately on becoming visible again, so the
  // first thing the user sees after switching back is current.
  //
  // `fetchPage` sets `loading`, which the queue table deliberately does NOT use
  // to blank itself (see QueueModule) — otherwise every poll would flash the
  // list empty.
  const savedFetch = useRef(fetchPage);
  savedFetch.current = fetchPage;
  useEffect(() => {
    if (!pollMs) return;
    let timer = null;
    const start = () => {
      stop();
      timer = setInterval(() => savedFetch.current(), pollMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        savedFetch.current();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollMs]);

  // When a filter changes, jump back to page 1 (skip the very first render).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setPage(1);
  }, [paramKey]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // If the row count shrank (a delete, or an action that drops the row from the
  // current filter) while we're on a page that no longer exists, snap back to
  // the last valid page — otherwise the table shows an empty page with the
  // footer hidden, stranding the user until they touch a filter.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return { rows, total, totalPages, page, setPage, loading, summary, refresh: fetchPage };
}
