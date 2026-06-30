import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

// One pagination footer for every table in the app. Page-based (1..totalPages).
// Renders nothing when there's a single page, so callers don't need to guard.
//
//   <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
export function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 p-4 border-t">
      <Button
        variant="outline"
        size="sm"
        disabled={page === 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Previous
      </Button>
      <span className="text-sm text-gray-600">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page === totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        Next
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
