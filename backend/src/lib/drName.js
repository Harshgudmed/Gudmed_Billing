// Backend twin of the frontend src/lib/utils.js drName(). Any doctor name that
// goes into a STRING the user sees — an invoice line, a WhatsApp/SMS message, a
// PDF — must carry exactly one "Dr." prefix, regardless of how the name was
// typed when the doctor was added ("Harsh", "dr harsh", "Dr. Harsh" all become
// "Dr. Harsh"). The frontend already does this for on-screen renders; strings
// built on the server had no equivalent, so they showed the raw stored name.
export function drName(name) {
  if (!name) return ''
  const clean = String(name).replace(/^\s*(dr\.?\s+)+/i, '').trim()
  return clean ? `Dr. ${clean}` : ''
}
