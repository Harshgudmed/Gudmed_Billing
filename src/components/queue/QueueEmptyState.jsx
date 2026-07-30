import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

// What the queue table says when it has no rows — handed to PaginatedTable as its
// `empty` slot, so the surrounding TableRow/TableCell/colSpan come from there.
//
// The queue defaults to TODAY. An empty screen with no explanation reads as "the
// queue is broken" when in fact the filters simply exclude everything — so name
// the filters in force, and give a one-click way out.
export function QueueEmptyState({ dateFilter, statusFilter, search, onClearFilters }) {
  const filtered = dateFilter.active || statusFilter !== 'all' || search

  return (
    <>
      <Clock className="h-8 w-8 mx-auto mb-2 text-gray-300" />
      {filtered ? (
        <>
          <p className="text-gray-600">No patients match the current filters</p>
          <p className="text-xs mt-1">
            Showing {dateFilter.active ? <b>{dateFilter.mode === 'today' ? 'today' : 'the selected dates'}</b> : 'all dates'}
            {statusFilter !== 'all' && <> · status <b>{statusFilter}</b></>}
            {search && <> · search <b>“{search}”</b></>}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilters}>
            Clear filters &amp; show all
          </Button>
        </>
      ) : (
        <>
          <p>No patients in queue</p>
          <p className="text-xs mt-1">Queue entries from triage and appointment check-ins appear here</p>
        </>
      )}
    </>
  )
}
