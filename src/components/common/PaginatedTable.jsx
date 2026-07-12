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
// nothing, and spans the empty/loading cell across every column.
export function PaginatedTable({
  pagination,
  columns,
  renderRow,
  transform,
  empty = 'No records found',
  tableClassName,
  headerClassName,
}) {
  const { rows, loading, page, totalPages, setPage } = pagination
  const items = transform ? rows.map(transform) : rows
  const colSpan = columns.length

  return (
    <div>
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
