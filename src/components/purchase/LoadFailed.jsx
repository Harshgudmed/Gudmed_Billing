// What a purchase screen shows when something it needs did not load: what
// failed, in words, and a way to try again — never an empty list that reads as
// "nothing there". Same look as PaginatedTable's failed-refresh line.
export default function LoadFailed({ children, onRetry, className = '' }) {
  return (
    <p role="alert" className={`rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ${className}`}>
      {children}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700">
          Try again
        </button>
      )}
    </p>
  )
}
