// Best-effort EXTERNAL barcode -> product lookup, used only when a scanned
// barcode is NOT already in the local medicine master. This is what makes
// "scan a brand-new box -> details auto-fill" possible.
//
// Reality check: free global barcode databases cover consumer goods well but
// Indian medicines only partially. So treat results as a head start to verify,
// not gospel. The provider is configurable so a paid/owned medicine API can be
// dropped in without code changes:
//   BARCODE_LOOKUP_ENABLED=false           -> disable the online fallback
//   BARCODE_API_URL=https://.../lookup?upc= -> custom provider (code appended)
//   BARCODE_API_KEY=...                      -> sent as Authorization header
// Default (no env): the keyless UPCitemdb trial endpoint (~100 lookups/day).

const TIMEOUT_MS = 6000

export async function externalBarcodeLookup(rawBarcode) {
  if (process.env.BARCODE_LOOKUP_ENABLED === 'false') return null

  // Strip separators — scanners/sheets may include dashes/spaces.
  const code = String(rawBarcode || '').replace(/\D/g, '')
  if (code.length < 8) return null // too short to be a real product code

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = process.env.BARCODE_API_URL
      ? `${process.env.BARCODE_API_URL}${encodeURIComponent(code)}`
      : `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`
    const headers = {}
    if (process.env.BARCODE_API_KEY) headers.Authorization = process.env.BARCODE_API_KEY

    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()

    // Tolerate a few common response shapes.
    const item = data?.items?.[0] || data?.products?.[0] || data?.item || data?.product || data
    const title = item?.title || item?.name || item?.product_name || item?.description
    if (!title) return null

    const category = item?.category
      ? String(item.category).split(/[>|/]/).pop().trim()
      : undefined

    // Same field names the local lookup returns, so the frontend fills it the
    // same way. Pricing/strength are rarely available online -> left blank.
    return {
      drugName: String(title).trim(),
      brandName: item?.brand ? String(item.brand).trim() : undefined,
      manufacturer: (item?.manufacturer || item?.brand) ? String(item.manufacturer || item.brand).trim() : undefined,
      drugCategory: category,
      _source: 'external',
    }
  } catch {
    return null // network error / timeout / bad JSON -> silent miss
  } finally {
    clearTimeout(timer)
  }
}
