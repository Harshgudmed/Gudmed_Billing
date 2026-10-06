import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { Loader2 } from 'lucide-react'

// One server-paginated table for the whole app. Give it the result of
// useServerPagination, the column headers, and how to render one row — it owns
// the header, the loading row, the empty row, the page of rows, and the shared
// footer, so no screen re-writes that boilerplate.
//
//   const ordersPagination = useServerPagination('/laboratory', { params: { resource: 'orders', ... } })
//   <PaginatedTable
//     pagination={ordersPagination}
//     transform={transformApiOrder}         // optional: map each raw row first
//     columns={[{ header: 'Order #' }, { header: 'Patient' }, …]}
//     renderRow={(order) => <TableRow key={order.id}>…</TableRow>}
//     empty="No orders found"
//   />
//
// Edge cases handled once, here: shows a spinner only on the FIRST load (not on
// every page change), shows the empty state only when a finished load returned
// nothing, says when a load failed (with Try again) instead of "nothing found",
// and spans the empty/loading cell across every column.
export function PaginatedTable({
  pagination,
  columns,
  renderRow,
  transform,
  empty = 'No records found',
  loadingLabel,
  tableClassName,
  headerClassName,
}) {
  const { rows, loading, page, totalPages, setPage, error, refresh } = pagination
  const items = transform ? rows.map(transform) : rows
  const colSpan = columns.length
  const retry = (
    <button type="button" onClick={refresh} className="ml-2 font-medium underline underline-offset-2">Try again</button>
  )

  return (
    <div>
      {/* A failed load keeps the last good rows (useServerPagination); say so,
          rather than pass them off as current. */}
      {error && items.length > 0 && (
        <p role="alert" className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Could not refresh this list — showing what was last loaded. {retry}
        </p>
      )}
      <Table className={tableClassName}>
        <TableHeader className={headerClassName}>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={i} className={c.className}>{c.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-center py-10 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin inline-block" />
                {/* Optional — a screen that already said "Loading queue…" keeps
                    saying it; callers that pass nothing get the bare spinner. */}
                {loadingLabel && <span className="ml-2">{loadingLabel}</span>}
              </TableCell>
            </TableRow>
          ) : items.length === 0 && error ? (
            <TableRow>
              <TableCell colSpan={colSpan} role="alert" className="text-center py-10 text-red-600">
                Could not load this list: {error}. {retry}
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-center py-10 text-gray-400">{empty}</TableCell>
            </TableRow>
          ) : (
            items.map(renderRow)
          )}
        </TableBody>
      </Table>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}
