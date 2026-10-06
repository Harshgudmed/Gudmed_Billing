import client from './client'

// Returns to the vendor (debit notes) — the /purchase resources the Returns tab
// uses. Kept apart from purchaseApi.js (shared) so the module owns its calls.
// The list itself is paged with useServerPagination(PURCHASE_ENDPOINT,
// { params: { resource: 'returns', view, status, search } }).

const get = (resource, params) => client.get('/purchase', { params: { resource, ...params } })
const patch = (body) => client.patch('/purchase', { resource: 'return', ...body })

export const purchaseReturnApi = {
  // { returnMode: 'approval' | 'direct', … } — which buttons the store sees
  getSettings:       ()                  => get('purchase-settings'),
  // orders with goods still on the shelf that can go back: [{ id, number, vendorName, status, orderDate }]
  getReturnableOrders: (search)          => get('returnables', { search }),
  // one order's batches: { order, lines: [{ receiptLineId, itemName, batchNumber, onShelf, waiting, returnable, … }] }
  getReturnables:    (orderId)           => get('returnables', { orderId }),
  getReturn:         (id)                => get('return', { id }),
  createReturn:      (body)              => client.post('/purchase', { resource: 'return', ...body }), // { orderId, reason, notes, lines: [{ receiptLineId, quantity }] }
  approveReturn:     (id, remark)        => patch({ id, action: 'approve', remark }),
  rejectReturn:      (id, remark)        => patch({ id, action: 'reject', remark }),
  cancelReturn:      (id, reason)        => patch({ id, action: 'cancel', reason }),
}
