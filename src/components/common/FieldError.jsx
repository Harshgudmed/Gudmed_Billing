// The red line under a form field: a validation error caught before submit or
// one the backend sent back after it — one place, either source.
// (Re-exported from PatientDetailsFields, where it was first written.)
export function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
}
