import client from './client'

// ─────────────────────────────────────────────────────────────────────────────
// Centralized Purchase & Supply Chain API — same shape as otApi.js.
// Every "/purchase" resource string lives HERE; components call named methods.
// `client` (axios) already unwraps to response.data → each call resolves to the
// backend's `{ success, data }` payload.
// ─────────────────────────────────────────────────────────────────────────────

const get   = (resource, params)    => client.get('/purchase', { params: { resource, ...params } })
const post  = (resource, body = {}) => client.post('/purchase', { resource, ...body })
const patch = (resource, body = {}) => client.patch('/purchase', { resource, ...body })
const del   = (resource, id)        => client.delete('/purchase', { params: { resource, id } })

// The list endpoint that useServerPagination pages over.
export const PURCHASE_ENDPOINT = '/purchase'

export const purchaseApi = {
  // ── Masters ────────────────────────────────────────────────────────────────
  // The first call for a hospital also creates its default units and categories.
  // Single server-side readiness check — replaces five separate list calls in PurchaseSettings.
  getSetupStatus: () => get('setup-status'),

  getUnits:      (params) => get('units', params),       // { includeInactive }
  getCategories: (params) => get('categories', params),  // { includeInactive } → nested tree

  // Changing units and categories is an administrator's (Settings → Integrations → Purchase Setup).
  // Delete works only for the hospital's own, unused rows; everything else is
  // retired with { isActive: false }.
  createUnit:     (body)     => post('unit', body),         // { code, name, kind, allowsFraction }
  updateUnit:     (id, body) => patch('unit', { id, ...body }),
  deleteUnit:     (id)       => del('unit', id),
  createCategory: (body)     => post('category', body),     // { name, parentId?, purchaseType, expenseHead, defaultGstRate }
  updateCategory: (id, body) => patch('category', { id, ...body }),
  deleteCategory: (id)       => del('category', id),

  // Vendors. The list masks bank account numbers; getVendor returns them in
  // full to admin / purchase officer (what the edit form needs).
  getVendors:          (params)     => get('vendors', params),     // { search, status, page, limit }
  getVendor:           (id)         => get('vendor', { id }),
  getStates:           ()           => get('states'),              // GST state codes, for the state picker
  createVendor:        (body)       => post('vendor', body),
  updateVendor:        (id, body)   => patch('vendor', { id, ...body }), // also { isActive } to retire / restore
  // Budgets (CapEx / OpEx / Project)
  getBudgets:    (params) => get('budgets', params),   // { financialYear, budgetType, departmentId }
  getBudget:     (id)     => get('budget', { id }),
  createBudget:  (body)   => post('budget', body),
  updateBudget:  (id, body) => patch('budget', { id, ...body }),

  // Vendor bulk import
  downloadVendorTemplate: () => client.get('/purchase/vendor-import/template', { responseType: 'blob' }),
  importVendors: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return client.post('/purchase/vendor-import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  // Vendor documents (PAN cert, GST cert, other compliance papers)
  getVendorDocs:       (vendorId)   => get('vendor-documents', { vendorId }),
  deleteVendorDoc:     (id)         => del('vendor-document', id),
  // Upload goes directly to /uploads/vendor-documents (not /purchase) — see uploadRoutes.js
  uploadVendorDoc:     (vendorId, docType, label, file) => {
    const fd = new FormData()
    fd.append('document', file)
    fd.append('vendorId', vendorId)
    fd.append('docType', docType)
    if (label) fd.append('label', label)
    return client.post('/uploads/vendor-documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },

  // Items. Each carries its category (+ parent), stock unit, usual vendor and
  // unit conversions. A top-level categoryId also matches its sub-categories.
  getItems:      (params) => get('items', params),       // { search, status, categoryId, page, limit }
  getItem:       (id)     => get('item', { id }),
  getGstRates:   ()       => get('gst-rates'),           // the rates an item may carry
  createItem:    (body)   => post('item', body),
  updateItem:    (id, body) => patch('item', { id, ...body }), // `conversions` replaces the list; { isActive } retires

  // ── Purchase requests ──────────────────────────────────────────────────────
  // The list is paged with useServerPagination (resource 'requests',
  // { status, priority, departmentId, search, view: 'mine' | 'to-approve' }).
  getRequest:       (id)       => get('request', { id }),    // lines, department, steps, currentStep
  getDashboard:     ()         => get('dashboard'),          // the landing page: cards, pipeline, attention, myOpen, approvedLast30Days, activity
  createRequest:    (body)     => post('request', body),     // a draft: { departmentId, requiredBy, priority, purpose, lines }
  saveRequest:      (id, body) => patch('request', { id, action: 'save', ...body }), // `lines` replaces the list
  submitRequest:    (id)       => patch('request', { id, action: 'submit' }),
  approveRequest:   (id, remark) => patch('request', { id, action: 'approve', remark }),
  rejectRequest:    (id, remark) => patch('request', { id, action: 'reject', remark }),
  cancelRequest:    (id, reason) => patch('request', { id, action: 'cancel', reason }),
  reopenRequest:    (id)       => patch('request', { id, action: 'reopen' }),
  deleteRequest:    (id)       => del('request', id),          // drafts only

  // ── Purchase orders ────────────────────────────────────────────────────────
  // The list is paged with useServerPagination (resource 'orders',
  // { status, vendorId, search, view: 'to-approve' | 'to-send' | 'mine' }).
  getOrder:           (id)       => get('order', { id }),            // lines (+ the request each came from), vendor, steps, hospital
  getOrderCandidates: (params)   => get('order-candidates', params), // approved request lines not on an order yet ({ requestId })
  createOrder:        (body)     => post('order', body),             // a draft: { vendorId, expectedDate, terms, notes, lines }
  saveOrder:          (id, body) => patch('order', { id, action: 'save', ...body }),
  submitOrder:        (id)       => patch('order', { id, action: 'submit' }),
  approveOrder:       (id, remark) => patch('order', { id, action: 'approve', remark }),
  rejectOrder:        (id, remark) => patch('order', { id, action: 'reject', remark }),
  sendOrder:          (id)       => patch('order', { id, action: 'send' }),   // given to the vendor
  cancelOrder:        (id, reason) => patch('order', { id, action: 'cancel', reason }),
  reopenOrder:        (id)       => patch('order', { id, action: 'reopen' }),
  closeOrder:         (id, reason) => patch('order', { id, action: 'close', reason }), // part received, the rest is not coming
  deleteOrder:        (id)       => del('order', id),                // drafts only

  // ── Goods receipts and stock ───────────────────────────────────────────────
  // Lists paged with useServerPagination: resource 'receipts' ({ search, orderId,
  // status, startDate, endDate — received on, YYYY-MM-DD }) and 'stock' ({ search,
  // categoryId, status: low | out | in_stock | expiring } → rows + summary).
  // Rates and values are left out for the store.
  getReceipt:    (id)     => get('receipt', { id }),
  // { orderId, receivedAt, challanNumber, challanDate, notes,
  //   lines: [{ orderLineId, receivedQty, rejectedQty, rejectReason, batchNumber, expiryDate }] }
  createReceipt: (body)   => post('receipt', body),
  cancelReceipt: (id, reason) => patch('receipt', { id, action: 'cancel', reason }), // administrator; takes the goods back out of stock
  getStockItem:  (id)     => get('stock-item', { id }),   // its batches and its last 100 movements

  // ── Vendor bills (3-way match: order rate × goods received × vendor's invoice) ─
  // The list is paged with useServerPagination: resource 'bills' ({ search, status,
  // view: 'on-hold' | 'approved' | 'mine', orderId }) → rows + summary.
  getBillCandidates: (params) => get('bill-candidates', params), // orders with goods received and not billed; ({ orderId }) → that order's billable lines, TDS and due days
  getBill:       (id)       => get('bill', { id }),
  // { orderId, vendorInvoiceNumber, vendorInvoiceDate, invoiceTotal?, tdsSection?, tdsRate?, notes?,
  //   lines: [{ orderLineId, quantity, rate, discountPct?, gstRate? }], submit? }
  createBill:    (body)     => post('bill', body),
  saveBill:      (id, body) => patch('bill', { id, action: 'save', ...body }),
  submitBill:    (id)       => patch('bill', { id, action: 'submit' }),   // matched → approved; else on hold for Finance
  approveBill:   (id, remark) => patch('bill', { id, action: 'approve', remark }),
  rejectBill:    (id, remark) => patch('bill', { id, action: 'reject', remark }),
  cancelBill:    (id, reason) => patch('bill', { id, action: 'cancel', reason }),
  reopenBill:    (id)       => patch('bill', { id, action: 'reopen' }),
  deleteBill:    (id)       => del('bill', id),                          // drafts only

  // Who approves how much (the store gets the levels without their ₹ amounts).
  // Changing them is an administrator's.
  getApprovalRules:  (documentType = 'PR') => get('approval-rules', { documentType }),
  saveApprovalRules: (rules, documentType = 'PR') => patch('approval-rules', { documentType, rules }), // [{ approverRole, minAmount }] in level order
}
