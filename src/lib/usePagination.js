import { useState, useMemo, useEffect } from "react";

// Client-side pagination helper. Give it the full list + page size; get back
// the current page's slice plus the page controls. Automatically snaps back to
// page 1 when the list shrinks (e.g. a filter changes), so you never end up on
// an empty page.
//
//   const { page, setPage, totalPages, pageItems } = usePagination(rows, 15);
//   ...pageItems.map(...)
//   <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
export function usePagination(items, perPage = 10) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [items, totalPages, page]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * perPage, page * perPage),
    [items, page, perPage],
  );

  return { page, setPage, totalPages, pageItems };
}
