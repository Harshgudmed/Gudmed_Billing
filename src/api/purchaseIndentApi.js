import client from './client'

// Store indents and issues. Two doors to one module:
//   /store-indents  a department's own indents (Store Indent in the sidebar)
//   /purchase       the store's side: issue against them, close, cancel an issue
// `client` unwraps to the backend's `{ success, data }` payload.

// The list endpoints useServerPagination pages over.
export const STORE_INDENT_ENDPOINT = '/store-indents' // { resource: 'indents', status, search }
export const PURCHASE_INDENT_ENDPOINT = '/purchase'   // { resource: 'indents' | 'issues', … }

const dept = (resource, params) => client.get(STORE_INDENT_ENDPOINT, { params: { resource, ...params } })
const store = (resource, params) => client.get(PURCHASE_INDENT_ENDPOINT, { params: { resource, ...params } })

export const indentApi = {
  // ── The department ─────────────────────────────────────────────────────────
  getForm:      ()       => dept('form'),            // { departments, myDepartment }
  searchItems:  (params) => dept('items', params),   // { search, page, limit } → items with inStock yes/no, no money
  getMyIndent:  (id)     => dept('indent', { id }),  // lines with issued / pending / inStock, its issues
  raiseIndent:  (body)   => client.post(STORE_INDENT_ENDPOINT, body), // { departmentId?, priority, neededBy, purpose, lines }
  cancelIndent: (id, reason) => client.patch(STORE_INDENT_ENDPOINT, { id, action: 'cancel', reason }),

  // ── The store ──────────────────────────────────────────────────────────────
  getIndent:    (id)     => store('indent', { id }), // lines with pending and what the shelf holds, its issues
  getIssue:     (id)     => store('issue', { id }),  // batch lines, the hospital (for the slip)
  issue:        (body)   => client.post(PURCHASE_INDENT_ENDPOINT, { resource: 'issue', ...body }), // { indentId, receivedByName, notes, lines: [{ indentLineId, quantity }] }
  closeIndent:  (id, reason) => client.patch(PURCHASE_INDENT_ENDPOINT, { resource: 'indent', action: 'close', id, reason }),
  cancelIssue:  (id, reason) => client.patch(PURCHASE_INDENT_ENDPOINT, { resource: 'issue', action: 'cancel', id, reason }), // administrator
}
