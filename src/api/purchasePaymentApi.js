import client from './client'

// Vendor payments — the /purchase resources answered by the server's
// purchasePaymentController.js. Lists are paged with useServerPagination on
// PURCHASE_ENDPOINT (resource 'payables' or 'payments').
const get = (resource, params) => client.get('/purchase', { params: { resource, ...params } })
const patch = (body) => client.patch('/purchase', { resource: 'payment', ...body })

export const purchasePaymentApi = {
  getSettings:  ()          => get('purchase-settings'),          // { paymentMode, … }
  getPayment:   (id)        => get('payment', { id }),             // with its bill, vendor (account masked) and hospital
  getBillDue:   (billId)    => get('payables', { billId }),        // one row when something is still due on it
  getPayments:  (params)    => get('payments', params),            // { billId, status, … }
  record:       (body)      => client.post('/purchase', { resource: 'payment', ...body }), // { billId, amount, mode, reference, paidOn, notes, paymentType, isRecurring }
  approve:      (id, remark) => patch({ id, action: 'approve', remark }),
  reject:       (id, remark) => patch({ id, action: 'reject', remark }),
  cancel:       (id, reason) => patch({ id, action: 'cancel', reason }),
}
