import client from './client'

// ─────────────────────────────────────────────────────────────────────────────
// Centralized Laboratory API — same shape as inpatientApi.js.
//
// Every "/laboratory" string and every `resource` name lives HERE. The module
// used to hand-write the endpoint at 14 call sites and the resource name inside
// each body, so a typo was a runtime 400 rather than a missing function, and
// renaming a resource meant finding every literal by eye.
//
// It also removes a JSON round-trip the old helper performed on every write:
//
//     body: JSON.stringify({ … })   // object → string   (at the call site)
//     JSON.parse(options.body)      // string → object   (inside the helper)
//     client.post(url, body)        // object → string   (again, inside axios)
//
// Three conversions to send one object. The waste is trivial at this size; what
// matters is that JSON.stringify is lossy in ways that bite quietly — a Date
// becomes a string, `undefined` keys vanish, NaN and Infinity become null.
// Passing the object straight through keeps exactly what the caller built.
//
// CONTRACT — deliberately identical to the fetchApi helper this replaces, so no
// call site had to change how it reads a response:
//   • `client` (axios) unwraps to response.data, i.e. the backend's
//     `{ success, data, meta }` envelope.
//   • A falsy `success` throws, so callers keep relying on try/catch rather than
//     checking a flag.
//   • The resolved value is the INNER `data`, not the envelope.
// `meta` (pagination totals) is not returned — nothing in the module read it
// from these calls; the paginated tables use useServerPagination instead.
// ─────────────────────────────────────────────────────────────────────────────

// Exported because useServerPagination takes the endpoint directly rather than
// going through these helpers — the paginated tables would otherwise be the last
// two places still hard-coding the string.
export const LAB_ENDPOINT = '/laboratory'
const ENDPOINT = LAB_ENDPOINT

/** Unwrap the envelope and turn `success: false` into a throw. */
function unwrap(res) {
  if (!res?.success) throw new Error(res?.error || 'API request failed')
  return res.data
}

const get   = async (resource, params)    => unwrap(await client.get(ENDPOINT, { params: { resource, ...params } }))
const post  = async (resource, body = {}) => unwrap(await client.post(ENDPOINT, { resource, ...body }))
const patch = async (resource, body = {}) => unwrap(await client.patch(ENDPOINT, { resource, ...body }))

export const labApi = {
  // ── Reads ──────────────────────────────────────────────────────────────────
  getTests:   (params) => get('tests', params),    // { limit, offset, page, search }
  getOrders:  (params) => get('orders', params),   // { limit, offset, page, search, status, priority }
  getResults: (params) => get('results', params),  // { limit, offset, orderId }
  getStats:   ()       => get('stats'),

  // ── Writes ─────────────────────────────────────────────────────────────────
  createTest:   (body) => post('test', body),
  createOrder:  (body) => post('order', body),
  createResult: (body) => post('result', body),

  updateOrder:  (id, body) => patch('order',  { id, ...body }),
  updateResult: (id, body) => patch('result', { id, ...body }),
  updateTest:   (id, body) => patch('test',   { id, ...body }),
}

export default labApi
